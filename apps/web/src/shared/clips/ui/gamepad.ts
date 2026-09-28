/**
 * Game controller clips (plan 11.2).
 *
 * - Switch Pro and Xbox Series controllers have a Share or Capture button.
 *   The standard mapping puts it at buttons[17]. A press clips, however
 *   long it is held (a press within 5 s of a clip extends it). A
 *   controller never opens the Capture menu: nothing in the menu can be
 *   reached or closed with a controller.
 * - Every other controller with the standard mapping: hold the Back/View
 *   button (buttons[8]) for BACK_HOLD_MS to clip. A shorter press stays the
 *   game's own button.
 * - Never in Retro Arcade: the emulator owns every controller button.
 * - Never while a clip sheet is open (`enabled` says no): the press would
 *   make a clip behind the sheet. A button that is still down when the
 *   sheet closes does nothing until it is let go.
 *
 * The poller reads navigator.getGamepads() once per animation frame, and
 * ONLY while a controller is connected. It stops when the last one goes.
 */

import type { ClipPress } from "./pressGesture";

export const SHARE_BUTTON_INDEX = 17;
export const BACK_BUTTON_INDEX = 8;
export const BACK_HOLD_MS = 1000;

/** Modules whose game owns every controller button (plan 11.2). */
export const NO_GAMEPAD_CLIP_APPS: ReadonlySet<string> = new Set(["retro-arcade"]);

/**
 * Controllers whose Share or Capture button Chromium maps to buttons[17]
 * (vendor and product ids, lower-case hex).
 */
const SHARE_BUTTON_PADS: ReadonlyArray<{ vendor: string; product: string }> = [
  { vendor: "057e", product: "2009" }, // Nintendo Switch Pro Controller: Capture
  { vendor: "045e", product: "0b12" }, // Xbox Series X|S controller, USB: Share
  { vendor: "045e", product: "0b13" }, // Xbox Series X|S controller, Bluetooth: Share
];

/**
 * The vendor and product ids in a Gamepad.id, or null.
 * Chromium: "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)".
 * Firefox: "45e-b13-Xbox Wireless Controller".
 */
export function parseVendorProduct(id: string): { vendor: string; product: string } | null {
  const match =
    /vendor:\s*([0-9a-f]{1,4})\s+product:\s*([0-9a-f]{1,4})/i.exec(id) ?? /^([0-9a-f]{1,4})-([0-9a-f]{1,4})-/i.exec(id);
  if (!match) return null;
  return { vendor: match[1].toLowerCase().padStart(4, "0"), product: match[2].toLowerCase().padStart(4, "0") };
}

export interface PadLike {
  id: string;
  index: number;
  connected: boolean;
  mapping: string;
  buttons: ReadonlyArray<{ pressed: boolean }>;
}

export type PadClipButton = { index: number; kind: "share" | "back-hold" };

/** Which button clips on this controller, or null. */
export function clipButtonFor(pad: PadLike): PadClipButton | null {
  const ids = parseVendorProduct(pad.id);
  const hasShareButton = ids
    ? SHARE_BUTTON_PADS.some((known) => known.vendor === ids.vendor && known.product === ids.product)
    : false;
  if (hasShareButton && pad.buttons.length > SHARE_BUTTON_INDEX) {
    return { index: SHARE_BUTTON_INDEX, kind: "share" };
  }
  if (pad.mapping === "standard" && pad.buttons.length > BACK_BUTTON_INDEX) {
    return { index: BACK_BUTTON_INDEX, kind: "back-hold" };
  }
  return null;
}

export interface GamepadPollerDeps {
  press: ClipPress;
  /** False while controller presses must do nothing (a clip sheet is open). Default: always true. */
  enabled?: () => boolean;
  getGamepads: () => ReadonlyArray<PadLike | null>;
  now: () => number;
  requestFrame: (callback: () => void) => number;
  cancelFrame: (handle: number) => void;
}

export interface GamepadPoller {
  /** Start polling if a controller is connected (safe to call again). */
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

interface HeldButton {
  kind: PadClipButton["kind"];
  since: number;
  /** A press is down in the press machine. False for a button that was blocked. */
  started: boolean;
  committed: boolean;
}

export function createGamepadPoller(deps: GamepadPollerDeps): GamepadPoller {
  const held = new Map<number, HeldButton>();
  let frame: number | null = null;

  const keyFor = (index: number) => `pad:${index}`;

  const release = (index: number, state: HeldButton) => {
    held.delete(index);
    if (!state.started) return;
    if (state.kind === "share") deps.press.up(keyFor(index));
    else if (!state.committed) deps.press.cancel(keyFor(index));
  };

  const tick = () => {
    frame = null;
    const pads = deps.getGamepads().filter((pad): pad is PadLike => !!pad && pad.connected);
    const seen = new Set<number>();
    const now = deps.now();
    const enabled = deps.enabled ? deps.enabled() : true;

    for (const pad of pads) {
      seen.add(pad.index);
      const button = clipButtonFor(pad);
      const pressed = button ? pad.buttons[button.index]?.pressed === true : false;
      const state = held.get(pad.index);

      if (!enabled && state?.started) {
        // A sheet opened while the button was down: end the press with no clip.
        state.started = false;
        if (!state.committed) deps.press.cancel(keyFor(pad.index));
      }

      if (pressed && button && !state) {
        // A blocked button is remembered, so it does not act when the sheet closes.
        const started = enabled && deps.press.down(keyFor(pad.index), 0, 0, "gamepad", { holdToMenu: false });
        held.set(pad.index, { kind: button.kind, since: now, started, committed: false });
      } else if (pressed && state) {
        if (state.kind === "back-hold" && state.started && !state.committed && now - state.since >= BACK_HOLD_MS) {
          state.committed = true;
          deps.press.commitHeld(keyFor(pad.index));
        }
      } else if (!pressed && state) {
        release(pad.index, state);
      }
    }

    // A controller that went away while its button was down.
    for (const [index, state] of Array.from(held.entries())) {
      if (!seen.has(index)) {
        held.delete(index);
        if (state.started) deps.press.cancel(keyFor(index));
      }
    }

    if (pads.length > 0) frame = deps.requestFrame(tick);
  };

  return {
    start() {
      if (frame !== null) return;
      const any = deps.getGamepads().some((pad) => !!pad && pad.connected);
      if (any) frame = deps.requestFrame(tick);
    },
    stop() {
      if (frame !== null) deps.cancelFrame(frame);
      frame = null;
      for (const [index, state] of Array.from(held.entries())) {
        held.delete(index);
        if (state.started) deps.press.cancel(keyFor(index));
      }
    },
    isRunning: () => frame !== null,
  };
}
