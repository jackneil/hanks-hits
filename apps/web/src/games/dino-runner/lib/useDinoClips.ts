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
 */

import { useEffect, useRef, type RefObject } from "react";

import { useAttachedGame, useClipSource } from "@/shared/clips";
import { startRun, type RunBest } from "@/shared/lib/runBest";

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
export const NEW_BEST_MOMENT = { kind: "new-best", label: "New best!", emoji: "🏆", priority: "featured" } as const;

export function useDinoClips(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  { gameState, score, highScore, runId }: DinoClipState
): void {
  const game = useAttachedGame();
  const run = useRef<{ best: RunBest; marked: boolean } | null>(null);
  const before = useRef<{ gameState: GameState; game: typeof game; runId: number }>({ gameState, game: null, runId });

  const highScoreRef = useRef(highScore);
  useEffect(() => {
    highScoreRef.current = highScore;
    run.current?.best.noteCloudBest(highScore);
  }, [highScore]);

  // Run phases. This effect runs before useClipSource's break signal below,
  // so at game over the service hears "end" first and keeps the result in
  // the ring (its post-roll), then the break.
  useEffect(() => {
    const prev = before.current;
    before.current = { gameState, game, runId };
    if (!game) return;
    const gameArrived = prev.game !== game;
    const runStarted = gameState === "playing" && (prev.runId !== runId || prev.gameState !== "playing");
    if (runStarted || (gameArrived && gameState === "playing" && run.current === null)) {
      if (run.current && !gameArrived) game.runPhase("end");
      run.current = { best: startRun(highScoreRef.current), marked: false };
      game.runPhase("start");
    } else if (gameState === "game-over" && prev.gameState !== "game-over" && run.current) {
      run.current = null;
      game.runPhase("end");
    }
  }, [gameState, game, runId]);

  // The new best: once per run, the moment the score passes the old record.
  useEffect(() => {
    const current = run.current;
    if (!game || !current || current.marked || gameState !== "playing") return;
    if (!current.best.brokeRecord(Math.floor(score))) return;
    current.marked = true;
    game.markMoment({ ...NEW_BEST_MOMENT });
  }, [game, score, gameState]);

  useClipSource(canvasRef, { isPlaying: gameState === "playing" });
}
