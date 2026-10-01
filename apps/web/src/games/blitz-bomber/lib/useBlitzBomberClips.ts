"use client";

/**
 * Gameplay clips for Blitz Bomber (the Asteroids pattern, plan 11.5).
 *
 * - The canvas goes to the clip service. Capture runs while the plane flies;
 *   the shell's pause and a landing (the level break before Next level)
 *   hold the run; the start card and a crash have no run.
 * - A run starts when the store's runId goes up (a start, Play again, the
 *   header's Restart) and ends at a crash. Next level continues the run.
 * - Passing the best from before the run marks a "new best" moment once.
 *
 * With clips off, every call here does nothing. The run logic is the shared
 * useRunClips; this maps the game's state.
 */

import type { RefObject } from "react";

import { useRunClips, type RunClipPhase } from "@/shared/clips";

import type { GameState } from "./constants";

export interface BlitzBomberClipState {
  gameState: GameState;
  score: number;
  highScore: number;
  runId: number;
}

export function useBlitzBomberClips(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  { gameState, score, highScore, runId }: BlitzBomberClipState
): void {
  useRunClips(canvasRef, { phase: runClipPhase(gameState), runId, score, best: highScore });
}

/** The plane flies; the pause and a landing hold the run; the rest has none. */
export function runClipPhase(gameState: GameState): RunClipPhase {
  if (gameState === "playing") return "playing";
  if (gameState === "paused" || gameState === "landed") return "hold";
  return "idle";
}
