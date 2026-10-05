/**
 * ClipService: the tab's clip singleton, outside React (plan 4.1). It lives
 * across client route changes, so a ring survives a trip to another page.
 *
 * It implements the contract (contract.ts) for every clip surface:
 * - the plan 7 state machine (machine.ts), driven by the capture engine's
 *   events, the page lifecycle (lifecycle.ts), the owner and the crash
 *   breaker (breaker.ts);
 * - the plan 11.1 tap rules: pointerdown freezes the ring end; a release
 *   under HOLD_FOR_MENU_MS commits a clip; a cancelled press commits
 *   nothing, whatever its length; a still hold of HOLD_FOR_MENU_MS or more
 *   opens the Capture menu and commits nothing; a tap within EXTEND_WINDOW_MS of the last clip
 *   makes that clip longer. The longer clip replaces the last clip only when
 *   it contains all of it. When the ring cannot reach back that far (a 30 s
 *   ring, or an encoder recovery cut the clip to its newest epoch), both
 *   clips stay and the new one is a plain clip, so no footage is lost;
 * - the clip button (plan 11.3), with "made" for 1.2 s and "error" for 3 s;
 * - immutable snapshots that change identity only when a field changes.
 *
 * Breaks: an attached game plays until something says it is at a break
 * (setAtBreak: the start card, the pause menu, a game's own isPlaying).
 *
 * Owners (plan 7.1): the session bus (registry.ts) tells the service when
 * the signed-in player changes, on any page. The end of the ring's last run
 * is kept on the service (not on one game mount), so a sign-in from the
 * /login page within 60 s of the run's end keeps the guest ring. Every
 * action result, the new-clip chip and the last result belong to one owner:
 * a purge clears them, and an action that ends after an owner change never
 * shows its clip to the new owner.
 *
 * Failures: 4 encoder failures in 60 s (FAILURES_TO_DISABLE) turn capture
 * off for the tab in every capturing state, also before the first output.
 * DISABLED stops the engine for good (no re-arm) and lets every source go.
 *
 * The capture engine is loaded with a dynamic import when a clip-enabled game
 * attaches, so nothing heavy reaches a page that has clips off.
 * getClipService() is null on the server and while clips are off.
 */

import type { ClipMeta, ClipRecord, MomentMark, RunPhase, Tier } from "../protocol";
import { GUEST_OWNER_KEY, ownerKeyFor } from "../library/ownerKey";
import { CrashBreaker, type BreakerVerdict } from "./breaker";
import {
  DEFAULT_CLIP_SECONDS,
  EXTEND_WINDOW_MS,
  HIDDEN_SNAPSHOT,
  HOLD_FOR_MENU_MS,
  type AttachedGame,
  type ClipActionResult,
  type ClipButtonState,
  type ClipLibraryApi,
  type ClipReasonCode,
  type ClipServiceApi,
  type ClipSnapshot,
  type EngineState,
  type GameAttachment,
  type PressOutcome,
  type PressToken,
  type RunClipPart,
  type RunSpan,
  type SaveOutcome,
  type ShareOutcome,
} from "./contract";
import { EngineFailure, type CaptureEngine, type EngineEvent, type MadeClip, type RecordingHandle } from "./engine";
import { getIoClient, type IoClient, type SessionBusLike } from "./ioClient";
import {
  Lifecycle,
  browserLifecycleEnv,
  hiddenClosesEncoder,
  ownerChangeAction,
  readSessionUserId,
  type LifecycleListener,
} from "./lifecycle";
import {
  ERROR_MS,
  MADE_MS,
  RECOVERING_QUIET_MS,
  SOURCE_LOST_GRACE_MS,
  deriveButton,
  transition,
  type MachineEvent,
  type TransitionContext,
} from "./machine";
import { currentSessionUser, onSessionUser, setClipService } from "./registry";
import { fileNameFor, saveFile, shareFile, type ShareEnv } from "./share";
import { browserLocks, randomId } from "./webLocks";

/** A lost source's ring is kept this long in case the same game comes back (plan 7). */
export const RING_KEEP_MS = 5 * 60 * 1000;
/** Video failures in this window that turn capture off (plan 7: 4 in 60 s). */
export const FAILURE_WINDOW_MS = 60_000;
export const FAILURES_TO_DISABLE = 4;
/**
 * After runPhase("end"), capture runs this long into the break, so the ring
 * holds the result card (the clip's end card). Plan 11.5 keeps 3 s after a
 * moment; the same span is used here.
 */
export const RESULT_POST_ROLL_MS = 3000;
/** How often the Record timer updates. */
export const RECORD_TICK_MS = 1000;
/** Active capture time allowed before an empty encoder attempt rests. */
export const WARMUP_TIMEOUT_MS = 15_000;
/** Moments older than this behind the newest frame can no longer be in a clip (a ring holds at most 60 s). */
export const MOMENT_KEEP_US = 120_000_000;
/** First wait before the owner is read again after a failed read at a bfcache restore. It doubles each time. */
export const OWNER_RETRY_MS = 2000;
/** The longest wait between two owner reads. */
export const OWNER_RETRY_MAX_MS = 60_000;

/** The parts of the library client that the service uses. */
export type ServiceIo = Pick<IoClient, "libraryApi" | "resolveOwner" | "setOwnerKey" | "update">;

export interface ClipServiceDeps {
  loadEngine?: () => Promise<CaptureEngine>;
  io?: ServiceIo;
  breaker?: CrashBreaker;
  lifecycle?: Lifecycle;
  /** Monotonic milliseconds (performance.now). */
  now?: () => number;
  /** Wall-clock milliseconds, for createdAt (Date.now). */
  wallNow?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  host?: () => string;
  /** The signed-in user id, read fresh (bfcache restore). */
  readUserId?: () => Promise<string | null>;
  ownerKeyFor?: (userId: string | null) => Promise<string>;
  /** iOS: a hidden page closes its encoders at once (plan 7.1). */
  closesEncoderWhenHidden?: boolean;
  shareEnv?: ShareEnv;
  /** The session bus (registry.ts). null: none (tests). */
  sessionBus?: SessionBusLike | null;
  log?: (message: string) => void;
}

/** The ring's last run, kept across detach (plan 7.1 guest-keep rule). */
interface RingRun {
  appId: string;
  /** Page time of the last runPhase("end"), or null. */
  lastRunEndAtMs: number | null;
  /** A run started after the last end. */
  runActive: boolean;
}

interface SourceReg {
  kind: "canvas" | "discover";
  canvas: HTMLCanvasElement | null;
  root: Element | null;
  targetFps: 30 | 60 | undefined;
  dispose: (() => void) | null;
  removed: boolean;
}

/** The last clip, for the extend rule. `made` settles with the stored clip (or null on failure). */
interface LastClip {
  committedAtMs: number;
  ownerKey: string;
  made: Promise<MadeClip | null>;
}

interface Recording {
  handle: RecordingHandle | null;
  recordingId: string;
  startedAtMs: number;
  startUs: number;
  restedAtStart: boolean;
  stars: Array<{ atUs: number; mark: MomentMark }>;
  stopping: Promise<ClipActionResult> | null;
  /** The owner epoch at the start: the video belongs to that owner. */
  epoch: number;
}

type Action = ClipActionResult["action"];
type EngineStatus = "unloaded" | "loading" | "ready" | "failed";

function sameRecording(a: ClipSnapshot["recording"], b: ClipSnapshot["recording"]): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.recordingId === b.recordingId && a.startedAtMs === b.startedAtMs && a.elapsedSec === b.elapsedSec && a.stars === b.stars;
}

function sameSnapshot(a: ClipSnapshot, b: Omit<ClipSnapshot, "version">): boolean {
  return (
    a.button === b.button &&
    a.engine === b.engine &&
    a.reason === b.reason &&
    a.appId === b.appId &&
    a.tier === b.tier &&
    a.warmProgress === b.warmProgress &&
    a.savingProgress === b.savingProgress &&
    a.bufferedSec === b.bufferedSec &&
    a.replayGranularitySec === b.replayGranularitySec &&
    a.ttfcMs === b.ttfcMs &&
    a.preRest === b.preRest &&
    sameRecording(a.recording, b.recording) &&
    a.unwatchedClipId === b.unwatchedClipId &&
    a.lastResult === b.lastResult &&
    a.gameCanPause === b.gameCanPause &&
    a.atBreak === b.atBreak
  );
}

function reasonOf(error: unknown): ClipReasonCode {
  return error instanceof EngineFailure ? error.reason : "mux-failed";
}

/** The engine for this device's tier (loadEngine.ts: WebCodecs for W and W+, MediaRecorder for M and V). */
function defaultLoadEngine(): Promise<CaptureEngine> {
  return import("./loadEngine").then(({ loadCaptureEngine }) => loadCaptureEngine());
}

function safeLocalStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

class Attachment implements AttachedGame {
  readonly sources = new Set<SourceReg>();
  /**
   * The game plays until something says it is at a break (the start card and
   * the pause menu through ClipProvider, or the game's own isPlaying). A game
   * that only registers its canvas therefore captures.
   */
  atBreak = false;
  runActive = false;
  lastRunEndAtMs: number | null = null;
  /** The latest run on the capture timeline (PressToken.run), or null. */
  run: RunSpan | null = null;
  moments: Array<{ atUs: number; mark: MomentMark }> = [];
  detached = false;
  /** The engine knows this game and the breaker let it capture: registrations go to the engine. */
  ready = false;

  constructor(
    private readonly service: ClipService,
    readonly game: GameAttachment,
  ) {}

  registerCanvas(canvas: HTMLCanvasElement, options?: { targetFps?: 30 | 60 }): () => void {
    return this.service.addSource(this, { kind: "canvas", canvas, root: null, targetFps: options?.targetFps, dispose: null, removed: false });
  }

  autoDiscover(root: Element): () => void {
    return this.service.addSource(this, { kind: "discover", canvas: null, root, targetFps: undefined, dispose: null, removed: false });
  }

  runPhase(phase: RunPhase): void {
    this.service.runPhase(this, phase);
  }

  markMoment(mark: Omit<MomentMark, "offsetSec"> & { offsetSec?: number }): void {
    this.service.markMoment(this, mark);
  }

  setAtBreak(atBreak: boolean): void {
    this.service.setAtBreak(this, atBreak);
  }

  detach(): void {
    this.service.detachGame(this);
  }
}

export class ClipService implements ClipServiceApi {
  readonly library: ClipLibraryApi;

  private readonly loadEngine: () => Promise<CaptureEngine>;
  private readonly io: ServiceIo;
  private readonly breaker: CrashBreaker;
  private readonly lifecycle: Lifecycle;
  private readonly now: () => number;
  private readonly wallNow: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly setRepeat: (fn: () => void, ms: number) => unknown;
  private readonly clearRepeat: (handle: unknown) => void;
  private readonly host: () => string;
  private readonly readUserId: () => Promise<string | null>;
  private readonly keyFor: (userId: string | null) => Promise<string>;
  private readonly closesOnHide: boolean;
  private readonly shareEnv: ShareEnv | undefined;
  private readonly log: (message: string) => void;

  private snapshot: ClipSnapshot = HIDDEN_SNAPSHOT;
  private readonly listeners = new Set<() => void>();

  private engine: CaptureEngine | null = null;
  private engineLoad: Promise<CaptureEngine | null> | null = null;
  private engineStatus: EngineStatus = "unloaded";
  private tier: Tier = "none";
  private supported = false;
  private state: EngineState = "idle";
  private attached: Attachment | null = null;

  // Engine facts.
  private outputOk = false;
  private sourcePresent = false;
  private governorResting = false;
  private warmupResting = false;
  private warmupElapsedMs = 0;
  private warmupStartedAt: number | null = null;
  private recovering = false;
  private bufferedSec = 0;
  /** The encoder's time to first frame (plan 15.2), once the engine measured it. */
  private ttfcMs: number | null = null;
  /** Replay granularity from the engine (tiers M and V), or null (1 s on tiers W and W+). */
  private granularitySec: number | null = null;
  private warmStartUs = 0;
  private lostSource = false;
  private disabledReason: "breaker" | "encoder-error" | null = null;
  private failures: number[] = [];
  /** FAILURES_TO_DISABLE reached (or the engine gave up): the machine goes to DISABLED from RECOVERING. */
  private failureLimit = false;
  private held: ClipButtonState | null = null;
  private preRest = false;

  // Owner.
  private ownerKey: string | null = null;
  /** Capture may use ownerKey now. False while the owner is read again (bfcache restore). */
  private ownerConfirmed = false;
  private ownerCheck = 0;
  /** Bumps at every owner purge: an action that started for an older owner never shows its result. */
  private ownerEpoch = 0;
  /** The owner read after a bfcache restore failed: tries so far (see readOwnerAfterRestore). */
  private ownerRetries: number | null = null;
  /** The ring's last run, kept across detach (plan 7.1 guest-keep rule). */
  private ringRun: RingRun | null = null;
  private readonly stopSession: () => void;

  // Actions.
  private saving = 0;
  private savingProgress: number | null = null;
  private madeUntilMs = 0;
  private errorUntilMs = 0;
  private errorReason: ClipReasonCode | null = null;
  private lastResult: ClipActionResult | null = null;
  private unwatchedClipId: string | null = null;
  private lastClip: LastClip | null = null;
  private recording: Recording | null = null;
  private elapsedSec = 0;
  private recordTicker: unknown = null;

  private readonly timers = new Map<string, unknown>();
  private disposed = false;

  constructor(deps: ClipServiceDeps = {}) {
    this.loadEngine = deps.loadEngine ?? defaultLoadEngine;
    const io = deps.io ?? getIoClient();
    if (!io) throw new Error("ClipService runs in a browser window only");
    this.io = io;
    this.library = io.libraryApi();
    this.now = deps.now ?? (() => performance.now());
    this.wallNow = deps.wallNow ?? (() => Date.now());
    const locks = deps.breaker && deps.lifecycle ? null : browserLocks();
    this.breaker = deps.breaker ?? new CrashBreaker({ storage: safeLocalStorage(), locks, now: this.wallNow });
    this.lifecycle = deps.lifecycle ?? new Lifecycle(browserLifecycleEnv(locks));
    this.setTimer = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.setRepeat = deps.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    this.clearRepeat = deps.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
    this.host = deps.host ?? (() => (typeof location !== "undefined" ? location.host : ""));
    this.readUserId = deps.readUserId ?? (() => readSessionUserId());
    this.keyFor = deps.ownerKeyFor ?? ((id) => ownerKeyFor(id));
    this.closesOnHide = deps.closesEncoderWhenHidden ?? hiddenClosesEncoder(typeof navigator !== "undefined" ? navigator : undefined);
    this.shareEnv = deps.shareEnv;
    this.log = deps.log ?? ((m) => console.warn(m));
    const listener: LifecycleListener = {
      visibility: (visible) => this.onVisibility(visible),
      pageHide: (persisted) => this.onPageHide(persisted),
      pageShow: () => this.onPageShow(),
      election: () => this.applyPauses(),
      online: () => this.retryOwnerNow(),
    };
    this.lifecycle.start(listener);
    const bus = deps.sessionBus === undefined ? { current: currentSessionUser, subscribe: onSessionUser } : deps.sessionBus;
    this.stopSession = bus ? bus.subscribe((userId) => void this.setSessionUser(userId)) : () => undefined;
    const known = bus?.current();
    if (known) {
      void this.setSessionUser(known.userId);
    } else {
      // The first owner: the library client reads the session (or, offline, uses the last known player).
      const check = ++this.ownerCheck;
      void this.io.resolveOwner().then((owner) => {
        if (check === this.ownerCheck && this.ownerKey === null) this.acceptOwner(owner.key, false, owner.confirmed);
      });
    }
  }

  // ---- store (useSyncExternalStore) ---------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ClipSnapshot => this.snapshot;

  getServerSnapshot = (): ClipSnapshot => HIDDEN_SNAPSHOT;

  // ---- attach ----------------------------------------------------------------------

  attach(game: GameAttachment): AttachedGame {
    if (this.attached) this.detachGame(this.attached);
    const attachment = new Attachment(this, game);
    this.attached = attachment;
    this.clearNamedTimer("ring-keep");
    this.lostSource = false;
    // A different game gets an empty ring (the engine purges it), so its run starts over.
    if (this.ringRun?.appId !== game.appId) this.ringRun = { appId: game.appId, lastRunEndAtMs: null, runActive: false };
    this.lifecycle.wantCapture(true);
    this.publish();
    void this.startGame(attachment);
    return attachment;
  }

  private async startGame(attachment: Attachment): Promise<void> {
    const engine = await this.ensureEngine();
    if (this.attached !== attachment) return;
    if (!engine || !this.supported) {
      this.publish();
      return;
    }
    let verdict: BreakerVerdict;
    try {
      verdict = await this.breaker.begin(attachment.game.appId);
    } catch {
      verdict = { state: "ok", startLevel: 0, crashes: 0 };
    }
    if (this.attached !== attachment) return;
    if (verdict.state === "disabled") {
      this.disabledReason = "breaker";
      this.fire("breaker");
      this.publish();
      return;
    }
    engine.setStartLevel(verdict.startLevel);
    // The attachment itself: its name, emoji and score are read at each frame.
    engine.setGame(attachment.game);
    attachment.ready = true;
    this.applyPauses();
    for (const reg of attachment.sources) this.forward(reg);
    this.publish();
  }

  private ensureEngine(): Promise<CaptureEngine | null> {
    if (!this.engineLoad) {
      this.engineStatus = "loading";
      this.engineLoad = (async () => {
        try {
          const engine = await this.loadEngine();
          if (this.disposed) {
            engine.dispose();
            return null;
          }
          engine.subscribe((event) => this.onEngine(event));
          const prepared = await engine.prepare();
          this.tier = prepared.tier;
          this.supported = prepared.supported;
          this.engine = engine;
          this.engineStatus = "ready";
          return engine;
        } catch (error) {
          this.log(`[clips] capture is not available here (${(error as { name?: string } | null)?.name ?? "Error"})`);
          this.tier = "none";
          this.supported = false;
          this.engineStatus = "failed";
          return null;
        }
      })();
    }
    return this.engineLoad;
  }

  /** @internal Attachment API. */
  addSource(attachment: Attachment, reg: SourceReg): () => void {
    if (attachment.detached) return () => undefined;
    attachment.sources.add(reg);
    this.forward(reg);
    return () => {
      if (reg.removed) return;
      reg.removed = true;
      attachment.sources.delete(reg);
      const dispose = reg.dispose;
      reg.dispose = null;
      dispose?.();
    };
  }

  /** Hands a registration to the engine once the engine may capture. */
  private forward(reg: SourceReg): void {
    const engine = this.engine;
    if (reg.removed || reg.dispose || !engine || !this.supported || this.disabledReason !== null || this.warmupResting) return;
    // Not before startGame: the breaker verdict and the engine's game come first.
    if (!this.attached || !this.attached.ready || !this.attached.sources.has(reg)) return;
    if (reg.kind === "canvas" && reg.canvas) {
      reg.dispose = engine.registerCanvas(reg.canvas, reg.targetFps ? { targetFps: reg.targetFps } : {});
    } else if (reg.root) {
      reg.dispose = engine.autoDiscover(reg.root);
    }
  }

  /** @internal Attachment API. */
  detachGame(attachment: Attachment): void {
    if (attachment.detached) return;
    attachment.detached = true;
    if (this.recording) void this.finishRecording("canvas-gone");
    for (const reg of [...attachment.sources]) {
      reg.removed = true;
      reg.dispose?.();
      reg.dispose = null;
    }
    attachment.sources.clear();
    if (this.attached !== attachment) return;
    this.attached = null;
    this.warmupResting = false;
    this.breaker.end(attachment.game.appId);
    this.lifecycle.wantCapture(false);
    for (const name of ["source-lost", "post-roll", "recovering-quiet"]) this.clearNamedTimer(name);
    // The next game starts from IDLE. 4 failures in 60 s keep capture off for the tab.
    if (this.disabledReason === "breaker") this.disabledReason = null;
    this.state = this.disabledReason === "encoder-error" ? "disabled" : "idle";
    this.held = null;
    // The ring is kept for RING_KEEP_MS in case the same game comes back. No
    // codec session and no game sound stay live meanwhile: the engine flushes
    // and closes its encoders and suspends the audio tap (the source pause
    // above reached it first). The next registered source wakes it.
    this.engine?.park();
    this.setNamedTimer("ring-keep", RING_KEEP_MS, () => {
      if (this.attached) return;
      this.engine?.purge();
      this.engine?.disarm();
      this.outputOk = false;
      this.bufferedSec = 0;
      this.ringRun = null;
    });
    this.publish();
  }

  /** @internal Attachment API. */
  runPhase(attachment: Attachment, phase: RunPhase): void {
    if (attachment.detached) return;
    const run = this.ringRun?.appId === attachment.game.appId ? this.ringRun : null;
    // The run's span on the capture timeline. With no engine yet, the
    // engine's first timeline starts at 0 during this run.
    const atUs = this.engine?.mediaEndUs() ?? 0;
    if (phase === "start") {
      attachment.runActive = true;
      attachment.run = { startUs: atUs, endUs: null };
      if (run) run.runActive = true;
      this.clearNamedTimer("post-roll");
    } else {
      attachment.runActive = false;
      if (attachment.run && attachment.run.endUs === null) attachment.run = { startUs: attachment.run.startUs, endUs: Math.max(attachment.run.startUs, atUs) };
      attachment.lastRunEndAtMs = this.now();
      if (run) {
        run.runActive = false;
        run.lastRunEndAtMs = attachment.lastRunEndAtMs;
      }
    }
    this.applyPauses();
  }

  /** @internal Attachment API. */
  markMoment(attachment: Attachment, mark: Omit<MomentMark, "offsetSec"> & { offsetSec?: number }): void {
    if (attachment.detached || !this.engine) return;
    const nowUs = this.engine.mediaEndUs();
    const atUs = nowUs + (mark.offsetSec ?? 0) * 1e6;
    attachment.moments.push({ atUs, mark: { kind: mark.kind, label: mark.label, emoji: mark.emoji, priority: mark.priority, offsetSec: 0 } });
    attachment.moments = attachment.moments.filter((m) => m.atUs >= nowUs - MOMENT_KEEP_US);
  }

  /** @internal Attachment API. */
  setAtBreak(attachment: Attachment, atBreak: boolean): void {
    if (attachment.detached || attachment.atBreak === atBreak) return;
    attachment.atBreak = atBreak;
    this.applyPauses();
  }

  /** The attached game's props changed (canPause): publish a new snapshot if it differs. */
  refreshGame(): void {
    this.publish();
  }

  // ---- tap (plan 11.1) -----------------------------------------------------------------

  beginPress(): PressToken | null {
    if (!this.attached || this.snapshot.button === "hidden") return null;
    const run = this.attached.run;
    return {
      pressId: randomId(),
      downAtMs: this.now(),
      endAtUs: this.engine?.mediaEndUs() ?? 0,
      run: run ? { startUs: run.startUs, endUs: run.endUs } : null,
    };
  }

  endPress(token: PressToken, info: { upAtMs: number; moved: boolean; cancelled?: boolean }): PressOutcome {
    // A cancelled press commits nothing, whatever its length: it only lets
    // the token go. The UI sends it for every press that must not clip (a
    // browser pointercancel, a controller button that stays the game's own,
    // the Capture menu opened without a hold, the result chip's frozen end).
    // The token keeps its frozen end for clipLast(seconds, token).
    if (info.cancelled) return { kind: "ignored", reason: "cancelled" };
    const snap = this.snapshot;
    if (!this.attached || snap.button === "hidden") return { kind: "ignored", reason: snap.reason ?? "flag-off" };
    // While the owner is read again (a bfcache restore), the ring can hold
    // another player's footage. A refusal is invisible (contract.ts).
    if (!this.ownerConfirmed) return { kind: "ignored", reason: "refused" };
    const heldMs = info.upAtMs - token.downAtMs;
    const button = snap.button;
    if (button === "recording" || button === "saving" || button === "exporting") return { kind: "ignored", reason: "busy" };
    if (heldMs >= HOLD_FOR_MENU_MS && !info.moved) return { kind: "menu" };
    switch (button) {
      case "resting":
      case "record-only":
        return { kind: "menu" };
      case "disabled":
        return { kind: "ignored", reason: snap.reason ?? "breaker" };
      case "error":
        return { kind: "ignored", reason: snap.reason ?? "encoder-error" };
      case "warming":
      case "source-lost":
      case "recovering":
        return { kind: "ignored", reason: "warming" };
      case "ready":
      case "made":
      case "suspended":
        if (this.canExtend(token.downAtMs)) return { kind: "extend", result: this.extendLastClip(token) };
        return { kind: "clip", result: this.commitClip(DEFAULT_CLIP_SECONDS, token) };
    }
  }

  clipLast(seconds: number = DEFAULT_CLIP_SECONDS, token?: PressToken): Promise<ClipActionResult> {
    if (!this.ownerConfirmed) return Promise.resolve(this.refuse("clip"));
    if (!this.attached || !this.engine || !this.canClipIn(this.snapshot.button)) {
      return Promise.resolve(this.fail("clip", this.snapshot.reason ?? "warming"));
    }
    return this.commitClip(seconds, token);
  }

  clipRun(token: PressToken, part: RunClipPart): Promise<ClipActionResult> {
    if (!this.ownerConfirmed) return Promise.resolve(this.refuse("clip"));
    if (!this.attached || !this.engine || !this.canClipIn(this.snapshot.button)) {
      return Promise.resolve(this.fail("clip", this.snapshot.reason ?? "warming"));
    }
    const run = token.run;
    if (!run) return Promise.resolve(this.fail("clip", "warming"));
    const endAtUs = run.endUs === null ? token.endAtUs : Math.min(token.endAtUs, run.endUs);
    const runSec = Math.max(0, (endAtUs - run.startUs) / 1e6);
    const seconds = part === "whole" ? runSec : Math.min(DEFAULT_CLIP_SECONDS, runSec);
    // Not the last clip: a clip button tap after it makes a new clip, never
    // an extend that would replace this run with the last 30 seconds.
    return this.makeClip(seconds, { ...token, endAtUs }, "clip", null, run.startUs).result;
  }

  /**
   * An action that cannot run for the player on screen: the owner is read
   * again (a bfcache restore), or the owner changed while it ran. It fails
   * with "hidden" and refused: true, changes no snapshot field, and the UI
   * shows nothing for it (contract.ts ClipActionResult.refused).
   */
  private refuse(action: Action): ClipActionResult {
    return { ok: false, action, reason: "hidden", atMs: this.now(), refused: true };
  }

  /** States with footage to clip: ready, made, suspended (pre-pause) and resting (pre-rest). */
  private canClipIn(button: ClipButtonState): boolean {
    return !this.warmupResting && (button === "ready" || button === "made" || button === "suspended" || button === "resting");
  }

  private canExtend(downAtMs: number): boolean {
    const last = this.lastClip;
    if (!last || last.ownerKey !== this.ownerKey) return false;
    const since = downAtMs - last.committedAtMs;
    return since >= 0 && since <= EXTEND_WINDOW_MS;
  }

  private meta(kind: ClipMeta["kind"], prefix: string): ClipMeta {
    return {
      id: `${prefix}${randomId().slice(0, 24)}`,
      ownerKey: this.ownerKey ?? GUEST_OWNER_KEY,
      gameId: this.attached?.game.appId ?? "unknown",
      kind,
      createdAt: this.wallNow(),
      durationMs: 0,
      width: 0,
      height: 0,
      fps: 0,
      hasAudio: false,
      mime: kind === "picture" ? "image/png" : "video/mp4",
      kept: false,
      watched: false,
      moments: [],
    };
  }

  private momentsFor(attachment: Attachment | null) {
    const list = attachment?.moments ?? [];
    return (startUs: number, endUs: number): MomentMark[] =>
      list.filter((m) => m.atUs >= startUs && m.atUs <= endUs).map((m) => ({ ...m.mark, offsetSec: (m.atUs - startUs) / 1e6 }));
  }

  /** A new clip. It becomes the last clip at once, so a quick second tap extends it. */
  private commitClip(seconds: number, token: PressToken | undefined): Promise<ClipActionResult> {
    const { result, made } = this.makeClip(seconds, token, "clip", null);
    this.lastClip = { committedAtMs: token?.downAtMs ?? this.now(), ownerKey: this.ownerKey ?? GUEST_OWNER_KEY, made };
    return result;
  }

  /** Plan 11.1 mash protection: the last clip grows to this tap. The extend window restarts here. */
  private extendLastClip(token: PressToken): Promise<ClipActionResult> {
    const previous = this.lastClip as LastClip;
    let settle: (value: MadeClip | null) => void = () => undefined;
    const made = new Promise<MadeClip | null>((resolve) => {
      settle = resolve;
    });
    this.lastClip = { committedAtMs: token.downAtMs, ownerKey: previous.ownerKey, made };
    const epoch = this.ownerEpoch;
    return previous.made.then((shorter) => {
      // The owner changed while the shorter clip saved: this tap belongs to the previous owner.
      if (epoch !== this.ownerEpoch) {
        settle(null);
        return this.refuse("extend");
      }
      const job = shorter
        ? this.makeClip(Math.max(DEFAULT_CLIP_SECONDS, (token.endAtUs - shorter.startUs) / 1e6), token, "extend", shorter)
        : this.makeClip(DEFAULT_CLIP_SECONDS, token, "clip", null);
      void job.made.then(settle);
      return job.result;
    });
  }

  private makeClip(
    seconds: number,
    token: PressToken | undefined,
    action: "clip" | "extend",
    replaces: MadeClip | null,
    notBeforeUs?: number,
  ): { result: Promise<ClipActionResult>; made: Promise<MadeClip | null> } {
    const engine = this.engine;
    if (!engine) return { result: Promise.resolve(this.fail(action, "warming")), made: Promise.resolve(replaces) };
    let settle: (value: MadeClip | null) => void = () => undefined;
    const made = new Promise<MadeClip | null>((resolve) => {
      settle = resolve;
    });
    this.beginSaving();
    const attachment = this.attached;
    const epoch = this.ownerEpoch;
    const result = (async (): Promise<ClipActionResult> => {
      try {
        const clip = await engine.clip({
          seconds,
          endAtUs: token?.endAtUs,
          ...(notBeforeUs === undefined ? {} : { notBeforeUs }),
          meta: this.meta("clip", "c"),
          moments: this.momentsFor(attachment),
          onProgress: (fraction) => {
            if (epoch !== this.ownerEpoch) return;
            this.savingProgress = Math.max(this.savingProgress ?? 0, Math.min(1, fraction));
            this.publish();
          },
        });
        // The longer clip replaces the shorter one only when it holds all of
        // it. A ring that cannot reach back that far (a 30 s ring, a byte
        // trim) or an encoder recovery (the clip starts at the newest epoch)
        // gives a clip that misses the start of the shorter one: both stay,
        // and this is a plain new clip.
        const contains = !!replaces && clip.startUs <= replaces.startUs && clip.endUs >= replaces.endUs;
        if (replaces && contains) await this.library.remove(replaces.record.id).catch(() => undefined);
        const done: "clip" | "extend" = action === "extend" && contains ? "extend" : "clip";
        settle(clip);
        // The owner changed while the clip saved: it is stored under the owner who
        // made it, and the new owner never sees it (no chip, no result).
        if (epoch !== this.ownerEpoch) return this.refuse(done);
        if (this.unwatchedClipId === null || this.unwatchedClipId === replaces?.record.id || done === "clip") {
          this.unwatchedClipId = clip.record.id;
        }
        return this.succeed(done, clip.record);
      } catch (error) {
        // A failed extend keeps the shorter clip as the last clip.
        settle(replaces);
        if (epoch !== this.ownerEpoch) return this.refuse(action);
        return this.fail(action, reasonOf(error));
      } finally {
        this.endSaving();
      }
    })();
    return { result, made };
  }

  private beginSaving(): void {
    this.saving++;
    this.savingProgress = 0;
    this.publish();
  }

  private endSaving(): void {
    this.saving = Math.max(0, this.saving - 1);
    this.savingProgress = this.saving > 0 ? this.savingProgress : null;
    this.publish();
  }

  private succeed(action: Action, record: ClipRecord, recording?: { parts: ClipRecord[]; failedParts: number }): ClipActionResult {
    const result: ClipActionResult = recording
      ? { ok: true, action, record, atMs: this.now(), parts: Object.freeze(recording.parts), failedParts: recording.failedParts }
      : { ok: true, action, record, atMs: this.now() };
    this.lastResult = result;
    this.errorUntilMs = 0;
    this.errorReason = null;
    this.clearNamedTimer("error");
    if (action === "clip" || action === "extend") {
      this.madeUntilMs = this.now() + MADE_MS;
      this.setNamedTimer("made", MADE_MS, () => this.publish());
    }
    this.publish();
    return result;
  }

  private fail(action: Action, reason: ClipReasonCode): ClipActionResult {
    const result: ClipActionResult = { ok: false, action, reason, atMs: this.now() };
    this.lastResult = result;
    // "warming" is the Play-a-little-first reply, not the amber error.
    if (reason !== "warming") {
      this.errorUntilMs = this.now() + ERROR_MS;
      this.errorReason = reason;
      this.madeUntilMs = 0;
      this.clearNamedTimer("made");
      this.setNamedTimer("error", ERROR_MS, () => this.publish());
    }
    this.publish();
    return result;
  }

  // ---- Record, pictures, stars --------------------------------------------------------

  async startRecording(): Promise<ClipActionResult | null> {
    const engine = this.engine;
    if (this.recording) return null;
    if (!this.ownerConfirmed) return this.refuse("record");
    if (!this.attached || !engine || !this.canClipIn(this.snapshot.button)) {
      return this.fail("record", this.snapshot.reason ?? "warming");
    }
    const meta = this.meta("record", "r");
    const rec: Recording = {
      handle: null,
      recordingId: meta.id,
      startedAtMs: this.wallNow(),
      startUs: engine.mediaEndUs(),
      restedAtStart: this.state === "resting",
      stars: [],
      stopping: null,
      epoch: this.ownerEpoch,
    };
    this.recording = rec;
    this.elapsedSec = 0;
    let handle: RecordingHandle;
    try {
      handle = await engine.startRecording(meta);
    } catch (error) {
      if (this.recording === rec) this.recording = null;
      if (rec.epoch !== this.ownerEpoch) return this.refuse("record");
      return this.fail("record", reasonOf(error));
    }
    rec.handle = handle;
    if (this.recording !== rec) {
      // Finalized while it started (hidden, source lost): the tee stops too.
      void handle.stop().catch(() => undefined);
      return null;
    }
    // From BUFFERING or RESTING. A Record started at a break (the pause menu,
    // the result chip) enters RECORDING when play resumes (pending()).
    this.fire("record");
    this.recordTicker = this.setRepeat(() => this.tickRecording(), RECORD_TICK_MS);
    this.settle();
    this.publish();
    return null;
  }

  private tickRecording(): void {
    const rec = this.recording;
    if (!rec || !this.engine) return;
    this.elapsedSec = Math.max(0, Math.floor((this.engine.mediaEndUs() - rec.startUs) / 1e6));
    this.publish();
  }

  stopRecording(): Promise<ClipActionResult> {
    if (!this.recording) return Promise.resolve(this.fail("record", "warming"));
    return this.finishRecording("stop");
  }

  /**
   * Stops the recording and keeps the video. edge: the machine event of the
   * change that ends it: "stop" (the kid), "hidden", "encoder-error" or
   * "canvas-gone" (plan 7: the part is finalized, and the machine follows).
   */
  private finishRecording(edge: "stop" | "hidden" | "encoder-error" | "canvas-gone"): Promise<ClipActionResult> {
    const rec = this.recording;
    if (!rec) return Promise.resolve(this.fail("record", "warming"));
    if (rec.stopping) return rec.stopping;
    if (this.recordTicker !== null) this.clearRepeat(this.recordTicker);
    this.recordTicker = null;
    const rested = rec.restedAtStart || this.governorResting;
    this.recording = null;
    if (this.state === "recording") this.fire(edge, { rested });
    this.settle();
    this.publish();
    rec.stopping = (async (): Promise<ClipActionResult> => {
      // A recording that never got its tee (it failed to start) has nothing to keep.
      if (!rec.handle) return rec.epoch === this.ownerEpoch ? this.fail("record", "encoder-error") : this.refuse("record");
      this.beginSaving();
      try {
        const result = await rec.handle.stop();
        const first = result.parts[0];
        // The stars go into the stored parts (they belong to the owner who recorded).
        if (first) await this.placeStars(rec, result.parts);
        // The owner changed meanwhile: the video is kept under its owner, and the new owner never sees it.
        if (rec.epoch !== this.ownerEpoch) return this.refuse("record");
        if (!first) return this.fail("record", "mux-failed");
        this.unwatchedClipId = first.record.id;
        // Every part, so the kid hears how many videos the recording made (never silent).
        return this.succeed("record", first.record, { parts: result.parts.map((p) => p.record), failedParts: result.failed });
      } catch (error) {
        if (rec.epoch !== this.ownerEpoch) return this.refuse("record");
        return this.fail("record", reasonOf(error));
      } finally {
        this.endSaving();
      }
    })();
    return rec.stopping;
  }

  /** Writes each star into the part it falls in (plan 8.4). */
  private async placeStars(rec: Recording, parts: Array<{ record: ClipRecord; startUs: number; endUs: number }>): Promise<void> {
    for (const part of parts) {
      const marks = rec.stars
        .filter((s) => s.atUs >= part.startUs && s.atUs <= part.endUs)
        .map((s) => ({ ...s.mark, offsetSec: (s.atUs - part.startUs) / 1e6 }));
      if (marks.length === 0) continue;
      await this.io.update(part.record.id, { moments: [...part.record.moments, ...marks] }).catch(() => undefined);
    }
  }

  addStar(): void {
    const rec = this.recording;
    if (!rec || !this.engine) return;
    rec.stars.push({ atUs: this.engine.mediaEndUs(), mark: { kind: "custom", label: "Star", emoji: "⭐", priority: "standard", offsetSec: 0 } });
    this.publish();
  }

  async takePicture(): Promise<ClipActionResult> {
    const engine = this.engine;
    const button = this.snapshot.button;
    if (!this.ownerConfirmed) return this.refuse("picture");
    if (!this.attached || !engine || this.warmupResting || button === "hidden" || button === "disabled") {
      return this.fail("picture", this.snapshot.reason ?? "source-lost");
    }
    const epoch = this.ownerEpoch;
    this.beginSaving();
    try {
      const record = await engine.picture(this.meta("picture", "p"));
      if (epoch !== this.ownerEpoch) return this.refuse("picture");
      return this.succeed("picture", record);
    } catch (error) {
      if (epoch !== this.ownerEpoch) return this.refuse("picture");
      return this.fail("picture", reasonOf(error));
    } finally {
      this.endSaving();
    }
  }

  async takeRecovered(): Promise<ClipRecord[]> {
    const library = this.library;
    if (!library.takeRecovered || this.disposed) return [];
    const epoch = this.ownerEpoch;
    let rows: ClipRecord[];
    try {
      rows = await library.takeRecovered();
    } catch (error) {
      // Values-free (plan 12): the error name only. The videos stay in the library.
      this.log(`[clips] the saved videos from last time could not be read (${(error as { name?: string } | null)?.name ?? "Error"})`);
      return [];
    }
    // The player changed while the list was read: no chip and no words for the new player.
    if (this.disposed || epoch !== this.ownerEpoch) return [];
    const mine = rows.filter((row) => this.ownerKey === null || row.ownerKey === this.ownerKey);
    if (mine.length === 0) return [];
    const newest = mine.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
    if (this.unwatchedClipId !== newest.id) {
      this.unwatchedClipId = newest.id;
      this.publish();
    }
    return mine;
  }

  markWatched(id: string): void {
    if (this.unwatchedClipId === id) {
      this.unwatchedClipId = null;
      this.publish();
    }
    // Eviction reads the flag: a clip the kid has not watched is never evicted.
    this.library.markWatched(id).catch(() => undefined);
  }

  wake(): void {
    if (this.state !== "resting" || !this.engine) return;
    if (this.warmupResting && this.attached) {
      this.warmupResting = false;
      this.warmupElapsedMs = 0;
      this.fire("retry-warmup");
      this.engine.setGame(this.attached.game);
      for (const reg of this.attached.sources) this.forward(reg);
      this.applyPauses();
    } else {
      this.engine.wake();
    }
    this.publish();
  }

  /**
   * An export session (plan 7: the editor, "Make it longer"). The live encoder
   * is flushed and closed first, so a phone never needs three codec sessions.
   * The game is paused for an export, so the service is usually SUSPENDED
   * then; every state that holds a live encoder (BUFFERING, SUSPENDED,
   * RESTING, RECORDING) closes it. Play resumes on a new epoch, and the pause,
   * the rest or the recording comes back (settle()).
   */
  async runExport<T>(task: () => Promise<T>): Promise<T> {
    const engine = this.engine;
    if (!engine || this.warmupResting || !this.fire("export")) return task();
    engine.setPaused("export", true);
    engine.closeEncoder("export");
    this.publish();
    try {
      return await task();
    } finally {
      engine.setPaused("export", false);
      this.fire("export-done");
      this.settle();
      this.publish();
    }
  }

  // ---- share and save (plan 12) ------------------------------------------------------------

  share(file: File): Promise<ShareOutcome> {
    const game = this.attached?.game;
    // The game pauses before the share sheet opens, where it can pause. Both
    // calls are synchronous, so the tap's user activation reaches share().
    if (game?.canPause) {
      try {
        game.pause?.();
      } catch {
        // A game's pause must never stop the share.
      }
    }
    return shareFile(file, this.shareEnv);
  }

  saveToDevice(file: File): Promise<SaveOutcome> {
    return saveFile(file, this.shareEnv);
  }

  fileNameFor(record: ClipRecord): string {
    return fileNameFor(record, this.host());
  }

  // ---- owner (plan 7.1) -----------------------------------------------------------------------

  /**
   * The signed-in user from the session bus (every page) or a caller. A user
   * id comes from a successful session read. null can also mean that
   * next-auth's own read failed (offline), so the service reads the session
   * itself: a guest is confirmed only by a successful read. When that read
   * fails too, a known owner stays, and an unknown one falls back like the
   * library client (the last confirmed player, or guest) outside a bfcache
   * restore, where capture waits for a real read instead.
   */
  async setSessionUser(userId: string | null): Promise<void> {
    const check = ++this.ownerCheck;
    let id = userId;
    if (id === null) {
      try {
        id = await this.readUserId();
      } catch {
        if (check !== this.ownerCheck) return;
        if (this.ownerKey !== null && this.ownerConfirmed) return;
        if (this.ownerRetries !== null) {
          // A bfcache restore waits for a real read. This call took over its
          // check, so the restore read starts again (and keeps retrying).
          this.readOwnerAfterRestore();
          return;
        }
        const owner = await this.io.resolveOwner();
        if (check === this.ownerCheck) this.acceptOwner(owner.key, false, owner.confirmed);
        return;
      }
    }
    const key = await this.keyFor(id);
    if (check === this.ownerCheck) this.acceptOwner(key, this.ownerRetries !== null);
  }

  /**
   * confirmed: the key came from a session read (the library client keeps it
   * for the tab). A fallback key is used for capture but not given to the
   * library client, which reads again at its next call.
   */
  private acceptOwner(key: string, bfcacheRestore: boolean, confirmed = true): void {
    const from = this.ownerKey;
    this.ownerKey = key;
    this.ownerConfirmed = true;
    this.ownerRetries = null;
    this.clearNamedTimer("owner-retry");
    if (confirmed) this.io.setOwnerKey(key);
    if (from !== null && from !== key) {
      // The ring's last run, kept across detach: a sign-in on the /login page
      // (the game is not mounted then) still keeps a guest run of 60 s ago.
      const run = this.ringRun;
      const action = ownerChangeAction({
        from,
        to: key,
        nowMs: this.now(),
        lastRunEndAtMs: run?.lastRunEndAtMs ?? null,
        runActive: run?.runActive ?? false,
        bfcacheRestore,
      });
      if (action === "purge") this.purgeForOwner();
    }
    this.applyPauses();
  }

  /**
   * Nothing of the previous owner stays: the ring, the moments, the last clip
   * (no extend), the new-clip chip, the last result (a picture of their
   * gameplay) and its "made" or "error" mark. An action still running ends
   * without a result for the new owner (ownerEpoch).
   */
  private purgeForOwner(): void {
    // A recording belongs to the owner who started it: it is kept, under that owner.
    if (this.recording) void this.finishRecording("stop");
    this.ownerEpoch++;
    this.engine?.purge();
    this.warmStartUs = this.engine?.mediaEndUs() ?? 0;
    this.lastClip = null;
    this.unwatchedClipId = null;
    this.lastResult = null;
    this.madeUntilMs = 0;
    this.errorUntilMs = 0;
    this.errorReason = null;
    this.clearNamedTimer("made");
    this.clearNamedTimer("error");
    if (this.attached) this.attached.moments = [];
    if (this.ringRun) this.ringRun = { appId: this.ringRun.appId, lastRunEndAtMs: null, runActive: false };
    this.fire("owner-change");
  }

  // ---- lifecycle ----------------------------------------------------------------------------------

  private onVisibility(visible: boolean): void {
    if (!visible && this.recording) void this.finishRecording("hidden");
    this.applyPauses();
    // Plan 7.1: on iOS a hidden page flushes and closes its encoders at once
    // (after the pause above, so the timeline pause reaches the worker first).
    if (!visible && this.closesOnHide && this.engine) this.engine.closeEncoder("hidden");
    if (visible) this.retryOwnerNow();
  }

  private onPageHide(persisted: boolean): void {
    // The page did not crash: its breaker markers end cleanly.
    this.breaker.endAll();
    this.breaker.releaseTabLock();
    if (this.recording) void this.finishRecording("hidden");
    if (persisted) this.ownerConfirmed = false;
    this.applyPauses();
  }

  private onPageShow(): void {
    void this.breaker.holdTabLock();
    // Another person may have signed in while the page was in the bfcache:
    // capture waits until the owner is read again.
    this.ownerConfirmed = false;
    this.ownerRetries = 0;
    this.applyPauses();
    this.readOwnerAfterRestore();
  }

  /**
   * Reads the owner after a bfcache restore. While the read fails (offline),
   * the ring is purged once and capture stays paused, and the read runs again
   * on a back-off timer (OWNER_RETRY_MS doubled, at most OWNER_RETRY_MAX_MS),
   * at "online" and when the page is visible again.
   */
  private readOwnerAfterRestore(): void {
    this.clearNamedTimer("owner-retry");
    const check = ++this.ownerCheck;
    void (async () => {
      let key: string | null = null;
      try {
        key = await this.keyFor(await this.readUserId());
      } catch {
        key = null;
      }
      if (check !== this.ownerCheck || this.ownerRetries === null) return;
      if (key === null) {
        if (this.ownerRetries === 0) {
          // The owner cannot be read: the ring is never reused, and capture stays paused.
          this.log("[clips] the signed-in user could not be read after a back navigation; trying again");
          this.purgeForOwner();
          this.publish();
        }
        this.ownerRetries++;
        const wait = Math.min(OWNER_RETRY_MAX_MS, OWNER_RETRY_MS * 2 ** (this.ownerRetries - 1));
        this.setNamedTimer("owner-retry", wait, () => this.readOwnerAfterRestore());
        return;
      }
      if (this.attached) void this.breaker.begin(this.attached.game.appId).catch(() => undefined);
      this.acceptOwner(key, true);
    })();
  }

  /** The owner read after a restore is waiting: try it now (online again, or visible again). */
  private retryOwnerNow(): void {
    if (this.ownerRetries === null || this.ownerRetries === 0) return;
    this.readOwnerAfterRestore();
  }

  /** True while the game is at a break that capture should skip (plan 11.1; the result post-roll is kept). */
  private breakPaused(): boolean {
    const attachment = this.attached;
    if (!attachment?.atBreak) return false;
    const end = attachment.lastRunEndAtMs;
    if (end === null || attachment.runActive) return true;
    const left = end + RESULT_POST_ROLL_MS - this.now();
    if (left <= 0) return true;
    this.setNamedTimer("post-roll", left, () => this.applyPauses());
    return false;
  }

  private suspendedNow(): boolean {
    return !this.lifecycle.visible || !this.lifecycle.ownsCapture || !this.ownerConfirmed || this.breakPaused();
  }

  /** Every reason to pause capture, applied to the engine; then the machine follows. */
  private applyPauses(): void {
    const engine = this.engine;
    if (engine) {
      engine.setPaused("hidden", !this.lifecycle.visible);
      engine.setPaused("break", this.breakPaused());
      engine.setPaused("other-tab", !this.lifecycle.ownsCapture);
      engine.setPaused("owner", !this.ownerConfirmed);
    }
    this.settle();
    this.markCapturing();
    this.publish();
  }

  /**
   * Writes the truth to the crash-breaker marker every time: capturing only
   * while frames flow. A disabled or unsupported game is never "capturing",
   * so a later death of the tab is never counted as a capture crash.
   */
  private markCapturing(): void {
    const attachment = this.attached;
    if (!attachment) return;
    const flowing = this.state === "warming" || this.state === "bridged" || this.state === "buffering" || this.state === "recording";
    const capturing = this.supported && this.disabledReason === null && flowing && !this.suspendedNow();
    this.breaker.setCapturing(attachment.game.appId, capturing);
  }

  // ---- engine events --------------------------------------------------------------------------------

  private onEngine(event: EngineEvent): void {
    // A stopped attempt cannot revive itself or count late failures as crashes.
    // Reset still clears its timeline; a pending tier switch may still finish.
    if (this.warmupResting && event.t !== "reset" && event.t !== "tier") return;
    switch (event.t) {
      case "source":
        this.sourcePresent = event.present;
        // No picture: the gap is taken out of the capture timeline.
        this.engine?.setPaused("source", !event.present);
        if (event.present) {
          if (this.lostSource) {
            // The ring "emptied" for the kid (plan 11.3): warm up again from here.
            this.warmStartUs = this.engine?.mediaEndUs() ?? 0;
            this.lostSource = false;
          }
        } else if (this.recording) {
          void this.finishRecording("canvas-gone");
        }
        break;
      case "output":
        this.outputOk = true;
        this.recovering = false;
        break;
      case "no-output":
        this.fire("no-output");
        break;
      case "encoder-error":
        this.onEncoderError(event.fatal);
        break;
      case "recovered":
        this.recovering = false;
        this.outputOk = true;
        break;
      case "buffered":
        this.bufferedSec = event.seconds;
        if (typeof event.ttfcMs === "number" && Number.isFinite(event.ttfcMs)) this.ttfcMs = event.ttfcMs;
        break;
      case "granularity":
        this.granularitySec = event.seconds;
        break;
      case "tier":
        // Another engine records now: its tier shows, and it measures its own granularity.
        this.tier = event.tier;
        this.granularitySec = null;
        break;
      case "governor":
        this.governorResting = event.resting;
        this.preRest = event.resting;
        if (event.resting) this.fire("governor-severe");
        break;
      case "source-error":
        // The engine also says the source is gone (the button shows it). No
        // action failed, so no result or toast: the kid did not tap anything.
        this.log("[clips] the game picture cannot be read");
        break;
      case "reset":
        // A new encoder session starts a new timeline at 0, with an empty ring.
        this.outputOk = false;
        this.bufferedSec = 0;
        this.warmStartUs = 0;
        this.lastClip = null;
        // A run that goes on starts at 0 on the new timeline (all of its
        // footage is new). An ended run's footage is gone.
        if (this.attached?.run) this.attached.run = this.attached.run.endUs === null ? { startUs: 0, endUs: null } : null;
        // The next session (perhaps another game) measures its own granularity and TTFC.
        this.granularitySec = null;
        this.ttfcMs = null;
        if (this.attached) this.attached.moments = [];
        break;
      case "unavailable":
        if (event.reason === "no-encoder") {
          // A fresh probe found no encoder for this game's picture: no clip button (no-tier).
          this.log("[clips] this device cannot encode this game's picture");
          this.supported = false;
        } else {
          // The engine stopped after failed arms in a row: capture turns off for the tab.
          this.recovering = true;
          this.failureLimit = true;
        }
        break;
    }
    this.settle();
    this.markCapturing();
    this.publish();
  }

  /**
   * A video failure. Every capturing state counts it (also WARMING and
   * BRIDGED, before the first output), except in the resume grace (plan 7.1).
   * FAILURES_TO_DISABLE in FAILURE_WINDOW_MS turn capture off for the tab:
   * the machine goes on to DISABLED from RECOVERING (pending()).
   */
  private onEncoderError(fatal: boolean): void {
    if (fatal) this.outputOk = false;
    this.recovering = true;
    if (!this.lifecycle.inResumeGrace()) {
      const now = this.now();
      this.failures = this.failures.filter((at) => now - at < FAILURE_WINDOW_MS);
      this.failures.push(now);
    }
    if (this.failures.length >= FAILURES_TO_DISABLE) this.failureLimit = true;
    // A recording closes its part (RECORDING -> RECOVERING). The other
    // capturing states take the encoder-error edge in settle().
    if (this.recording) void this.finishRecording("encoder-error");
  }

  /**
   * DISABLED: capture is off (the breaker, or FAILURES_TO_DISABLE). The
   * engine stops for good (disarm: no re-arm timer, no forced probe) and every
   * source the service gave it goes, so nothing can arm it again.
   */
  private stopForDisabled(): void {
    if (this.disabledReason === null) this.disabledReason = "encoder-error";
    for (const reg of this.attached?.sources ?? []) {
      const dispose = reg.dispose;
      reg.dispose = null;
      dispose?.();
    }
    this.engine?.disarm();
  }

  // ---- the machine ---------------------------------------------------------------------------------------

  private fire(event: MachineEvent, ctx: TransitionContext = {}): boolean {
    const next = transition(this.state, event, ctx);
    if (next === null) return false;
    this.enter(next);
    return true;
  }

  private enter(next: EngineState): void {
    const previous = this.state;
    if (previous === next) return;
    if (next === "source-lost" || next === "recovering") {
      // Plan 11.3 quiet periods: the button stays as it was for a moment.
      this.held = this.snapshot.button === "hidden" ? null : this.snapshot.button;
      const lost = next === "source-lost";
      this.setNamedTimer(lost ? "source-lost" : "recovering-quiet", lost ? SOURCE_LOST_GRACE_MS : RECOVERING_QUIET_MS, () => {
        this.held = null;
        if (this.state === "source-lost") {
          this.lostSource = true;
          this.fire("grace-over");
          this.settle();
        }
        this.publish();
      });
    } else {
      this.held = null;
      if (previous === "source-lost") this.clearNamedTimer("source-lost");
      if (previous === "recovering") this.clearNamedTimer("recovering-quiet");
    }
    this.state = next;
    if (next === "disabled") this.stopForDisabled();
  }

  /** Level facts that must hold in the current state, applied as plan 7 edges only. */
  private settle(): void {
    for (let i = 0; i < 8; i++) {
      const event = this.pending();
      if (!event || !this.fire(event)) return;
    }
  }

  private pending(): MachineEvent | null {
    const canCapture = !!this.attached && this.supported && this.disabledReason === null;
    switch (this.state) {
      case "idle":
        return canCapture && this.sourcePresent ? "source-registered" : null;
      case "warming":
        // A failure before the first output counts too (it can reach DISABLED).
        if (this.recovering) return "encoder-error";
        return this.outputOk ? "output-ok" : null;
      case "bridged":
        if (this.recovering) return "encoder-error";
        return this.outputOk ? "hardware-ready" : null;
      case "buffering":
        if (!this.sourcePresent) return "canvas-gone";
        if (this.recovering) return "encoder-error";
        if (this.governorResting) return "governor-severe";
        // A Record started at a break (pause menu, result chip) records from here.
        if (this.recording?.handle) return "record";
        return this.suspendedNow() ? "suspend" : null;
      case "recording":
        if (!this.sourcePresent) return "canvas-gone";
        return null;
      case "resting":
        if (this.governorResting || this.warmupResting) return null;
        return this.recording ? "record" : "probe-passes";
      case "suspended":
        return this.suspendedNow() ? null : "resume";
      case "source-lost":
        return this.sourcePresent ? "re-registered" : null;
      case "recovering":
        if (this.failureLimit) return "disable";
        return !this.recovering && this.outputOk ? "recreated" : null;
      default:
        return null;
    }
  }

  // ---- snapshot --------------------------------------------------------------------------------------------

  private publish(): void {
    this.reconcileWarmup();
    const attachment = this.attached;
    const now = this.now();
    const mediaEnd = this.engine?.mediaEndUs() ?? 0;
    const warmSec = Math.max(0, Math.min(this.bufferedSec, (mediaEnd - this.warmStartUs) / 1e6));
    // While the engine loads, the button shows Warming (its tier is not known yet).
    const loading = !!attachment && (this.engineStatus === "loading" || this.engineStatus === "unloaded");
    const derived = deriveButton({
      attached: !!attachment,
      supported: loading || this.supported,
      engine: this.state,
      disabledReason: this.disabledReason,
      otherTab: !!attachment && this.lifecycle.visible && !this.lifecycle.ownsCapture,
      recording: this.recording !== null,
      saving: this.saving > 0,
      made: this.madeUntilMs > now,
      error: this.errorUntilMs > now ? this.errorReason : null,
      warmSec,
      lostSource: this.lostSource,
      held: this.held,
    });
    const holdsFootage = this.state === "buffering" || this.state === "recording" || this.state === "suspended" || this.state === "resting";
    const rec = this.recording;
    const next: Omit<ClipSnapshot, "version"> = {
      button: derived.button,
      engine: this.state,
      reason: this.warmupResting ? "warmup-timeout" : derived.reason,
      appId: attachment?.game.appId ?? null,
      tier: this.tier,
      warmProgress: derived.warmProgress,
      savingProgress: this.saving > 0 ? this.savingProgress : null,
      bufferedSec: holdsFootage ? this.bufferedSec : 0,
      ...(this.granularitySec === null ? {} : { replayGranularitySec: this.granularitySec }),
      ...(this.ttfcMs === null ? {} : { ttfcMs: Math.round(this.ttfcMs) }),
      preRest: this.preRest,
      recording: rec ? { recordingId: rec.recordingId, startedAtMs: rec.startedAtMs, elapsedSec: this.elapsedSec, stars: rec.stars.length } : null,
      unwatchedClipId: this.unwatchedClipId,
      lastResult: this.lastResult,
      gameCanPause: attachment?.game.canPause ?? false,
      atBreak: attachment ? attachment.atBreak : true,
    };
    if (sameSnapshot(this.snapshot, next)) return;
    this.snapshot = Object.freeze({
      ...next,
      recording: next.recording ? Object.freeze(next.recording) : null,
      version: this.snapshot.version + 1,
    }) as ClipSnapshot;
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // One bad listener must not stop the others.
      }
    }
  }

  /** Count only time when this source may capture; bridge fallback shares the budget. */
  private reconcileWarmup(): void {
    const now = this.now();
    if (this.warmupStartedAt !== null) this.warmupElapsedMs += Math.max(0, now - this.warmupStartedAt);
    this.warmupStartedAt = null;
    this.clearNamedTimer("warmup");
    if (this.disposed || !this.attached || !this.supported || !this.sourcePresent || this.outputOk ||
        (this.state !== "warming" && this.state !== "bridged")) {
      this.warmupElapsedMs = 0;
      return;
    }
    if (this.suspendedNow()) return;
    const remaining = WARMUP_TIMEOUT_MS - this.warmupElapsedMs;
    if (remaining > 0) {
      this.warmupStartedAt = now;
      this.setNamedTimer("warmup", remaining, () => this.publish());
      return;
    }
    // Latch before cleanup: source removal and disarm emit synchronously.
    this.warmupResting = true;
    this.fire("warmup-timeout");
    this.sourcePresent = false;
    for (const reg of this.attached.sources) {
      const dispose = reg.dispose;
      reg.dispose = null;
      dispose?.();
    }
    // Removing registrations also empties EngineSwitch's replay set, so an
    // upgrade finishing later cannot arm its new engine behind the resting UI.
    this.engine?.disarm();
    this.markCapturing();
  }

  // ---- timers -------------------------------------------------------------------------------------------------

  private setNamedTimer(name: string, ms: number, fn: () => void): void {
    this.clearNamedTimer(name);
    if (this.disposed) return;
    const handle = this.setTimer(() => {
      if (this.timers.get(name) === handle) this.timers.delete(name);
      fn();
    }, ms);
    this.timers.set(name, handle);
  }

  private clearNamedTimer(name: string): void {
    const handle = this.timers.get(name);
    if (handle === undefined) return;
    this.timers.delete(name);
    this.clearTimer(handle);
  }

  /** Stops everything (tests). */
  dispose(): void {
    if (this.disposed) return;
    if (this.attached) this.detachGame(this.attached);
    this.disposed = true;
    for (const name of [...this.timers.keys()]) this.clearNamedTimer(name);
    if (this.recordTicker !== null) this.clearRepeat(this.recordTicker);
    this.stopSession();
    this.lifecycle.stop();
    this.engine?.dispose();
    this.listeners.clear();
  }
}

// ---------------------------------------------------------------------------
// The tab singleton
// ---------------------------------------------------------------------------

let service: ClipService | null = null;

export { getClipService } from "./registry";

/**
 * Creates the tab's clip service once clips are known to be on (ClipProvider
 * calls it after the flag verdict). Null on the server.
 */
export function startClipService(deps: ClipServiceDeps = {}): ClipService | null {
  if (typeof window === "undefined") return null;
  if (!service) {
    service = new ClipService(deps);
    setClipService(service);
  }
  return service;
}

/** Ends the tab's clip service (tests). */
export function resetClipServiceForTests(): void {
  service?.dispose();
  service = null;
  setClipService(null);
}
