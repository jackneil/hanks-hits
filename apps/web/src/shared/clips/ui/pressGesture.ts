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
 *   moment: endPress() gets a press length of at least HOLD_FOR_MENU_MS
 *   (a timer can fire a little early, and browsers blur the clock), the
 *   service answers "menu", and the Capture menu opens while the finger is
 *   still down. The later release does nothing. Nothing is committed.
 * - A press that must never open the menu (a game controller) reports a
 *   length under HOLD_FOR_MENU_MS, so however long it is held, it is a tap.
 * - Drag off to cancel (like a native iOS button): a pointer press that is
 *   released more than RELEASE_SLOP_PX outside the button commits nothing.
 *   The button sends it as a cancel (releasedOff). The release point is
 *   the last pointermove of the press (shared/lib/input/pointerTrail.ts),
 *   never the pointerup's own point. A release within that
 *   distance of the button still clips, also after a move past
 *   PRESS_SLOP_PX (the move only stops the hold from opening the menu).
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
  type ClipButtonState,
  type ClipReasonCode,
  type ClipServiceApi,
  type ClipSnapshot,
  type PressOutcome,
  type PressToken,
} from "../service/contract";
import { isClipReasonCode } from "./copy";
import { nowMs } from "./platform";

/**
 * A pointer that moves farther than this from where it went down is a
 * drag, not a hold. Small fingers wobble, so it is larger than the usual
 * 8-10 px.
 */
export const PRESS_SLOP_PX = 16;

/**
 * A pointer press that is released more than this many pixels outside the
 * button's rectangle commits nothing, like a native iOS button: a kid who
 * slides the finger away changed their mind. A release inside the button,
 * or within this distance of its edges, still clips (small fingers slide).
 */
export const RELEASE_SLOP_PX = 48;

/** The edges of an element on screen (DOMRect has them). */
export interface EdgeRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * True when a release at (x, y) is more than `slop` pixels outside `rect`
 * on either axis: the press must end as a cancel, with no clip.
 */
export function releasedOff(rect: EdgeRect, x: number, y: number, slop: number = RELEASE_SLOP_PX): boolean {
  const outsideX = Math.max(rect.left - x, x - rect.right, 0);
  const outsideY = Math.max(rect.top - y, y - rect.bottom, 0);
  return outsideX > slop || outsideY > slop;
}

/**
 * A click this soon after a pointer event is the browser's compatibility
 * click for that pointer, not a new tap (the same window as usePointerTap).
 */
export const COMPAT_CLICK_WINDOW_MS = 1000;

/** Where a press came from. The UI uses it for the hold tip and the menu. */
export type TapSource = "pointer" | "keyboard" | "gamepad";

/**
 * What the UI must do after a press. A "menu" outcome says whether the
 * press was a hold: in a run that cannot pause, a hold still clips the
 * moment (the menu would cover the game), and any other menu request waits
 * for the end of the run (uiStore.ts).
 */
export type TapOutcome =
  | { kind: "commit"; action: "clip" | "extend"; result: Promise<ClipActionResult>; source: TapSource }
  | { kind: "stop"; result: Promise<ClipActionResult>; source: TapSource }
  | { kind: "menu"; token: PressToken | null; source: TapSource; hold: boolean }
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
  /**
   * False: a hold never opens the menu, however long (a game controller,
   * and one-shot taps). The release is a tap. Default true.
   */
  holdToMenu?: boolean;
}

export interface ClipPress {
  /** A press starts. Returns false when nothing started (hidden, or a press is already down). */
  down(key: string, x: number, y: number, source: TapSource, options?: PressOptions): boolean;
  /** The pointer moved. Past PRESS_SLOP_PX the hold no longer opens the menu. */
  move(key: string, x: number, y: number): void;
  /** The press ends normally (pointerup, button released). */
  up(key: string): void;
  /** The press ends without a tap (pointercancel, lost capture, a release dragged off the button). */
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
  holdToMenu: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * States that clip what the ring holds when the service gave no press
 * token: Ready and Made clip now, and Suspended clips the footage from
 * before the pause (plan 11.3).
 */
const CLIP_WITHOUT_TOKEN: ReadonlySet<ClipButtonState> = new Set(["ready", "made", "suspended"]);

/**
 * The outcome of a tap when the service gave no press token: decided by the
 * button state. `clipNow` makes the clip for Ready, Made and Suspended
 * (service.clipLast); without it those states do nothing.
 */
export function outcomeForState(
  snapshot: ClipSnapshot,
  source: TapSource,
  clipNow?: () => Promise<ClipActionResult>,
): TapOutcome {
  switch (snapshot.button) {
    case "warming":
    case "source-lost":
    case "recovering":
      return { kind: "reply", reason: "warming", pulse: true, source };
    case "resting":
    case "record-only":
      return { kind: "menu", token: null, source, hold: false };
    case "disabled":
      return { kind: "reply", reason: "breaker", pulse: false, source };
    case "error":
      return { kind: "reply", reason: snapshot.reason ?? "encoder-error", pulse: false, source };
    case "ready":
    case "made":
    case "suspended":
      return clipNow ? { kind: "commit", action: "clip", result: clipNow(), source } : { kind: "none", source };
    case "saving":
    case "exporting":
    case "recording":
    case "hidden":
      return { kind: "none", source };
  }
}

/**
 * Turn the service's PressOutcome into what the UI does. `hold` is true when
 * the press ended as a hold. An ignored press whose code is not a reason
 * ("busy", or "cancelled" from a newer service) does nothing.
 */
export function outcomeForPress(outcome: PressOutcome, token: PressToken, source: TapSource, hold = false): TapOutcome {
  switch (outcome.kind) {
    case "clip":
    case "extend":
      return { kind: "commit", action: outcome.kind, result: outcome.result, source };
    case "menu":
      return { kind: "menu", token, source, hold };
    case "ignored": {
      const code: string = outcome.reason;
      if (!isClipReasonCode(code)) return { kind: "none", source };
      switch (code) {
        case "resting":
        case "record-only":
          return { kind: "menu", token, source, hold };
        case "warming":
        case "source-lost":
          return { kind: "reply", reason: "warming", pulse: true, source };
        default:
          return { kind: "reply", reason: code, pulse: false, source };
      }
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
   * - A press that the hold timer ended reports at least HOLD_FOR_MENU_MS.
   *   The timer can fire a little early and the clock is coarse (a measured
   *   499.9 ms), and the service must not commit a clip while the finger is
   *   still down.
   * - A press that must never open the menu reports less than
   *   HOLD_FOR_MENU_MS, so the service treats it as a tap.
   */
  const upAtFor = (token: PressToken, press: ActivePress, hold: boolean): number => {
    const held = Math.max(0, now() - press.downAt);
    if (hold) return token.downAtMs + Math.max(HOLD_FOR_MENU_MS, held);
    if (!press.holdToMenu) return token.downAtMs + Math.min(held, HOLD_FOR_MENU_MS - 1);
    return token.downAtMs + held;
  };

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
        upAtMs: upAtFor(press.token, press, how.hold),
        moved: press.moved,
        ...(how.cancelled ? { cancelled: true } : {}),
      });
      emit(outcomeForPress(outcome, press.token, press.source, how.hold));
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
      emit({ kind: "menu", token: null, source: press.source, hold: true });
      return;
    }
    const snapshot = deps.snapshot();
    const clipNow =
      service && CLIP_WITHOUT_TOKEN.has(snapshot.button) ? () => service.clipLast(DEFAULT_CLIP_SECONDS) : undefined;
    emit(outcomeForState(snapshot, press.source, clipNow));
  };

  const findActive = (key: string): ActivePress | null => (active && active.key === key ? active : null);

  const press: ClipPress = {
    down(key, x, y, source, options = {}) {
      if (active) return false;
      const service = deps.service();
      const snapshot = deps.snapshot();
      if (!service || snapshot.button === "hidden") return false;

      const holdToMenu = options.holdToMenu !== false;
      if (snapshot.button === "recording") {
        active = { key, source, x, y, token: null, downAt: now(), moved: false, mode: "stop", holdToMenu: false, timer: null };
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
        holdToMenu,
        timer: null,
      };
      active = started;
      if (holdToMenu) {
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
      service.endPress(token, { upAtMs: upAtFor(token, current, false), moved: false, cancelled: true });
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
        deps.onOutcome({ kind: "menu", token: null, source, hold: false });
        return;
      }
      const token = service.beginPress();
      if (token) service.endPress(token, { upAtMs: token.downAtMs, moved: false, cancelled: true });
      deps.onOutcome({ kind: "menu", token, source, hold: false });
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
