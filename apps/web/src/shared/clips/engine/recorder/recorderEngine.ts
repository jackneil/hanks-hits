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
 *   canvas.captureStream() -> rotating video-only MediaRecorders -> ring.
 *   game-audio bus tap point -> MediaStreamAudioDestinationNode -> one
 *   sound recorder that does not restart while capture runs
 *   (soundRecorder.ts) -> the io worker's sound store.
 * The io worker indexes each segment (keyframes, packet times, decoder
 * config), joins the segments of a clip into one file (MP4 for M, WebM for
 * V) with the sound of the same span, and stores it with the library's write
 * protocol (verify, move, row, broadcast).
 *
 * First frames: a recorder gets a frame only when the compositor is painted.
 * Capture starts at the first paint after the governor warmup (so no
 * recorder records the empty canvas), and each recorder's start() asks for a
 * repaint of the last picture in the next display frame (a "touch"). While
 * the game draws nothing, a touch comes every KEEPALIVE_MS. The engine keeps
 * the capture time of each paint, and when a segment's index comes, it puts
 * the segment's first frame on the paint that its packet times fit
 * (anchor.ts), not on the recorder's "start" event.
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
 * ("segmentRecordAdd", journaled in OPFS for crash recovery), with the sound
 * of the session's timeline, and the io worker makes the parts at the end.
 *
 * Failures: a recorder that fails is dropped with its segment. When no
 * recorder records any more, the engine says "encoder-error" and starts a
 * new one after a wait. RECORDER_FAILURE_LIMIT failures in a row (with no
 * good segment between them) stop the engine ("unavailable").
 *
 * Tier change: every arm probes again (plan 5). When a fresh probe finds a
 * working VideoEncoder (tier W or W+), the engine asks onTierChange (the
 * engine switch in service/loadEngine.ts) to move the game to the WebCodecs
 * engine before it arms.
 */

import { PRESETS, type ClipMeta, type ClipRecord, type HudState, type OutputPreset, type SegmentContainer, type SegmentIndex, type Tier } from "../../protocol";
import { bitrateFor, probeCapabilityReport, SOFTWARE_PRESETS, type CapabilityReport, type ContentKind } from "../../runtime/capabilities";
import { Governor, type GovernorLevel, type PowerState } from "../../runtime/governor";
import { installCanvasActivity, type ActivityRealm, type CanvasActivity } from "../../sources/canvasActivity";
import { RUNG_HISTORY_US, RungTimeline, rowFps } from "../../rungTimeline";
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
} from "../../service/engineShared";
import { IoError, getIoClient, type IoClient, type SegmentRecordSession } from "../../service/ioClient";
import { anchorSegment } from "./anchor";
import { RecorderAudio } from "./audioTrack";
import { CaptureClock } from "./captureClock";
import { Pacer, startCanvasFeed, type CanvasFeed } from "./canvasFeed";
import { PageCompositor, type FrameSource } from "./compositor";
import {
  GRANULARITY_WINDOW,
  HANDOFF_OVERLAP_MS,
  HANDOFF_RETRY_MS,
  KEEPALIVE_MS,
  KEYFRAME_INTERVAL_MS,
  PAINT_LOG_MAX,
  PURGE_FRAMES,
  RECORDER_CONTAINERS,
  RECORDER_FAILURE_LIMIT,
  RECORDER_FPS,
  RECORDER_TICK_MS,
  RECORDER_TYPES,
  ROTATION_MS,
  SEQUENTIAL_AFTER_FAILURES,
  SOUND_TYPES,
  START_TIMEOUT_MS,
  STOP_TIMEOUT_MS,
  TAKEOVER_GRACE_MS,
} from "./constants";
import { discoverFeed, type FeedDiscovery } from "./discover";
import { Rotator, type FinishedSegment, type MediaRecorderLike, type RotatorFailure } from "./rotator";
import { SegmentRing, keyframeGapUs, planClip, type RingSegment } from "./segmentRing";
import { SoundRecorder } from "./soundRecorder";

/** The io worker calls that this engine uses. IoClient fits it. */
export type RecorderIo = Pick<IoClient, "configure" | "index" | "concat" | "picture" | "segmentRecord" | "audioRun" | "audioAppend" | "audioEnd">;

/** The options every video recorder gets. */
export interface RecorderOptions {
  mimeType: string;
  videoBitsPerSecond: number;
  /** Chromium: the keyframe spacing to use. Other browsers ignore it. */
  videoKeyFrameIntervalDuration: number;
}

/** The options of the sound recorder. */
export interface SoundRecorderMakeOptions {
  mimeType: string;
  audioBitsPerSecond: number;
}

/** The page compositor, or a test double. */
export interface CompositorLike {
  readonly preset: OutputPreset;
  paint(source: FrameSource, hud: HudState, scale: number): void;
  /** Paints the last picture again (canvas capture then gives one more frame). */
  touch(): void;
  /** Paints the empty frame. */
  clear(): void;
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
  /** Makes the sound recorder. Default: the same MediaRecorder constructor. */
  createSoundRecorder?: (stream: MediaStream, options: SoundRecorderMakeOptions) => MediaRecorderLike;
  /** MediaRecorder.isTypeSupported (the sound recorder's types). */
  isTypeSupported?: (mimeType: string) => boolean;
  createStream?: (tracks: MediaStreamTrack[]) => MediaStream;
  createCompositor?: (preset: OutputPreset, brandHost: string) => CompositorLike;
  /** The sound tap. null: no game sound in clips (tests, or no Web Audio). */
  audio?: RecorderAudio | null;
  power?: PowerSource | null;
  /** True when this browser can record a canvas (MediaRecorder, MediaStream, captureStream). */
  canRecord?: () => boolean;
  /**
   * A fresh probe at arm found tier W or W+ (a working VideoEncoder). The
   * engine switch moves the game to the WebCodecs engine and settles true;
   * false keeps this engine. Absent: this engine keeps recording.
   */
  onTierChange?: (report: CapabilityReport) => Promise<boolean>;
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
  /** Segments are sent in order of arrival, each after its index. */
  chain: Promise<void>;
  /** Segments that could not be read, so they are not in the video (reported as failed). */
  lost: number;
  /** No more segments are sent (the last one is out, or the recording ended). */
  closed: boolean;
  /** The end of the recording, once it started (stop() and a disarm share it). */
  ending: Promise<void> | null;
}

/** A Record tap whose io recording is opening: the segments that finish meanwhile wait here. */
interface RecordingStart {
  startUs: number;
  held: RingSegment[];
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
  sound: SoundRecorder;
  governor: Governor;
  pacer: Pacer;
  /**
   * The capture rung over capture time (plan 7). A clip's row fps and each
   * Record segment's fps is the rung weighted over its span, never the rung
   * of one moment or the recorder's constant rate (rungTimeline.ts).
   */
  rungs: RungTimeline;
  /** The rung of the newest note (the rung that capture uses now). */
  rungFps: number;
  /** Content scale inside the coded frame (a governor step). */
  scale: number;
  /** The clock runs (no pause reason, not parked). */
  live: boolean;
  /** The compositor holds a picture (a paint came after arm). */
  hasContent: boolean;
  /** Capture was started for this live span (recorders and sound). */
  captureOn: boolean;
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
   * one is used only up to its successor's start (Record uses them so).
   */
  coveredToUs: number;
  indexes: WeakMap<RingSegment, Promise<SegmentIndex | null>>;
  granularitySec: number | null;
  /** Segments whose recorder started before this capture time hold footage from before a purge: no clip uses them. */
  purgeUs: number;
  /** Display frames left before the hand-off of a purge (0: none waits). */
  purgeFrames: number;
  /** Capture times of the compositor paints (and touches), in order (anchor.ts). */
  paints: number[];
  /** Page time of the newest paint. */
  lastPaintMs: number;
  anchorMisses: number;
  recording: SessionRecording | null;
  recordStarting: RecordingStart | null;
}

const CONTAINER_MIMES: Readonly<Record<SegmentContainer, "video/mp4" | "video/webm">> = { mp4: "video/mp4", webm: "video/webm" };

function ringSecondsFor(memoryClass: string): number {
  return memoryClass === "low" ? 30 : 60;
}

/** The capture rate of a governor level: its paint rate (at most the recorders' rate), or 0 while it rests. */
function rungOf(level: GovernorLevel): number {
  return level.k > 0 ? Math.min(RECORDER_FPS, level.fps) : 0;
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
 * The same order as selectTier (plan 5).
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

function browserIsTypeSupported(mimeType: string): boolean {
  const recorder = (globalThis as unknown as { MediaRecorder?: { isTypeSupported?: (t: string) => boolean } }).MediaRecorder;
  return typeof recorder?.isTypeSupported === "function" ? recorder.isTypeSupported(mimeType) : false;
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
  private readonly createSoundRecorder: (stream: MediaStream, options: SoundRecorderMakeOptions) => MediaRecorderLike;
  private readonly isTypeSupported: (mimeType: string) => boolean;
  private readonly createStream: (tracks: MediaStreamTrack[]) => MediaStream;
  private readonly createCompositor: (preset: OutputPreset, brandHost: string) => CompositorLike;
  private readonly audio: RecorderAudio | null;
  private readonly power: PowerSource | null;
  private readonly canRecord: () => boolean;
  private readonly onTierChange: ((report: CapabilityReport) => Promise<boolean>) | null;
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
  /** The engine switch said no once: this engine records on, and does not ask again. */
  private keepTier = false;
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
    this.createSoundRecorder =
      deps.createSoundRecorder ??
      ((stream, options) => new MediaRecorder(stream, options as MediaRecorderOptions) as unknown as MediaRecorderLike);
    this.isTypeSupported = deps.isTypeSupported ?? browserIsTypeSupported;
    this.createStream = deps.createStream ?? ((tracks) => new MediaStream(tracks));
    this.createCompositor = deps.createCompositor ?? ((preset, host) => new PageCompositor(preset, host, { document }));
    this.audio = deps.audio === undefined ? new RecorderAudio() : deps.audio;
    this.power = deps.power === undefined ? browserPowerSource() : deps.power;
    this.canRecord = deps.canRecord ?? browserCanRecord;
    this.onTierChange = deps.onTierChange ?? null;
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
    if (s && !s.live) {
      void s.rotator.stop();
      s.sound.stop();
    }
  }

  mediaEndUs(): number {
    const s = this.session;
    return s ? s.clock.nowUs(this.now()) : 0;
  }

  async clip(request: ClipRequest): Promise<MadeClip> {
    const s = this.session;
    if (!s || !s.outputSent) throw new EngineFailure("warming", "no footage yet");
    const endUs = request.endAtUs ?? s.clock.nowUs(this.now());
    // The newest sound bytes go to the io worker now: the join waits for the sound up to its end.
    s.sound.flush();
    await this.finishFootageTo(s, endUs, () => Math.max(0, ...s.ring.segments.map((segment) => segment.endUs)));
    if (this.session !== s) throw new EngineFailure("encoder-error", "the recorder stopped");
    const fromUs = Math.max(0, endUs - request.seconds * 1e6);
    // Each index moves its segment's start to its first frame, and that can change which segments the span needs.
    let needed = s.ring.needed(fromUs, endUs);
    for (let pass = 0; pass < 3; pass++) {
      await Promise.all(needed.map((segment) => this.ensureIndex(s, segment)));
      if (this.session !== s) throw new EngineFailure("encoder-error", "the recorder stopped");
      const again = s.ring.needed(fromUs, endUs);
      const same = again.length === needed.length && again.every((segment, i) => segment === needed[i]);
      needed = again;
      if (same) break;
    }
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
      // The rung that capture used over the clip, weighted by time (plan 7).
      fps: rowFps(s.rungs.weighted(plan.startUs, plan.endUs)) || s.rungs.lastNonZero() || RECORDER_FPS,
      // The io worker sets it from the joined file.
      hasAudio: false,
      mime: CONTAINER_MIMES[s.container],
      moments: request.moments ? request.moments(plan.startUs, plan.endUs) : request.meta.moments,
    };
    try {
      const record = await this.io.concat(
        { container: s.container, segments: plan.segments, timeline: s.gen, ...(poster ? { poster } : {}) },
        meta,
      );
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
    if (s.recording || s.recordStarting) throw new EngineFailure("encoder-error", "a recording is already running");
    const startUs = s.clock.nowUs(this.now());
    // From the tap on, a segment that finishes waits here until the io recording is open.
    const starting: RecordingStart = { startUs, held: [] };
    s.recordStarting = starting;
    let io: SegmentRecordSession | null = null;
    try {
      const poster = await s.compositor.posterJpeg();
      io = this.io.segmentRecord(
        meta.id,
        {
          ...meta,
          kind: "record",
          width: s.preset.width,
          height: s.preset.height,
          // Each segment carries its own weighted rung (feedRecording); this is
          // the fallback for a segment without one. While capture rests at
          // the tap: the last rung that capture used.
          fps: rowFps(s.rungs.at(startUs)) || s.rungs.lastNonZero() || RECORDER_FPS,
          mime: CONTAINER_MIMES[s.container],
        },
        { container: s.container, timeline: s.gen, startUs, poster },
      );
      await io.started;
    } catch (error) {
      if (s.recordStarting === starting) s.recordStarting = null;
      throw failureFromIo(error);
    }
    if (this.session !== s || s.recordStarting !== starting) {
      io.end();
      throw new EngineFailure("encoder-error", "the recorder stopped");
    }
    s.recordStarting = null;
    const rec: SessionRecording = {
      id: meta.id,
      io,
      startUs,
      stopUs: null,
      chain: Promise.resolve(),
      lost: 0,
      closed: false,
      ending: null,
    };
    s.recording = rec;
    // The segments that finished while the io recording opened (the tap is in one of them).
    for (const segment of starting.held) this.feedRecording(s, rec, segment);
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
    // The last picture is from before the purge: a repaint must never show it again.
    s.compositor.clear();
    if (s.live && s.rotator.running) {
      // A new recorder, once the empty frame is the track's frame (PURGE_FRAMES).
      s.purgeFrames = PURGE_FRAMES;
      this.requestTouch(s);
    }
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
      draw: (source, hud, pageMs) => {
        s.compositor.paint(source, hud, s.scale);
        this.onPaint(s, pageMs);
      },
      touch: (pageMs) => {
        if (this.session !== s || !s.hasContent) return;
        s.compositor.touch();
        this.logPaint(s, pageMs);
      },
      onFrame: () => this.onFrame(s),
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

  // ---- paints ------------------------------------------------------------------

  /** A game frame was painted into the compositor. The first one starts capture. */
  private onPaint(s: Session, pageMs: number): void {
    if (this.session !== s) return;
    this.logPaint(s, pageMs);
    s.hasContent = true;
    if (s.live && !s.captureOn) this.startCapture(s);
  }

  private logPaint(s: Session, pageMs: number): void {
    const us = s.clock.nowUs(pageMs);
    const last = s.paints[s.paints.length - 1];
    if (last === undefined || us >= last) s.paints.push(us);
    if (s.paints.length > PAINT_LOG_MAX) s.paints.splice(0, s.paints.length - PAINT_LOG_MAX);
    s.lastPaintMs = this.now();
  }

  /** The end of a display frame: counts the frames of a purge's wait, then hands off. */
  private onFrame(s: Session): void {
    if (this.session !== s || s.purgeFrames === 0) return;
    s.purgeFrames--;
    if (s.purgeFrames > 0) {
      this.requestTouch(s);
      return;
    }
    if (s.live && s.rotator.running) void s.rotator.handOff();
  }

  /** A recorder was started: it needs a frame now. */
  private requestTouch(s: Session): void {
    if (this.session !== s || !s.hasContent) return;
    this.newestFeed()?.requestTouch();
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
    const probed = report.caps.tier;
    if ((probed === "W" || probed === "W+") && this.onTierChange && !this.keepTier) {
      // A working VideoEncoder now (the first probe met a cold or busy one): the WebCodecs engine takes over.
      let switched = false;
      try {
        switched = await this.onTierChange(report);
      } catch {
        switched = false;
      }
      if (switched) {
        this.halted = true;
        return;
      }
      this.keepTier = true;
      if (gen !== this.gen || this.disposed || !this.entries.has(first)) {
        if (gen === this.gen) this.armAgain = true;
        return;
      }
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
    const container = RECORDER_CONTAINERS[tier];
    const created: Session = {
      gen,
      tier,
      container,
      mimeType: RECORDER_TYPES[tier],
      preset,
      bitrate,
      ringSeconds,
      compositor,
      videoTrack,
      clock,
      ring: new SegmentRing(ringSeconds),
      rotator: null as unknown as Rotator,
      sound: new SoundRecorder({
        createRecorder: (stream, options) => this.createSoundRecorder(stream, options),
        createStream: (tracks) => this.createStream(tracks),
        isTypeSupported: this.isTypeSupported,
        types: SOUND_TYPES[tier],
        container,
        timeline: gen,
        keepSeconds: ringSeconds,
        captureUs: () => clock.nowUs(this.now()),
        io: this.io,
        setTimeout: this.setTimer,
        clearTimeout: this.clearTimer,
        log: this.log,
      }),
      governor,
      pacer: new Pacer(report.caps.displayHz),
      rungs: new RungTimeline(rungOf(governor.level)),
      rungFps: rungOf(governor.level),
      scale: 1,
      live: false,
      hasContent: false,
      captureOn: false,
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
      purgeFrames: 0,
      paints: [],
      lastPaintMs: 0,
      anchorMisses: 0,
      recording: null,
      recordStarting: null,
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
      takeoverGraceMs: TAKEOVER_GRACE_MS,
      onSegment: (segment) => this.onSegment(created, segment),
      onStarted: () => this.onRecorderStarted(created),
      onStartCall: () => this.requestTouch(created),
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

  /** A video-only recorder: the sound has its own recorder (soundRecorder.ts). */
  private makeRecorder(s: Session): MediaRecorderLike {
    return this.createRecorder(this.createStream([s.videoTrack]), {
      mimeType: s.mimeType,
      videoBitsPerSecond: s.bitrate,
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
    s.captureOn = false;
    s.recordStarting = null;
    // The sound run ends: its last bytes and its end go to the io worker before any later run.
    s.sound.dispose();
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

  /**
   * Capture runs while no pause reason is set and the engine is not parked.
   * The recorders start at once when the compositor holds a picture, else at
   * the first paint (after the governor warmup).
   */
  private applyLive(): void {
    const s = this.session;
    if (!s) return;
    const run = this.pauses.size === 0 && !this.parked;
    const now = this.now();
    if (run && !s.live) {
      s.live = true;
      s.clock.run(now);
      s.pacer.reset();
      if (s.hasContent) this.startCapture(s);
    } else if (!run && s.live) {
      s.live = false;
      s.captureOn = false;
      if (s.restartTimer !== null) this.clearTimer(s.restartTimer);
      s.restartTimer = null;
      // Each recorder's segment ends at this capture time, then the clock stands still.
      void s.rotator.stop();
      s.sound.stop();
      s.clock.pause(now);
    }
  }

  /** Starts the recorders and the sound for this live span. */
  private startCapture(s: Session): void {
    if (this.session !== s || !s.live) return;
    s.captureOn = true;
    s.rotator.start();
    const track = this.audio?.track;
    if (track && track.readyState !== "ended") s.sound.start(track);
  }

  /** The governor level, with Record kept at the low-power rung while resting (plan 7). */
  private applyLevel(): void {
    const s = this.session;
    if (!s) return;
    let level: GovernorLevel = s.governor.level;
    const resting = level.kind === "resting";
    if (resting && s.recording) level = s.governor.ladder[s.governor.ladder.length - 2];
    if (level.k > 0) s.pacer.setStride(level.k);
    this.noteRung(s, rungOf(level));
    s.scale = level.scale;
    s.ring.setRingSeconds(level.keepSeconds ?? s.ringSeconds);
    this.setPaused("rest", resting && !s.recording);
  }

  /**
   * The capture rung changed (plan 7): note it at the capture time of now.
   * While capture rests with no Record, the clock stands still, so the 0
   * rung covers no capture time.
   */
  private noteRung(s: Session, fps: number): void {
    if (fps === s.rungFps) return;
    const atUs = s.clock.nowUs(this.now());
    s.rungFps = fps;
    s.rungs.note(atUs, fps);
    s.rungs.forgetBefore(atUs - RUNG_HISTORY_US);
  }

  private tick(s: Session): void {
    if (this.session !== s) return;
    const now = this.now();
    s.governor.tick(now);
    this.evict(s);
    if (s.captureOn && s.hasContent && s.rotator.running && now - s.lastPaintMs >= KEEPALIVE_MS) {
      // The game draws nothing: the recorders still need frames.
      this.requestTouch(s);
    }
    if (s.captureOn && s.rotator.idle && s.restartTimer === null && !this.halted) {
      // No recorder records and nothing will start one (a failure that left no successor).
      this.recoverCapture(s, "no recorder runs");
    }
    this.emit({ t: "buffered", seconds: this.bufferedSec(s) });
  }

  /**
   * Seconds of footage back from now: from the oldest usable segment's start,
   * or from the running recorder's start when no segment reaches back
   * further (the first rotation after an arm or a purge).
   */
  private bufferedSec(s: Session): number {
    let oldest = Infinity;
    for (const segment of s.ring.segments) {
      if (!segment.broken) {
        oldest = segment.startUs;
        break;
      }
    }
    const running = s.rotator.currentStartUs;
    if (running !== null && running >= s.purgeUs) oldest = Math.min(oldest, running);
    if (!Number.isFinite(oldest)) return 0;
    return Math.min(s.ring.ringSeconds, Math.max(0, (s.clock.nowUs(this.now()) - oldest) / 1e6));
  }

  private evict(s: Session): void {
    s.ring.evict(s.live ? s.clock.nowUs(this.now()) : 0);
  }

  private onAudioTrack(s: Session, track: MediaStreamTrack | null): void {
    if (this.session !== s || !s.captureOn) return;
    // A new sound track (a new bus): a new sound run records it from now on.
    s.sound.stop();
    if (track && track.readyState !== "ended") s.sound.start(track);
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
    if (!s.rotator.idle || !s.captureOn) return;
    this.recoverCapture(s, "the recorder failed");
  }

  /** No recorder carries the footage: say so, and start one again after a wait. */
  private recoverCapture(s: Session, why: string): void {
    if (s.restartTimer !== null) return;
    this.log(`[clips] ${why}; capture starts again`);
    s.recovering = true;
    this.emit({ t: "encoder-error", fatal: !s.outputSent });
    s.restartTimer = this.setTimer(() => {
      s.restartTimer = null;
      if (this.session === s && s.captureOn && s.rotator.idle) s.rotator.start();
    }, Math.min(REARM_MAX_DELAY_MS, HANDOFF_RETRY_MS * 2 ** Math.max(0, s.failuresInRow - 1)));
  }

  private onSegment(s: Session, finished: FinishedSegment): void {
    s.finished++;
    s.coveredToUs = Math.max(s.coveredToUs, finished.nextStartUs ?? finished.endUs);
    s.failuresInRow = 0;
    const segment: RingSegment = {
      id: s.nextId++,
      blob: finished.blob,
      startUs: finished.startUs,
      startCallUs: finished.startCallUs,
      startEventUs: finished.startUs,
      endUs: finished.endUs,
      nextStartUs: finished.nextStartUs,
      index: null,
      broken: false,
    };
    // A recorder started before the purge can hold footage from before it.
    if (this.session === s && segment.startCallUs >= s.purgeUs) {
      s.ring.add(segment);
      // Index now: the keyframes set the granularity, the packet times set the start, and a clip does not wait for it later.
      void this.ensureIndex(s, segment);
      this.evict(s);
    }
    const rec = s.recording;
    if (rec && !rec.closed) this.feedRecording(s, rec, segment);
    else if (s.recordStarting) s.recordStarting.held.push(segment);
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
          this.anchor(s, segment, index);
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

  /** Puts the segment's first frame on the paint that its packet times fit (anchor.ts). */
  private anchor(s: Session, segment: RingSegment, index: SegmentIndex): void {
    const found = anchorSegment({
      paintsUs: s.paints,
      startCallUs: segment.startCallUs,
      startEventUs: segment.startEventUs,
      packetTimesUs: index.packetTimesUs,
    });
    if (!found.matched) {
      s.anchorMisses++;
      if (s.anchorMisses === 1) this.log(`[clips] a segment's frames do not fit the paint times (${Math.round(found.errorUs)} us); its start is the first paint after the recorder started`);
    }
    segment.startUs = found.startUs;
    if (this.session === s) s.ring.resort();
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
        if (this.session === s && s.live && s.captureOn) s.rotator.start();
      }
    }
  }

  // ---- Record --------------------------------------------------------------------

  /**
   * Sends one finished segment to the recording, after its index. A segment
   * that holds the tap starts at its own last keyframe at or before the tap;
   * the io worker puts the segments in order, makes their windows meet, and
   * starts the recording at the latest of those keyframes.
   */
  private feedRecording(s: Session, rec: SessionRecording, segment: RingSegment): void {
    const stopUs = rec.stopUs ?? Infinity;
    if (segment.endUs <= rec.startUs || segment.startCallUs >= stopUs) return;
    rec.chain = rec.chain.then(async () => {
      const index = await this.ensureIndex(s, segment);
      if (!index || segment.broken) {
        rec.lost++;
        return;
      }
      let fromUs = segment.startUs;
      if (rec.startUs > segment.startUs) {
        // The recording starts at the last keyframe at or before the tap (plan 6.6).
        for (const k of index.keyframesUs) {
          if (segment.startUs + k <= rec.startUs) fromUs = segment.startUs + k;
          else break;
        }
      }
      const toUs = Math.min(segment.endUs, stopUs);
      if (!(toUs > fromUs)) return;
      // The rung that capture used over this window, weighted by time (plan 7).
      // The io worker weights a part's segments the same way. It includes the
      // footage from the keyframe before the tap, at the rung that covered it.
      const fps = rowFps(s.rungs.weighted(fromUs, toUs));
      // A tile picture for a part that could start with this segment (a device with no video decoder).
      const poster = await s.compositor.posterJpeg();
      rec.io.add({ blob: segment.blob, startUs: segment.startUs, fromUs, toUs, ...(fps > 0 ? { fps } : {}) }, poster);
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
    // The sound up to the stop tap goes to the io worker now.
    s.sound.flush();
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
    // Every sound byte up to here is on its way before the end.
    await s.sound.sent();
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
