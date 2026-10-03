/**
 * The shared state of the clip surfaces, and the actions that change it.
 *
 * The clip button, the toast slot, the pause-menu entry and the result-chip
 * actions are mounted in different places. They share one store: which
 * sheet is open, the tap reply toast, a clip or a menu that waits for the
 * end of a run, the frozen end of the last run, and the one-time hold tip.
 * The store is framework-free, so the tests drive it without React.
 * ClipUiRuntime makes one per game page.
 *
 * Pausing (plan 11.1, 12): before a sheet opens during play, the game
 * pauses where it can. The UI cannot pause a game through the service
 * contract, so the host (GameShell, through ClipUiMount) gives pauseGame and
 * resumeGame to ClipUiRuntime.
 *
 * Never cover a run that cannot pause (plan 11.1 "Never interrupt play",
 * 11.4 "the result chip is the Capture home for games that cannot pause"):
 * during such a run no sheet opens. A hold on the clip button still clips
 * the moment of the press, and any other request for a sheet waits for the
 * next break, with a reply that says so.
 */

import {
  DEFAULT_CLIP_SECONDS,
  type ClipActionResult,
  type ClipButtonState,
  type ClipReasonCode,
  type ClipServiceApi,
  type ClipSnapshot,
  type EngineState,
  type PressToken,
  type RunClipPart,
} from "../service/contract";
import type { ClipRecord } from "../protocol";
import { deferredMenuText, reasonText, recoveredReplyText, TOAST_COPY, type SavePlatform } from "./copy";
import { logClipUiFailure } from "./log";
import { nowMs } from "./platform";
import type { TapOutcome, TapSource } from "./pressGesture";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Where the Capture menu was opened from. */
export type MenuSource = TapSource | "pause-menu" | "result-chip";

/** What the viewer shows: one clip, or the list of one game's clips. */
export type ViewerTarget = { kind: "clip"; id: string } | { kind: "game"; gameId: string };

export type SheetState =
  | { kind: "menu"; token: PressToken | null; source: MenuSource; pausedByUs: boolean }
  | { kind: "viewer"; target: ViewerTarget; pausedByUs: boolean }
  | { kind: "settings"; pausedByUs: boolean };

export interface ReplyToast {
  id: number;
  text: string;
  /**
   * True for a reply to the kid's own tap: it keeps a 44 px read-aloud
   * button that takes taps during play (plan 11.3). Other toasts take no taps.
   */
  tappable: boolean;
}

/**
 * The end of the run that the result chip shows (plan 11.4). The press
 * token freezes the capture-timeline end at the moment the chip appeared,
 * and it carries the run's own span (PressToken.run), so the chip's clip
 * actions clip the run and not the time the kid spent on the result screen
 * or an earlier run. Capture can go on after the run (a post-roll, or a
 * service that captures between runs), so the mark also counts how long
 * capture ran since then: that much of the ring's start is gone.
 */
export interface ResultMark {
  token: PressToken | null;
  /**
   * Capture time (ms) since the mark, up to the last count. While capture
   * runs, ClipUiRuntime counts it on once a second (tickResultMark), so
   * every part that reads it sees the same number.
   */
  capturedMs: number;
  /** When the running capture was last counted (this module's clock), or null while capture is stopped. */
  runningSince: number | null;
}

export interface ClipUiState {
  sheet: SheetState | null;
  reply: ReplyToast | null;
  /** A clip the kid asked to watch during a run that cannot pause. It opens at the next break. */
  pendingOpenId: string | null;
  /** The Capture menu was asked for during a run that cannot pause. It opens at the next break. */
  pendingMenu: boolean;
  /** The frozen end of the run on the result chip, while the chip is on screen. */
  resultMark: ResultMark | null;
  /**
   * The one-time hold tip (plan 11.4): "due" after the third clip, "showing"
   * at the next break, "none" before and after.
   */
  holdTip: "none" | "due" | "showing";
  /** Bumps on a warming tap, so the button pulses once. */
  pulse: number;
  /**
   * The newest Record video saved from last time (plan 8.4) that the kid has
   * not been told about yet. The reply waits for a break; an open viewer
   * (My clips) tells the kid itself.
   */
  recoveredClipId: string | null;
}

/** How long a reply stays, and how long after the kid taps its read-aloud button. */
export const REPLY_MS = 6000;
export const REPLY_READING_MS = 15000;
/** The hold tip comes after this many clips made with the clip button (plan 11.4). */
export const HOLD_TIP_AFTER_CLIPS = 3;
/** iPhone share coaching shows for the first shares only (plan 12). */
export const SHARE_COACH_TIMES = 3;
/** localStorage key of the small UI memory (no personal data). */
export const UI_PREFS_KEY = "hh-clips-ui";

/** Engine states in which the capture timeline moves (the service's own "flowing" states). */
const CAPTURE_RUNNING: ReadonlySet<EngineState> = new Set(["warming", "bridged", "buffering", "recording"]);

/** True while the capture timeline moves. */
export function captureRuns(engine: EngineState): boolean {
  return CAPTURE_RUNNING.has(engine);
}

/** Capture seconds since the mark, as last counted. 0 without a mark. */
export function capturedSecSince(mark: ResultMark | null): number {
  return mark ? mark.capturedMs / 1000 : 0;
}

/** How often a running capture is counted on the result mark. */
export const RESULT_MARK_TICK_MS = 1000;

interface UiPrefs {
  manualClips: number;
  holdTipShown: boolean;
  sharesCoached: number;
}

const DEFAULT_PREFS: UiPrefs = { manualClips: 0, holdTipShown: false, sharesCoached: 0 };

function readPrefs(): UiPrefs {
  try {
    if (typeof window === "undefined" || !window.localStorage) return { ...DEFAULT_PREFS };
    const raw = window.localStorage.getItem(UI_PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<UiPrefs>;
    const count = (value: unknown) =>
      typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
    return {
      manualClips: count(parsed.manualClips),
      holdTipShown: parsed.holdTipShown === true,
      sharesCoached: count(parsed.sharesCoached),
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function writePrefs(prefs: UiPrefs): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(UI_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage is full or blocked (a private window). The tip can show again; nothing breaks.
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface ClipUiStore {
  subscribe(listener: () => void): () => void;
  getState(): ClipUiState;
  setSheet(sheet: SheetState | null): void;
  /** Show a reply toast. Returns its id. */
  showReply(text: string, tappable: boolean): number;
  /** Keep the reply up while the voice reads it. */
  holdReply(id: number): void;
  clearReply(id?: number): void;
  setPendingOpen(id: string | null): void;
  setPendingMenu(pending: boolean): void;
  setResultMark(mark: ResultMark | null): void;
  /** Count a clip made with the clip button; the hold tip becomes due after the third. */
  noteManualClip(): void;
  /** Show a due hold tip (at a break). It never shows again after this. */
  showHoldTip(): void;
  /** Hide the hold tip. */
  dismissHoldTip(): void;
  bumpPulse(): void;
  setRecovered(id: string | null): void;
  /** How many times the iPhone share coaching showed. */
  sharesCoached(): number;
  noteShareCoached(): void;
  dispose(): void;
}

export function createClipUiStore(): ClipUiStore {
  let prefs: UiPrefs | null = null;
  const loadPrefs = (): UiPrefs => (prefs ??= readPrefs());

  let state: ClipUiState = {
    sheet: null,
    reply: null,
    pendingOpenId: null,
    pendingMenu: false,
    resultMark: null,
    holdTip: "none",
    pulse: 0,
    recoveredClipId: null,
  };
  const listeners = new Set<() => void>();
  let replySeq = 0;
  let replyTimer: ReturnType<typeof setTimeout> | null = null;

  const set = (next: Partial<ClipUiState>) => {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  };

  const armReplyTimer = (id: number, ms: number) => {
    if (replyTimer !== null) clearTimeout(replyTimer);
    replyTimer = setTimeout(() => {
      replyTimer = null;
      if (state.reply?.id === id) set({ reply: null });
    }, ms);
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => state,
    setSheet(sheet) {
      set({ sheet });
    },
    showReply(text, tappable) {
      replySeq += 1;
      const id = replySeq;
      set({ reply: { id, text, tappable } });
      armReplyTimer(id, REPLY_MS);
      return id;
    },
    holdReply(id) {
      if (state.reply?.id === id) armReplyTimer(id, REPLY_READING_MS);
    },
    clearReply(id) {
      if (!state.reply || (id !== undefined && state.reply.id !== id)) return;
      if (replyTimer !== null) clearTimeout(replyTimer);
      replyTimer = null;
      set({ reply: null });
    },
    setPendingOpen(id) {
      if (state.pendingOpenId !== id) set({ pendingOpenId: id });
    },
    setPendingMenu(pending) {
      if (state.pendingMenu !== pending) set({ pendingMenu: pending });
    },
    setResultMark(mark) {
      if (state.resultMark !== mark) set({ resultMark: mark });
    },
    noteManualClip() {
      const current = loadPrefs();
      prefs = { ...current, manualClips: current.manualClips + 1 };
      writePrefs(prefs);
      if (!prefs.holdTipShown && prefs.manualClips >= HOLD_TIP_AFTER_CLIPS && state.holdTip === "none") {
        set({ holdTip: "due" });
      }
    },
    showHoldTip() {
      if (state.holdTip !== "due") return;
      prefs = { ...loadPrefs(), holdTipShown: true };
      writePrefs(prefs);
      set({ holdTip: "showing" });
    },
    dismissHoldTip() {
      if (state.holdTip !== "none") set({ holdTip: "none" });
    },
    bumpPulse() {
      set({ pulse: state.pulse + 1 });
    },
    setRecovered(id) {
      if (state.recoveredClipId !== id) set({ recoveredClipId: id });
    },
    sharesCoached: () => loadPrefs().sharesCoached,
    noteShareCoached() {
      const current = loadPrefs();
      prefs = { ...current, sharesCoached: current.sharesCoached + 1 };
      writePrefs(prefs);
    },
    dispose() {
      if (replyTimer !== null) clearTimeout(replyTimer);
      replyTimer = null;
      listeners.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Controller: the actions every clip surface calls
// ---------------------------------------------------------------------------

/** What the page gives the clip UI (GameShell in the integration step). */
export interface ClipUiHost {
  /** Pause the game (GameShell pause: the pause menu opens under the sheet). */
  pauseGame?: () => void;
  /** Resume the game after a Capture menu that paused it for a quick action. */
  resumeGame?: () => void;
}

export interface ClipUiDeps {
  store: ClipUiStore;
  service: () => ClipServiceApi | null;
  snapshot: () => ClipSnapshot;
  host: () => ClipUiHost;
  platform: () => SavePlatform;
  /** This module's clock (ms). Default performance.now(). */
  now?: () => number;
}

export interface ClipUiController {
  readonly store: ClipUiStore;
  platform(): SavePlatform;
  /** Act on a clip button press (pointer, keyboard or gamepad). */
  handleTapOutcome(outcome: TapOutcome): void;
  /**
   * Open the Capture menu. During a run that cannot pause it opens at the
   * next break instead (with a reply that says so).
   */
  openMenu(token: PressToken | null, source: MenuSource): void;
  /** Named sharing uses the universal shell overlay hold, including continuous games. */
  openSharingMenu(): void;
  /**
   * Open the viewer. During play the game pauses first where it can. In a
   * run that cannot pause, a clip opens at the next break instead (the
   * new-clip chip says "Your clip is ready when this run ends!").
   */
  openViewer(target: ViewerTarget): void;
  openSettings(): void;
  /** Close the open sheet. A Capture menu that paused the game resumes it. */
  closeSheet(options?: { resume?: boolean }): void;
  /** Swap the open sheet for another one and keep the pause. */
  replaceSheet(next: { kind: "viewer"; target: ViewerTarget } | { kind: "settings" }): void;
  /** The new-clip chip: open the newest clip (plan 11.1). */
  openNewestClip(): void;
  /** Open a clip or the menu that waited for the end of a run. Call when the snapshot reaches a break. */
  flushPendingOpen(): void;

  // Capture menu rows
  clipLastFromMenu(token: PressToken | null): void;
  recordFromMenu(): void;
  stopRecordingFromMenu(): void;
  pictureFromMenu(): void;
  wakeFromMenu(): void;

  // Result chip (at a break)
  /** Freeze the end of the run: call when the result chip's clip actions appear. */
  beginResultMark(): void;
  /** Forget the frozen end: call when the result chip goes away. */
  endResultMark(): void;
  /** Count the capture that runs now onto the result mark (ClipUiRuntime calls it once a second). */
  tickResultMark(): void;
  /** The snapshot's engine state changed: keep the result mark's capture count. */
  noteEngine(engine: EngineState): void;
  /**
   * A result chip clip action (plan 11.4, decision D1): clip the run of the
   * frozen end ("whole" or its "end") and open the clip. A second tap while
   * the first clip saves does nothing.
   */
  clipRun(part: RunClipPart): void;

  /** Alt+R: start a video, or stop the one that records. */
  toggleRecord(): void;

  /** Show a reply for a failed or thrown action. */
  replyForResult(result: ClipActionResult | null): void;

  // Crash recovery (plan 8.4)
  /**
   * Take the Record videos saved from last time from the service (it points
   * the new-clip chip at the newest), and tell the kid: a reply at the next
   * break, or the open viewer. Call it when the clip UI starts, when the
   * library changes, and when My clips opens.
   */
  checkRecovered(): Promise<void>;
  /** Show a waiting "from last time" reply now, if no sheet is open and play is at a break. */
  flushRecovered(): void;
  /** The kid saw the video from last time, or the viewer told them about it: no reply. */
  recoveredSeen(): void;
}

/**
 * True when closing this sheet (with no option) gives play back: a Capture
 * menu that paused the game itself. Every other sheet, and a menu opened at
 * a break (the pause menu, a start or result card), goes back to that break.
 */
export function closeResumesPlay(sheet: SheetState | null): boolean {
  return sheet !== null && sheet.kind === "menu" && sheet.pausedByUs;
}

/** Button states where a hold in a run that cannot pause clips its frozen moment. */
const HOLD_CLIPS_IN: ReadonlySet<ClipButtonState> = new Set(["ready", "made", "suspended", "resting"]);

/**
 * Wait for a clip action. A thrown action counts as "the file could not be
 * made", and it logs a values-free reason (plan 12).
 */
function settle(action: string, promise: Promise<ClipActionResult>): Promise<ClipActionResult | null> {
  return promise.then(
    (result) => result,
    (error: unknown) => {
      logClipUiFailure(action, error);
      return null;
    },
  );
}

export function createClipUiController(deps: ClipUiDeps): ClipUiController {
  const { store } = deps;
  const now = deps.now ?? nowMs;

  /** True when a sheet may open now: at a break, or where the game can pause. */
  const canCoverPlay = (): boolean => {
    const snapshot = deps.snapshot();
    return snapshot.atBreak || (snapshot.gameCanPause && typeof deps.host().pauseGame === "function");
  };

  const pauseIfPlaying = (): boolean => {
    const snapshot = deps.snapshot();
    if (snapshot.atBreak) return false;
    const pause = deps.host().pauseGame;
    if (!snapshot.gameCanPause || !pause) return false;
    pause();
    return true;
  };

  const replyForResult = (result: ClipActionResult | null) => {
    if (result === null) {
      store.showReply(reasonText("mux-failed"), true);
      return;
    }
    // A refused result (the owner changed, or is read again) is invisible.
    if (!result.ok && result.refused) return;
    if (!result.ok) {
      logClipUiFailure(result.action, undefined, result.reason);
      store.showReply(reasonText(result.reason), true);
    }
  };

  /** A clip made with the clip button (a tap or a hold): count it, then reply. */
  const commitFromButton = (action: string, result: Promise<ClipActionResult>) => {
    void settle(action, result).then((settled) => {
      if (settled?.ok && settled.action === "clip") store.noteManualClip();
      replyForResult(settled);
    });
  };

  /** The reason a resting or record-only button gives before its menu. */
  const menuReason = (): ClipReasonCode | null => {
    const button = deps.snapshot().button;
    if (button === "resting") return "resting";
    if (button === "record-only") return "record-only";
    return null;
  };

  /** The Capture menu waits for the next break. The reply says so. */
  const deferMenu = () => {
    store.setPendingMenu(true);
    store.showReply(deferredMenuText(menuReason()), true);
  };

  const openViewerNow = (target: ViewerTarget, pausedByUs: boolean) => {
    const pending = store.getState().pendingOpenId;
    if (target.kind === "clip" && pending === target.id) store.setPendingOpen(null);
    store.setSheet({ kind: "viewer", target, pausedByUs });
  };

  /** After a clip at a break, open it so two taps share it (plan 11.1). */
  const openResultAtBreak = (result: ClipActionResult | null) => {
    if (result && result.ok) {
      controller.openViewer({ kind: "clip", id: result.record.id });
      return;
    }
    replyForResult(result);
  };

  const resultToken = (): PressToken | undefined => store.getState().resultMark?.token ?? undefined;
  /** A result chip run clip is being made: a second tap must not make a second clip. */
  let runClipBusy = false;

  const controller: ClipUiController = {
    store,
    platform: () => deps.platform(),

    handleTapOutcome(outcome) {
      switch (outcome.kind) {
        case "commit":
          commitFromButton(outcome.action, outcome.result);
          return;
        case "stop":
          void settle("record", outcome.result).then(replyForResult);
          return;
        case "menu": {
          const service = deps.service();
          if (!service) return;
          if (!canCoverPlay()) {
            // A slow press in a run that cannot pause: clip the moment of the press.
            if (outcome.hold && outcome.token && HOLD_CLIPS_IN.has(deps.snapshot().button)) {
              commitFromButton("clip", service.clipLast(DEFAULT_CLIP_SECONDS, outcome.token));
              return;
            }
            deferMenu();
            return;
          }
          controller.openMenu(outcome.token, outcome.source);
          return;
        }
        case "reply":
          if (outcome.pulse) store.bumpPulse();
          store.showReply(reasonText(outcome.reason), true);
          return;
        case "none":
          return;
      }
    },

    openSharingMenu() {
      const service = deps.service();
      if (!service || store.getState().sheet) return;
      const token = service.beginPress();
      // Release the gesture without capture; retain its frozen timeline bounds for the preview.
      if (token) service.endPress(token, { upAtMs: token.downAtMs, moved: false, cancelled: true });
      store.setPendingMenu(false);
      // Sheet registers a shell overlay hold. Closing releases it without changing the game's pause menu.
      store.setSheet({ kind: "menu", token, source: "pause-menu", pausedByUs: false });
    },

    openMenu(token, source) {
      if (!deps.service()) return;
      if (store.getState().sheet) return;
      if (!canCoverPlay()) {
        deferMenu();
        return;
      }
      const pausedByUs = pauseIfPlaying();
      store.setPendingMenu(false);
      store.setSheet({ kind: "menu", token, source, pausedByUs });
    },

    openViewer(target) {
      if (!deps.service()) return;
      if (deps.snapshot().atBreak) {
        openViewerNow(target, false);
        return;
      }
      if (pauseIfPlaying()) {
        openViewerNow(target, true);
        return;
      }
      if (canCoverPlay()) {
        openViewerNow(target, false);
        return;
      }
      // A run that cannot pause: never cover it.
      if (target.kind === "clip") {
        store.setPendingOpen(target.id);
        store.showReply(TOAST_COPY.readyAtRunEnd, true);
        return;
      }
      deferMenu();
    },

    openSettings() {
      if (!deps.service() || store.getState().sheet) return;
      if (!canCoverPlay()) {
        deferMenu();
        return;
      }
      store.setSheet({ kind: "settings", pausedByUs: pauseIfPlaying() });
    },

    closeSheet(options = {}) {
      const sheet = store.getState().sheet;
      if (!sheet) return;
      // An open viewer (My clips) showed the "from last time" note itself.
      if (sheet.kind === "viewer") store.setRecovered(null);
      store.setSheet(null);
      // Only a Capture menu hands play straight back: the kid picked a quick
      // action. After the viewer or settings the pause menu stays, so the kid
      // resumes when ready. (closeResumesPlay names the close control.)
      const resume = options.resume === undefined ? closeResumesPlay(sheet) : options.resume && sheet.pausedByUs;
      if (resume) deps.host().resumeGame?.();
    },

    replaceSheet(next) {
      const sheet = store.getState().sheet;
      const pausedByUs = sheet?.pausedByUs ?? false;
      if (next.kind === "viewer") openViewerNow(next.target, pausedByUs);
      else store.setSheet({ kind: "settings", pausedByUs });
    },

    openNewestClip() {
      const id = deps.snapshot().unwatchedClipId;
      if (!id) return;
      controller.openViewer({ kind: "clip", id });
    },

    flushPendingOpen() {
      const state = store.getState();
      if (state.sheet || !deps.snapshot().atBreak || !deps.service()) return;
      if (state.pendingOpenId) {
        store.setPendingMenu(false);
        openViewerNow({ kind: "clip", id: state.pendingOpenId }, false);
        return;
      }
      if (state.pendingMenu) {
        store.setPendingMenu(false);
        store.setSheet({ kind: "menu", token: null, source: "result-chip", pausedByUs: false });
      }
    },

    clipLastFromMenu(token) {
      const service = deps.service();
      if (!service) return;
      const result = settle("clip", service.clipLast(DEFAULT_CLIP_SECONDS, token ?? undefined));
      controller.closeSheet();
      void result.then(replyForResult);
    },

    recordFromMenu() {
      const service = deps.service();
      if (!service) return;
      const started = service.startRecording().then(
        (result) => result,
        (error: unknown) => {
          logClipUiFailure("record", error);
          return null;
        },
      );
      controller.closeSheet();
      void started.then((result) => {
        if (result && !result.ok) replyForResult(result);
      });
    },

    stopRecordingFromMenu() {
      const service = deps.service();
      if (!service) return;
      const result = settle("record", service.stopRecording());
      controller.closeSheet();
      void result.then(replyForResult);
    },

    pictureFromMenu() {
      const service = deps.service();
      if (!service) return;
      // Take the picture first: the frame is the one under the menu.
      const result = settle("picture", service.takePicture());
      controller.closeSheet();
      void result.then(replyForResult);
    },

    wakeFromMenu() {
      const service = deps.service();
      if (!service) return;
      service.wake();
      controller.closeSheet();
    },

    beginResultMark() {
      if (store.getState().resultMark) return;
      const service = deps.service();
      let token: PressToken | null = null;
      if (service) {
        // The same frozen end a press takes (plan 11.1), released at once:
        // nothing is committed until the kid taps a result chip action.
        token = service.beginPress();
        if (token) service.endPress(token, { upAtMs: token.downAtMs, moved: false, cancelled: true });
      }
      const running = captureRuns(deps.snapshot().engine);
      store.setResultMark({ token, capturedMs: 0, runningSince: running ? now() : null });
    },

    endResultMark() {
      store.setResultMark(null);
    },

    tickResultMark() {
      const mark = store.getState().resultMark;
      if (!mark || mark.runningSince === null) return;
      const at = now();
      store.setResultMark({ ...mark, capturedMs: mark.capturedMs + Math.max(0, at - mark.runningSince), runningSince: at });
    },

    noteEngine(engine) {
      const mark = store.getState().resultMark;
      if (!mark) return;
      const running = captureRuns(engine);
      if (running && mark.runningSince === null) {
        store.setResultMark({ ...mark, runningSince: now() });
      } else if (!running && mark.runningSince !== null) {
        store.setResultMark({ ...mark, capturedMs: mark.capturedMs + Math.max(0, now() - mark.runningSince), runningSince: null });
      }
    },

    clipRun(part) {
      const service = deps.service();
      const token = resultToken();
      if (!service || !token || runClipBusy) return;
      runClipBusy = true;
      void settle("clip", service.clipRun(token, part)).then((result) => {
        runClipBusy = false;
        openResultAtBreak(result);
      });
    },

    toggleRecord() {
      const service = deps.service();
      if (!service) return;
      const snapshot = deps.snapshot();
      if (snapshot.recording !== null || snapshot.button === "recording") {
        void settle("record", service.stopRecording()).then(replyForResult);
        return;
      }
      void service.startRecording().then(
        (result) => {
          if (result && !result.ok) replyForResult(result);
        },
        (error: unknown) => {
          logClipUiFailure("record", error);
          replyForResult(null);
        },
      );
    },

    replyForResult,

    async checkRecovered() {
      const service = deps.service();
      if (!service) return;
      let rows: ClipRecord[];
      try {
        rows = await service.takeRecovered();
      } catch (error) {
        logClipUiFailure("recovered", error);
        return;
      }
      if (rows.length === 0 || deps.service() !== service) return;
      const newest = rows.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
      store.setRecovered(newest.id);
      controller.flushRecovered();
    },

    flushRecovered() {
      const state = store.getState();
      if (!state.recoveredClipId || state.sheet || !deps.snapshot().atBreak) return;
      store.setRecovered(null);
      store.showReply(recoveredReplyText(), true);
    },

    recoveredSeen() {
      store.setRecovered(null);
    },
  };

  return controller;
}
