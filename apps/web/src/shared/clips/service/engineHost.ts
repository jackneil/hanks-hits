/**
 * The WebCodecs capture engine (tiers W and W+, plan 4 and 5). It implements
 * CaptureEngine (engine.ts). The service loads this module with a dynamic
 * import, only when a clip-enabled game attaches and clips are on.
 *
 * Start (lazy, at the first registered canvas):
 * 1. probeCapabilityReport(): only while no encoder session is live (the probe
 *    needs the hardware encoder; plan 5: probes re-run at every arm, and a
 *    definitive result comes from the 7-day cache).
 * 2. chooseVideoEncoder() for the source's shape and content (2D or 3D).
 * 3. The encode worker (created once) gets EncodeCmd "arm" with the audio
 *    MessagePort. "armed" comes later, as an event; frames and audio flow
 *    before it.
 * 4. A new FramePump per arm, with the encode worker as its sink. The pump
 *    posts the "timeline" messages itself ("live" at its first frame, so the
 *    capture epoch is that page time). The engine never sends a timeline.
 * 5. Sources register through sources/canvasSource (or autoDiscover) with the
 *    pump, and their governor callbacks.
 * 6. The audio tap attaches to the game-audio bus with the other end of the
 *    audio port, and posts ClockAnchor messages to the encode worker.
 *
 * Replies: every "consumed" goes to pump.consumed() (late ones from a previous
 * arm are skipped). "audio-encoder-error" is a gapless AAC restart: it never
 * counts as a video failure. Other encoder errors are video failures; the
 * encode worker opens a new encoder session by itself, and its next "epoch"
 * event is the recovery. "config-unsupported" ends the session: the engine
 * probes again (no cache) and arms again.
 *
 * Governor (plan 7): canvas frames and capture costs (governorInputs), the
 * pump's counters and the encoder's queue (at each stats event), Compute
 * Pressure and Battery. A level sets the pump stride (level.k) and the path E
 * readback width (level.scale). Paths P and D read the canvas at its own size
 * (their main-thread cost does not depend on the scale). Resting pauses the
 * pump, except while Record runs: Record stays at the low-power rung.
 */

import {
  PRESETS,
  type ClipMeta,
  type ClipPackets,
  type ClipRecord,
  type EncodeCmd,
  type EncodeEvent,
  type OutputPreset,
  type Tier,
} from "../protocol";
import { MIN_CLIP_SECONDS } from "./contract";
import { chooseVideoEncoder, probeCapabilityReport, type CapabilityReport, type ContentKind, type EncoderPlan } from "../runtime/capabilities";
import { FramePump } from "../runtime/framePump";
import { Governor, governorInputs, type GovernorLevel, type PowerState, type PressureState } from "../runtime/governor";
import { installRafDispatcher } from "../runtime/rafDispatcher";
import { autoDiscover as runAutoDiscover, type AutoDiscovery } from "../sources/autoDiscover";
import { installCanvasActivity, type ActivityRealm } from "../sources/canvasActivity";
import { registerCanvasSource, type CanvasSource } from "../sources/canvasSource";
import { AudioTap } from "./audioTap";
import {
  EngineFailure,
  type CaptureEngine,
  type ClipRequest,
  type EngineEvent,
  type EngineGame,
  type MadeClip,
  type PauseReason,
  type PrepareResult,
  type RecordingHandle,
} from "./engine";
import { IoError, getIoClient, type IoClient } from "./ioClient";
import { randomId } from "./webLocks";

/** No encoder output this long after the first frame: the cold start is slow (plan 5.1). */
export const NO_OUTPUT_MS = 2500;
/** The engine's housekeeping tick (governor windows, the no-output check). */
export const ENGINE_TICK_MS = 500;
/** Wait before arming again after a fatal encoder failure, so a bad config cannot spin. */
export const REARM_DELAY_MS = 1000;
/** Path E readback width at full scale (sources/pathE default). */
export const BASE_READBACK_WIDTH = 640;
/** Longest wait for a game draw before a picture is read anyway. */
export const PICTURE_WAIT_MS = 500;

/** The encode worker, or a test double. */
export interface EncodeWorkerLike {
  postMessage(message: EncodeCmd, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<EncodeEvent>) => void) | null;
  onerror: ((event: unknown) => void) | null;
  terminate(): void;
}

/** Power signals for the governor (plan 7). */
export interface PowerSource {
  subscribe(listener: (state: PowerState) => void): () => void;
}

export interface EngineHostDeps {
  probe?: (options: { force?: boolean }) => Promise<CapabilityReport>;
  createEncodeWorker?: () => Promise<EncodeWorkerLike>;
  io?: IoClient;
  /** The audio tap. null: no game sound in clips (tests, or no Web Audio). */
  audioTap?: AudioTap | null;
  power?: PowerSource | null;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  /** The deployment's host for the band. Default: location.host. */
  brandHost?: () => string;
  log?: (message: string) => void;
}

interface Session {
  gen: number;
  worker: EncodeWorkerLike;
  preset: OutputPreset;
  plan: EncoderPlan;
  pump: FramePump;
  governor: Governor;
  armed: boolean;
  output: boolean;
  outputSent: boolean;
  recovering: boolean;
  firstFrameAtMs: number | null;
  noOutputSent: boolean;
  tick: unknown;
}

interface SourceEntry {
  kind: "canvas" | "discover";
  canvas: HTMLCanvasElement | null;
  root: Element | null;
  targetFps: 30 | 60;
  source: CanvasSource | null;
  discovery: AutoDiscovery | null;
  /** The canvas cannot be read at all (a tainted canvas): it gives no picture. */
  failed: boolean;
}

interface PendingClip {
  resolve(packets: ClipPackets): void;
  reject(error: unknown): void;
}

function ringSecondsFor(memoryClass: string): number {
  return memoryClass === "low" ? 30 : 60;
}

function realmOf(node: Element): ActivityRealm | null {
  return (node.ownerDocument?.defaultView as unknown as ActivityRealm | null) ?? null;
}

/** "3d" for a WebGL canvas (the game's own context, seen without getContext), else "2d". */
function contentOf(canvas: HTMLCanvasElement | null): ContentKind {
  if (!canvas) return "2d";
  const realm = realmOf(canvas);
  if (!realm) return "2d";
  const activity = installCanvasActivity(realm);
  try {
    const type = activity.record(canvas)?.type;
    return type === "webgl" || type === "webgl2" ? "3d" : "2d";
  } finally {
    activity.uninstall();
  }
}

/** Tall when the picture is taller than wide (plan 6.1: the shape follows the source). */
function orientationOf(entry: SourceEntry): "tall" | "wide" {
  if (entry.canvas && entry.canvas.width > 0 && entry.canvas.height > 0) {
    return entry.canvas.height > entry.canvas.width ? "tall" : "wide";
  }
  const node = entry.canvas ?? entry.root;
  const rect = node?.getBoundingClientRect?.();
  return rect && rect.height > rect.width ? "tall" : "wide";
}

function failureFromIo(error: unknown): EngineFailure {
  if (error instanceof EngineFailure) return error;
  if (error instanceof IoError) {
    switch (error.code) {
      case "quota":
        return new EngineFailure("quota", error.message);
      case "mux-failed":
      case "verify-failed":
      case "bad-command":
        return new EngineFailure("mux-failed", error.message);
      default:
        return new EngineFailure("storage-unavailable", error.message);
    }
  }
  return new EngineFailure("mux-failed", String((error as { name?: string } | null)?.name ?? "error"));
}

function defaultCreateWorker(): Promise<EncodeWorkerLike> {
  return import("./workers").then(({ createEncodeWorker }) => createEncodeWorker() as unknown as EncodeWorkerLike);
}

/** Compute Pressure (Chromium) and Battery Status (Chromium), where they exist. */
export function browserPowerSource(): PowerSource {
  return {
    subscribe(listener) {
      const stops: Array<() => void> = [];
      const g = globalThis as unknown as {
        PressureObserver?: new (cb: (records: Array<{ state: PressureState }>) => void) => {
          observe(source: "cpu", options?: { sampleInterval?: number }): Promise<void>;
          disconnect(): void;
        };
        navigator?: { getBattery?: () => Promise<EventTarget & { level: number; charging: boolean }> };
      };
      if (typeof g.PressureObserver === "function") {
        try {
          const observer = new g.PressureObserver((records) => {
            const last = records[records.length - 1];
            if (last) listener({ pressure: last.state });
          });
          observer.observe("cpu", { sampleInterval: 1000 }).catch(() => undefined);
          stops.push(() => observer.disconnect());
        } catch {
          // No permission or no source: no pressure signal.
        }
      }
      let stopped = false;
      g.navigator
        ?.getBattery?.()
        .then((battery) => {
          if (stopped) return;
          const push = () => listener({ batteryLevel: battery.level, charging: battery.charging });
          push();
          battery.addEventListener("levelchange", push);
          battery.addEventListener("chargingchange", push);
          stops.push(() => {
            battery.removeEventListener("levelchange", push);
            battery.removeEventListener("chargingchange", push);
          });
        })
        .catch(() => undefined);
      return () => {
        stopped = true;
        for (const stop of stops.splice(0)) stop();
      };
    },
  };
}

/** Reads a canvas as PNG right after the game's next draw (or after PICTURE_WAIT_MS). */
function snapshotPng(
  canvas: HTMLCanvasElement,
  timers: { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void },
): Promise<{ png: ArrayBuffer; width: number; height: number } | null> {
  const realm = realmOf(canvas);
  if (!realm || typeof canvas.toBlob !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    const dispatcher = installRafDispatcher(realm);
    let done = false;
    let timer: unknown = null;
    // toBlob copies the pixels at the call. In the post hook that is the same
    // task as the game's draw, so a WebGL drawing buffer is still intact.
    const take = () => {
      if (done) return;
      done = true;
      remove();
      dispatcher.uninstall();
      if (timer !== null) timers.clear(timer);
      const width = canvas.width;
      const height = canvas.height;
      try {
        canvas.toBlob((blob) => {
          if (!blob) {
            resolve(null);
            return;
          }
          const read = typeof blob.arrayBuffer === "function" ? blob.arrayBuffer() : new Response(blob).arrayBuffer();
          read.then(
            (png) => resolve({ png, width, height }),
            () => resolve(null),
          );
        }, "image/png");
      } catch {
        // A tainted canvas (SecurityError): no picture.
        resolve(null);
      }
    };
    const remove = dispatcher.addPostHook(take);
    dispatcher.wake();
    timer = timers.set(take, PICTURE_WAIT_MS);
  });
}

export class EngineHost implements CaptureEngine {
  private readonly probe: (options: { force?: boolean }) => Promise<CapabilityReport>;
  private readonly createWorker: () => Promise<EncodeWorkerLike>;
  private readonly io: IoClient;
  private readonly tap: AudioTap | null;
  private readonly power: PowerSource | null;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly setTick: (fn: () => void, ms: number) => unknown;
  private readonly clearTick: (handle: unknown) => void;
  private readonly brandHost: () => string;
  private readonly log: (message: string) => void;

  private report: CapabilityReport | null = null;
  private worker: Promise<EncodeWorkerLike> | null = null;
  private session: Session | null = null;
  private arming: Promise<void> | null = null;
  private gen = 0;
  private forceProbe = false;
  private rearmTimer: unknown = null;
  private readonly entries = new Set<SourceEntry>();
  private readonly pauses = new Set<PauseReason>();
  private readonly pendingClips = new Map<string, PendingClip>();
  private readonly listeners = new Set<(event: EngineEvent) => void>();
  private game: EngineGame | null = null;
  private startLevel = 0;
  private recording: string | null = null;
  private powerState: PowerState = {};
  private stopPower: (() => void) | null = null;
  /** "consumed" replies still owed for frames of a previous arm. */
  private staleConsumed = 0;
  /** The last presence told to the service. */
  private present = false;
  private lastHud = { gameName: "", emoji: "" } as { gameName: string; emoji: string; score?: string };
  private disposed = false;

  constructor(deps: EngineHostDeps = {}) {
    this.probe = deps.probe ?? ((options) => probeCapabilityReport(options));
    this.createWorker = deps.createEncodeWorker ?? defaultCreateWorker;
    const io = deps.io ?? getIoClient();
    if (!io) throw new Error("EngineHost runs in a browser window only");
    this.io = io;
    this.tap = deps.audioTap === undefined ? new AudioTap() : deps.audioTap;
    this.power = deps.power === undefined ? browserPowerSource() : deps.power;
    this.now = deps.now ?? (() => performance.now());
    this.setTimer = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.setTick = deps.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    this.clearTick = deps.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
    this.brandHost = deps.brandHost ?? (() => (typeof location !== "undefined" ? location.host : ""));
    this.log = deps.log ?? ((m) => console.warn(m));
  }

  // ---- CaptureEngine ---------------------------------------------------------

  async prepare(): Promise<PrepareResult> {
    // Only before the first arm: a live encoder session would fail the probe.
    if (!this.report && !this.session) this.report = await this.probe({});
    const report = this.report;
    if (!report) return { tier: "none", supported: false };
    const tier: Tier = report.caps.tier;
    const supported = (tier === "W" || tier === "W+") && report.caps.videoEncoderH264 && report.video.ok;
    if (supported) this.io.configure(report.caps.memoryClass);
    return { tier, supported };
  }

  setGame(game: EngineGame | null): void {
    const changed = !!game && !!this.game && game.appId !== this.game.appId;
    this.game = game;
    if (changed && this.session) {
      // Another game: its frames must never share a clip with the last one.
      this.purge();
      this.disarm();
      this.maybeArm();
    }
  }

  registerCanvas(canvas: HTMLCanvasElement, options: { targetFps?: 30 | 60 } = {}): () => void {
    const entry: SourceEntry = { kind: "canvas", canvas, root: null, targetFps: options.targetFps ?? 30, source: null, discovery: null, failed: false };
    return this.addEntry(entry);
  }

  autoDiscover(root: Element): () => void {
    const entry: SourceEntry = { kind: "discover", canvas: null, root, targetFps: 30, source: null, discovery: null, failed: false };
    return this.addEntry(entry);
  }

  setPaused(reason: PauseReason, paused: boolean): void {
    const before = this.pauses.size > 0;
    if (paused) this.pauses.add(reason);
    else this.pauses.delete(reason);
    const after = this.pauses.size > 0;
    const s = this.session;
    if (!s || before === after) return;
    if (after) s.pump.pause(this.now());
    else s.pump.resume(this.now());
  }

  closeEncoder(reason: "hidden" | "export"): void {
    this.session?.worker.postMessage({ t: "closeEncoder", reason });
  }

  mediaEndUs(): number {
    return this.session?.pump.stats().mediaEndUs ?? 0;
  }

  async clip(request: ClipRequest): Promise<MadeClip> {
    const s = this.session;
    if (!s || !s.outputSent) throw new EngineFailure("warming", "no footage yet");
    const requestId = `q${randomId()}`;
    const packets = await new Promise<ClipPackets>((resolve, reject) => {
      this.pendingClips.set(requestId, { resolve, reject });
      const cmd: EncodeCmd =
        request.endAtUs === undefined
          ? { t: "clip", requestId, seconds: request.seconds }
          : { t: "clip", requestId, seconds: request.seconds, endAtUs: request.endAtUs };
      s.worker.postMessage(cmd);
    });
    if (packets.video.length === 0 || packets.coveredSec < MIN_CLIP_SECONDS) {
      throw new EngineFailure("warming", `only ${packets.coveredSec.toFixed(1)} s of footage`);
    }
    request.onProgress?.(0.5);
    const { startUs, endUs } = packets;
    const meta: ClipMeta = {
      ...request.meta,
      durationMs: Math.round(packets.coveredSec * 1000),
      width: s.preset.width,
      height: s.preset.height,
      fps: s.governor.level.fps || s.plan.video.framerate,
      hasAudio: packets.audioConfig !== null && packets.audio.length > 0,
      mime: "video/mp4",
      moments: request.moments ? request.moments(packets.startUs, packets.endUs) : request.meta.moments,
    };
    try {
      const record = await this.io.mux(packets, meta);
      return { record, startUs, endUs };
    } catch (error) {
      throw failureFromIo(error);
    }
  }

  /** The capture tier the last probe found, or null before the first probe. */
  get tier(): Tier | null {
    return this.report?.caps.tier ?? null;
  }

  async picture(meta: ClipMeta): Promise<ClipRecord> {
    const canvas = this.newestCanvas();
    if (!canvas) throw new EngineFailure("source-lost", "no game picture");
    const shot = await snapshotPng(canvas, { set: this.setTimer, clear: this.clearTimer });
    if (!shot) throw new EngineFailure("source-lost", "the game picture could not be read");
    try {
      return await this.io.picture(shot.png, {
        ...meta,
        kind: "picture",
        mime: "image/png",
        width: shot.width,
        height: shot.height,
        durationMs: 0,
        fps: 0,
        hasAudio: false,
      });
    } catch (error) {
      throw failureFromIo(error);
    }
  }

  async startRecording(meta: ClipMeta): Promise<RecordingHandle> {
    const s = this.session;
    if (!s || !s.outputSent) throw new EngineFailure("warming", "no footage yet");
    if (this.recording) throw new EngineFailure("encoder-error", "a recording is already running");
    const recordingId = meta.id;
    const channel = new MessageChannel();
    const io = this.io.record(recordingId, channel.port2, {
      ...meta,
      kind: "record",
      width: s.preset.width,
      height: s.preset.height,
      fps: s.plan.video.framerate,
      mime: "video/mp4",
    });
    try {
      await io.started;
    } catch (error) {
      channel.port1.close();
      throw failureFromIo(error);
    }
    if (this.session !== s) {
      channel.port1.close();
      this.io.recordEnd(recordingId);
      throw new EngineFailure("encoder-error", "the encoder stopped");
    }
    s.worker.postMessage({ t: "record", on: true, recordingId, port: channel.port1 }, [channel.port1]);
    this.recording = recordingId;
    this.applyLevel();
    let stopped = false;
    return {
      recordingId,
      stop: async () => {
        if (!stopped) {
          stopped = true;
          // After a disarm the tee has already sent "end" (or, after a worker
          // crash, recordEnd did), so only a live recording is stopped here.
          if (this.recording === recordingId && this.session === s) {
            this.recording = null;
            s.worker.postMessage({ t: "record", on: false, recordingId });
            this.applyLevel();
          }
        }
        try {
          return await io.finished;
        } catch (error) {
          throw failureFromIo(error);
        }
      },
    };
  }

  purge(): void {
    this.session?.worker.postMessage({ t: "purge" });
  }

  wake(): boolean {
    const s = this.session;
    if (!s) return false;
    return s.governor.resume(this.now());
  }

  setStartLevel(level: number): void {
    this.startLevel = Math.max(0, Math.floor(level));
  }

  disarm(): void {
    this.disarmSession(true);
  }

  /** workerAlive: the worker still runs and will answer the frames in flight ("consumed"). */
  private disarmSession(workerAlive: boolean): void {
    this.gen++;
    if (this.rearmTimer !== null) this.clearTimer(this.rearmTimer);
    this.rearmTimer = null;
    const s = this.session;
    this.session = null;
    if (!s) return;
    this.clearTick(s.tick);
    for (const entry of this.entries) this.detachEntry(entry);
    s.pump.stop(this.now());
    if (workerAlive) this.staleConsumed += s.pump.stats().inFlight;
    this.tap?.detach();
    // The tee (if any) posts its last chunk and "end" to the io worker at disarm.
    this.recording = null;
    s.worker.postMessage({ t: "disarm" });
    this.rejectClips(new EngineFailure("encoder-error", "the encoder stopped"));
    this.emit({ t: "reset" });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disarm();
    this.disposed = true;
    this.entries.clear();
    this.stopPower?.();
    this.stopPower = null;
    const worker = this.worker;
    this.worker = null;
    void worker?.then((w) => w.terminate()).catch(() => undefined);
    this.listeners.clear();
  }

  subscribe(listener: (event: EngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---- sources ---------------------------------------------------------------

  private addEntry(entry: SourceEntry): () => void {
    if (this.disposed) return () => undefined;
    this.entries.add(entry);
    this.updatePresence();
    if (this.session) this.attachEntry(entry, this.session);
    else this.maybeArm();
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      this.detachEntry(entry);
      this.entries.delete(entry);
      this.updatePresence();
    };
  }

  /** Tells the service when the first source comes or the last usable one goes. */
  private updatePresence(): void {
    let present = false;
    for (const entry of this.entries) if (!entry.failed) present = true;
    if (present === this.present) return;
    this.present = present;
    this.emit({ t: "source", present });
  }

  /** A canvas that cannot be read at all gives no picture: it counts as gone. */
  private failEntry(entry: SourceEntry): void {
    if (entry.kind !== "canvas" || entry.failed) return;
    entry.failed = true;
    this.detachEntry(entry);
    this.emit({ t: "source-error" });
    this.updatePresence();
  }

  private newestCanvas(): HTMLCanvasElement | null {
    let canvas: HTMLCanvasElement | null = null;
    for (const entry of this.entries) canvas = entry.canvas ?? entry.discovery?.canvas ?? canvas;
    return canvas;
  }

  private hud() {
    const game = this.game;
    if (!game) return this.lastHud;
    let score: string | undefined;
    try {
      score = game.score?.();
    } catch {
      score = this.lastHud.score;
    }
    this.lastHud = { gameName: game.gameName, emoji: game.emoji, ...(score === undefined ? {} : { score }) };
    return this.lastHud;
  }

  private attachEntry(entry: SourceEntry, s: Session): void {
    this.detachEntry(entry);
    if (entry.failed) return;
    const inputs = governorInputs(s.governor);
    const common = {
      hud: () => this.hud(),
      targetFps: s.preset.targetFps,
      pump: s.pump,
      // The capture cost is measured on the engine's clock (performance.now in a page).
      now: this.now,
      ...inputs,
      onPathChange: (_path: string, reason: "context" | "readback-failed") => {
        // Path D on a WebGL canvas costs a whole frame on WebKit (plan 3a): go to low power at once.
        if (reason === "readback-failed") s.governor.setPower(this.now(), { lowPowerMode: true });
      },
      // A canvas source stops for good (a tainted canvas). Auto-discovery reports a
      // canvas it could not use and keeps looking, so it stays.
      onError: () => (entry.kind === "canvas" ? this.failEntry(entry) : this.emit({ t: "source-error" })),
    };
    try {
      if (entry.kind === "canvas" && entry.canvas) {
        entry.source = registerCanvasSource({ ...common, canvas: entry.canvas });
      } else if (entry.kind === "discover" && entry.root) {
        entry.discovery = runAutoDiscover({ ...common, root: entry.root, onRegistered: () => this.applyLevel() });
      }
    } catch (error) {
      this.log(`[clips] a game canvas could not be registered (${(error as { name?: string } | null)?.name ?? "Error"})`);
      if (entry.kind === "canvas") this.failEntry(entry);
      else this.emit({ t: "source-error" });
      return;
    }
    // Registration can reset the pump's stride: apply the governor level again.
    this.applyLevel();
  }

  private detachEntry(entry: SourceEntry): void {
    entry.source?.unregister();
    entry.source = null;
    entry.discovery?.stop();
    entry.discovery = null;
  }

  // ---- arm -------------------------------------------------------------------

  private maybeArm(): void {
    if (this.session || this.arming || this.disposed || this.entries.size === 0) return;
    const first = this.entries.values().next().value as SourceEntry;
    this.arming = this.arm(first).finally(() => {
      this.arming = null;
    });
  }

  private ensureWorker(): Promise<EncodeWorkerLike> {
    if (!this.worker) {
      const made = this.createWorker().then((worker) => {
        worker.onmessage = (event) => this.onEncodeEvent(worker, event.data);
        worker.onerror = () => this.onWorkerCrash(made);
        return worker;
      });
      this.worker = made;
      made.catch(() => {
        if (this.worker === made) this.worker = null;
      });
    }
    return this.worker;
  }

  private async arm(first: SourceEntry): Promise<void> {
    const gen = ++this.gen;
    let report: CapabilityReport;
    let worker: EncodeWorkerLike;
    try {
      // Plan 5: probes re-run at every arm. No encoder session is live here.
      report = await this.probe({ force: this.forceProbe });
      this.forceProbe = false;
      this.report = report;
      if (gen !== this.gen || this.disposed) return;
      worker = await this.ensureWorker();
    } catch (error) {
      if (gen !== this.gen || this.disposed) return;
      this.log(`[clips] capture could not start (${(error as { name?: string } | null)?.name ?? "Error"})`);
      this.emit({ t: "encoder-error", fatal: true });
      this.scheduleRearm();
      return;
    }
    if (gen !== this.gen || this.disposed || !this.entries.has(first)) {
      if (!this.disposed && this.entries.size > 0 && gen === this.gen) this.maybeArmSoon();
      return;
    }
    const orientation = orientationOf(first);
    const plan = chooseVideoEncoder(report, { ...PRESETS[orientation], targetFps: first.targetFps, orientation }, contentOf(first.canvas));
    if (!plan) {
      this.emit({ t: "encoder-error", fatal: true });
      return;
    }
    // The coded frame is what the encoder takes. A tall source on an encoder
    // with no portrait support gets a wide frame with the picture letterboxed.
    const preset: OutputPreset = {
      width: plan.video.width,
      height: plan.video.height,
      targetFps: plan.video.framerate >= 60 ? 60 : 30,
      orientation: plan.video.height > plan.video.width ? "tall" : "wide",
    };
    const audio = new MessageChannel();
    worker.postMessage(
      {
        t: "arm",
        caps: report.caps,
        video: plan.video,
        preset,
        ringSeconds: ringSecondsFor(report.caps.memoryClass),
        audioPort: audio.port1,
        brandHost: this.brandHost(),
      },
      [audio.port1],
    );
    const pump = new FramePump({ sink: worker, displayHz: report.caps.displayHz, targetFps: preset.targetFps });
    let session: Session | null = null;
    const governor = new Governor({
      displayHz: report.caps.displayHz,
      targetFps: preset.targetFps,
      startLevel: this.startLevel,
      onChange: (level) => {
        if (!session || this.session !== session) return;
        this.applyLevel();
        this.emit({ t: "governor", level: { ...level }, resting: level.kind === "resting" });
      },
    });
    session = {
      gen,
      worker,
      preset,
      plan,
      pump,
      governor,
      armed: false,
      output: false,
      outputSent: false,
      recovering: false,
      firstFrameAtMs: null,
      noOutputSent: false,
      tick: null,
    };
    this.session = session;
    if (this.pauses.size > 0) pump.pause(this.now());
    governor.setPower(this.now(), this.powerState);
    if (this.power && !this.stopPower) {
      this.stopPower = this.power.subscribe((state) => {
        this.powerState = { ...this.powerState, ...state };
        this.session?.governor.setPower(this.now(), state);
      });
    }
    for (const entry of this.entries) this.attachEntry(entry, session);
    this.applyLevel();
    if (governor.resting) this.emit({ t: "governor", level: { ...governor.level }, resting: true });
    this.tap?.attach(audio.port2, { postAnchor: (anchor) => worker.postMessage(anchor) });
    if (!this.tap) audio.port2.close();
    const s = session;
    s.tick = this.setTick(() => this.tick(s), ENGINE_TICK_MS);
  }

  private maybeArmSoon(): void {
    queueMicrotask(() => this.maybeArm());
  }

  private scheduleRearm(): void {
    if (this.rearmTimer !== null || this.disposed) return;
    this.rearmTimer = this.setTimer(() => {
      this.rearmTimer = null;
      this.maybeArm();
    }, REARM_DELAY_MS);
  }

  /** The governor level, with Record kept at the low-power rung while resting (plan 7). */
  private applyLevel(): void {
    const s = this.session;
    if (!s) return;
    let level: GovernorLevel = s.governor.level;
    const resting = level.kind === "resting";
    if (resting && this.recording) level = s.governor.ladder[s.governor.ladder.length - 2];
    this.setPaused("rest", resting && !this.recording);
    if (level.k > 0) s.pump.configure({ stride: level.k });
    const width = Math.max(2, Math.round((BASE_READBACK_WIDTH * level.scale) / 2) * 2);
    for (const entry of this.entries) {
      entry.source?.setReadbackWidth(width);
      entry.discovery?.source?.setReadbackWidth(width);
    }
  }

  private tick(s: Session): void {
    if (this.session !== s) return;
    const now = this.now();
    s.governor.tick(now);
    if (s.output || s.noOutputSent) return;
    if (s.firstFrameAtMs === null && s.pump.stats().sent > 0) s.firstFrameAtMs = now;
    if (s.firstFrameAtMs !== null && now - s.firstFrameAtMs >= NO_OUTPUT_MS && this.hasBridge()) {
      s.noOutputSent = true;
      this.emit({ t: "no-output" });
    }
  }

  /** A software H.264 encoder answered the probe (Chromium). WebKit has none (plan 5.1). */
  private hasBridge(): boolean {
    const r = this.report;
    return !!r && r.caps.hardwareEncoder && r.video.attempts.some((a) => a.ok && a.hardwareAcceleration === "no-preference");
  }

  // ---- encode worker events --------------------------------------------------

  private onEncodeEvent(worker: EncodeWorkerLike, event: EncodeEvent): void {
    const s = this.session && this.session.worker === worker ? this.session : null;
    switch (event.t) {
      case "consumed":
        if (this.staleConsumed > 0) this.staleConsumed--;
        else s?.pump.consumed();
        return;
      case "armed":
        if (!s) return;
        s.armed = true;
        this.maybeOutput(s);
        return;
      case "epoch":
        if (!s) return;
        s.output = true;
        if (s.recovering) {
          s.recovering = false;
          this.emit({ t: "recovered" });
        }
        this.maybeOutput(s);
        return;
      case "stats": {
        if (!s) return;
        const now = this.now();
        const st = event.stats;
        this.emit({ t: "buffered", seconds: st.ringSeconds });
        const queue = Math.max(0, st.framesIn - st.framesEncoded - st.framesDropped);
        const fps = s.governor.level.fps || s.preset.targetFps;
        s.governor.encoder(now, { queue, latencyMs: (queue * 1000) / fps });
        s.governor.pumpStats(now, s.pump.stats());
        return;
      }
      case "clipReady": {
        const pending = this.pendingClips.get(event.packets.requestId);
        if (!pending) return;
        this.pendingClips.delete(event.packets.requestId);
        pending.resolve(event.packets);
        return;
      }
      case "error":
        this.onEncodeError(s, event.code);
        return;
    }
  }

  private maybeOutput(s: Session): void {
    if (s.outputSent || !s.armed || !s.output) return;
    s.outputSent = true;
    this.emit({ t: "output" });
  }

  private onEncodeError(s: Session | null, code: Extract<EncodeEvent, { t: "error" }>["code"]): void {
    switch (code) {
      case "audio-encoder-error":
        // A gapless AAC restart: never a video failure, never the crash breaker.
        this.log("[clips] the sound encoder restarted");
        return;
      case "audio-encoder-missing":
        this.log("[clips] no sound encoder: clips have no game sound");
        // The audio setup is over (without sound), and no "armed" follows it.
        // The video still works, so warming ends at the first video output.
        if (s) {
          s.armed = true;
          this.maybeOutput(s);
        }
        return;
      case "config-unsupported":
        if (!s) return;
        this.log("[clips] the encoder refused its settings; probing again");
        this.emit({ t: "encoder-error", fatal: true });
        this.forceProbe = true;
        this.disarm();
        this.scheduleRearm();
        return;
      default:
        if (!s) return;
        this.log(`[clips] encoder failure (${code})`);
        s.recovering = true;
        this.emit({ t: "encoder-error", fatal: false });
    }
  }

  private onWorkerCrash(which: Promise<EncodeWorkerLike>): void {
    if (this.worker !== which) return;
    this.worker = null;
    void which.then((w) => w.terminate()).catch(() => undefined);
    const recording = this.recording;
    this.log("[clips] the encode worker stopped");
    this.emit({ t: "encoder-error", fatal: true });
    // A new worker owes no "consumed" replies.
    this.staleConsumed = 0;
    this.disarmSession(false);
    // The tee died with the worker: store what the io worker has.
    if (recording) this.io.recordEnd(recording);
    this.scheduleRearm();
  }

  private rejectClips(error: EngineFailure): void {
    const all = [...this.pendingClips.values()];
    this.pendingClips.clear();
    for (const p of all) p.reject(error);
  }

  private emit(event: EngineEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // One bad listener must not stop the engine.
      }
    }
  }
}

