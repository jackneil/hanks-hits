"use client";

/**
 * Gameplay clips for Hill Climb (plan 11.5, the Asteroids pattern).
 *
 * - The canvas goes to the clip service (useClipSource). Capture runs only
 *   while the truck drives: the start card, the pause sheet, the Garage
 *   and the result are breaks.
 * - A run starts when the truck starts to drive from any break (the start
 *   card, Play again, the Garage's Play, and a restart remount from the
 *   header or the pause sheet), and ends at the crash or the empty tank
 *   (runPhase). A resume after a pause is the same run. A run that is torn
 *   down without a result (the Garage from the pause sheet, or the header
 *   restart, which remounts the game) ends when the game leaves the run.
 * - When the distance passes the best from before the run, the game marks
 *   a featured "new best" moment once per run (markMoment). A first-ever
 *   run breaks no record, so it marks nothing. A better best that cloud
 *   sync brings during the run raises the distance to beat
 *   (runBest.noteCloudBest).
 *
 * With clips off, every call here does nothing: useAttachedGame gives null.
 * The run logic is the shared useRunClips; this maps the game's phase.
 */

import type { RefObject } from "react";

import { useRunClips, type RunClipPhase } from "@/shared/clips";

/** What the game is doing, for the clip service. */
export type HillClimbClipPhase = "start" | "garage" | "playing" | "paused" | "gameOver";

export interface HillClimbClipState {
  phase: HillClimbClipPhase;
  /** The distance of the run so far, in metres. */
  distance: number;
  /** The saved best. The store raises it only at the end of a run. */
  bestDistance: number;
}

/** The words and picture of the new-best moment (the viewer's filmstrip star). */
export { NEW_BEST_MOMENT } from "@/shared/clips";

export function useHillClimbClips(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  { phase, distance, bestDistance }: HillClimbClipState,
): void {
  useRunClips(canvasRef, { phase: runClipPhase(phase), score: distance, best: bestDistance });
}

/** The truck drives; the pause sheet keeps the run; everything else has no run. */
export function runClipPhase(phase: HillClimbClipPhase): RunClipPhase {
  if (phase === "playing") return "playing";
  if (phase === "paused") return "hold";
  return "idle";
}
