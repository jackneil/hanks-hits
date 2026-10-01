"use client";

/**
 * Gameplay clips for Dino Runner (the Asteroids pattern, plan 11.5).
 *
 * - The canvas goes to the clip service (useClipSource). Capture runs only
 *   while a run plays: the start card and the game-over result are breaks.
 * - A run starts when the store's runId goes up (the start card, Play again
 *   on the result chip, the header's Restart) and ends at game over
 *   (runPhase). A restart during a run ends that run first.
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

export interface DinoClipState {
  gameState: GameState;
  score: number;
  /** The saved best. The store raises it only at game over. */
  highScore: number;
  /** The store's run counter: a new value while playing is a new run (a restart). */
  runId: number;
}

/** The words and picture of the new-best moment (the viewer's filmstrip star). */
export { NEW_BEST_MOMENT } from "@/shared/clips";

export function useDinoClips(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  { gameState, score, highScore, runId }: DinoClipState
): void {
  useRunClips(canvasRef, { phase: runClipPhase(gameState), runId, score: Math.floor(score), best: highScore });
}

/** A run plays; the start card and the result have no run. */
export function runClipPhase(gameState: GameState): RunClipPhase {
  return gameState === "playing" ? "playing" : "idle";
}
