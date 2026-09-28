"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * One shared game loop for canvas games: a fixed simulation step, with
 * smooth drawing at any screen refresh rate.
 *
 * Why: many games put their requestAnimationFrame loop in a React effect
 * whose dependencies change on every store update. React then tears the
 * loop down and builds it again on every frame. That lost timers, made
 * some games update on every other frame only (half speed and judder),
 * made others run twice as fast on 120 Hz screens, and killed held-key
 * movement. This hook starts ONE frame chain per mount. It keeps the
 * callbacks in refs, so new callbacks on each render never restart it.
 *
 * How the time works:
 * - The simulation moves in fixed steps of game time (`fixedStepMs`,
 *   1000/60 ms by default, so 60 steps each second). `update(stepMs)` runs
 *   once for each step.
 * - Each frame adds the real time since the last frame to an accumulator,
 *   multiplied by `timeScale`. The loop then runs as many whole steps as
 *   the accumulator holds. So the game runs at the same speed on a 60, 90,
 *   120 or 144 Hz screen.
 * - `render(alpha)` runs once each frame after the steps. `alpha` is the
 *   part of the next step that has already passed (0 or more, less than 1).
 *   Use it to draw positions between the last two steps.
 * - The frame time is clamped to `maxDtMs` (50 ms). A long frame, a stall
 *   or a debugger pause never makes a burst of steps.
 * - When `update` throws, the loop drops the steps that were still due in
 *   that frame. The next frame is already requested, so the game keeps
 *   running, and the dropped steps never come back as a burst.
 * - `paused` stops the steps but keeps `render` running, so the picture
 *   stays on screen. When the game resumes, the first frame only restarts
 *   the clock. The loop never "catches up" the paused time.
 * - When the page comes back from a hidden tab, the loop also restarts
 *   the clock, so no game time passes while the kid was away.
 * - `running: false` stops the frame chain completely.
 *
 * Keep today's speed: a game that ran at half speed because of the old
 * loop bug keeps its feel with `timeScale: 0.5` (plan decision 3).
 *
 * The names `fixedStepMs`, `maxDtMs`, `timeScale` and `onAfterRender` are
 * the contract in the gameplay-clips plan. The per-game PRs and the clip
 * kit use these names, so do not rename them.
 */

/** The game time of one simulation step, in ms, when not set (60 steps each second). */
export const DEFAULT_FIXED_STEP_MS = 1000 / 60;
/** The longest frame time the loop accepts, in ms, when not set. */
export const DEFAULT_MAX_DT_MS = 50;

/**
 * Floating-point slack for the step count. A 144 Hz frame is 6.944... ms,
 * and a sum of those can land a hair under a whole step. Without this
 * slack, one second of frames could give 59 steps instead of 60.
 */
const STEP_EPSILON_MS = 1e-6;

export interface GameLoopCallbacks {
  /** Move the game forward by one fixed step. `stepMs` is game time in ms. */
  update: (stepMs: number) => void;
  /**
   * Draw the game. Runs once each frame after the updates, also while the
   * loop is paused. `alpha` is 0 or more and less than 1.
   */
  render?: (alpha: number) => void;
  /**
   * Runs after `render`, in the same frame. Use it to read the finished
   * picture (for example, to capture a clip frame).
   */
  onAfterRender?: () => void;
}

export interface GameLoopOptions {
  /** Start the frame chain (true) or stop it (false). */
  running: boolean;
  /** Stop the updates but keep drawing. Resuming never catches up. */
  paused?: boolean;
  /** The game time of one fixed step, in ms. Default 1000/60 (60 steps each second). */
  fixedStepMs?: number;
  /** The longest frame time in ms that the loop accepts. Default 50. */
  maxDtMs?: number;
  /** Game time for each unit of real time. 0.5 is half speed. Default 1. */
  timeScale?: number;
}

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function nonNegativeOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

export function useGameLoop(
  callbacks: GameLoopCallbacks,
  options: GameLoopOptions
): void {
  const callbacksRef = useRef(callbacks);
  const optionsRef = useRef(options);

  // Always use the newest callbacks and options. A layout effect runs
  // before the browser can fire the next frame, so no frame sees old ones.
  useLayoutEffect(() => {
    callbacksRef.current = callbacks;
    optionsRef.current = options;
  });

  const { running } = options;

  useEffect(() => {
    if (!running) return;
    if (typeof window === "undefined") return;
    if (typeof window.requestAnimationFrame !== "function") return;

    let frameId = 0;
    let stopped = false;
    // null means "restart the clock on the next frame" (no time passes).
    let lastTimestamp: number | null = null;
    let accumulatorMs = 0;
    let alpha = 0;

    const tick = (timestamp: number) => {
      if (stopped) return;
      // Ask for the next frame first, so one bad frame cannot stop the game.
      frameId = window.requestAnimationFrame(tick);

      const opts = optionsRef.current;
      const { update, render, onAfterRender } = callbacksRef.current;
      const stepMs = positiveOr(opts.fixedStepMs, DEFAULT_FIXED_STEP_MS);

      if (opts.paused) {
        // Frozen: no updates, and the resume frame restarts the clock.
        lastTimestamp = null;
      } else {
        if (lastTimestamp === null) lastTimestamp = timestamp;
        const maxDtMs = positiveOr(opts.maxDtMs, DEFAULT_MAX_DT_MS);
        const timeScale = nonNegativeOr(opts.timeScale, 1);
        const dtMs = Math.min(Math.max(timestamp - lastTimestamp, 0), maxDtMs);
        lastTimestamp = timestamp;

        accumulatorMs += dtMs * timeScale;
        try {
          while (accumulatorMs >= stepMs - STEP_EPSILON_MS) {
            update(stepMs);
            accumulatorMs -= stepMs;
          }
        } finally {
          // When update throws, the steps still due in this frame stay in
          // the accumulator. Drop them. If they stay, each frame that throws
          // adds more, and the first good frame runs them all as one burst.
          if (accumulatorMs >= stepMs - STEP_EPSILON_MS) accumulatorMs = 0;
        }
        if (accumulatorMs < 0) accumulatorMs = 0;
        alpha = Math.min(accumulatorMs / stepMs, 1 - Number.EPSILON);
      }

      render?.(alpha);
      onAfterRender?.();
    };

    const onVisibilityChange = () => {
      lastTimestamp = null;
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    frameId = window.requestAnimationFrame(tick);

    return () => {
      stopped = true;
      window.cancelAnimationFrame(frameId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [running]);
}
