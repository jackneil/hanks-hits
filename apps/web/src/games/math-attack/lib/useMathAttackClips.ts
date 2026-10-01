"use client";

/**
 * Gameplay clips for Math Attack (the Asteroids pattern, plan 11.5).
 *
 * - The canvas goes to the clip service. Capture runs while the problems
 *   fall; the shell's pause holds the run; the start card and the result
 *   have no run.
 * - A run starts when the store's runId goes up (the start card, Play
 *   again) and ends at game over.
 * - Passing the best from before the run marks a "new best" moment once.
 *
 * With clips off, every call here does nothing. The run logic is the shared
 * useRunClips; this maps the game's state.
 */

import type { RefObject } from "react";

import { useRunClips, type RunClipPhase } from "@/shared/clips";

import type { useMathAttackStore } from "./store";

type GameState = ReturnType<typeof useMathAttackStore.getState>["gameState"];

export interface MathAttackClipState {
  gameState: GameState;
  score: number;
  highScore: number;
  runId: number;
}

export function useMathAttackClips(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  { gameState, score, highScore, runId }: MathAttackClipState
): void {
  useRunClips(canvasRef, { phase: runClipPhase(gameState), runId, score, best: highScore });
}

/** The problems fall; the pause holds the run; the rest has none. */
export function runClipPhase(gameState: GameState): RunClipPhase {
  if (gameState === "playing") return "playing";
  if (gameState === "paused") return "hold";
  return "idle";
}
