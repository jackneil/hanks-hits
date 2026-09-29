/**
 * The MediaRecorder capture engine (tiers M and V, plan 5). It implements
 * CaptureEngine (service/engine.ts), so ClipService works with it exactly as
 * with the WebCodecs engine of tiers W and W+.
 *
 * Who lands here (plan 5): tier M, where the VideoEncoder probe fails and
 * MediaRecorder offers MP4 (H.264 and AAC); tier V, where MediaRecorder
 * offers WebM (VP8 and Opus): Firefox Android, Firefox desktop 111-129,
 * 32-bit ARM Chrome with no hardware H.264 encoder.
 *
 * The pipeline, on the main thread:
 *   game canvas -> canvas feed (drawImage, in the game's rAF task) ->
 *   page compositor (band, HUD and host, the worker compositor's rules) ->
 *   canvas.captureStream() -> rotating MediaRecorders -> segment ring.
 *   game-audio bus tap point -> MediaStreamAudioDestinationNode -> the same
 *   recorders (the sound before the sound switch).
 * The io worker indexes each segment (keyframes, decoder configs), joins the
 * segments of a clip into one file (MP4 for M, WebM for V), and stores it
 * with the library's write protocol (verify, move, row, broadcast).
 *
 * Replay granularity: a clip starts at the last keyframe at or before the
 * asked start. Tier M asks for a keyframe every KEYFRAME_INTERVAL_MS where
 * the browser supports it; every segment starts with a keyframe anyway.
 * The engine measures the real spacing from the segment indexes (the first
 * one arrives a rotation after arm) and sends it as a "granularity" event.
 *
 * Capture time: page time with paused spans removed (CaptureClock). A pause
 * (hidden, a break, resting, no source, another tab, the owner check) stops
 * the recorders: each segment is a whole file, and the next one starts at
 * resume.
 *
 * Record: the segments from the tap on go to the io worker as they finish
 * ("segmentRecordAdd", journaled in OPFS for crash recovery), and the io
 * worker makes the parts at the end.
 *
 * Failures: a recorder that fails is dropped with its segment. When no
 * recorder records any more, the engine says "encoder-error" and starts a
 * new one after a wait. RECORDER_FAILURE_LIMIT failures in a row (with no
 * good segment between them) stop the engine ("unavailable").
 */

import { PRESETS, type ClipMeta, type ClipRecord, type HudState, type OutputPreset, type SegmentContainer, type SegmentIndex, type Tier } from "../../protocol";
import { bitrateFor, probeCapabilityReport, SOFTWARE_PRESETS, type CapabilityReport, type ContentKind } from "../../runtime/capabilities";
import { Governor, type GovernorLevel, type PowerState } from "../../runtime/governor";
import { installCanvasActivity, type ActivityRealm, type CanvasActivity } from "../../sources/canvasActivity";
import { MIN_CLIP_SECONDS } from "../../service/contract";
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
} from "../../service/engine";
import {
  ARM_FAILURE_LIMIT,
  PICTURE_WAIT_MS,
  REARM_DELAY_MS,
  REARM_MAX_DELAY_MS,
  browserPowerSource,
  contentKindOf,
  type PowerSource,
} from "../../service/engineHost";
import { IoError, getIoClient, type IoClient, type SegmentRecordSession } from "../../service/ioClient";
import { RecorderAudio } from "./audioTrack";
import { CaptureClock } from "./captureClock";
import { Pacer, startCanvasFeed, type CanvasFeed } from "./canvasFeed";
import { PageCompositor, type FrameSource } from "./compositor";
import {
  GRANULARITY_WINDOW,
  HANDOFF_OVERLAP_MS,
  HANDOFF_RETRY_MS,
  KEYFRAME_INTERVAL_MS,
  RECORDER_AUDIO_BITRATE,
  RECORDER_CONTAINERS,
  RECORDER_FAILURE_LIMIT,
  RECORDER_FPS,
  RECORDER_TICK_MS,
  RECORDER_TYPES,
  ROTATION_MS,
  SEQUENTIAL_AFTER_FAILURES,
  START_TIMEOUT_MS,
  STOP_TIMEOUT_MS,
} from "./constants";
import { discoverFeed, type FeedDiscovery } from "./discover";
import { Rotator, type FinishedSegment, type MediaRecorderLike, type RotatorFailure } from "./rotator";
import { SegmentRing, keyframeGapUs, planClip, type RingSegment } from "./segmentRing";

/** The io worker calls that this engine uses. IoClient fits it. */
export type RecorderIo = Pick<IoClient, "configure" | "index" | "concat" | "picture" | "segmentRecord">;

/** The options every recorder gets. */
export interface RecorderOptions {
  mimeType: string;
  videoBitsPerSecond: number;
  audioBitsPerSecond: number;
  /** Chromium: the keyframe spacing to use. Other browsers ignore it. */
  videoKeyFrameIntervalDuration: number;
}

/** The page compositor, or a test double. */
export interface CompositorLike {
  readonly preset: OutputPreset;
  paint(source: FrameSource, hud: HudState, scale: number): void;
  captureTrack(fps: number): MediaStreamTrack | null;
  posterJpeg(): Promise<Blob | null>;
  dispose(): void;
}

export interface RecorderEngineDeps {
  /** The report of the probe that chose this engine (loadEngine.ts). */
  report?: CapabilityReport | null;
  probe?: (options: { force?: boolean }) => Promise<CapabilityReport>;
  io?: RecorderIo;
  createRecorder?: (stream: MediaStream, options: RecorderOptions) => MediaRecorderLike;
  createStream?: (tracks: MediaStreamTrack[]) => MediaStream;
  createCompositor?: (preset: OutputPreset, brandHost: string) => CompositorLike;
  /** The sound tap. null: no game sound in clips (tests, or no Web Audio). */
  audio?: RecorderAudio | null;
  power?: PowerSource | null;
  /** True when this browser can record a canvas (MediaRecorder, MediaStream, captureStream). */
  canRecord?: () => boolean;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  /** The deployment's host for the band. Default: location.host. */
  brandHost?: () => string;
  log?: (message: string) => void;
}

interface Entry {
  kind: "canvas" | "discover";
  canvas: HTMLCanvasElement | null;
  root: Element | null;
  feed: CanvasFeed | null;
  discovery: FeedDiscovery | null;
  failed: boolean;
  /** The realm's canvas activity tracker, held while the canvas is registered (the context type). */
  activity: CanvasActivity | null;
}

interface SessionRecording {
  id: string;
  io: SegmentRecordSession;
  startUs: number;
  /** Set when stop() starts: segments after it are not part of the recording. */
  stopUs: number | null;
  /** Segments are sent in order, each after its index. */
  chain: Promise<void>;
  sentAny: boolean;
  /** Segments that could not be read, so they are not in the video (reported as failed). */
  lost: number;
  /** No more segments are sent (the last one is out, or the recording ended). */
  closed: boolean;
  /** The end of the recording, once it started (stop() and a disarm share it). */
  ending: Promise<void> | null;
}

interface Session {
  gen: number;
  tier: "M" | "V";
  container: SegmentContainer;
  mimeType: string;
  preset: OutputPreset;
  bitrate: number;
  ringSeconds: number;
  compositor: CompositorLike;
  videoTrack: MediaStreamTrack;
  clock: CaptureClock;
  ring: SegmentRing;
  rotator: Rotator;
  governor: Governor;
  pacer: Pacer;
  /** Content scale inside the coded frame (a governor step). */
  scale: number;
  /** Capture runs: the clock runs and a recorder records (or starts). */
  live: boolean;
  outputSent: boolean;
  recovering: boolean;
  failuresInRow: number;
  restartTimer: unknown;
  tick: unknown;
  nextId: number;
  /** Segments that came out of the recorders (a hand-off that ended one shows here). */
  finished: number;
  /**
   * How far the segments that came out cover the capture timeline when each
   * one is used only up to its successor's first frame (Record uses them so).
   */
  coveredToUs: number;
  indexes: WeakMap<RingSegment, Promise<SegmentIndex | null>>;
  granularitySec: number | null;
  /** Segments that start before this capture time hold footage from before a purge: no clip uses them. */
  purgeUs: number;
  recording: SessionRecording | null;
}

const CONTAINER_MIMES: Readonly<Record<SegmentContainer, "video/mp4" | "video/webm">> = { mp4: "video/mp4", webm: "video/webm" };

function ringSecondsFor(memoryClass: string): number {
  return memoryClass === "low" ? 30 : 60;
}

function realmOf(node: Element): ActivityRealm | null {
  return (node.ownerDocument?.defaultView as unknown as ActivityRealm | null) ?? null;
}

function nameOf(error: unknown): string {
  return (error as { name?: string } | null)?.name ?? "Error";
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
  return new EngineFailure("mux-failed", nameOf(error));
}

/**
 * The recorder tier that a probe report allows: M when MediaRecorder makes
 * MP4 (H.264 and AAC), else V when it makes WebM (VP8 and Opus), else null.
 * The same order as selectTier (plan 5). A later probe that finds a working
 * VideoEncoder does not stop this engine: MediaRecorder still works.
 */
export function recorderTierOf(report: CapabilityReport): "M" | "V" | null {
  if (report.caps.mediaRecorderMp4) return "M";
  if (report.caps.mediaRecorderWebm) return "V";
  return null;
}

/** True when this browser can record a canvas: MediaRecorder, MediaStream and canvas captureStream. */
export function browserCanRecord(): boolean {
  const g = globalThis as unknown as {
    MediaRecorder?: unknown;
    MediaStream?: unknown;
    HTMLCanvasElement?: { prototype?: { captureStream?: unknown } };
  };
  return typeof g.MediaRecorder === "function" && typeof g.MediaStream === "function" && typeof g.HTMLCanvasElement?.prototype?.captureStream === "function";
}

/** The tall or wide shape of the first source (plan 6.1: the shape follows the source). */
function orientationOf(entry: Entry): "tall" | "wide" {
  if (entry.canvas && entry.canvas.width > 0 && entry.canvas.height > 0) return entry.canvas.height > entry.canvas.width ? "tall" : "wide";
  const node = entry.canvas ?? entry.root;
  const rect = node?.getBoundingClientRect?.();
  return rect && rect.height > rect.width ? "tall" : "wide";
}

export class RecorderEngine implements CaptureEngine {
  private readonly probe: (options: { force?: boolean }) => Promise<CapabilityReport>;
  private readonly io: RecorderIo;
  private readonly createRecorder: (stream: MediaStream, options: RecorderOptions) => MediaRecorderLike;
  private readonly createStream: (tracks: MediaStreamTrack[]) => MediaStream;
  private readonly createCompositor: (preset: OutputPreset, brandHost: string) => CompositorLike;
  private readonly audio: RecorderAudio | null;
  private readonly power: PowerSource | null;
  private readonly canRecord: () => boolean;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly setTick: (fn: () => void, ms: number) => unknown;
  private readonly clearTick: (handle: unknown) => void;
  private readonly brandHost: () => string;
  private readonly log: (message: string) => void;

  private report: CapabilityReport | null;
  private session: Session | null = null;
  private arming: Promise<void> | null = null;
  private armAgain = false;
  private gen = 0;
  private forceProbe = false;
  private failedArms = 0;
  private halted = false;
  private parked = false;
  private disposed = false;
  private rearmTimer: unknown = null;
  private contentWait: { entry: Entry; cancel: () => void } | null = null;
  private readonly entries = new Set<Entry>();
  private readonly pauses = new Set<PauseReason>();
  private readonly listeners = new Set<(event: EngineEvent) => void>();
  private game: EngineGame | null = null;
  private startLevel = 0;
  private present = false;
  private powerState: PowerState = {};
  private stopPower: (() => void) | null = null;
  private lastHud: HudState = { gameName: "", emoji: "" };

  constructor(deps: RecorderEngineDeps = {}) {
    this.report = deps.report ?? null;
    this.probe = deps.probe ?? ((options) => probeCapabilityReport(options));
    const io = deps.io ?? getIoClient();
    if (!io) throw new Error("RecorderEngine runs in a browser window only");
    this.io = io;
    this.createRecorder =
      deps.createRecorder ??
      ((stream, options) => new MediaRecorder(stream, options as MediaRecorderOptions) as unknown as MediaRecorderLike);
    this.createStream = deps.createStream ?? ((tracks) => new MediaStream(tracks));
    this.createCompositor = deps.createCompositor ?? ((preset, host) => new PageCompositor(preset, host, { document }));
    this.audio = deps.audio === undefined ? new RecorderAudio() : deps.audio;
    this.power = deps.power === undefined ? browserPowerSource() : deps.power;
    this.canRecord = deps.canRecord ?? browserCanRecord;
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
    if (!this.report && !this.session) this.report = await this.probe({});
    const report = this.report;
    if (!report) return { tier: "none", supported: false };
    const tier: Tier = report.caps.tier;
    const supported = (tier === "M" || tier === "V") && recorderTierOf(report) !== null && this.canRecord();
    if (supported) this.io.configure(report.caps.memoryClass);
    return { tier, supported };
  }

  /** The capture tier the last probe found, or null before the first probe. */
  get tier(): Tier | null {
    return this.report?.caps.tier ?? null;
  }

  setGame(game: EngineGame | null): void {
    const changed = !!game && !!this.game && game.appId !== this.game.appId;
    this.game = game;
    this.halted = false;
    this.failedArms = 0;
    if (changed && this.session) {
      // Another game: its frames must never share a clip with the last one.
      this.purge();
      this.disarmSession();
    }
    this.maybeArm();
  }

  registerCanvas(canvas: HTMLCanvasElement): () => void {
    const realm = realmOf(canvas);
    const entry: Entry = {
      kind: "canvas",
      canvas,
      root: null,
      feed: null,
      discovery: null,
      failed: false,
      activity: realm && !this.disposed ? installCanvasActivity(realm) : null,
    };
    return this.addEntry(entry);
  }

  autoDiscover(root: Element): () => void {
    return this.addEntry({ kind: "discover", canvas: null, root, feed: null, discovery: null, failed: false, activity: null });
  }

  setPaused(reason: PauseReason, paused: boolean): void {
    if (paused) this.pauses.add(reason);
    else this.pauses.delete(reason);
    this.applyLive();
  }

  closeEncoder(reason: "hidden" | "export"): void {
    void reason;
    // The pause that caused this reached the engine first: the recorders stop there.
    const s = this.session;
    if (s && !s.live) void s.rotator.stop();
  }

  mediaEndUs(): number {
    const s = this.session;
    return s ? s.clock.nowUs(this.now()) : 0;
  }

  async clip(request: ClipRequest): Promise<MadeClip> {
    const s = this.session;
    if (!s || !s.outputSent) throw new EngineFailure("warming", "no footage yet");
    const endUs = request.endAtUs ?? s.clock.nowUs(this.now());
    await this.finishFootageTo(s, endUs, () => Math.max(0, ...s.ring.segments.map((segment) => segment.endUs)));
    if (this.session !== s) throw new EngineFailure("encoder-error", "the recorder stopped");
    const fromUs = Math.max(0, endUs - request.seconds * 1e6);
    const needed = s.ring.needed(fromUs, endUs);
    await Promise.all(needed.map((segment) => this.ensureIndex(s, segment)));
    if (this.session !== s) throw new EngineFailure("encoder-error", "the recorder stopped");
    const plan = planClip(needed, fromUs, endUs);
    const coveredSec = plan ? (plan.endUs - plan.startUs) / 1e6 : 0;
    if (!plan || coveredSec < MIN_CLIP_SECONDS) throw new EngineFailure("warming", `only ${coveredSec.toFixed(1)} s of footage`);
    if (plan.cut) this.log("[clips] the clip starts at the newest recorder segments (an older one cannot join them)");
    request.onProgress?.(0.5);
    const poster = await s.compositor.posterJpeg();
    const meta: ClipMeta = {
      ...request.meta,
      durationMs: Math.round(coveredSec * 1000),
      width: s.preset.width,
      height: s.preset.height,
      fps: s.governor.level.fps ? Math.min(RECORDER_FPS, s.governor.level.fps) : RECORDER_FPS,
      // The io worker sets it from the joined file.
      hasAudio: false,
      mime: CONTAINER_MIMES[s.container],
      moments: request.moments ? request.moments(plan.startUs, plan.endUs) : request.meta.moments,
    };
    try {
      const record = await this.io.concat({ container: s.container, segments: plan.segments, ...(poster ? { poster } : {}) }, meta);
      return { record, startUs: plan.startUs, endUs: plan.endUs };
    } catch (error) {
      throw failureFromIo(error);
    }
  }

  async picture(meta: ClipMeta): Promise<ClipRecord> {
    const feed = this.newestFeed();
    if (!feed) throw new EngineFailure("source-lost", "no game picture");
    const shot = await feed.snapshotPng(PICTURE_WAIT_MS, { set: this.setTimer, clear: this.clearTimer });
    if (shot === "no-draw") throw new EngineFailure("hidden", "the game did not draw a new picture (it is paused)");
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
    if (s.recording) throw new EngineFailure("encoder-error", "a recording is already running");
    const startUs = s.clock.nowUs(this.now());
    const io = this.io.segmentRecord(meta.id, s.container, {
      ...meta,
      kind: "record",
      width: s.preset.width,
      height: s.preset.height,
      fps: RECORDER_FPS,
      mime: CONTAINER_MIMES[s.container],
    });
    try {
      await io.started;
    } catch (error) {
      throw failureFromIo(error);
    }
    if (this.session !== s || s.recording) {
      io.end();
      throw new EngineFailure("encoder-error", "the recorder stopped");
    }
    const rec: SessionRecording = {
      id: meta.id,
      io,
      startUs,
      stopUs: null,
      chain: Promise.resolve(),
      sentAny: false,
      lost: 0,
      closed: false,
      ending: null,
    };
    s.recording = rec;
    this.applyLevel();
    return {
      recordingId: meta.id,
      stop: async () => {
        await this.endRecording(s, rec);
        try {
          const done = await rec.io.finished;
          return { parts: done.parts, failed: done.failed + rec.lost };
        } catch (error) {
          throw failureFromIo(error);
        }
      },
    };
  }

  purge(): void {
    const s = this.session;
    if (!s) return;
    s.ring.clear();
    // The recorder that runs now holds footage from before the purge: no clip may use it.
    s.purgeUs = s.clock.nowUs(this.now());
    if (s.live && s.rotator.running) void s.rotator.handOff();
    this.emit({ t: "buffered", seconds: 0 });
  }

  wake(): boolean {
    const s = this.session;
    if (!s) return false;
    return s.governor.resume(this.now());
  }

  setStartLevel(level: number): void {
    this.startLevel = Math.max(0, Math.floor(level));
  }

  park(): void {
    const s = this.session;
    if (!s || this.parked) return;
    this.parked = true;
    this.applyLive();
    this.audio?.suspend();
  }

  disarm(): void {
    this.halted = true;
    this.disarmSession();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disarm();
    this.disposed = true;
    for (const entry of this.entries) entry.activity?.uninstall();
    this.entries.clear();
    this.stopPower?.();
    this.stopPower = null;
    this.listeners.clear();
  }

  subscribe(listener: (event: EngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---- sources ---------------------------------------------------------------

  private addEntry(entry: Entry): () => void {
    if (this.disposed) return () => undefined;
    this.halted = false;
    this.entries.add(entry);
    this.updatePresence();
    if (this.session) {
      this.unpark();
      this.attachEntry(entry, this.session);
    } else {
      this.maybeArm();
    }
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      this.detachEntry(entry);
      this.entries.delete(entry);
      if (this.contentWait?.entry === entry) this.contentWait.cancel();
      entry.activity?.uninstall();
      entry.activity = null;
      this.updatePresence();
    };
  }

  private unpark(): void {
    if (!this.parked) return;
    this.parked = false;
    this.audio?.resume();
    this.applyLive();
  }

  private updatePresence(): void {
    let present = false;
    for (const entry of this.entries) if (!entry.failed) present = true;
    if (present === this.present) return;
    this.present = present;
    this.emit({ t: "source", present });
  }

  private failEntry(entry: Entry): void {
    if (entry.kind !== "canvas" || entry.failed) return;
    entry.failed = true;
    this.detachEntry(entry);
    this.emit({ t: "source-error" });
    this.updatePresence();
  }

  private newestFeed(): CanvasFeed | null {
    let found: CanvasFeed | null = null;
    for (const entry of this.entries) {
      const feed = entry.feed ?? entry.discovery?.feed ?? null;
      if (feed && !feed.stopped) found = feed;
    }
    return found;
  }

  private hud(): HudState {
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

  private feedFor(s: Session, canvas: HTMLCanvasElement, onError: () => void): CanvasFeed {
    return startCanvasFeed({
      canvas,
      draw: (source, hud) => s.compositor.paint(source, hud, s.scale),
      hud: () => this.hud(),
      pacer: s.pacer,
      live: () => this.session === s && s.live,
      onCaptureCost: (sample) => s.governor.captureCost(sample.frameMs, sample.ms, { path: sample.path }),
      onGameFrame: (pageMs, info) => s.governor.gameFrame(pageMs, info),
      onError,
      now: this.now,
    });
  }

  private attachEntry(entry: Entry, s: Session): void {
    this.detachEntry(entry);
    if (entry.failed) return;
    try {
      if (entry.kind === "canvas" && entry.canvas) {
        entry.feed = this.feedFor(s, entry.canvas, () => this.failEntry(entry));
      } else if (entry.kind === "discover" && entry.root) {
        entry.discovery = discoverFeed({
          root: entry.root,
          start: (canvas) => this.feedFor(s, canvas, () => this.emit({ t: "source-error" })),
          onError: () => this.emit({ t: "source-error" }),
          setInterval: this.setTick,
          clearInterval: this.clearTick,
        });
      }
    } catch (error) {
      this.log(`[clips] a game canvas could not be registered (${nameOf(error)})`);
      if (entry.kind === "canvas") this.failEntry(entry);
      else this.emit({ t: "source-error" });
    }
  }

  private detachEntry(entry: Entry): void {
    entry.feed?.stop();
    entry.feed = null;
    entry.discovery?.stop();
    entry.discovery = null;
  }

  // ---- arm -------------------------------------------------------------------

  private maybeArm(): void {
    if (this.arming) {
      this.armAgain = true;
      return;
    }
    if (this.session || this.disposed || this.halted || this.entries.size === 0) return;
    const first = this.entries.values().next().value as Entry;
    this.armAgain = false;
    this.arming = this.arm(first).finally(() => {
      this.arming = null;
      if (this.armAgain) {
        this.armAgain = false;
        this.maybeArm();
      }
    });
  }

  /** The content kind of the first source, once the game has a context on its canvas (see engineHost). */
  private waitForContent(entry: Entry): Promise<ContentKind | null> {
    const canvas = entry.kind === "canvas" ? entry.canvas : null;
    const activity = entry.activity;
    if (!canvas || !activity) return Promise.resolve("2d");
    const known = activity.record(canvas);
    if (known) return Promise.resolve(contentKindOf(known.type));
    return new Promise((resolve) => {
      let settled = false;
      const settle = (kind: ContentKind | null) => {
        if (settled) return;
        settled = true;
        stop();
        if (this.contentWait?.entry === entry) this.contentWait = null;
        resolve(kind);
      };
      const stop = activity.onContext((record) => {
        if (record.canvas === canvas) settle(contentKindOf(record.type));
      });
      this.contentWait = { entry, cancel: () => settle(null) };
    });
  }

  private async arm(first: Entry): Promise<void> {
    const gen = ++this.gen;
    const content = await this.waitForContent(first);
    if (content === null || gen !== this.gen || this.disposed || !this.entries.has(first)) {
      if (gen === this.gen) this.armAgain = true;
      return;
    }
    let report: CapabilityReport;
    try {
      // Plan 5: probes re-run at every arm.
      report = await this.probe({ force: this.forceProbe });
      this.forceProbe = false;
      this.report = report;
    } catch (error) {
      if (gen !== this.gen || this.disposed) return;
      this.log(`[clips] capture could not start (${nameOf(error)})`);
      this.emit({ t: "encoder-error", fatal: true });
      this.armFailed();
      return;
    }
    if (gen !== this.gen || this.disposed || !this.entries.has(first)) {
      if (gen === this.gen) this.armAgain = true;
      return;
    }
    const tier = recorderTierOf(report);
    if (!tier || !this.canRecord()) {
      this.log("[clips] this browser cannot record the game's picture");
      this.halted = true;
      this.emit({ t: "unavailable", reason: "no-encoder" });
      return;
    }
    const orientation = orientationOf(first);
    // Tier V encodes VP8 in software on weak phones: one size step down (plan 5.1 software preset).
    const size = (tier === "M" ? PRESETS : SOFTWARE_PRESETS)[orientation];
    const preset: OutputPreset = { width: size.width, height: size.height, targetFps: 30, orientation };
    let compositor: CompositorLike;
    let videoTrack: MediaStreamTrack | null;
    try {
      compositor = this.createCompositor(preset, this.brandHost());
      videoTrack = compositor.captureTrack(RECORDER_FPS);
    } catch (error) {
      this.log(`[clips] capture could not start (${nameOf(error)})`);
      this.emit({ t: "encoder-error", fatal: true });
      this.armFailed();
      return;
    }
    if (!videoTrack) {
      compositor.dispose();
      this.log("[clips] this browser cannot capture a canvas");
      this.halted = true;
      this.emit({ t: "unavailable", reason: "no-encoder" });
      return;
    }
    const areaScale = (preset.width * preset.height) / (PRESETS.tall.width * PRESETS.tall.height);
    const bitrate = Math.max(1_000_000, Math.round(bitrateFor(content, RECORDER_FPS) * Math.min(1, areaScale)));
    const ringSeconds = ringSecondsFor(report.caps.memoryClass);
    let session: Session | null = null;
    const governor = new Governor({
      displayHz: report.caps.displayHz,
      targetFps: RECORDER_FPS,
      startLevel: this.startLevel,
      onChange: (level) => {
        if (!session || this.session !== session) return;
        this.applyLevel();
        this.emit({ t: "governor", level: { ...level }, resting: level.kind === "resting" });
      },
    });
    const clock = new CaptureClock();
    const created: Session = {
      gen,
      tier,
      container: RECORDER_CONTAINERS[tier],
      mimeType: RECORDER_TYPES[tier],
      preset,
      bitrate,
      ringSeconds,
      compositor,
      videoTrack,
      clock,
      ring: new SegmentRing(ringSeconds),
      rotator: null as unknown as Rotator,
      governor,
      pacer: new Pacer(report.caps.displayHz),
      scale: 1,
      live: false,
      outputSent: false,
      recovering: false,
      failuresInRow: 0,
      restartTimer: null,
      tick: null,
      nextId: 1,
      finished: 0,
      coveredToUs: 0,
      indexes: new WeakMap(),
      granularitySec: null,
      purgeUs: 0,
      recording: null,
    };
    session = created;
    created.rotator = new Rotator({
      createRecorder: () => this.makeRecorder(created),
      now: this.now,
      captureUs: () => created.clock.nowUs(this.now()),
      setTimeout: this.setTimer,
      clearTimeout: this.clearTimer,
      rotationMs: ROTATION_MS,
      overlapMs: HANDOFF_OVERLAP_MS,
      startTimeoutMs: START_TIMEOUT_MS,
      stopTimeoutMs: STOP_TIMEOUT_MS,
      retryMs: HANDOFF_RETRY_MS,
      sequentialAfterFailures: SEQUENTIAL_AFTER_FAILURES,
      onSegment: (segment) => this.onSegment(created, segment),
      onStarted: () => this.onRecorderStarted(created),
      onFailure: (kind, info) => this.onRecorderFailure(created, kind, info),
      log: this.log,
    });
    this.session = created;
    this.parked = false;
    governor.setPower(this.now(), this.powerState);
    if (this.power && !this.stopPower) {
      this.stopPower = this.power.subscribe((state) => {
        this.powerState = { ...this.powerState, ...state };
        this.session?.governor.setPower(this.now(), state);
      });
    }
    this.audio?.attach((track) => this.onAudioTrack(created, track));
    for (const entry of this.entries) this.attachEntry(entry, created);
    this.applyLevel();
    if (governor.resting) this.emit({ t: "governor", level: { ...governor.level }, resting: true });
    created.tick = this.setTick(() => this.tick(created), RECORDER_TICK_MS);
    this.applyLive();
  }

  private makeRecorder(s: Session): MediaRecorderLike {
    const tracks: MediaStreamTrack[] = [s.videoTrack];
    const audio = this.audio?.track;
    if (audio && audio.readyState !== "ended") tracks.push(audio);
    return this.createRecorder(this.createStream(tracks), {
      mimeType: s.mimeType,
      videoBitsPerSecond: s.bitrate,
      audioBitsPerSecond: RECORDER_AUDIO_BITRATE,
      videoKeyFrameIntervalDuration: KEYFRAME_INTERVAL_MS,
    });
  }

  private armFailed(): void {
    this.armAgain = false;
    if (this.halted || this.disposed) return;
    this.failedArms++;
    if (this.failedArms >= ARM_FAILURE_LIMIT) {
      this.halted = true;
      this.log("[clips] capture failed to start too many times; it stays off for this game");
      this.emit({ t: "unavailable", reason: "failing" });
      return;
    }
    if (this.rearmTimer !== null) return;
    this.rearmTimer = this.setTimer(() => {
      this.rearmTimer = null;
      this.maybeArm();
    }, Math.min(REARM_MAX_DELAY_MS, REARM_DELAY_MS * 2 ** Math.max(0, this.failedArms - 1)));
  }

  private disarmSession(): void {
    this.gen++;
    if (this.rearmTimer !== null) this.clearTimer(this.rearmTimer);
    this.rearmTimer = null;
    this.contentWait?.cancel();
    const s = this.session;
    this.session = null;
    this.parked = false;
    if (!s) return;
    this.clearTick(s.tick);
    if (s.restartTimer !== null) this.clearTimer(s.restartTimer);
    s.restartTimer = null;
    for (const entry of this.entries) this.detachEntry(entry);
    s.live = false;
    const cleanup = () => {
      s.rotator.dispose();
      try {
        s.videoTrack.stop();
      } catch {
        // Already ended.
      }
      s.compositor.dispose();
    };
    const rec = s.recording;
    if (rec) {
      // Record keeps what it has: the last segment ends now, and the io worker makes the parts.
      void this.endRecording(s, rec).finally(cleanup);
    } else {
      cleanup();
    }
    s.ring.clear();
    this.audio?.detach();
    this.emit({ t: "reset" });
  }

  // ---- capture on and off ------------------------------------------------------

  /** Capture runs while no pause reason is set and the engine is not parked. */
  private applyLive(): void {
    const s = this.session;
    if (!s) return;
    const run = this.pauses.size === 0 && !this.parked;
    const now = this.now();
    if (run && !s.live) {
      s.live = true;
      s.clock.run(now);
      s.pacer.reset();
      s.rotator.start();
    } else if (!run && s.live) {
      s.live = false;
      if (s.restartTimer !== null) this.clearTimer(s.restartTimer);
      s.restartTimer = null;
      // Each recorder's segment ends at this capture time, then the clock stands still.
      void s.rotator.stop();
      s.clock.pause(now);
    }
  }

  /** The governor level, with Record kept at the low-power rung while resting (plan 7). */
  private applyLevel(): void {
    const s = this.session;
    if (!s) return;
    let level: GovernorLevel = s.governor.level;
    const resting = level.kind === "resting";
    if (resting && s.recording) level = s.governor.ladder[s.governor.ladder.length - 2];
    if (level.k > 0) s.pacer.setStride(level.k);
    s.scale = level.scale;
    s.ring.setRingSeconds(level.keepSeconds ?? s.ringSeconds);
    this.setPaused("rest", resting && !s.recording);
  }

  private tick(s: Session): void {
    if (this.session !== s) return;
    const now = this.now();
    s.governor.tick(now);
    this.evict(s);
    const seconds = s.live || s.ring.segments.length > 0 ? Math.min(s.ring.ringSeconds, s.ring.coveredSec(s.clock.nowUs(now))) : 0;
    this.emit({ t: "buffered", seconds });
  }

  private evict(s: Session): void {
    s.ring.evict(s.live ? s.clock.nowUs(this.now()) : 0);
  }

  private onAudioTrack(s: Session, track: MediaStreamTrack | null): void {
    void track;
    // A new sound track: the next segment records it. Start that segment now.
    if (this.session === s && s.live && s.rotator.running) void s.rotator.handOff();
  }

  // ---- recorder events ---------------------------------------------------------

  private onRecorderStarted(s: Session): void {
    if (this.session !== s) return;
    if (!s.outputSent) {
      s.outputSent = true;
      this.failedArms = 0;
      this.emit({ t: "output" });
      // Until the first segment is measured, the rotation period is the most a clip can start early.
      this.setGranularity(s, ROTATION_MS / 1000);
      return;
    }
    if (s.recovering) {
      s.recovering = false;
      this.emit({ t: "recovered" });
    }
  }

  private onRecorderFailure(s: Session, kind: RotatorFailure, info: { current: boolean }): void {
    if (this.session !== s) return;
    this.log(`[clips] a recorder failed (${kind}${info.current ? ", current" : ""})`);
    s.failuresInRow++;
    if (s.failuresInRow >= RECORDER_FAILURE_LIMIT) {
      this.log("[clips] the recorders keep failing; capture stays off for this game");
      this.halted = true;
      this.emit({ t: "unavailable", reason: "failing" });
      this.disarmSession();
      return;
    }
    if (s.rotator.running || !s.live) return;
    // No recorder carries the footage now: say so, and start again after a wait.
    s.recovering = true;
    this.emit({ t: "encoder-error", fatal: !s.outputSent });
    if (s.restartTimer !== null) this.clearTimer(s.restartTimer);
    s.restartTimer = this.setTimer(() => {
      s.restartTimer = null;
      if (this.session === s && s.live && !s.rotator.running) s.rotator.start();
    }, Math.min(REARM_MAX_DELAY_MS, HANDOFF_RETRY_MS * 2 ** Math.max(0, s.failuresInRow - 1)));
  }

  private onSegment(s: Session, finished: FinishedSegment): void {
    s.finished++;
    s.coveredToUs = Math.max(s.coveredToUs, finished.nextStartUs ?? finished.endUs);
    s.failuresInRow = 0;
    const segment: RingSegment = { id: s.nextId++, blob: finished.blob, startUs: finished.startUs, endUs: finished.endUs, index: null, broken: false };
    if (this.session === s && segment.startUs >= s.purgeUs) {
      s.ring.add(segment);
      // Index now: the keyframes set the granularity, and a clip does not wait for it later.
      void this.ensureIndex(s, segment);
      this.evict(s);
    }
    const rec = s.recording;
    if (rec && !rec.closed) this.feedRecording(s, rec, segment, finished.nextStartUs);
  }

  private ensureIndex(s: Session, segment: RingSegment): Promise<SegmentIndex | null> {
    let pending = s.indexes.get(segment);
    if (!pending) {
      pending = this.io.index(segment.blob, s.container).then(
        (index) => {
          segment.index = index;
          if (!index.firstIsKey) {
            // Every recorder starts with a keyframe. One that does not cannot start a clip.
            segment.broken = true;
            this.log("[clips] a recorder segment does not start with a keyframe");
          }
          this.updateGranularity(s);
          return index;
        },
        (error) => {
          segment.broken = true;
          this.log(`[clips] a recorder segment does not parse (${nameOf(error)})`);
          return null;
        },
      );
      s.indexes.set(segment, pending);
    }
    return pending;
  }

  /** The largest keyframe gap of the newest indexed segments (plan 5 replay granularity). */
  private updateGranularity(s: Session): void {
    if (this.session !== s) return;
    const list = s.ring.segments;
    const gaps: number[] = [];
    for (let i = list.length - 1; i >= 0 && gaps.length < GRANULARITY_WINDOW; i--) {
      const index = list[i].index;
      if (!index || list[i].broken) continue;
      const next = list[i + 1];
      const span = next ? Math.min(index.durationUs, next.startUs - list[i].startUs) : index.durationUs;
      gaps.push(keyframeGapUs(index, Math.max(1, span)));
    }
    if (gaps.length === 0) return;
    this.setGranularity(s, Math.max(...gaps) / 1e6);
  }

  private setGranularity(s: Session, seconds: number): void {
    const rounded = Math.max(0.1, Math.ceil(seconds * 10) / 10);
    if (s.granularitySec === rounded) return;
    s.granularitySec = rounded;
    this.emit({ t: "granularity", seconds: rounded });
  }

  /**
   * Makes sure the footage up to endUs is in finished segments: a hand-off
   * ends the segment that records now (a hand-off that already runs is
   * shared, and it can end an older segment, so the check repeats). When the
   * hand-off cannot start a new recorder, the current one is stopped and
   * started again.
   */
  private async finishFootageTo(s: Session, endUs: number, newestEnd: () => number): Promise<void> {
    // A recorder that a pause stopped a moment ago can still be giving its segment.
    await s.rotator.drained();
    for (let i = 0; i < 3; i++) {
      if (newestEnd() >= endUs || this.session !== s || !s.rotator.running) return;
      const before = s.finished;
      await s.rotator.handOff();
      if (s.finished === before && this.session === s && s.rotator.running) {
        await s.rotator.stop();
        if (this.session === s && s.live) s.rotator.start();
      }
    }
  }

  // ---- Record --------------------------------------------------------------------

  /** Sends one finished segment to the recording, in order, with its window. */
  private feedRecording(s: Session, rec: SessionRecording, segment: RingSegment, nextStartUs: number | null): void {
    const stopUs = rec.stopUs ?? Infinity;
    if (segment.endUs <= rec.startUs || segment.startUs >= stopUs) return;
    rec.chain = rec.chain.then(async () => {
      const index = await this.ensureIndex(s, segment);
      if (!index || segment.broken) {
        rec.lost++;
        return;
      }
      let fromUs = segment.startUs;
      if (!rec.sentAny && rec.startUs > segment.startUs) {
        // The recording starts at the last keyframe at or before the tap (plan 6.6).
        for (const k of index.keyframesUs) {
          if (segment.startUs + k <= rec.startUs) fromUs = segment.startUs + k;
          else break;
        }
      }
      const toUs = Math.min(nextStartUs ?? segment.endUs, stopUs);
      if (!(toUs > fromUs)) return;
      rec.io.add({ blob: segment.blob, startUs: segment.startUs, fromUs, toUs });
      rec.sentAny = true;
    });
  }

  /**
   * Ends a recording: the segment that records now ends, every segment goes
   * out, and the io worker makes the parts. stop() and a disarm share one end.
   */
  private endRecording(s: Session, rec: SessionRecording): Promise<void> {
    rec.ending ??= this.runEndRecording(s, rec);
    return rec.ending;
  }

  private async runEndRecording(s: Session, rec: SessionRecording): Promise<void> {
    if (rec.stopUs === null) rec.stopUs = s.clock.nowUs(this.now());
    const stopUs = rec.stopUs;
    if (this.session === s && s.live) {
      // Capture goes on after the recording: end the segment that holds the stop tap.
      await this.finishFootageTo(s, stopUs, () => s.coveredToUs);
    } else {
      // The session ended (or capture is paused): every segment ends now.
      await s.rotator.stop();
    }
    rec.closed = true;
    if (s.recording === rec) s.recording = null;
    if (this.session === s) this.applyLevel();
    await rec.chain;
    rec.io.end();
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
