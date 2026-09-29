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
 * - The events of a press that started on the control stop there, so a game
 *   that listens on the window (Hill Climb's touch zones) never sees them. A
 *   press that started on the game and moves over or ends on the control
 *   still reaches the game (shared/lib/input/pressOwnership.ts): a kid who
 *   holds thrust and lifts the finger over the chip does not get a stuck
 *   thrust.
 * - A press that leaves the control before it comes up is not a tap, and
 *   it is forgotten: a later release on the control from a press that began
 *   somewhere else never acts.
 */

import { useLayoutEffect, useState } from "react";
import type React from "react";

import { createPressOwnership } from "@/shared/lib/input/pressOwnership";

import { nowMs } from "./platform";
import { COMPAT_CLICK_WINDOW_MS } from "./pressGesture";

/** How the tap came: a pointer (finger, mouse, pen), or a click with no pointer (keyboard). */
export type InPlayTapSource = "pointer" | "keyboard";

export interface InPlayTapHandlers {
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerUp: (event: React.PointerEvent) => void;
  onPointerCancel: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerLeave: (event: React.PointerEvent) => void;
  onLostPointerCapture: (event: React.PointerEvent) => void;
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
 * Handlers that keep a pointer press from moving focus and keep the events
 * of a press that started on the element from the game. For wrappers (the
 * hold tip). Each element needs its own set: they remember its presses.
 */
export function createNoFocusNoLeak(): InPlayTapHandlers {
  const owned = createPressOwnership();
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  return {
    onPointerDown(event) {
      event.stopPropagation();
      owned.down(event.pointerId);
    },
    onPointerUp(event) {
      if (owned.end(event.pointerId)) event.stopPropagation();
    },
    onPointerCancel(event) {
      if (owned.end(event.pointerId)) event.stopPropagation();
    },
    onPointerMove(event) {
      if (owned.owns(event.pointerId)) event.stopPropagation();
    },
    onPointerLeave(event) {
      owned.leave(event.pointerId, event.pointerType);
    },
    onLostPointerCapture(event) {
      owned.end(event.pointerId);
    },
    onMouseDown(event) {
      event.stopPropagation();
      owned.mouseDown();
      event.preventDefault();
    },
    onMouseUp(event) {
      if (owned.mouseUp()) event.stopPropagation();
    },
    // A touch event always goes to the element where the touch started.
    onTouchStart: stop,
    onTouchMove: stop,
    onTouchEnd: stop,
    onTouchCancel: stop,
    onClick: stop,
    onContextMenu: stop,
  };
}

/** React form of createNoFocusNoLeak: one set for the life of the element. */
export function useNoFocusNoLeak(): InPlayTapHandlers {
  const [handlers] = useState(createNoFocusNoLeak);
  return handlers;
}

/** The framework-free core; the hook below wraps it. */
export function createInPlayTap(initial: (source: InPlayTapSource) => void): InPlayTap {
  let onTap = initial;
  let lastPointerAt = Number.NEGATIVE_INFINITY;
  const owned = createPressOwnership();
  /** Presses that can still end in a tap: a left press that has not left the control. */
  const armed = new Set<number>();

  const handlers: InPlayTapHandlers = {
    ...createNoFocusNoLeak(),
    onPointerDown(event) {
      event.stopPropagation();
      owned.down(event.pointerId);
      lastPointerAt = nowMs();
      // Right-click and the other mouse buttons are not taps.
      if (event.pointerType === "mouse" && event.button !== 0) return;
      armed.add(event.pointerId);
    },
    onPointerUp(event) {
      // A press that started on the game: its release belongs to the game.
      if (!owned.end(event.pointerId)) return;
      event.stopPropagation();
      lastPointerAt = nowMs();
      if (!armed.delete(event.pointerId)) return;
      onTap("pointer");
    },
    onPointerCancel(event) {
      armed.delete(event.pointerId);
      if (!owned.end(event.pointerId)) return;
      event.stopPropagation();
      lastPointerAt = nowMs();
    },
    onPointerMove(event) {
      if (owned.owns(event.pointerId)) event.stopPropagation();
    },
    onPointerLeave(event) {
      // The press ends off the control: no tap, and its release is not ours.
      armed.delete(event.pointerId);
      owned.leave(event.pointerId, event.pointerType);
    },
    onLostPointerCapture(event) {
      armed.delete(event.pointerId);
      owned.end(event.pointerId);
    },
    onMouseDown(event) {
      event.stopPropagation();
      owned.mouseDown();
      event.preventDefault();
    },
    onMouseUp(event) {
      if (owned.mouseUp()) event.stopPropagation();
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
