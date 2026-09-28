/**
 * The shared state of the clip surfaces, and the actions that change it.
 *
 * The clip button, the toast slot, the pause-menu entry and the result-chip
 * actions are mounted in different places. They share one store: which
 * sheet is open, the tap reply toast, a clip that waits for the end of a
 * run, and the one-time hold tip. The store is framework-free, so the
 * tests drive it without React. ClipUiProvider makes one per game page.
 *
 * Pausing (plan 11.1, 12): before a sheet opens during play, the game
 * pauses where it can. The UI cannot pause a game through the service
 * contract, so the host (GameShell) gives pauseGame and resumeGame to
 * ClipUiProvider.
 */

import {
  DEFAULT_CLIP_SECONDS,
  type ClipActionResult,
  type ClipServiceApi,
  type ClipSnapshot,
  type PressToken,
} from "../service/contract";
import { reasonText, TOAST_COPY, type SavePlatform } from "./copy";
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

export interface ClipUiState {
  sheet: SheetState | null;
  reply: ReplyToast | null;
  /** A clip the kid asked to watch during a run that cannot pause. It opens at the next break. */
  pendingOpenId: string | null;
  /**
   * The one-time hold tip (plan 11.4): "due" after the third clip, "showing"
   * at the next break, "none" before and after.
   */
  holdTip: "none" | "due" | "showing";
  /** Bumps on a warming tap, so the button pulses once. */
  pulse: number;
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
  /** Count a clip made with the clip button; the hold tip becomes due after the third. */
  noteManualClip(): void;
  /** Show a due hold tip (at a break). It never shows again after this. */
  showHoldTip(): void;
  /** Hide the hold tip. */
  dismissHoldTip(): void;
  bumpPulse(): void;
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
    holdTip: "none",
    pulse: 0,
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
}

export interface ClipUiController {
  readonly store: ClipUiStore;
  platform(): SavePlatform;
  /** Act on a clip button press (pointer, keyboard or gamepad). */
  handleTapOutcome(outcome: TapOutcome): void;
  openMenu(token: PressToken | null, source: MenuSource): void;
  /**
   * Open the viewer. During play the game pauses first where it can.
   * `deferInRun`: in a run that cannot pause, say the clip is ready when the
   * run ends and open it at the next break instead (the new-clip chip).
   */
  openViewer(target: ViewerTarget, options?: { deferInRun?: boolean }): void;
  openSettings(): void;
  /** Close the open sheet. A Capture menu that paused the game resumes it. */
  closeSheet(options?: { resume?: boolean }): void;
  /** Swap the open sheet for another one and keep the pause. */
  replaceSheet(next: { kind: "viewer"; target: ViewerTarget } | { kind: "settings" }): void;
  /** The new-clip chip: open the newest clip (plan 11.1). */
  openNewestClip(): void;
  /** Open a clip that waited for the end of a run. Call when the snapshot reaches a break. */
  flushPendingOpen(): void;

  // Capture menu rows
  clipLastFromMenu(token: PressToken | null): void;
  recordFromMenu(): void;
  stopRecordingFromMenu(): void;
  pictureFromMenu(): void;
  wakeFromMenu(): void;

  // Result chip actions (at a break)
  watch(): void;
  wholeRunVideo(seconds: number): void;
  recordFromChip(): void;
  pictureFromChip(): void;

  /** Alt+R: start a video, or stop the one that records. */
  toggleRecord(): void;

  /** Show a reply for a failed or thrown action. */
  replyForResult(result: ClipActionResult | null): void;
}

/** A thrown action counts as "the file could not be made". */
function settle(promise: Promise<ClipActionResult>): Promise<ClipActionResult | null> {
  return promise.then(
    (result) => result,
    () => null,
  );
}

export function createClipUiController(deps: ClipUiDeps): ClipUiController {
  const { store } = deps;

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
    if (!result.ok) store.showReply(reasonText(result.reason), true);
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

  const controller: ClipUiController = {
    store,
    platform: () => deps.platform(),

    handleTapOutcome(outcome) {
      switch (outcome.kind) {
        case "commit":
          void settle(outcome.result).then((result) => {
            if (result?.ok && result.action === "clip") store.noteManualClip();
            replyForResult(result);
          });
          return;
        case "stop":
          void settle(outcome.result).then(replyForResult);
          return;
        case "menu":
          controller.openMenu(outcome.token, outcome.source);
          return;
        case "reply":
          if (outcome.pulse) store.bumpPulse();
          store.showReply(reasonText(outcome.reason), true);
          return;
        case "none":
          return;
      }
    },

    openMenu(token, source) {
      if (!deps.service()) return;
      const open = store.getState().sheet;
      if (open) return;
      const pausedByUs = pauseIfPlaying();
      store.setSheet({ kind: "menu", token, source, pausedByUs });
    },

    openViewer(target, options = {}) {
      if (!deps.service()) return;
      const snapshot = deps.snapshot();
      if (snapshot.atBreak) {
        openViewerNow(target, false);
        return;
      }
      if (pauseIfPlaying()) {
        openViewerNow(target, true);
        return;
      }
      if (options.deferInRun && target.kind === "clip") {
        store.setPendingOpen(target.id);
        store.showReply(TOAST_COPY.readyAtRunEnd, true);
        return;
      }
      openViewerNow(target, false);
    },

    openSettings() {
      if (!deps.service() || store.getState().sheet) return;
      store.setSheet({ kind: "settings", pausedByUs: pauseIfPlaying() });
    },

    closeSheet(options = {}) {
      const sheet = store.getState().sheet;
      if (!sheet) return;
      store.setSheet(null);
      // Only a Capture menu hands play straight back: the kid picked a quick
      // action. After the viewer or settings the pause menu stays, so the kid
      // resumes when ready.
      const resume = options.resume ?? sheet.kind === "menu";
      if (resume && sheet.pausedByUs) deps.host().resumeGame?.();
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
      controller.openViewer({ kind: "clip", id }, { deferInRun: true });
    },

    flushPendingOpen() {
      const state = store.getState();
      const id = state.pendingOpenId;
      if (!id || state.sheet || !deps.snapshot().atBreak) return;
      openViewerNow({ kind: "clip", id }, false);
    },

    clipLastFromMenu(token) {
      const service = deps.service();
      if (!service) return;
      const result = settle(service.clipLast(DEFAULT_CLIP_SECONDS, token ?? undefined));
      controller.closeSheet();
      void result.then(replyForResult);
    },

    recordFromMenu() {
      const service = deps.service();
      if (!service) return;
      const started = service.startRecording().then(
        (result) => result,
        () => null,
      );
      controller.closeSheet();
      void started.then((result) => {
        if (result && !result.ok) replyForResult(result);
      });
    },

    stopRecordingFromMenu() {
      const service = deps.service();
      if (!service) return;
      const result = settle(service.stopRecording());
      controller.closeSheet();
      void result.then(replyForResult);
    },

    pictureFromMenu() {
      const service = deps.service();
      if (!service) return;
      // Take the picture first: the frame is the one under the menu.
      const result = settle(service.takePicture());
      controller.closeSheet();
      void result.then(replyForResult);
    },

    wakeFromMenu() {
      const service = deps.service();
      if (!service) return;
      service.wake();
      controller.closeSheet();
    },

    watch() {
      const service = deps.service();
      if (!service) return;
      const newest = deps.snapshot().unwatchedClipId;
      if (newest) {
        controller.openViewer({ kind: "clip", id: newest });
        return;
      }
      void settle(service.clipLast(DEFAULT_CLIP_SECONDS)).then(openResultAtBreak);
    },

    wholeRunVideo(seconds) {
      const service = deps.service();
      if (!service) return;
      void settle(service.clipLast(Math.max(1, Math.ceil(seconds)))).then(openResultAtBreak);
    },

    recordFromChip() {
      if (deps.snapshot().recording !== null) return;
      controller.toggleRecord();
    },

    pictureFromChip() {
      const service = deps.service();
      if (!service) return;
      void settle(service.takePicture()).then(openResultAtBreak);
    },

    toggleRecord() {
      const service = deps.service();
      if (!service) return;
      const snapshot = deps.snapshot();
      if (snapshot.recording !== null || snapshot.button === "recording") {
        void settle(service.stopRecording()).then(replyForResult);
        return;
      }
      void service.startRecording().then(
        (result) => {
          if (result && !result.ok) replyForResult(result);
        },
        () => replyForResult(null),
      );
    },

    replyForResult,
  };

  return controller;
}
