"use client";

/**
 * Gameplay clips for Hank's Hopper (PR-G2, the shared useRunClips).
 *
 * - Capture runs only while the player plays a level; the shell's pause
 *   keeps the run open, and the start card and the end of a level are
 *   breaks.
 * - A run is one attempt at a level: it starts when play starts and ends at
 *   "Level complete!" or "Oops!".
 * - A level's record is a time, known only at the finish, so a cleared
 *   level marks a featured "level clear" moment just before the run ends
 *   (the run's own new-best rule never fires: there is no running score to
 *   beat).
 *
 * With clips off, every call here does nothing.
 */

import { useEffect, useRef, type RefObject } from "react";

import { useAttachedGame, useRunClips, type RunClipPhase } from "@/shared/clips";

import type { GameState } from "./constants";

/** The words and picture of the level-clear moment (the viewer's filmstrip star). */
export const LEVEL_CLEAR_MOMENT = {
  kind: "level-clear",
  label: "Level complete!",
  emoji: "🏁",
  priority: "featured",
} as const;

export interface PlatformerClipState {
  gameState: GameState;
  score: number;
}

export function usePlatformerClips(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  { gameState, score }: PlatformerClipState,
): void {
  const game = useAttachedGame();
  const before = useRef(gameState);
  // Declared before useRunClips, so on the finishing commit the moment is
  // marked before the run's "end".
  useEffect(() => {
    const prev = before.current;
    before.current = gameState;
    if (game && gameState === "levelComplete" && prev !== "levelComplete") {
      game.markMoment({ ...LEVEL_CLEAR_MOMENT });
    }
  }, [game, gameState]);

  useRunClips(canvasRef, { phase: runClipPhase(gameState), score, best: 0 });
}

/** A level plays; the shell's pause keeps the run; everything else has no run. */
export function runClipPhase(gameState: GameState): RunClipPhase {
  if (gameState === "playing") return "playing";
  if (gameState === "paused") return "hold";
  return "idle";
}
