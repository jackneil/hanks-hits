"use client";

/**
 * Gameplay clips for Bomberman (plan Phase 2, like Asteroids).
 *
 * - The canvas goes to the clip service (useClipSource). Capture runs only
 *   while a level plays: the start card, the pause menu, the level-done
 *   card and the game-over card are breaks.
 * - A run starts when a game starts (the store's runId goes up: the start
 *   card, Play again, and the header or pause-menu Restart), and ends at
 *   game over, or when the game goes back to the menu (runPhase). A restart
 *   during a run ends that run first. The next level after a win is the
 *   same run: the score carries over.
 * - When the score passes the best from before the run, the game marks a
 *   featured "new best" moment once per run (markMoment). A cleared level
 *   marks a standard "level done" moment. A better best that cloud sync
 *   brings during the run raises the score to beat (runBest.noteCloudBest).
 *
 * With clips off, every call here does nothing: useAttachedGame gives null.
 */

import { useEffect, useRef, type RefObject } from "react";

import { useAttachedGame, useClipSource } from "@/shared/clips";
import { startRun, type RunBest } from "@/shared/lib/runBest";

export type BombermanClipStatus = "menu" | "playing" | "paused" | "won" | "lost";

export interface BombermanClipState {
  gameState: BombermanClipStatus;
  score: number;
  level: number;
  /** The saved best. The store raises it at game over and at a level win. */
  highScore: number;
  /** The store's run counter: a new value is a new run (a restart). */
  runId: number;
}

/** The words and picture of the new-best moment (the viewer's filmstrip star). */
export const NEW_BEST_MOMENT = { kind: "new-best", label: "New best!", emoji: "🏆", priority: "featured" } as const;

/** The words and picture of a cleared level. */
export function levelClearMoment(level: number) {
  return { kind: "level-clear", label: `Level ${level} done!`, emoji: "🎉", priority: "standard" } as const;
}

export function useBombermanClips(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  { gameState, score, level, highScore, runId }: BombermanClipState,
): void {
  const game = useAttachedGame();
  const run = useRef<{ best: RunBest; marked: boolean } | null>(null);
  const before = useRef<{ gameState: BombermanClipStatus; game: typeof game; runId: number }>({ gameState, game: null, runId });

  const highScoreRef = useRef(highScore);
  useEffect(() => {
    highScoreRef.current = highScore;
    run.current?.best.noteCloudBest(highScore);
  }, [highScore]);

  // Run phases. This effect runs before useClipSource's break signal below,
  // so at game over the service hears "end" first and keeps the result card
  // in the ring (its post-roll), then the break.
  useEffect(() => {
    const prev = before.current;
    before.current = { gameState, game, runId };
    if (!game) return;
    const gameArrived = prev.game !== game;
    const inRun = gameState === "playing" || gameState === "paused" || gameState === "won";
    // A new run: the store's startGame ran (a new runId), from any screen.
    const runStarted = gameState === "playing" && (prev.runId !== runId || prev.gameState === "menu" || prev.gameState === "lost");
    if (runStarted || (gameArrived && inRun && run.current === null)) {
      if (run.current && !gameArrived) game.runPhase("end");
      run.current = { best: startRun(highScoreRef.current), marked: false };
      game.runPhase("start");
    } else if ((gameState === "lost" || gameState === "menu") && run.current) {
      run.current = null;
      game.runPhase("end");
    }
  }, [gameState, game, runId]);

  // The new best: once per run, the moment the score passes the old record.
  useEffect(() => {
    const current = run.current;
    if (!game || !current || current.marked || gameState !== "playing") return;
    if (!current.best.brokeRecord(score)) return;
    current.marked = true;
    game.markMoment({ ...NEW_BEST_MOMENT });
  }, [game, score, gameState]);

  // A cleared level: the moment the store says "won".
  const wonLevel = useRef<number | null>(null);
  useEffect(() => {
    if (!game || !run.current) return;
    if (gameState !== "won") {
      wonLevel.current = null;
      return;
    }
    if (wonLevel.current === level) return;
    wonLevel.current = level;
    game.markMoment(levelClearMoment(level));
  }, [game, gameState, level]);

  useClipSource(canvasRef, { isPlaying: gameState === "playing" });
}
