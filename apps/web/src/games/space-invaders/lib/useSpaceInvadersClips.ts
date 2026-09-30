"use client";

/**
 * Gameplay clips for Space Invaders (plan 2.6, the Asteroids pattern).
 *
 * - The canvas goes to the clip service (useClipSource). Capture runs only
 *   while a round plays: the wave card, the shell's pause and the game-over
 *   card are breaks.
 * - A run starts when a round starts (the store's runId goes up: the start
 *   card's age choice, Play again, and the header or pause-menu Restart),
 *   and ends at game over (runPhase). A restart during a run ends that run
 *   first. A new wave, and a resume after a pause, are the same run.
 * - When the score passes the best from before the run, the game marks a
 *   featured "new best" moment once per run (markMoment). A first-ever
 *   score breaks no record, so it marks nothing. A better best that cloud
 *   sync brings during the run raises the score to beat.
 *
 * With clips off, every call here does nothing: useAttachedGame gives null.
 * The run logic is the shared useRunClips; this maps the game's state.
 */

import type { RefObject } from "react";

import { useRunClips, type RunClipPhase } from "@/shared/clips";

import type { GameState } from "./constants";

export interface SpaceInvadersClipState {
  gameState: GameState;
  score: number;
  /**
   * The best to beat: the store's runStartBest (the saved best when the
   * run started). The store raises the saved best during a run, so the
   * saved best itself is never the record to beat.
   */
  highScore: number;
  /** The store's run counter: a new value while playing is a new run (a restart). */
  runId: number;
}

/** The words and picture of the new-best moment (the viewer's filmstrip star). */
export { NEW_BEST_MOMENT } from "@/shared/clips";

export function useSpaceInvadersClips(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  { gameState, score, highScore, runId }: SpaceInvadersClipState,
): void {
  useRunClips(canvasRef, { phase: runClipPhase(gameState), runId, score, best: highScore });
}

/**
 * A wave plays; the shell's pause and the wave card keep the run open (a
 * new wave is the same run); the start card and game over have no run.
 */
export function runClipPhase(gameState: GameState): RunClipPhase {
  if (gameState === "playing") return "playing";
  if (gameState === "paused" || gameState === "waveComplete") return "hold";
  return "idle";
}
