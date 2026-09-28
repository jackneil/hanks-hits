"use client";

import { useLayoutEffect, useState } from "react";

/**
 * A short lockout on restart and "next level" input after the game changes
 * state, so a kid who is still tapping or holding a key at the moment the
 * run ends sees the result card.
 *
 * Why: in many games a tap or Space on the game-over screen restarts at
 * once. A kid who taps to jump at the moment of the crash, or holds Space
 * to fire (the keyboard then repeats the key), skipped the "Game over" and
 * "NEW HIGH SCORE" card without ever seeing it. The result chip and its
 * clip buttons were gone before a finger could reach them.
 *
 * Rules:
 * - A key auto-repeat (KeyboardEvent.repeat) never counts. Only a new
 *   press can restart.
 * - Any input in the first `ms` after a state change is ignored (600 ms by
 *   default).
 *
 * Use it ONLY for restart and advance actions. Never gate normal play with
 * it: the first taps of a new run must always work.
 *
 * Usage in a component:
 *   const grace = useRestartGrace(600, gameState);
 *   // in the tap or key handler, at game over:
 *   if (!grace.accept(event)) return;
 *   restart();
 *
 * Code outside React (a store) can use createRestartGrace directly and call
 * markTransition() in its endGame action.
 */

/** The lockout after a state change, in ms, when not set. */
export const DEFAULT_RESTART_GRACE_MS = 600;

/** Anything that can say whether it is a key auto-repeat. */
export type GraceInput = { repeat?: boolean } | null | undefined;

export interface RestartGrace {
  /**
   * True when this input may restart or advance now. False for a key
   * auto-repeat, and for any input inside the lockout.
   */
  accept(input?: GraceInput): boolean;
  /** Start a new lockout now. */
  markTransition(): void;
  /** True while the lockout runs. */
  isLocked(): boolean;
  /** Change the lockout length. */
  setWindowMs(ms: number): void;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function cleanWindow(ms: number): number {
  return Number.isFinite(ms) && ms >= 0 ? ms : DEFAULT_RESTART_GRACE_MS;
}

/**
 * The framework-free core. A new grace has no lockout until the first
 * markTransition() call.
 */
export function createRestartGrace(ms = DEFAULT_RESTART_GRACE_MS): RestartGrace {
  let windowMs = cleanWindow(ms);
  let transitionAt = Number.NEGATIVE_INFINITY;

  const isLocked = () => now() - transitionAt < windowMs;

  return {
    accept(input) {
      if (input?.repeat === true) return false;
      return !isLocked();
    },
    markTransition() {
      transitionAt = now();
    },
    isLocked,
    setWindowMs(next) {
      windowMs = cleanWindow(next);
    },
  };
}

/**
 * React hook form of createRestartGrace. The lockout starts when the
 * component mounts (a result card that appears at game over needs no more
 * setup) and again every time `phase` changes. The returned object keeps
 * the same identity on every render.
 */
export function useRestartGrace(
  ms = DEFAULT_RESTART_GRACE_MS,
  phase?: unknown
): RestartGrace {
  const [grace] = useState(() => createRestartGrace(ms));

  useLayoutEffect(() => {
    grace.setWindowMs(ms);
  }, [grace, ms]);

  // A layout effect runs in the same commit as the change, before the
  // browser can deliver the next tap or key to the new screen.
  useLayoutEffect(() => {
    grace.markTransition();
  }, [grace, phase]);

  return grace;
}
