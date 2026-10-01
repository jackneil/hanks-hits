"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import type React from "react";

import { createPointerTrail } from "./pointerTrail";
import { COMPAT_CLICK_WINDOW_MS } from "./usePointerTap";

/**
 * A button that also works for a tap by a second finger.
 *
 * Why: a browser makes a click only from a one-finger tap. A kid who holds
 * GAS with one thumb and taps Pause (or Map) with the other thumb gets a
 * pointerdown and a pointerup on the button, but no click, so an onClick
 * button did nothing until the first thumb let go (phone check,
 * 2026-09-30, all four driving games).
 *
 * The click stays the main path: a one-finger tap, a mouse and the
 * keyboard work exactly as before. When a finger lifts on the button and
 * no click follows within SECOND_FINGER_WAIT_MS, the action runs then. A
 * click that comes late after that (a slow phone) is ignored, so one tap
 * never runs the action twice.
 *
 * A finger that slides off the button before it lifts is not a tap. The
 * check reads the finger's last pointermove (createPointerTrail), not the
 * pointerup point: iPhone Safari can send a pointerup at (0, 0).
 *
 * Use it for a button that opens or closes something (Pause, Map, a
 * panel). A click is dispatched at the finger after the action runs, so
 * acting on the press itself could let that click land on the new overlay.
 * For a game action that must happen on the press (NOS, jump, fire), use
 * usePointerTap, which acts on pointerdown for every finger.
 *
 * Usage:
 *   const pause = useSecondFingerClick(() => togglePause());
 *   <button type="button" {...pause}>Pause</button>
 */

/**
 * How long to wait for the browser's own click after a finger lifts. A
 * one-finger tap's click follows the pointerup within a few milliseconds.
 */
export const SECOND_FINGER_WAIT_MS = 250;

export interface SecondFingerClickHandlers<T extends Element = Element> {
  onClick: (event: React.MouseEvent<T>) => void;
  onPointerDown: (event: React.PointerEvent<T>) => void;
  onPointerMove: (event: React.PointerEvent<T>) => void;
  onPointerUp: (event: React.PointerEvent<T>) => void;
  onPointerCancel: (event: React.PointerEvent<T>) => void;
}

export interface SecondFingerClick<T extends Element = Element> {
  /** Spread these on the button. Their identity never changes. */
  handlers: SecondFingerClickHandlers<T>;
  /** Replace the action. */
  configure(onClick: () => void): void;
  /** Drop a wait that is still running (for unmount). */
  dispose(): void;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** The framework-free core. The hook below wraps it. */
export function createSecondFingerClick<T extends Element = Element>(
  initial: () => void
): SecondFingerClick<T> {
  let action = initial;
  /** Touch pointers that went down on the button and are still down. */
  const pressed = new Set<number>();
  /** Where each of those fingers is now (the release point). */
  const trail = createPointerTrail();
  let waiting: ReturnType<typeof setTimeout> | null = null;
  /** When the wait ran the action; a click soon after is the late browser click. */
  let firedAt = Number.NEGATIVE_INFINITY;

  const stopWaiting = () => {
    if (waiting !== null) clearTimeout(waiting);
    waiting = null;
  };

  const handlers: SecondFingerClickHandlers<T> = {
    onClick() {
      if (waiting !== null) {
        // The browser's click for the tap: it runs the action, not the wait.
        stopWaiting();
      } else if (now() - firedAt < COMPAT_CLICK_WINDOW_MS) {
        return;
      }
      action();
    },
    onPointerDown(event) {
      if (event.pointerType !== "touch") return;
      pressed.add(event.pointerId);
      trail.down(event);
    },
    onPointerMove(event) {
      // The browser captures a touch to the button it went down on, so the
      // button gets every move of that finger.
      if (pressed.has(event.pointerId)) trail.move(event);
    },
    onPointerUp(event) {
      if (event.pointerType !== "touch" || !pressed.delete(event.pointerId)) return;
      // A finger that slid off the button before it lifted is not a tap.
      // The point comes from the finger's moves, never from the pointerup.
      const at = trail.release(event);
      const box = (event.currentTarget as Element).getBoundingClientRect();
      const inside = at.x >= box.left && at.x <= box.right && at.y >= box.top && at.y <= box.bottom;
      if (!inside) return;
      stopWaiting();
      waiting = setTimeout(() => {
        waiting = null;
        firedAt = now();
        action();
      }, SECOND_FINGER_WAIT_MS);
    },
    onPointerCancel(event) {
      pressed.delete(event.pointerId);
      trail.forget(event.pointerId);
    },
  };

  return {
    handlers,
    configure(next) {
      action = next;
    },
    dispose() {
      stopWaiting();
      for (const pointerId of pressed) trail.forget(pointerId);
      pressed.clear();
    },
  };
}

/**
 * React hook form of createSecondFingerClick. The returned handlers keep the
 * same identity on every render; the newest action always runs.
 */
export function useSecondFingerClick<T extends Element = Element>(
  onClick: () => void
): SecondFingerClickHandlers<T> {
  const [click] = useState(() => createSecondFingerClick<T>(onClick));

  useLayoutEffect(() => {
    click.configure(onClick);
  });

  useEffect(() => () => click.dispose(), [click]);

  return click.handlers;
}
