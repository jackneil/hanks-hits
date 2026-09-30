"use client";

/**
 * Gameplay clips for Breakout (plan 2.6, the Asteroids pattern).
 *
 * - The canvas goes to the clip service (useClipSource). Capture runs only
 *   while a round plays: the level card, the shell's pause and the
 *   game-over card are breaks.
 * - A run starts when a round starts (the store's runId goes up: Play,
 *   Play again, and a restart from the header or the pause menu), and ends
 *   at game over (runPhase). A restart during a run ends that run first. A
 *   new level, and a resume after a pause, are the same run.
 * - When the score passes the best from before the run, the game marks a
 *   featured "new best" moment once per run (markMoment). The store raises
 *   the saved best at each level card, so the record to beat is the
 *   store's runStartBest, not the saved best.
 *
 * With clips off, every call here does nothing: useAttachedGame gives null.
 * The run logic is the shared useRunClips; this maps the game's status.
 */

import type { RefObject } from "react";

import { useRunClips, type RunClipPhase } from "@/shared/clips";

import type { GameStatus } from "./constants";

export interface BreakoutClipState {
  status: GameStatus;
  score: number;
  /** The best to beat: the store's runStartBest. */
  highScore: number;
  /** The store's run counter: a new value while playing is a new run (a restart). */
  runId: number;
}

/** The words and picture of the new-best moment (the viewer's filmstrip star). */
export { NEW_BEST_MOMENT } from "@/shared/clips";

export function useBreakoutClips(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  { status, score, highScore, runId }: BreakoutClipState,
): void {
  useRunClips(canvasRef, { phase: runClipPhase(status), runId, score, best: highScore });
}

/**
 * A round plays; the shell's pause and the level card keep the run open
 * (a new level is the same run); the start card and game over have no run.
 */
export function runClipPhase(status: GameStatus): RunClipPhase {
  if (status === "playing") return "playing";
  if (status === "paused" || status === "level-complete") return "hold";
  return "idle";
}
