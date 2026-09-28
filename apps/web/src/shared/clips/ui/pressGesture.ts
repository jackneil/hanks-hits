/**
 * The press state machine of the clip button (plan 11.1).
 *
 * It is framework-free, so the tests drive it with fake timers, and the
 * pointer, keyboard and gamepad paths all use the same rules:
 *
 * - On the press (pointerdown), call service.beginPress(). The service
 *   freezes the ring bounds, so a slow press by a 6-year-old still clips
 *   the moment they meant.
 * - On the release before HOLD_FOR_MENU_MS, call service.endPress() and
 *   act on its outcome (clip, extend, menu, or ignored with a reason).
 * - A hold of HOLD_FOR_MENU_MS without movement ends the press at that
 *   moment: endPress() gets the real time, the service answers "menu",
 *   and the Capture menu opens while the finger is still down. The later
 *   release does nothing. Nothing is committed.
 * - While a video records, the button is the stop control: the release
 *   stops the video. There is no hold.
 * - Each press acts once. A second finger, and the compatibility click
 *   that the browser sends after a pointer press, do nothing (the same
 *   rule as shared/lib/input usePointerTap, PR 1.3).
 */

import {
  DEFAULT_CLIP_SECONDS,
  HOLD_FOR_MENU_MS,
  type ClipActionResult,
  type ClipReasonCode,
  type ClipServiceApi,
  type ClipSnapshot,
  type PressOutcome,
  type PressToken,
} from "../service/contract";
import { nowMs } from "./platform";

/**
 * A pointer that moves farther than this from where it went down is a
 * drag, not a hold. Small fingers wobble, so it is larger than the usual
 * 8-10 px.
 */
export const PRESS_SLOP_PX = 16;

/**
 * A click this soon after a pointer event is the browser's compatibility
 * click for that pointer, not a new tap (the same window as usePointerTap).
 */
export const COMPAT_CLICK_WINDOW_MS = 1000;

/** Where a press came from. The UI uses it for the hold tip and the menu. */
export type TapSource = "pointer" | "keyboard" | "gamepad";

/** What the UI must do after a press. */
export type TapOutcome =
  | { kind: "commit"; action: "clip" | "extend"; result: Promise<ClipActionResult>; source: TapSource }
  | { kind: "stop"; result: Promise<ClipActionResult>; source: TapSource }
  | { kind: "menu"; token: PressToken | null; source: TapSource }
  | { kind: "reply"; reason: ClipReasonCode; pulse: boolean; source: TapSource }
  | { kind: "none"; source: TapSource };

export interface ClipPressDeps {
  service: () => ClipServiceApi | null;
  snapshot: () => ClipSnapshot;
  onOutcome: (outcome: TapOutcome) => void;
  now?: () => number;
  holdMs?: number;
}

export interface PressOptions {
  /** False: a long hold does not open the menu (gamepad Back button). Default true. */
  holdToMenu?: boolean;
}

export interface ClipPress {
  /** A press starts. Returns false when nothing started (hidden, or a press is already down). */
  down(key: string, x: number, y: number, source: TapSource, options?: PressOptions): boolean;
  /** The pointer moved. Past PRESS_SLOP_PX the hold no longer opens the menu. */
  move(key: string, x: number, y: number): void;
  /** The press ends normally (pointerup, button released). */
  up(key: string): void;
  /** The press ends without a tap (pointercancel, lost capture). */
  cancel(key: string): void;
  /** End a held press as a deliberate clip, however long it was held (gamepad Back hold). */
  commitHeld(key: string): void;
  /** A press and a release at once (Enter or Space, a screen reader, a hotkey). */
  tap(source: TapSource): void;
  /** Open the Capture menu without a hold (right-click, the menu key). */
  openMenu(source: TapSource): void;
  /** True while a press is down. */
  isActive(): boolean;
  /** Release a press that is still down, with no outcome (unmount). */
  dispose(): void;
}

type PressMode = "press" | "stop" | "state";

interface ActivePress {
  key: string;
  source: TapSource;
  x: number;
  y: number;
  token: PressToken | null;
  /** When the press began, on this module's clock. */
  downAt: number;
  moved: boolean;
  mode: PressMode;
  timer: ReturnType<typeof setTimeout> | null;
}

/** The outcome of a tap when the service gave no press token: decided by the button state. */
export function outcomeForState(snapshot: ClipSnapshot, source: TapSource): TapOutcome {
  switch (snapshot.button) {
    case "warming":
    case "source-lost":
    case "recovering":
      return { kind: "reply", reason: "warming", pulse: true, source };
    case "resting":
    case "record-only":
      return { kind: "menu", token: null, source };
    case "disabled":
      return { kind: "reply", reason: "breaker", pulse: false, source };
    case "error":
      return { kind: "reply", reason: snapshot.reason ?? "encoder-error", pulse: false, source };
    case "ready":
    case "made":
    case "suspended":
      return snapshot.reason ? { kind: "reply", reason: snapshot.reason, pulse: false, source } : { kind: "none", source };
    case "saving":
    case "exporting":
    case "recording":
    case "hidden":
      return { kind: "none", source };
  }
}

/** Turn the service's PressOutcome into what the UI does. */
export function outcomeForPress(outcome: PressOutcome, token: PressToken, source: TapSource): TapOutcome {
  switch (outcome.kind) {
    case "clip":
    case "extend":
      return { kind: "commit", action: outcome.kind, result: outcome.result, source };
    case "menu":
      return { kind: "menu", token, source };
    case "ignored":
      switch (outcome.reason) {
        case "busy":
          return { kind: "none", source };
        case "resting":
        case "record-only":
          return { kind: "menu", token, source };
        case "warming":
        case "source-lost":
          return { kind: "reply", reason: "warming", pulse: true, source };
        default:
          return { kind: "reply", reason: outcome.reason, pulse: false, source };
      }
  }
}

export function createClipPress(deps: ClipPressDeps): ClipPress {
  const now = deps.now ?? nowMs;
  const holdMs = deps.holdMs ?? HOLD_FOR_MENU_MS;
  let active: ActivePress | null = null;

  /**
   * The release time for endPress, on the service's clock. The contract
   * does not name the clock of PressToken.downAtMs, so the press length is
   * measured here and added to downAtMs: the hold rule then works on any
   * clock.
   */
  const upAtFor = (token: PressToken, press: ActivePress): number => token.downAtMs + Math.max(0, now() - press.downAt);

  const clearTimer = (press: ActivePress) => {
    if (press.timer !== null) {
      clearTimeout(press.timer);
      press.timer = null;
    }
  };

  /**
   * End the active press. `emit` false releases the token with no outcome.
   * `hold` true means the hold threshold ended it.
   */
  const finish = (press: ActivePress, how: { cancelled: boolean; hold: boolean; emit: boolean }) => {
    clearTimer(press);
    if (active === press) active = null;
    const service = deps.service();
    const emit = (outcome: TapOutcome) => {
      if (how.emit) deps.onOutcome(outcome);
    };

    if (press.mode === "press") {
      if (!service || !press.token) return;
      const outcome = service.endPress(press.token, {
        upAtMs: upAtFor(press.token, press),
        moved: press.moved,
        ...(how.cancelled ? { cancelled: true } : {}),
      });
      emit(outcomeForPress(outcome, press.token, press.source));
      return;
    }

    if (how.cancelled) {
      emit({ kind: "none", source: press.source });
      return;
    }

    if (press.mode === "stop") {
      if (!service) return;
      emit({ kind: "stop", result: service.stopRecording(), source: press.source });
      return;
    }

    // "state": the service gave no token. A hold still opens the menu.
    if (how.hold) {
      emit({ kind: "menu", token: null, source: press.source });
      return;
    }
    emit(outcomeForState(deps.snapshot(), press.source));
  };

  const findActive = (key: string): ActivePress | null => (active && active.key === key ? active : null);

  const press: ClipPress = {
    down(key, x, y, source, options = {}) {
      if (active) return false;
      const service = deps.service();
      const snapshot = deps.snapshot();
      if (!service || snapshot.button === "hidden") return false;

      if (snapshot.button === "recording") {
        active = { key, source, x, y, token: null, downAt: now(), moved: false, mode: "stop", timer: null };
        return true;
      }

      const token = service.beginPress();
      const started: ActivePress = {
        key,
        source,
        x,
        y,
        token,
        downAt: now(),
        moved: false,
        mode: token ? "press" : "state",
        timer: null,
      };
      active = started;
      if (options.holdToMenu !== false) {
        started.timer = setTimeout(() => {
          started.timer = null;
          if (active !== started || started.moved) return;
          finish(started, { cancelled: false, hold: true, emit: true });
        }, holdMs);
      }
      return true;
    },

    move(key, x, y) {
      const current = findActive(key);
      if (!current || current.moved) return;
      if (Math.hypot(x - current.x, y - current.y) > PRESS_SLOP_PX) {
        current.moved = true;
        clearTimer(current);
      }
    },

    up(key) {
      const current = findActive(key);
      if (current) finish(current, { cancelled: false, hold: false, emit: true });
    },

    cancel(key) {
      const current = findActive(key);
      if (current) finish(current, { cancelled: true, hold: false, emit: true });
    },

    commitHeld(key) {
      const current = findActive(key);
      if (!current) return;
      const service = deps.service();
      if (current.mode !== "press" || !service || !current.token) {
        finish(current, { cancelled: false, hold: false, emit: true });
        return;
      }
      // Release the press without a commit, then clip up to the frozen end.
      clearTimer(current);
      active = null;
      const token = current.token;
      service.endPress(token, { upAtMs: upAtFor(token, current), moved: false, cancelled: true });
      deps.onOutcome({
        kind: "commit",
        action: "clip",
        result: service.clipLast(DEFAULT_CLIP_SECONDS, token),
        source: current.source,
      });
    },

    tap(source) {
      if (active) return;
      const key = `tap:${source}`;
      if (!press.down(key, 0, 0, source, { holdToMenu: false })) return;
      press.up(key);
    },

    openMenu(source) {
      if (active) return;
      const service = deps.service();
      const snapshot = deps.snapshot();
      if (!service || snapshot.button === "hidden") return;
      if (snapshot.button === "recording") {
        deps.onOutcome({ kind: "menu", token: null, source });
        return;
      }
      const token = service.beginPress();
      if (token) service.endPress(token, { upAtMs: token.downAtMs, moved: false, cancelled: true });
      deps.onOutcome({ kind: "menu", token, source });
    },

    isActive() {
      return active !== null;
    },

    dispose() {
      if (active) finish(active, { cancelled: true, hold: false, emit: false });
    },
  };

  return press;
}

/**
 * A ClipPress that forwards to whatever press `get` returns (or does
 * nothing while it returns null). React parts create the real press in an
 * effect and hand this proxy to listeners.
 */
export function forwardPress(get: () => ClipPress | null): ClipPress {
  return {
    down: (key, x, y, source, options) => get()?.down(key, x, y, source, options) ?? false,
    move: (key, x, y) => get()?.move(key, x, y),
    up: (key) => get()?.up(key),
    cancel: (key) => get()?.cancel(key),
    commitHeld: (key) => get()?.commitHeld(key),
    tap: (source) => get()?.tap(source),
    openMenu: (source) => get()?.openMenu(source),
    isActive: () => get()?.isActive() ?? false,
    dispose: () => get()?.dispose(),
  };
}
