/**
 * ClipService: the tab's clip singleton, outside React (plan 4.1). It lives
 * across client route changes, so a ring survives a trip to another page.
 *
 * It implements the contract (contract.ts) for every clip surface:
 * - the plan 7 state machine (machine.ts), driven by the capture engine's
 *   events, the page lifecycle (lifecycle.ts), the owner and the crash
 *   breaker (breaker.ts);
 * - the plan 11.1 tap rules: pointerdown freezes the ring end; a release
 *   under HOLD_FOR_MENU_MS commits a clip; a still hold of HOLD_FOR_MENU_MS
 *   or more opens the Capture menu and commits nothing; a tap within
 *   EXTEND_WINDOW_MS of the last clip makes that clip longer (the longer clip
 *   replaces it, so the library keeps one row);
 * - the clip button (plan 11.3), with "made" for 1.2 s and "error" for 3 s;
 * - immutable snapshots that change identity only when a field changes.
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
  type SaveOutcome,
  type ShareOutcome,
} from "./contract";
import { EngineFailure, type CaptureEngine, type EngineEvent, type MadeClip, type RecordingHandle } from "./engine";
import { getIoClient, type IoClient } from "./ioClient";
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
import { setClipService } from "./registry";
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
/** Moments older than this behind the newest frame can no longer be in a clip (a ring holds at most 60 s). */
export const MOMENT_KEEP_US = 120_000_000;

/** The parts of the library client that the service uses. */
export type ServiceIo = Pick<IoClient, "libraryApi" | "ownerKey" | "setOwnerKey" | "update">;

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
  log?: (message: string) => void;
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

function defaultLoadEngine(): Promise<CaptureEngine> {
  return import("./engineHost").then(({ EngineHost }) => new EngineHost());
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
  atBreak = true;
  runActive = false;
  lastRunEndAtMs: number | null = null;
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
  private recovering = false;
  private bufferedSec = 0;
  private warmStartUs = 0;
  private lostSource = false;
  private disabledReason: "breaker" | "encoder-error" | null = null;
  private failures: number[] = [];
  private held: ClipButtonState | null = null;
  private preRest = false;

  // Owner.
  private ownerKey: string | null = null;
  private ownerConfirmed = false;
  private ownerCheck = 0;

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
    };
    this.lifecycle.start(listener);
    // The first owner: the library client reads the session once.
    const check = ++this.ownerCheck;
    void this.io.ownerKey().then((key) => {
      if (check === this.ownerCheck && this.ownerKey === null) this.acceptOwner(key, false);
    });
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
    if (reg.removed || reg.dispose || !engine || !this.supported || this.disabledReason !== null) return;
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
    this.breaker.end(attachment.game.appId);
    this.lifecycle.wantCapture(false);
    for (const name of ["source-lost", "post-roll", "recovering-quiet"]) this.clearNamedTimer(name);
    // The next game starts from IDLE. 4 failures in 60 s keep capture off for the tab.
    if (this.disabledReason === "breaker") this.disabledReason = null;
    this.state = this.disabledReason === "encoder-error" ? "disabled" : "idle";
    this.held = null;
    // The engine keeps its ring for RING_KEEP_MS in case the same game comes back.
    this.setNamedTimer("ring-keep", RING_KEEP_MS, () => {
      if (this.attached) return;
      this.engine?.purge();
      this.engine?.disarm();
      this.outputOk = false;
      this.bufferedSec = 0;
    });
    this.publish();
  }

  /** @internal Attachment API. */
  runPhase(attachment: Attachment, phase: RunPhase): void {
    if (attachment.detached) return;
    if (phase === "start") {
      attachment.runActive = true;
      this.clearNamedTimer("post-roll");
    } else {
      attachment.runActive = false;
      attachment.lastRunEndAtMs = this.now();
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
    return { pressId: randomId(), downAtMs: this.now(), endAtUs: this.engine?.mediaEndUs() ?? 0 };
  }

  endPress(token: PressToken, info: { upAtMs: number; moved: boolean; cancelled?: boolean }): PressOutcome {
    const snap = this.snapshot;
    if (!this.attached || snap.button === "hidden") return { kind: "ignored", reason: snap.reason ?? "flag-off" };
    if (info.cancelled) return { kind: "ignored", reason: "cancelled" };
    const button = snap.button;
    if (button === "recording" || button === "saving" || button === "exporting") return { kind: "ignored", reason: "busy" };
    if (info.upAtMs - token.downAtMs >= HOLD_FOR_MENU_MS && !info.moved) return { kind: "menu" };
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
    if (!this.attached || !this.engine || !this.canClipIn(this.snapshot.button)) {
      return Promise.resolve(this.fail("clip", this.snapshot.reason ?? "warming"));
    }
    return this.commitClip(seconds, token);
  }

  /** States with footage to clip: ready, made, suspended (pre-pause) and resting (pre-rest). */
  private canClipIn(button: ClipButtonState): boolean {
    return button === "ready" || button === "made" || button === "suspended" || button === "resting";
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
    return previous.made.then((shorter) => {
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
  ): { result: Promise<ClipActionResult>; made: Promise<MadeClip | null> } {
    const engine = this.engine;
    if (!engine) return { result: Promise.resolve(this.fail(action, "warming")), made: Promise.resolve(replaces) };
    let settle: (value: MadeClip | null) => void = () => undefined;
    const made = new Promise<MadeClip | null>((resolve) => {
      settle = resolve;
    });
    this.beginSaving();
    const attachment = this.attached;
    const result = (async (): Promise<ClipActionResult> => {
      try {
        const clip = await engine.clip({
          seconds,
          endAtUs: token?.endAtUs,
          meta: this.meta("clip", "c"),
          moments: this.momentsFor(attachment),
          onProgress: (fraction) => {
            this.savingProgress = Math.max(this.savingProgress ?? 0, Math.min(1, fraction));
            this.publish();
          },
        });
        // The longer clip is stored: the shorter one goes, so the library keeps one row.
        if (replaces) await this.library.remove(replaces.record.id).catch(() => undefined);
        settle(clip);
        if (this.unwatchedClipId === null || this.unwatchedClipId === replaces?.record.id || action === "clip") {
          this.unwatchedClipId = clip.record.id;
        }
        return this.succeed(action, clip.record);
      } catch (error) {
        // A failed extend keeps the shorter clip as the last clip.
        settle(replaces);
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

  private succeed(action: Action, record: ClipRecord): ClipActionResult {
    const result: ClipActionResult = { ok: true, action, record, atMs: this.now() };
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
    };
    this.recording = rec;
    this.elapsedSec = 0;
    let handle: RecordingHandle;
    try {
      handle = await engine.startRecording(meta);
    } catch (error) {
      if (this.recording === rec) this.recording = null;
      return this.fail("record", reasonOf(error));
    }
    rec.handle = handle;
    if (this.recording !== rec) {
      // Finalized while it started (hidden, source lost): the tee stops too.
      void handle.stop().catch(() => undefined);
      return null;
    }
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
      if (!rec.handle) return this.fail("record", "encoder-error");
      this.beginSaving();
      try {
        const result = await rec.handle.stop();
        const first = result.parts[0];
        if (!first) return this.fail("record", "mux-failed");
        await this.placeStars(rec, result.parts);
        this.unwatchedClipId = first.record.id;
        return this.succeed("record", first.record);
      } catch (error) {
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
    if (!this.attached || !engine || button === "hidden" || button === "disabled") {
      return this.fail("picture", this.snapshot.reason ?? "source-lost");
    }
    this.beginSaving();
    try {
      return this.succeed("picture", await engine.picture(this.meta("picture", "p")));
    } catch (error) {
      return this.fail("picture", reasonOf(error));
    } finally {
      this.endSaving();
    }
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
    this.engine.wake();
    this.publish();
  }

  /**
   * An export session (plan 7: the editor, "Make it longer"). The live encoder
   * is flushed and closed first, so a phone never needs three codec sessions.
   * Play resumes on a new epoch.
   */
  async runExport<T>(task: () => Promise<T>): Promise<T> {
    const engine = this.engine;
    if (!engine || this.state !== "buffering") return task();
    engine.setPaused("export", true);
    engine.closeEncoder("export");
    this.fire("export");
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

  /** The signed-in user from the React session (ClipProvider). null: a guest. */
  async setSessionUser(userId: string | null): Promise<void> {
    const check = ++this.ownerCheck;
    const key = await this.keyFor(userId);
    if (check === this.ownerCheck) this.acceptOwner(key, false);
  }

  private acceptOwner(key: string, bfcacheRestore: boolean): void {
    const from = this.ownerKey;
    this.ownerKey = key;
    this.ownerConfirmed = true;
    this.io.setOwnerKey(key);
    if (from !== null && from !== key) {
      const attachment = this.attached;
      const action = ownerChangeAction({
        from,
        to: key,
        nowMs: this.now(),
        lastRunEndAtMs: attachment?.lastRunEndAtMs ?? null,
        runActive: attachment?.runActive ?? false,
        bfcacheRestore,
      });
      if (action === "purge") this.purgeForOwner();
    }
    this.applyPauses();
  }

  private purgeForOwner(): void {
    // A recording belongs to the owner who started it: it is kept, under that owner.
    if (this.recording) void this.finishRecording("stop");
    this.engine?.purge();
    this.warmStartUs = this.engine?.mediaEndUs() ?? 0;
    this.lastClip = null;
    this.unwatchedClipId = null;
    if (this.attached) this.attached.moments = [];
    this.fire("owner-change");
  }

  // ---- lifecycle ----------------------------------------------------------------------------------

  private onVisibility(visible: boolean): void {
    if (!visible && this.recording) void this.finishRecording("hidden");
    this.applyPauses();
    // Plan 7.1: on iOS a hidden page flushes and closes its encoders at once
    // (after the pause above, so the timeline pause reaches the worker first).
    if (!visible && this.closesOnHide && this.engine) this.engine.closeEncoder("hidden");
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
    this.applyPauses();
    const check = ++this.ownerCheck;
    void (async () => {
      let key: string | null = null;
      try {
        key = await this.keyFor(await this.readUserId());
      } catch {
        key = null;
      }
      if (check !== this.ownerCheck) return;
      if (key === null) {
        // The owner cannot be read: the ring is never reused, and capture stays paused.
        this.log("[clips] the signed-in user could not be read after a back navigation");
        this.purgeForOwner();
        this.publish();
        return;
      }
      if (this.attached) void this.breaker.begin(this.attached.game.appId).catch(() => undefined);
      this.acceptOwner(key, true);
    })();
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

  private markCapturing(): void {
    const attachment = this.attached;
    if (!attachment || !this.supported || this.disabledReason !== null) return;
    const flowing = this.state === "warming" || this.state === "bridged" || this.state === "buffering" || this.state === "recording";
    this.breaker.setCapturing(attachment.game.appId, flowing && !this.suspendedNow());
  }

  // ---- engine events --------------------------------------------------------------------------------

  private onEngine(event: EngineEvent): void {
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
        if (this.attached) this.attached.moments = [];
        break;
    }
    this.settle();
    this.markCapturing();
    this.publish();
  }

  private onEncoderError(fatal: boolean): void {
    if (fatal) this.outputOk = false;
    this.recovering = true;
    if (!this.lifecycle.inResumeGrace()) {
      const now = this.now();
      this.failures = this.failures.filter((at) => now - at < FAILURE_WINDOW_MS);
      this.failures.push(now);
    }
    if (this.recording) void this.finishRecording("encoder-error");
    else this.fire("encoder-error");
    if (this.failures.length >= FAILURES_TO_DISABLE && this.state === "recovering") {
      this.disabledReason = "encoder-error";
      this.fire("disable");
      this.engine?.disarm();
    }
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
        return this.outputOk ? "output-ok" : null;
      case "bridged":
        return this.outputOk ? "hardware-ready" : null;
      case "buffering":
        if (!this.sourcePresent) return "canvas-gone";
        if (this.recovering) return "encoder-error";
        if (this.governorResting) return "governor-severe";
        return this.suspendedNow() ? "suspend" : null;
      case "recording":
        if (!this.sourcePresent) return "canvas-gone";
        return null;
      case "resting":
        if (this.governorResting) return null;
        return this.recording ? "record" : "probe-passes";
      case "suspended":
        return this.suspendedNow() ? null : "resume";
      case "source-lost":
        return this.sourcePresent ? "re-registered" : null;
      case "recovering":
        return !this.recovering && this.outputOk ? "recreated" : null;
      default:
        return null;
    }
  }

  // ---- snapshot --------------------------------------------------------------------------------------------

  private publish(): void {
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
      reason: derived.reason,
      appId: attachment?.game.appId ?? null,
      tier: this.tier,
      warmProgress: derived.warmProgress,
      savingProgress: this.saving > 0 ? this.savingProgress : null,
      bufferedSec: holdsFootage ? this.bufferedSec : 0,
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

  // ---- timers -------------------------------------------------------------------------------------------------

  private setNamedTimer(name: string, ms: number, fn: () => void): void {
    this.clearNamedTimer(name);
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
