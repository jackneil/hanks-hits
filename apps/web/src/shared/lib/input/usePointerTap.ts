"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import type React from "react";

/**
 * One tap = one action, for finger, mouse, pen and keyboard.
 *
 * Why: some games put BOTH onClick and onTouchStart on a canvas or a
 * button. React attaches touchstart as a passive listener, so
 * preventDefault() in it does nothing, and the browser then fires its
 * compatibility click too. One tap ran the action twice: two turns in
 * Hextris, two bullets in Oregon Trail, a restart AND a new game in
 * Space Invaders.
 *
 * This helper listens to pointer events only. The action runs on
 * pointerdown, which is the fastest signal. The click that the browser
 * sends after a pointer tap is ignored. A click that comes with no pointer
 * before it (Enter or Space on a focused button, or a screen reader) still
 * runs the action once, so keyboard players are not locked out.
 *
 * Hold controls (a gas pedal, a jump that goes higher while held): give
 * `onRelease`. It runs when the LAST finger on the control lets go, or the
 * browser cancels the touch, or the control unmounts while held. The
 * helper also captures the pointer, so a finger that slides off the
 * control still releases it.
 *
 * CSS: give the element `touch-action: manipulation` (Tailwind
 * `touch-manipulation`) for taps, or `touch-action: none` (`touch-none`)
 * for holds and drags. Without it the browser can take the touch for a
 * scroll or a zoom and cancel the press.
 *
 * Usage:
 *   const tap = usePointerTap((e) => rotate(e));
 *   <canvas {...tap} className="touch-manipulation" />
 *
 *   const gas = usePointerTap(() => press("gas"), { onRelease: () => release("gas") });
 *   <button type="button" {...gas} className="touch-none">GAS</button>
 */

/**
 * A click that comes this soon after a pointer event on the same element is
 * the browser's compatibility click for that pointer, not a new tap. It is
 * measured from the pointerup, so a slow press by a small child is covered.
 */
export const COMPAT_CLICK_WINDOW_MS = 1000;

/** The event that started a tap: a pointer, or a click with no pointer (keyboard). */
export type TapEvent<T extends Element = Element> =
  | React.PointerEvent<T>
  | React.MouseEvent<T>;

export interface PointerTapOptions<T extends Element = Element> {
  /**
   * Makes this a hold control. Runs when the last pointer that pressed the
   * element lets go or is cancelled. Gets no event when the element
   * unmounts while held, or after a keyboard press.
   */
  onRelease?: (event?: React.PointerEvent<T>) => void;
  /** False ignores every tap. Default true. */
  enabled?: boolean;
  /**
   * Ignore mouse buttons other than the main one (right-click opens menus).
   * Default true.
   */
  mainButtonOnly?: boolean;
}

export interface PointerTapHandlers<T extends Element = Element> {
  onPointerDown: (event: React.PointerEvent<T>) => void;
  onPointerUp: (event: React.PointerEvent<T>) => void;
  onPointerCancel: (event: React.PointerEvent<T>) => void;
  onLostPointerCapture: (event: React.PointerEvent<T>) => void;
  onClick: (event: React.MouseEvent<T>) => void;
  onContextMenu: (event: React.MouseEvent<T>) => void;
}

type PointerTapConfig<T extends Element> = PointerTapOptions<T> & {
  onTap: (event: TapEvent<T>) => void;
};

export interface PointerTap<T extends Element = Element> {
  /** Spread these on the element. Their identity never changes. */
  handlers: PointerTapHandlers<T>;
  /** Replace the tap action and options. */
  configure(config: PointerTapConfig<T>): void;
  /** Release a hold that is still down (for unmount). */
  releaseAll(): void;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * The framework-free core. The hook below wraps it; code that is not a
 * React component can use it with its own listeners.
 */
export function createPointerTap<T extends Element = Element>(
  initial: PointerTapConfig<T>
): PointerTap<T> {
  let config = initial;
  let lastPointerAt = Number.NEGATIVE_INFINITY;
  const activePointers = new Set<number>();

  const isHold = () => typeof config.onRelease === "function";

  const endPointer = (event: React.PointerEvent<T>) => {
    lastPointerAt = now();
    if (!activePointers.delete(event.pointerId)) return;
    if (activePointers.size === 0) config.onRelease?.(event);
  };

  const handlers: PointerTapHandlers<T> = {
    onPointerDown(event) {
      lastPointerAt = now();
      if (config.enabled === false) return;
      if ((config.mainButtonOnly ?? true) && event.button !== 0) return;

      if (isHold()) {
        activePointers.add(event.pointerId);
        const target = event.currentTarget as Element & {
          setPointerCapture?: (pointerId: number) => void;
        };
        try {
          target.setPointerCapture?.(event.pointerId);
        } catch {
          // The pointer is already gone (a very fast tap). Nothing to hold.
        }
      }
      config.onTap(event);
    },
    onPointerUp: endPointer,
    onPointerCancel: endPointer,
    onLostPointerCapture: endPointer,
    onClick(event) {
      // The compatibility click for a pointer tap we already handled.
      if (now() - lastPointerAt < COMPAT_CLICK_WINDOW_MS) return;
      if (config.enabled === false) return;
      // A click with no pointer: Enter or Space on a focused button, or a
      // screen reader. It is one full tap, so a hold presses and lets go.
      config.onTap(event);
      if (isHold() && activePointers.size === 0) config.onRelease?.();
    },
    onContextMenu(event) {
      // A long press on a hold control must not open the phone's menu:
      // the menu cancels the touch and lets go of the pedal.
      if (isHold()) event.preventDefault();
    },
  };

  return {
    handlers,
    configure(next) {
      config = next;
    },
    releaseAll() {
      if (activePointers.size === 0) return;
      activePointers.clear();
      config.onRelease?.();
    },
  };
}

/**
 * React hook form of createPointerTap. The returned handlers keep the same
 * identity on every render; the newest `onTap` and options always run.
 */
export function usePointerTap<T extends Element = Element>(
  onTap: (event: TapEvent<T>) => void,
  options: PointerTapOptions<T> = {}
): PointerTapHandlers<T> {
  const [tap] = useState(() => createPointerTap<T>({ ...options, onTap }));

  useLayoutEffect(() => {
    tap.configure({ ...options, onTap });
  });

  useEffect(() => () => tap.releaseAll(), [tap]);

  return tap.handlers;
}
