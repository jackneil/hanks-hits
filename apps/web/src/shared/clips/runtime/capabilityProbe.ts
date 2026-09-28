/**
 * Encoder and storage probes that run in a worker (plan 5, 5.1).
 *
 * Feature detection only. The probes ENCODE (isConfigSupported alone is not
 * proof): 2 frames per video candidate, and 2048 samples of silence for AAC.
 * The encode worker uses the same scope, so a worker probe is the truth.
 *
 * All browser APIs come in through a ProbeEnv, so tests call runProbe()
 * directly with fakes, and capabilities.ts can run the same code in window
 * scope when a worker cannot start.
 */
import { AUDIO_BITRATE, AUDIO_CHANNELS, AUDIO_SAMPLE_RATE } from "../protocol";
import { avcCodecString, avcLevelHex, PROFILE_ORDER, type AvcProfile } from "./avcLevel";

/** The subset of a FileSystemSyncAccessHandle the probe uses. */
interface SyncHandle {
  write(buffer: ArrayBufferView, options?: { at?: number }): number;
  read(buffer: ArrayBufferView, options?: { at?: number }): number;
  flush(): void;
  close(): void;
}
interface ProbeFileHandle {
  createSyncAccessHandle?: () => Promise<SyncHandle>;
}
interface ProbeDirectory {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<ProbeFileHandle>;
  removeEntry(name: string): Promise<void>;
}

export interface ProbeEnv {
  scope: "worker" | "window";
  VideoEncoder?: typeof VideoEncoder;
  VideoFrame?: typeof VideoFrame;
  AudioEncoder?: typeof AudioEncoder;
  AudioData?: typeof AudioData;
  AudioDecoder?: unknown;
  getDirectory?: () => Promise<ProbeDirectory>;
  /** Time limit for one encode probe. Default 4000 ms. */
  timeoutMs?: number;
  now?: () => number;
}

export interface VideoTarget {
  width: number;
  height: number;
  fps: number;
}

/** 720p30 (level 3.1), 720p60 (3.2) and 1080p30 (4.0), plan 5.1. */
export const DEFAULT_TARGETS: readonly VideoTarget[] = [
  { width: 1280, height: 720, fps: 30 },
  { width: 1280, height: 720, fps: 60 },
  { width: 1920, height: 1080, fps: 30 },
];

export type Acceleration = "prefer-hardware" | "no-preference";

export interface VideoAttempt {
  codec: string;
  width: number;
  height: number;
  fps: number;
  hardwareAcceleration: Acceleration;
  ok: boolean;
  /** Why it failed: unsupported, threw, timeout, error, no-output, not-key, no-description. */
  reason: string | null;
  outputs: number;
  ms: number;
}

export interface WorkerProbeReport {
  scope: "worker" | "window";
  video: {
    ok: boolean;
    hardware: boolean;
    /** Levels that probe-encoded, for example ["1f", "20", "28"]. */
    levels: string[];
    /** The first codec string that encoded, per level. */
    codecByLevel: Record<string, string>;
    /** The encoder accepts portrait coded frames (720x1280). */
    portrait: boolean;
    attempts: VideoAttempt[];
  };
  audio: {
    aac: boolean;
    reason: string | null;
    /** What the encoder gave as its decoder description: raw ASC, an esds box (WebKit 302253), or none. */
    description: "asc" | "esds" | "other" | "none";
  };
  audioData: boolean;
  audioDecoder: boolean;
  opfsSyncAccess: boolean;
}

export interface ProbeRequest {
  t: "probe";
  targets?: VideoTarget[];
  timeoutMs?: number;
}

export type ProbeResponse = { t: "probe-result"; report: WorkerProbeReport } | { t: "probe-error"; error: string };

function bitrateFor(target: VideoTarget): number {
  const pixels = target.width * target.height;
  const base = target.fps > 30 ? 3_500_000 : 3_000_000;
  return Math.round(base * Math.max(1, pixels / (1280 * 720)));
}

class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new TimeoutError("timeout")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const i420Cache = new Map<string, Uint8Array>();
function i420(width: number, height: number): Uint8Array {
  const key = `${width}x${height}`;
  let buf = i420Cache.get(key);
  if (!buf) {
    buf = new Uint8Array(width * height + 2 * Math.ceil(width / 2) * Math.ceil(height / 2)).fill(0x80);
    i420Cache.set(key, buf);
  }
  return buf;
}

/** Encode 2 frames with one configuration. */
export async function probeVideoConfig(
  env: ProbeEnv,
  codec: string,
  target: VideoTarget,
  hardwareAcceleration: Acceleration,
): Promise<VideoAttempt> {
  const now = env.now ?? (() => performance.now());
  const t0 = now();
  const attempt: VideoAttempt = {
    codec,
    width: target.width,
    height: target.height,
    fps: target.fps,
    hardwareAcceleration,
    ok: false,
    reason: null,
    outputs: 0,
    ms: 0,
  };
  const done = (reason: string | null) => {
    attempt.ok = reason === null;
    attempt.reason = reason;
    attempt.ms = Math.round(now() - t0);
    return attempt;
  };
  const Encoder = env.VideoEncoder;
  const Frame = env.VideoFrame;
  if (!Encoder || !Frame) return done("missing");
  const config: VideoEncoderConfig = {
    codec,
    width: target.width,
    height: target.height,
    bitrate: bitrateFor(target),
    bitrateMode: "variable",
    framerate: target.fps,
    latencyMode: "quality",
    hardwareAcceleration,
    avc: { format: "avc" },
  };
  try {
    const support = await withTimeout(Encoder.isConfigSupported(config), env.timeoutMs ?? 4000);
    if (!support.supported) return done("unsupported");
  } catch (error) {
    return done(error instanceof TimeoutError ? "timeout" : "threw");
  }
  let firstType: string | null = null;
  let description = false;
  let failed: unknown = null;
  let encoder: VideoEncoder | null = null;
  try {
    encoder = new Encoder({
      output: (chunk, meta) => {
        if (attempt.outputs === 0) firstType = chunk.type;
        attempt.outputs++;
        if (meta?.decoderConfig?.description) description = true;
      },
      error: (error) => {
        failed = error;
      },
    });
    encoder.configure(config);
    const data = i420(target.width, target.height);
    for (let i = 0; i < 2; i++) {
      const frame = new Frame(data, {
        format: "I420",
        codedWidth: target.width,
        codedHeight: target.height,
        timestamp: Math.round((i * 1e6) / target.fps),
        duration: Math.round(1e6 / target.fps),
      });
      encoder.encode(frame, { keyFrame: i === 0 });
      frame.close();
    }
    await withTimeout(encoder.flush(), env.timeoutMs ?? 4000);
  } catch (error) {
    failed = failed ?? error;
    if (error instanceof TimeoutError) return done("timeout");
  } finally {
    try {
      encoder?.close();
    } catch {
      // Already closed after an error.
    }
  }
  if (failed) return done("error");
  if (attempt.outputs === 0) return done("no-output");
  if (firstType !== "key") return done("not-key");
  if (!description) return done("no-description");
  return done(null);
}

async function firstWorkingProfile(
  env: ProbeEnv,
  target: VideoTarget,
  accel: Acceleration,
  attempts: VideoAttempt[],
  profiles: readonly AvcProfile[] = PROFILE_ORDER,
): Promise<string | null> {
  const level = avcLevelHex(target.width, target.height, target.fps, { bitrate: bitrateFor(target) });
  if (!level) return null;
  for (const profile of profiles) {
    const attempt = await probeVideoConfig(env, avcCodecString(profile, level), target, accel);
    attempts.push(attempt);
    if (attempt.ok) return attempt.codec;
  }
  return null;
}

export async function probeVideo(env: ProbeEnv, targets: readonly VideoTarget[] = DEFAULT_TARGETS): Promise<WorkerProbeReport["video"]> {
  const result: WorkerProbeReport["video"] = {
    ok: false,
    hardware: false,
    levels: [],
    codecByLevel: {},
    portrait: false,
    attempts: [],
  };
  if (!env.VideoEncoder || !env.VideoFrame || targets.length === 0) return result;
  const [base, ...rest] = targets;
  // Hardware first; software only when no hardware encoder answers (plan 5.1).
  let accel: Acceleration = "prefer-hardware";
  let baseCodec = await firstWorkingProfile(env, base, accel, result.attempts);
  if (!baseCodec) {
    accel = "no-preference";
    baseCodec = await firstWorkingProfile(env, base, accel, result.attempts);
  }
  if (!baseCodec) return result;
  result.ok = true;
  result.hardware = accel === "prefer-hardware";
  const baseLevel = baseCodec.slice(-2);
  result.levels.push(baseLevel);
  result.codecByLevel[baseLevel] = baseCodec;
  for (const target of rest) {
    const codec = await firstWorkingProfile(env, target, accel, result.attempts);
    if (!codec) continue;
    const level = codec.slice(-2);
    if (!result.levels.includes(level)) result.levels.push(level);
    result.codecByLevel[level] ??= codec;
  }
  // Portrait coded frames (some Android encoders reject them, plan 5.1).
  const portrait: VideoTarget = { width: base.height, height: base.width, fps: base.fps };
  const portraitAttempt = await probeVideoConfig(env, baseCodec, portrait, accel);
  result.attempts.push(portraitAttempt);
  result.portrait = portraitAttempt.ok;
  return result;
}

function describeAudioDescription(desc: AllowSharedBufferSource | undefined): WorkerProbeReport["audio"]["description"] {
  if (!desc) return "none";
  const bytes = ArrayBuffer.isView(desc)
    ? new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength)
    : new Uint8Array(desc as ArrayBuffer);
  if (bytes.length === 0) return "none";
  // An esds payload starts with an ES_Descriptor tag (0x03); an AudioSpecificConfig is 2 to 5 bytes.
  if (bytes[0] === 0x03 && bytes.length > 5) return "esds";
  if (bytes.length >= 2 && bytes.length <= 5) return "asc";
  return "other";
}

export async function probeAudio(env: ProbeEnv): Promise<WorkerProbeReport["audio"]> {
  const Encoder = env.AudioEncoder;
  if (!Encoder) return { aac: false, reason: "missing", description: "none" };
  const config: AudioEncoderConfig = {
    codec: "mp4a.40.2",
    sampleRate: AUDIO_SAMPLE_RATE,
    numberOfChannels: AUDIO_CHANNELS,
    bitrate: AUDIO_BITRATE,
  };
  try {
    // iOS can throw here instead of answering "unsupported".
    const support = await withTimeout(Encoder.isConfigSupported(config), env.timeoutMs ?? 4000);
    if (!support.supported) return { aac: false, reason: "unsupported", description: "none" };
  } catch {
    return { aac: false, reason: "threw", description: "none" };
  }
  const Data = env.AudioData;
  if (!Data) return { aac: false, reason: "no-audiodata", description: "none" };
  let outputs = 0;
  let failed: unknown = null;
  let description: WorkerProbeReport["audio"]["description"] = "none";
  let encoder: AudioEncoder | null = null;
  try {
    encoder = new Encoder({
      output: (_chunk, meta) => {
        outputs++;
        if (meta?.decoderConfig) description = describeAudioDescription(meta.decoderConfig.description);
      },
      error: (error) => {
        failed = error;
      },
    });
    encoder.configure(config);
    const frames = 2048;
    const data = new Data({
      format: "f32-planar",
      sampleRate: AUDIO_SAMPLE_RATE,
      numberOfChannels: AUDIO_CHANNELS,
      numberOfFrames: frames,
      timestamp: 0,
      data: new Float32Array(frames * AUDIO_CHANNELS),
    });
    encoder.encode(data);
    data.close();
    await withTimeout(encoder.flush(), env.timeoutMs ?? 4000);
  } catch (error) {
    failed = failed ?? error;
  } finally {
    try {
      encoder?.close();
    } catch {
      // Already closed.
    }
  }
  if (failed) return { aac: false, reason: failed instanceof TimeoutError ? "timeout" : "error", description };
  if (outputs === 0) return { aac: false, reason: "no-output", description };
  return { aac: true, reason: null, description };
}

/** OPFS with a sync access handle: write, flush, read back, remove. Worker scope only. */
export async function probeOpfs(env: ProbeEnv): Promise<boolean> {
  if (env.scope !== "worker" || !env.getDirectory) return false;
  const name = `.clips-probe-${Math.random().toString(36).slice(2)}`;
  let root: ProbeDirectory | null = null;
  let handle: SyncHandle | null = null;
  try {
    root = await env.getDirectory();
    const file = await root.getFileHandle(name, { create: true });
    if (typeof file.createSyncAccessHandle !== "function") return false;
    handle = await file.createSyncAccessHandle();
    const out = new Uint8Array([1, 2, 3, 4]);
    handle.write(out, { at: 0 });
    handle.flush();
    const back = new Uint8Array(4);
    handle.read(back, { at: 0 });
    return back.every((b, i) => b === out[i]);
  } catch {
    // Private windows and some embedded views refuse OPFS.
    return false;
  } finally {
    try {
      handle?.close();
    } catch {
      // Closed.
    }
    try {
      await root?.removeEntry(name);
    } catch {
      // Never created.
    }
  }
}

export async function runProbe(env: ProbeEnv, request: ProbeRequest = { t: "probe" }): Promise<WorkerProbeReport> {
  const scoped: ProbeEnv = { ...env, timeoutMs: request.timeoutMs ?? env.timeoutMs };
  // Sequential on purpose: phones have few hardware encoder sessions.
  const video = await probeVideo(scoped, request.targets ?? DEFAULT_TARGETS);
  const audio = await probeAudio(scoped);
  const opfsSyncAccess = await probeOpfs(scoped);
  return {
    scope: env.scope,
    video,
    audio,
    audioData: typeof env.AudioData === "function",
    audioDecoder: typeof env.AudioDecoder === "function",
    opfsSyncAccess,
  };
}

/** The probe environment of the current global scope (worker or window). */
export function globalProbeEnv(scope: "worker" | "window"): ProbeEnv {
  const g = globalThis as unknown as {
    VideoEncoder?: typeof VideoEncoder;
    VideoFrame?: typeof VideoFrame;
    AudioEncoder?: typeof AudioEncoder;
    AudioData?: typeof AudioData;
    AudioDecoder?: unknown;
    navigator?: { storage?: { getDirectory?: () => Promise<unknown> } };
  };
  const storage = g.navigator?.storage;
  return {
    scope,
    VideoEncoder: g.VideoEncoder,
    VideoFrame: g.VideoFrame,
    AudioEncoder: g.AudioEncoder,
    AudioData: g.AudioData,
    AudioDecoder: g.AudioDecoder,
    getDirectory:
      storage && typeof storage.getDirectory === "function"
        ? () => storage.getDirectory!() as Promise<ProbeDirectory>
        : undefined,
  };
}
