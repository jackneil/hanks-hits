"use client";

/**
 * Gameplay clips for Arkanoid (PR-G3, the shared useRunClips).
 *
 * - Capture runs only while balls fly; the shell's pause keeps the run
 *   open, and the start card and the result are breaks.
 * - A run starts at each start (the store's runId goes up) and ends at
 *   game over. A lost life is the same run.
 * - When the score passes the best from before the run, the game marks a
 *   featured "new best" moment once per run.
 *
 * With clips off, every call here does nothing.
 */

import type { RefObject } from "react";

import { useRunClips, type RunClipPhase } from "@/shared/clips";

import type { GameState } from "./store";

export { NEW_BEST_MOMENT } from "@/shared/clips";

export interface ArkanoidClipState {
  gameState: GameState;
  score: number;
  /** The saved best. The store raises it only at game over. */
  highScore: number;
  runId: number;
}

export function useArkanoidClips(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  { gameState, score, highScore, runId }: ArkanoidClipState,
): void {
  useRunClips(canvasRef, { phase: runClipPhase(gameState), runId, score, best: highScore });
}

/** Balls fly; the shell's pause keeps the run; the start card and game over have no run. */
export function runClipPhase(gameState: GameState): RunClipPhase {
  if (gameState === "playing") return "playing";
  if (gameState === "paused") return "hold";
  return "idle";
}
