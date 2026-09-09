"use client";

/**
 * The one line of news the game tells the player.
 *
 * A new day, a flip that put the rider back on the wheels, and later the
 * things a store or a stand says. It sits low in the middle of the screen,
 * above the pedals so a thumb never covers it, and it goes away by itself.
 *
 * A screen reader announces it politely, so a kid using one hears the same
 * news everyone else reads.
 */

import { useEffect } from "react";

import { useFourWheeler3dStore } from "../../lib/store";
import { TOUCH_LAYOUT, EDGE, GAP } from "../../lib/hudLayout";

/**
 * How long a hint stays up, in milliseconds.
 *
 * The 2D game used 1.4 seconds. A kid who is still learning to read needs
 * longer than a grown-up to get through one line, so this one waits 2.5.
 */
export const HINT_SECONDS = 2.5;

/**
 * How high the toast sits on a phone.
 *
 * Clear of the JUMP and HORN row, which is the tallest thing along the bottom
 * of a touch screen. The number comes from the shared layout, so moving a
 * button moves the toast with it.
 */
const TOUCH_BOTTOM = TOUCH_LAYOUT.jump.bottom + TOUCH_LAYOUT.jump.height + GAP;

/** How high it sits with a mouse, where the bottom of the screen is free. */
const MOUSE_BOTTOM = 88;

export type HintToastProps = {
  /** True on a touch screen, where the toast has to clear the controls. */
  raised?: boolean;
};

export function HintToast({ raised = false }: HintToastProps) {
  const hint = useFourWheeler3dStore((state) => state.hint);
  const setHint = useFourWheeler3dStore((state) => state.setHint);

  // Each new hint starts the clock again, so two in a row are both readable.
  useEffect(() => {
    if (!hint) return;
    const timer = window.setTimeout(() => setHint(null), HINT_SECONDS * 1000);
    return () => window.clearTimeout(timer);
  }, [hint, setHint]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fw-hint-toast pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4"
      style={{
        bottom: `${raised ? TOUCH_BOTTOM + EDGE + 100 : MOUSE_BOTTOM}px`,
      }}
    >
      {hint && (
        <p className="max-w-md rounded-full bg-slate-900/85 px-5 py-2 text-center text-sm font-medium text-white shadow-md">
          {hint}
        </p>
      )}
    </div>
  );
}

export default HintToast;
