"use client";

/**
 * Gameplay clips for Hextris (the Asteroids pattern, plan 11.5).
 *
 * - The canvas goes to the clip service. Capture runs while a round plays;
 *   the shell's pause holds the run; the start card and the result are
 *   breaks with no run.
 * - A run starts when the store's runId goes up (the start card, Play again
 *   on the result chip, the header's Restart) and ends at game over.
 * - Passing the best from before the run marks a "new best" moment once.
 *
 * With clips off, every call here does nothing. The run logic is the shared
 * useRunClips; this maps the game's state.
 */

import type { RefObject } from "react";

import { useRunClips, type RunClipPhase } from "@/shared/clips";

import type { GameStatus } from "./constants";

export interface HextrisClipState {
  status: GameStatus;
  score: number;
  /** The best score when the run started. */
  best: number;
  runId: number;
}

export function useHextrisClips(canvasRef: RefObject<HTMLCanvasElement | null>, { status, score, best, runId }: HextrisClipState): void {
  useRunClips(canvasRef, { phase: runClipPhase(status), runId, score, best });
}

/** A round plays; the pause holds it; the start card and the result have no run. */
export function runClipPhase(status: GameStatus): RunClipPhase {
  if (status === "playing") return "playing";
  if (status === "paused") return "hold";
  return "idle";
}
