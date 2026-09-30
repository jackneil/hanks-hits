"use client";

/**
 * Gameplay clips for a canvas game that plays in runs (a round, a level, a
 * drive): one hook instead of a copy per game.
 *
 * What the game tells the clip service:
 * - The canvas (useClipSource). Capture runs only while the phase is
 *   "playing"; every other phase is a break.
 * - Run phases (runPhase). A run starts when play starts after "idle" (the
 *   start card, the result), when `runId` changes while playing (a restart
 *   from any screen, also mid-run), or when the service arrives while the
 *   game already plays. A run ends at "idle", and when the game unmounts
 *   with a run open (the header restart remounts some games). "hold" (the
 *   game's own pause, a level-complete card) keeps the run open.
 * - The new-best moment (markMoment), once per run, when the score passes
 *   the best from before the run. A first-ever score breaks no record, so
 *   it marks nothing. A better best that cloud sync brings during the run
 *   (the kid played on another device) raises the score to beat.
 *
 * With clips off, every call here does nothing: useAttachedGame gives null.
 *
 * Usage:
 *   useRunClips(canvasRef, {
 *     phase: status === "playing" ? "playing" : status === "paused" ? "hold" : "idle",
 *     runId, score, best: progress.highScore,
 *   });
 */

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

import { startRun, type RunBest } from "@/shared/lib/runBest";

import type { MomentMark } from "./protocol";
import { useClipSource } from "./service/ClipProvider";
import { useAttachedGame } from "./service/context";

/** Where a run stands: live, paused inside the run, or no run at all. */
export type RunClipPhase = "playing" | "hold" | "idle";

export interface RunClipState {
  phase: RunClipPhase;
  /** The game's run counter. A new value while playing is a new run (a restart). */
  runId?: number;
  /** The score of the run so far, in the unit of `best`. */
  score: number;
  /** The saved best. A store that raises it during a run is fine: the run keeps its own snapshot. */
  best: number;
  /** True when a smaller score is better (a race time). */
  lowerIsBetter?: boolean;
}

/** The words and picture of the new-best moment (the viewer's filmstrip star). */
export const NEW_BEST_MOMENT = {
  kind: "new-best",
  label: "New best!",
  emoji: "🏆",
  priority: "featured",
} as const satisfies Omit<MomentMark, "offsetSec">;

export function useRunClips(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  { phase, runId = 0, score, best, lowerIsBetter = false }: RunClipState,
): void {
  const game = useAttachedGame();
  const run = useRef<{ best: RunBest; marked: boolean } | null>(null);
  const before = useRef<{ phase: RunClipPhase; game: typeof game; runId: number }>({ phase, game: null, runId });

  const gameRef = useRef(game);
  useLayoutEffect(() => {
    gameRef.current = game;
  });

  const bestRef = useRef(best);
  const lowerRef = useRef(lowerIsBetter);
  useEffect(() => {
    bestRef.current = best;
    lowerRef.current = lowerIsBetter;
    // During a run the saved best rises through cloud sync (or a store that
    // writes it as it goes). noteCloudBest never lowers the score to beat.
    run.current?.best.noteCloudBest(best);
  }, [best, lowerIsBetter]);

  // Run phases. This effect runs before useClipSource's break signal below,
  // so at the end of a run the service hears "end" first and keeps the
  // result in the ring (its post-roll), then the break.
  useEffect(() => {
    const prev = before.current;
    before.current = { phase, game, runId };
    if (!game) return;
    const gameArrived = prev.game !== game;
    const started = phase === "playing" && (prev.phase === "idle" || prev.runId !== runId);
    if (started || (gameArrived && phase === "playing" && run.current === null)) {
      // A restart during a run: that run ends first, so the service keeps
      // the two attempts apart (post-roll, run end time).
      if (run.current && !gameArrived) game.runPhase("end");
      run.current = { best: startRun(bestRef.current, { lowerIsBetter: lowerRef.current }), marked: false };
      game.runPhase("start");
    } else if (phase === "idle" && run.current) {
      run.current = null;
      game.runPhase("end");
    }
  }, [phase, game, runId]);

  // Unmounted with a run open (a restart that remounts the game): end that
  // run, so the next mount's run stands on its own.
  useEffect(
    () => () => {
      if (run.current && gameRef.current) gameRef.current.runPhase("end");
      run.current = null;
    },
    [],
  );

  // The new best: once per run, the moment the score passes the old record.
  useEffect(() => {
    const current = run.current;
    if (!game || !current || current.marked || phase !== "playing") return;
    if (!current.best.brokeRecord(score)) return;
    current.marked = true;
    game.markMoment({ ...NEW_BEST_MOMENT });
  }, [game, score, phase]);

  useClipSource(canvasRef, { isPlaying: phase === "playing" });
}
