"use client";

/**
 * Taps on the clip controls that sit over a running game: the new-clip
 * chip, the star button, the reply's read-aloud button, and the result
 * chip's clip buttons.
 *
 * Rules (the same one-tap rule as shared/lib/input usePointerTap, PR 1.3,
 * which is not on this branch yet):
 * - The action runs when a pointer that went down on the control comes up
 *   on it. A phone sends no click for a second finger while another finger
 *   is down (a kid who holds the gas pedal and taps the star), so the
 *   action must not wait for the click. pointerup is also the event that
 *   gives a touch its user activation, which the voice needs.
 * - The compatibility click after a pointer press is ignored. A click with
 *   no pointer before it (Enter or Space, or a screen reader) runs the
 *   action once.
 * - A pointer press never moves keyboard focus onto the control. A focused
 *   button owns Space and Enter (keyBelongsToTarget), so the game would stop
 *   hearing its jump key. Keyboard focus still works as usual.
 * - Every pointer, touch, mouse and click event stops at the control, so a
 *   game that listens on the window (Hill Climb's touch zones) never sees it.
 */

import { useLayoutEffect, useState } from "react";
import type React from "react";

import { nowMs } from "./platform";
import { COMPAT_CLICK_WINDOW_MS } from "./pressGesture";

/** How the tap came: a pointer (finger, mouse, pen), or a click with no pointer (keyboard). */
export type InPlayTapSource = "pointer" | "keyboard";

export interface InPlayTapHandlers {
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerUp: (event: React.PointerEvent) => void;
  onPointerCancel: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onMouseDown: (event: React.MouseEvent) => void;
  onMouseUp: (event: React.MouseEvent) => void;
  onTouchStart: (event: React.TouchEvent) => void;
  onTouchMove: (event: React.TouchEvent) => void;
  onTouchEnd: (event: React.TouchEvent) => void;
  onTouchCancel: (event: React.TouchEvent) => void;
  onClick: (event: React.MouseEvent) => void;
  onContextMenu: (event: React.MouseEvent) => void;
}

export interface InPlayTap {
  /** Spread these on the control. Their identity never changes. */
  handlers: InPlayTapHandlers;
  /** Replace the action. */
  configure(onTap: (source: InPlayTapSource) => void): void;
}

/**
 * Handlers that keep a pointer press from moving focus and stop every
 * pointer, touch, mouse and click event at the element. For controls that
 * act on their own (the clip button), and for wrappers.
 */
export const NO_FOCUS_NO_LEAK: InPlayTapHandlers = {
  onPointerDown: (event) => event.stopPropagation(),
  onPointerUp: (event) => event.stopPropagation(),
  onPointerCancel: (event) => event.stopPropagation(),
  onPointerMove: (event) => event.stopPropagation(),
  onMouseDown: (event) => {
    event.stopPropagation();
    event.preventDefault();
  },
  onMouseUp: (event) => event.stopPropagation(),
  onTouchStart: (event) => event.stopPropagation(),
  onTouchMove: (event) => event.stopPropagation(),
  onTouchEnd: (event) => event.stopPropagation(),
  onTouchCancel: (event) => event.stopPropagation(),
  onClick: (event) => event.stopPropagation(),
  onContextMenu: (event) => event.stopPropagation(),
};

/** The framework-free core; the hook below wraps it. */
export function createInPlayTap(initial: (source: InPlayTapSource) => void): InPlayTap {
  let onTap = initial;
  let lastPointerAt = Number.NEGATIVE_INFINITY;
  const down = new Set<number>();

  const handlers: InPlayTapHandlers = {
    ...NO_FOCUS_NO_LEAK,
    onPointerDown(event) {
      event.stopPropagation();
      lastPointerAt = nowMs();
      // Right-click and the other mouse buttons are not taps.
      if (event.pointerType === "mouse" && event.button !== 0) return;
      down.add(event.pointerId);
    },
    onPointerUp(event) {
      event.stopPropagation();
      lastPointerAt = nowMs();
      if (!down.delete(event.pointerId)) return;
      onTap("pointer");
    },
    onPointerCancel(event) {
      event.stopPropagation();
      lastPointerAt = nowMs();
      down.delete(event.pointerId);
    },
    onClick(event) {
      event.stopPropagation();
      // The compatibility click for a pointer tap that already acted.
      if (nowMs() - lastPointerAt < COMPAT_CLICK_WINDOW_MS) return;
      onTap("keyboard");
    },
    onContextMenu(event) {
      event.stopPropagation();
      // A long press on a phone must not open the browser's menu over the game.
      event.preventDefault();
    },
  };

  return {
    handlers,
    configure(next) {
      onTap = next;
    },
  };
}

/** React form of createInPlayTap. The newest `onTap` always runs. */
export function useInPlayTap(onTap: (source: InPlayTapSource) => void): InPlayTapHandlers {
  const [tap] = useState(() => createInPlayTap(onTap));
  useLayoutEffect(() => {
    tap.configure(onTap);
  });
  return tap.handlers;
}
