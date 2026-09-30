"use client";

/**
 * Gameplay clips for Asteroids (plan 11.5).
 *
 * - The canvas goes to the clip service (useClipSource). Capture runs only
 *   while a round plays: the wave-complete card, the game's own pause and
 *   the game-over card are breaks.
 * - A run starts when a round starts (the store's runId goes up: the start
 *   card, Play again, and the header or pause-menu Restart), and ends at
 *   game over (runPhase). A restart during a run ends that run first. A new
 *   wave, and a resume after a pause, are the same run.
 * - When the score passes the best from before the run, the game marks a
 *   featured "new best" moment once per run (markMoment). A first-ever score
 *   breaks no record, so it marks nothing. A better best that cloud sync
 *   brings during the run (the kid played on another device) raises the
 *   score to beat (runBest.noteCloudBest).
 *
 * With clips off, every call here does nothing: useAttachedGame gives null.
 * The run logic is the shared useRunClips; this maps the game's status.
 */

import type { RefObject } from "react";

import { useRunClips, type RunClipPhase } from "@/shared/clips";

import type { GameStatus } from "./constants";

export interface AsteroidsClipState {
  status: GameStatus;
  score: number;
  /** The saved best. The store raises it only at game over. */
  highScore: number;
  /** The store's run counter: a new value while playing is a new run (a restart). */
  runId: number;
}

/** The words and picture of the new-best moment (the viewer's filmstrip star). */
export { NEW_BEST_MOMENT } from "@/shared/clips";

export function useAsteroidsClips(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  { status, score, highScore, runId }: AsteroidsClipState,
): void {
  useRunClips(canvasRef, { phase: runClipPhase(status), runId, score, best: highScore });
}

/**
 * A round plays; the game's own pause and the wave-complete card keep the
 * run open; the start card and the game-over card have no run.
 */
export function runClipPhase(status: GameStatus): RunClipPhase {
  if (status === "playing") return "playing";
  if (status === "paused" || status === "waveComplete") return "hold";
  return "idle";
}
