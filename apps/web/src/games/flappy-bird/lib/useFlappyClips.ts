"use client";

/**
 * Gameplay clips for Flappy Bird (PR-G2, the shared useRunClips).
 *
 * - Capture runs only while the bird flies; the start card and the result
 *   are breaks.
 * - A run starts when the bird starts to fly (the start card, Play again)
 *   and ends at the crash.
 * - When the pipe count passes the best from before the run, the game
 *   marks a featured "new best" moment once per run.
 *
 * With clips off, every call here does nothing.
 */

import type { RefObject } from "react";

import { useRunClips, type RunClipPhase } from "@/shared/clips";

import type { GameState } from "./constants";

export { NEW_BEST_MOMENT } from "@/shared/clips";

export interface FlappyClipState {
  gameState: GameState;
  /** Pipes passed in this run. */
  score: number;
  /** The saved best. The store raises it only at the crash. */
  highScore: number;
}

export function useFlappyClips(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  { gameState, score, highScore }: FlappyClipState,
): void {
  useRunClips(canvasRef, { phase: runClipPhase(gameState), score, best: highScore });
}

/** The bird flies; the start card and the result have no run. */
export function runClipPhase(gameState: GameState): RunClipPhase {
  return gameState === "playing" ? "playing" : "idle";
}
