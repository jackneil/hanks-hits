"use client";

/**
 * Gameplay clips for Endless Runner (PR-G2, the shared useRunClips).
 *
 * - Capture runs only while the runner runs; the start card and the
 *   result are breaks.
 * - A run starts when the runner starts (the start card, Play again) and
 *   ends at the crash.
 * - When the distance passes the best from before the run, the game marks
 *   a featured "new best" moment once per run.
 *
 * With clips off, every call here does nothing.
 */

import type { RefObject } from "react";

import { useRunClips, type RunClipPhase } from "@/shared/clips";

import type { GameState } from "./constants";

export { NEW_BEST_MOMENT } from "@/shared/clips";

export interface EndlessClipState {
  gameState: GameState;
  /** Metres run in this run. */
  distance: number;
  /** The saved best. The store raises it only at the crash. */
  highScore: number;
}

export function useEndlessClips(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  { gameState, distance, highScore }: EndlessClipState,
): void {
  useRunClips(canvasRef, { phase: runClipPhase(gameState), score: distance, best: highScore });
}

/** The runner runs; the start card and the result have no run. */
export function runClipPhase(gameState: GameState): RunClipPhase {
  return gameState === "playing" ? "playing" : "idle";
}
