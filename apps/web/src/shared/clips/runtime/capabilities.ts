/**
 * Capability probe and tier selection (plan 5, 5.1, 6.5, 3a).
 *
 * Feature detection only: the user-agent string is never parsed. It is only
 * part of the cache key, as an opaque string, so a browser update probes again.
 *
 * Two kinds of probe:
 * - Quick probes run on every call (presence checks, MediaRecorder types,
 *   canShare, memory class). They also make the cache key.
 * - Encode probes run in a worker (capabilities.worker.ts). The probes re-run
 *   at every arm (plan 5), except that a DEFINITIVE report (no transient
 *   failure: see isDefinitiveReport) is cached under the hash of the quick
 *   results plus the user agent, for 7 days (GPU drivers change without a
 *   user-agent change). A report with a timeout or an encoder error is never
 *   cached, so one busy or cold encoder does not pin the device for a week.
 *   The WebGL2 readback check is cached with the encode probes.
 *
 * Worker failure: the probe worker starts the same way as the encode and io
 * workers (new Worker(new URL(...)), which needs Next 16.3 or later,
 * vercel/next.js #94015). When it cannot start, the encode worker cannot
 * either: the tier is then M or V (MediaRecorder on the main thread), never W
 * or W+. The window-scope fallback probe runs once per session; the failure
 * and that report are kept in memory for the session, so later arms do not
 * run encoders on the main thread again.
 *
 * Display rate: measured BEFORE the encode probes start (never during them),
 * and kept per session and screen at the highest reliable value (see
 * rungs.ts), so a measurement taken while a slow game runs never lowers it.
 * Callers that measured on the start card pass displayHz.
 *
 * Call the probe while no encode session is live (before arm): phones have
 * few hardware encoder sessions, and a busy one fails the probe.
 *
 * No window or navigator access happens at import time (SSR-safe).
 */
import {
  PRESETS,
  type Capabilities,
  type MemoryClass,
  type Orientation,
  type OutputPreset,
  type Tier,
  type VideoEncoderChoice,
} from "../protocol";
import {
  globalProbeEnv,
  isDefinitiveReport,
  runProbe,
  SOFTWARE_TARGET,
  type ProbeRequest,
  type ProbeResponse,
  type VideoAttempt,
  type WorkerProbeReport,
} from "./capabilityProbe";
import { measureDisplayHz, rememberDisplayHz, rememberedDisplayHz, screenKey } from "./rungs";

// ---------------------------------------------------------------------------
// Memory class and tier (pure)
// ---------------------------------------------------------------------------

export interface MemoryInput {
  /** navigator.deviceMemory (Chromium only). */
  deviceMemory?: number;
  /** navigator.platform, for example "iPhone", "iPad", "MacIntel". */
  platform?: string;
  maxTouchPoints?: number;
  /** "AudioEncoder" in self. On an iPhone it means iOS 26+ and an A13 or newer. */
  audioEncoderPresent: boolean;
  /** The primary pointer is coarse (a phone or a tablet). */
  coarsePointer?: boolean;
}

/**
 * Memory class (plan 6.5, 3a):
 * - Chromium: deviceMemory <= 2 GB low, <= 4 GB mid, more high.
 * - iPhone with AudioEncoder: mid. Older iPhones: low.
 * - Every iPad: low (iPadOS 26 also runs on 2-3 GB A12 iPads). iPadOS reports
 *   "MacIntel" with touch points, so that counts as an iPad.
 * - Other touch-first devices with no memory hint (Firefox Android): low.
 * - Desktops with no memory hint (Safari, Firefox): mid.
 */
export function memoryClassFor(input: MemoryInput): MemoryClass {
  if (typeof input.deviceMemory === "number" && input.deviceMemory > 0) {
    if (input.deviceMemory <= 2) return "low";
    if (input.deviceMemory <= 4) return "mid";
    return "high";
  }
  const platform = input.platform ?? "";
  if (platform === "iPhone" || platform === "iPod") return input.audioEncoderPresent ? "mid" : "low";
  if (platform === "iPad" || (platform === "MacIntel" && (input.maxTouchPoints ?? 0) > 1)) return "low";
  if (input.coarsePointer) return "low";
  return "mid";
}

export interface TierInput {
  worker: boolean;
  videoEncoderH264: boolean;
  audioEncoderAac: boolean;
  webAssembly: boolean;
  mediaRecorderMp4: boolean;
  mediaRecorderWebm: boolean;
}

/**
 * Tier (plan 5):
 * - W: WebCodecs H.264 and native AAC.
 * - W+: WebCodecs H.264, AAC from the WASM encoder.
 * - M: no H.264 encoder, MediaRecorder MP4 (H.264 + AAC).
 * - V: no H.264 encoder, MediaRecorder WebM (VP8 + Opus).
 * - none: nothing records.
 */
export function selectTier(input: TierInput): Tier {
  if (input.worker && input.videoEncoderH264) {
    if (input.audioEncoderAac) return "W";
    if (input.webAssembly) return "W+";
  }
  if (input.mediaRecorderMp4) return "M";
  if (input.mediaRecorderWebm) return "V";
  return "none";
}

// ---------------------------------------------------------------------------
// Encoder choice for a session (plan 5.1)
// ---------------------------------------------------------------------------

export type ContentKind = "2d" | "3d" | "replay";

export interface EncoderPlan {
  video: VideoEncoderChoice;
  /**
   * 90 when the encoder rejects portrait coded frames: the compositor then
   * paints the tall frame rotated into a landscape coded frame, and the muxer
   * writes rotation metadata.
   */
  rotation: 0 | 90;
  /** True when only a software encoder works (one size step down, at most 30 fps). */
  software: boolean;
}

/** Bitrates (VBR), plan 5.1. */
export function bitrateFor(content: ContentKind, fps: number): number {
  if (content === "replay") return 1_000_000;
  if (content === "3d") return 3_000_000;
  return fps > 30 ? 3_500_000 : 2_000_000;
}

/**
 * The software preset: one size step down from PRESETS, with both sides
 * multiples of 16 (the probe encodes these sizes; see SOFTWARE_TARGET).
 */
export const SOFTWARE_PRESETS: Record<Orientation, { width: number; height: number }> = {
  tall: { width: SOFTWARE_TARGET.height, height: SOFTWARE_TARGET.width },
  wide: { width: SOFTWARE_TARGET.width, height: SOFTWARE_TARGET.height },
};

/**
 * The encoder configuration for a session, or null when the tier has no
 * WebCodecs video encoder.
 *
 * It only returns a size, a frame rate and a codec string that the probe
 * really encoded with the same hardwareAcceleration:
 * - the preset size (the software preset when only software encodes), at 60
 *   fps when asked for and probed, else at 30 fps;
 * - a tall frame uses the landscape attempt of the same size when portrait
 *   coded frames were probed and work (the level is the same), and a
 *   landscape coded frame with rotation 90 when they do not;
 * - when no attempt matches, the probed base target (the first size that
 *   encoded).
 */
export function chooseVideoEncoder(report: CapabilityReport, preset: OutputPreset, content: ContentKind): EncoderPlan | null {
  const caps = report.caps;
  if (!caps.videoEncoderH264 || !report.video.ok) return null;
  const software = !caps.hardwareEncoder;
  const accel = software ? "no-preference" : "prefer-hardware";
  const worked = report.video.attempts.filter((a) => a.ok && a.hardwareAcceleration === accel);
  if (worked.length === 0) return null;
  const find = (w: number, h: number, fps: number): VideoAttempt | undefined =>
    worked.find((a) => a.width === w && a.height === h && a.fps === fps);

  const size = (software ? SOFTWARE_PRESETS : PRESETS)[preset.orientation];
  const tall = size.height > size.width;
  const rotate = tall && !report.video.portrait;
  const codedW = rotate ? size.height : size.width;
  const codedH = rotate ? size.width : size.height;
  const fpsOrder = !software && preset.targetFps === 60 ? [60, 30] : [30];

  let chosen: { attempt: VideoAttempt; width: number; height: number; fps: number; rotation: 0 | 90 } | null = null;
  for (const fps of fpsOrder) {
    // A portrait size also matches its landscape attempt: same macroblocks, same level.
    const attempt = find(codedW, codedH, fps) ?? (codedH > codedW ? find(codedH, codedW, fps) : undefined);
    if (attempt) {
      chosen = { attempt, width: codedW, height: codedH, fps, rotation: rotate ? 90 : 0 };
      break;
    }
  }
  if (!chosen) {
    // The probed base target, in the shape the content needs.
    const base = worked[0];
    const baseTall = tall && report.video.portrait;
    chosen = {
      attempt: base,
      width: baseTall ? Math.min(base.width, base.height) : Math.max(base.width, base.height),
      height: baseTall ? Math.max(base.width, base.height) : Math.min(base.width, base.height),
      fps: base.fps,
      rotation: tall && !report.video.portrait ? 90 : 0,
    };
  }
  const { width, height, fps } = chosen;
  const areaScale = (width * height) / (PRESETS.tall.width * PRESETS.tall.height);
  const bitrate = Math.max(1_000_000, Math.round(bitrateFor(content, fps) * Math.min(1, areaScale)));
  return {
    video: {
      codec: chosen.attempt.codec,
      width,
      height,
      bitrate,
      framerate: fps,
      latencyMode: "quality",
      hardwareAcceleration: accel,
    },
    rotation: chosen.rotation,
    software,
  };
}

// ---------------------------------------------------------------------------
// Probe orchestration
// ---------------------------------------------------------------------------

/** What a probe found, beyond the contract's Capabilities. */
export interface CapabilityReport {
  caps: Capabilities;
  video: WorkerProbeReport["video"];
  audio: WorkerProbeReport["audio"];
  /** Where the encode probes ran. "window" means the worker could not start. */
  probeScope: "worker" | "window";
  /** Why the probe worker could not start, or null. */
  workerFailure: string | null;
  /** Hash of the quick probes plus the user agent. */
  fingerprint: string;
  /** When the encode probes ran (ms since the epoch). */
  probedAt: number;
  /** True when the encode probes came from the storage cache or the session memo. */
  fromCache: boolean;
  /** True when the report was written to the storage cache (a definitive report). */
  cached: boolean;
}

/** A Worker, or a test double. */
export interface WorkerLike {
  postMessage(message: ProbeRequest): void;
  onmessage: ((event: MessageEvent<ProbeResponse>) => void) | null;
  onerror: ((event: unknown) => void) | null;
  terminate(): void;
}

/** The global objects the quick probes read. Tests pass fakes. */
export interface ProbeGlobals {
  navigator?: {
    userAgent?: string;
    platform?: string;
    maxTouchPoints?: number;
    deviceMemory?: number;
    canShare?: (data: { files: File[] }) => boolean;
  };
  Worker?: unknown;
  WebAssembly?: unknown;
  VideoEncoder?: unknown;
  VideoFrame?: unknown;
  AudioEncoder?: unknown;
  AudioData?: unknown;
  AudioDecoder?: unknown;
  MediaRecorder?: { isTypeSupported(type: string): boolean };
  File?: typeof File;
  matchMedia?: (query: string) => { matches: boolean };
  document?: { createElement(tag: "canvas"): HTMLCanvasElement };
  /** For the display-rate memo key. */
  screen?: { width?: number; height?: number };
  devicePixelRatio?: number;
}

export interface ProbeOptions {
  /** Ignore the storage cache and the session memo; try the worker again. */
  force?: boolean;
  globals?: ProbeGlobals;
  /** Start the probe worker. Return null when workers are not available. */
  createWorker?: () => WorkerLike | null;
  /** Run the encode probes in this scope when the worker fails (default: window scope). */
  fallbackProbe?: (request: ProbeRequest) => Promise<WorkerProbeReport>;
  /** Measure the display rate (default: 40 rAF intervals of the window). */
  measureHz?: () => Promise<number>;
  /** A display rate the caller measured while the game was idle. Skips the measurement. */
  displayHz?: number;
  /** Cache storage. Default: localStorage when it works. Null turns the cache off. */
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  now?: () => number;
  /** Time limit for the whole worker probe. Default 90 s. */
  workerTimeoutMs?: number;
  /**
   * Called when the probe worker cannot start (a hard error: the tier falls
   * to M or V). Called again on later probes of the same session.
   */
  onWorkerFailure?: (reason: string) => void;
}

export const CAPS_CACHE_ITEM = "hankshits.clips.capabilities.v1";
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const MP4_TYPE = "video/mp4;codecs=avc1,mp4a.40.2";
export const WEBM_TYPE = "video/webm;codecs=vp8,opus";

/** FNV-1a, 32 bit, as 8 hex digits. Not for security: a cache key only. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

interface QuickProbes {
  worker: boolean;
  webAssembly: boolean;
  videoEncoder: boolean;
  videoFrame: boolean;
  audioEncoder: boolean;
  audioData: boolean;
  audioDecoder: boolean;
  mediaRecorderMp4: boolean;
  mediaRecorderWebm: boolean;
  shareFiles: boolean;
  memoryClass: MemoryClass;
}

function defaultGlobals(): ProbeGlobals {
  return globalThis as unknown as ProbeGlobals;
}

function isTypeSupported(g: ProbeGlobals, type: string): boolean {
  try {
    return Boolean(g.MediaRecorder?.isTypeSupported(type));
  } catch {
    return false;
  }
}

function canShareVideo(g: ProbeGlobals): boolean {
  const nav = g.navigator;
  if (!nav?.canShare || !g.File) return false;
  try {
    return nav.canShare({ files: [new g.File([new Uint8Array(8)], "clip.mp4", { type: "video/mp4" })] });
  } catch {
    return false;
  }
}

export function quickProbes(g: ProbeGlobals = defaultGlobals()): QuickProbes {
  const nav = g.navigator ?? {};
  let coarse = false;
  try {
    coarse = Boolean(g.matchMedia?.("(pointer: coarse)").matches);
  } catch {
    coarse = false;
  }
  return {
    worker: typeof g.Worker === "function",
    webAssembly: typeof g.WebAssembly === "object" && g.WebAssembly !== null,
    videoEncoder: typeof g.VideoEncoder === "function",
    videoFrame: typeof g.VideoFrame === "function",
    audioEncoder: typeof g.AudioEncoder === "function",
    audioData: typeof g.AudioData === "function",
    audioDecoder: typeof g.AudioDecoder === "function",
    mediaRecorderMp4: isTypeSupported(g, MP4_TYPE),
    mediaRecorderWebm: isTypeSupported(g, WEBM_TYPE),
    shareFiles: canShareVideo(g),
    memoryClass: memoryClassFor({
      deviceMemory: nav.deviceMemory,
      platform: nav.platform,
      maxTouchPoints: nav.maxTouchPoints,
      audioEncoderPresent: typeof g.AudioEncoder === "function",
      coarsePointer: coarse,
    }),
  };
}

/** WebGL2 with fenceSync, clientWaitSync, getBufferSubData and PIXEL_PACK_BUFFER (path E). */
export function probeWebGL2Readback(g: ProbeGlobals = defaultGlobals()): boolean {
  let gl: WebGL2RenderingContext | null = null;
  try {
    const canvas = g.document?.createElement("canvas");
    if (!canvas) return false;
    canvas.width = 2;
    canvas.height = 2;
    gl = canvas.getContext("webgl2");
    if (!gl) return false;
    return (
      typeof gl.fenceSync === "function" &&
      typeof gl.clientWaitSync === "function" &&
      typeof gl.getBufferSubData === "function" &&
      typeof gl.PIXEL_PACK_BUFFER === "number"
    );
  } catch {
    return false;
  } finally {
    // Give the context back at once: a page may hold only a few.
    try {
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      // Nothing to release.
    }
  }
}

interface CachedProbe {
  fingerprint: string;
  probedAt: number;
  report: WorkerProbeReport;
  webgl2AsyncReadback: boolean;
}

function readCache(storage: ProbeOptions["storage"], fingerprint: string, now: number): CachedProbe | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(CAPS_CACHE_ITEM);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedProbe;
    if (cached.fingerprint !== fingerprint) return null;
    if (!(now - cached.probedAt >= 0 && now - cached.probedAt < CACHE_MAX_AGE_MS)) return null;
    if (!cached.report?.video || !cached.report?.audio) return null;
    return cached;
  } catch {
    return null;
  }
}

/** Returns true when the entry was stored. */
function writeCache(storage: ProbeOptions["storage"], entry: CachedProbe): boolean {
  if (!storage) return false;
  try {
    storage.setItem(CAPS_CACHE_ITEM, JSON.stringify(entry));
    return true;
  } catch {
    // Quota or a private window: the probe simply runs again next time.
    return false;
  }
}

function defaultStorage(): ProbeOptions["storage"] {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function defaultCreateWorker(): WorkerLike | null {
  if (typeof Worker === "undefined") return null;
  return new Worker(new URL("./capabilities.worker.ts", import.meta.url), {
    type: "module",
  }) as unknown as WorkerLike;
}

function runWorkerProbe(
  create: () => WorkerLike | null,
  request: ProbeRequest,
  timeoutMs: number,
): Promise<WorkerProbeReport> {
  return new Promise((resolve, reject) => {
    let worker: WorkerLike | null;
    try {
      worker = create();
    } catch (error) {
      reject(new Error(`worker did not start: ${String(error)}`));
      return;
    }
    if (!worker) {
      reject(new Error("workers are not available"));
      return;
    }
    const w = worker;
    const timer = setTimeout(() => finish(new Error("worker probe timed out")), timeoutMs);
    function finish(error: Error | null, report?: WorkerProbeReport) {
      clearTimeout(timer);
      w.onmessage = null;
      w.onerror = null;
      w.terminate();
      if (error) reject(error);
      else resolve(report as WorkerProbeReport);
    }
    w.onmessage = (event) => {
      const data = event.data;
      if (data?.t === "probe-result") finish(null, data.report);
      else if (data?.t === "probe-error") finish(new Error(data.error));
    };
    w.onerror = () => finish(new Error("worker error"));
    w.postMessage(request);
  });
}

/** Time the display-rate measurement may take before it counts as hidden. */
export const HZ_MEASURE_TIMEOUT_MS = 2000;

/**
 * The display rate: a caller's idle value, or a measurement. Either one goes
 * through the session memo, which keeps the highest rate per screen. When rAF
 * does not run (a hidden tab), the memo or 60 Hz.
 */
async function displayRate(options: ProbeOptions, g: ProbeGlobals): Promise<number> {
  const key = screenKey(g);
  if (typeof options.displayHz === "number" && options.displayHz > 0) return rememberDisplayHz(key, options.displayHz);
  const measure =
    options.measureHz ??
    (() =>
      typeof window === "undefined" || typeof window.requestAnimationFrame !== "function"
        ? Promise.resolve(null)
        : measureDisplayHz(window));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hidden = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), HZ_MEASURE_TIMEOUT_MS);
  });
  let measured: number | null = null;
  try {
    measured = await Promise.race([measure(), hidden]);
  } catch {
    measured = null;
  } finally {
    clearTimeout(timer);
  }
  if (measured === null || !Number.isFinite(measured) || measured <= 0) return rememberedDisplayHz(key) ?? 60;
  return rememberDisplayHz(key, measured);
}

/** Session memory of the probe worker (module state; one page is one session). */
const session: {
  workerFailure: string | null;
  windowReport: CachedProbe | null;
} = { workerFailure: null, windowReport: null };

/** Forget the session memory of the probe worker (tests). */
export function resetProbeSession(): void {
  session.workerFailure = null;
  session.windowReport = null;
}

/** Run the probes (or read the cache) and return the full report. */
export async function probeCapabilityReport(options: ProbeOptions = {}): Promise<CapabilityReport> {
  const g = options.globals ?? defaultGlobals();
  const now = options.now ?? (() => Date.now());
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const quick = quickProbes(g);
  const fingerprint = fnv1a(JSON.stringify(quick) + "|" + (g.navigator?.userAgent ?? ""));
  // Measure first: an encode probe running at the same time would slow rAF.
  const displayHz = await displayRate(options, g);

  let entry = options.force ? null : readCache(storage, fingerprint, now());
  let probeScope: "worker" | "window" = entry?.report.scope ?? "worker";
  let fromCache = entry !== null;
  let cachedNow = false;
  if (!entry && !options.force && session.workerFailure !== null && session.windowReport?.fingerprint === fingerprint) {
    // The worker failed earlier in this session: reuse the window-scope result.
    entry = session.windowReport;
    probeScope = "window";
    fromCache = true;
    options.onWorkerFailure?.(session.workerFailure);
  }
  if (!entry) {
    const request: ProbeRequest = { t: "probe" };
    let report: WorkerProbeReport | null = null;
    if (options.force || session.workerFailure === null) {
      try {
        report = await runWorkerProbe(options.createWorker ?? defaultCreateWorker, request, options.workerTimeoutMs ?? 90_000);
        probeScope = "worker";
        session.workerFailure = null;
      } catch (error) {
        session.workerFailure = error instanceof Error ? error.message : String(error);
      }
    }
    if (!report) {
      options.onWorkerFailure?.(session.workerFailure ?? "worker failed");
      const fallback = options.fallbackProbe ?? ((r: ProbeRequest) => runProbe(globalProbeEnv("window"), r));
      report = await fallback(request);
      probeScope = "window";
    }
    entry = { fingerprint, probedAt: now(), report, webgl2AsyncReadback: probeWebGL2Readback(g) };
    if (probeScope === "window") {
      // Never stored: the worker is tried again in the next session.
      session.windowReport = entry;
    } else if (isDefinitiveReport(report)) {
      cachedNow = writeCache(storage, entry);
    }
  }

  const report = entry.report;
  const workerRuns = probeScope === "worker";
  const caps: Capabilities = {
    tier: selectTier({
      // The encode worker starts like the probe worker: no worker probe, no W tier.
      worker: quick.worker && workerRuns,
      videoEncoderH264: report.video.ok,
      audioEncoderAac: report.audio.aac,
      webAssembly: quick.webAssembly,
      mediaRecorderMp4: quick.mediaRecorderMp4,
      mediaRecorderWebm: quick.mediaRecorderWebm,
    }),
    videoEncoderH264: report.video.ok,
    h264Levels: [...report.video.levels],
    hardwareEncoder: report.video.hardware,
    audioEncoderAac: report.audio.aac,
    audioData: quick.audioData,
    audioDecoder: quick.audioDecoder,
    mediaRecorderMp4: quick.mediaRecorderMp4,
    mediaRecorderWebm: quick.mediaRecorderWebm,
    webgl2AsyncReadback: entry.webgl2AsyncReadback,
    opfsSyncAccess: report.opfsSyncAccess,
    shareFiles: quick.shareFiles,
    memoryClass: quick.memoryClass,
    displayHz,
  };
  return {
    caps,
    video: report.video,
    audio: report.audio,
    probeScope,
    workerFailure: workerRuns ? null : session.workerFailure,
    fingerprint,
    probedAt: entry.probedAt,
    fromCache,
    cached: cachedNow,
  };
}

/**
 * The contract's Capabilities for this device. Call it while no encode
 * session is live (before arm).
 */
export async function probeCapabilities(options: ProbeOptions = {}): Promise<Capabilities> {
  return (await probeCapabilityReport(options)).caps;
}
