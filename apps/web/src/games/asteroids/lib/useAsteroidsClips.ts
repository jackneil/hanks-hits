"use client";

/**
 * Gameplay clips for Asteroids (plan 11.5).
 *
 * - The canvas goes to the clip service (useClipSource). Capture runs only
 *   while a round plays: the wave-complete card, the game's own pause and
 *   the game-over card are breaks.
 * - A run starts when a round starts (the store's runId goes up: the start
 *   card, Play again, and the header or pause-menu Restart), and ends at
 *   game over (runPhase). A restart during a run ends that run first. A new
 *   wave, and a resume after a pause, are the same run.
 * - When the score passes the best from before the run, the game marks a
 *   featured "new best" moment once per run (markMoment). A first-ever score
 *   breaks no record, so it marks nothing.
 *
 * With clips off, every call here does nothing: useAttachedGame gives null.
 */

import { useEffect, useRef, type RefObject } from "react";

import { useAttachedGame, useClipSource } from "@/shared/clips";
import { startRun, type RunBest } from "@/shared/lib/runBest";

import type { GameStatus } from "./constants";

export interface AsteroidsClipState {
  status: GameStatus;
  score: number;
  /** The saved best. The store raises it only at game over. */
  highScore: number;
  /** The store's run counter: a new value while playing is a new run (a restart). */
  runId: number;
}

/** The words and picture of the new-best moment (the viewer's filmstrip star). */
export const NEW_BEST_MOMENT = { kind: "new-best", label: "New best!", emoji: "🏆", priority: "featured" } as const;

export function useAsteroidsClips(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  { status, score, highScore, runId }: AsteroidsClipState,
): void {
  const game = useAttachedGame();
  const run = useRef<{ best: RunBest; marked: boolean } | null>(null);
  const before = useRef<{ status: GameStatus; game: typeof game; runId: number }>({ status, game: null, runId });

  // Run phases. This effect runs before useClipSource's break signal below,
  // so at game over the service hears "end" first and keeps the result card
  // in the ring (its post-roll), then the break.
  const highScoreRef = useRef(highScore);
  useEffect(() => {
    highScoreRef.current = highScore;
  });
  useEffect(() => {
    const prev = before.current;
    before.current = { status, game, runId };
    if (!game) return;
    const gameArrived = prev.game !== game;
    // A new run: the store's startGame ran (a new runId), from any screen,
    // also from a run in play or in the pause menu (Restart).
    const roundStarted =
      status === "playing" && (prev.runId !== runId || prev.status === "ready" || prev.status === "gameOver");
    if (roundStarted || (gameArrived && status === "playing" && run.current === null)) {
      // A restart during a run: that run ends first, so the service keeps
      // the two attempts apart (post-roll, run end time).
      if (run.current && !gameArrived) game.runPhase("end");
      run.current = { best: startRun(highScoreRef.current), marked: false };
      game.runPhase("start");
    } else if (status === "gameOver" && prev.status !== "gameOver" && run.current) {
      run.current = null;
      game.runPhase("end");
    }
  }, [status, game, runId]);

  // The new best: once per run, the moment the score passes the old record.
  useEffect(() => {
    const current = run.current;
    if (!game || !current || current.marked || status !== "playing") return;
    if (!current.best.brokeRecord(score)) return;
    current.marked = true;
    game.markMoment({ ...NEW_BEST_MOMENT });
  }, [game, score, status]);

  useClipSource(canvasRef, { isPlaying: status === "playing" });
}
