"use client";

/**
 * Gameplay clips for Hill Climb (plan 11.5, the Asteroids pattern).
 *
 * - The canvas goes to the clip service (useClipSource). Capture runs only
 *   while the truck drives: the start card, the pause sheet, the Garage
 *   and the result are breaks.
 * - A run starts when the truck starts to drive from any break (the start
 *   card, Play again, the Garage's Play, and a restart remount from the
 *   header or the pause sheet), and ends at the crash or the empty tank
 *   (runPhase). A resume after a pause is the same run. A run that is torn
 *   down without a result (the Garage from the pause sheet, or the header
 *   restart, which remounts the game) ends when the game leaves the run.
 * - When the distance passes the best from before the run, the game marks
 *   a featured "new best" moment once per run (markMoment). A first-ever
 *   run breaks no record, so it marks nothing. A better best that cloud
 *   sync brings during the run raises the distance to beat
 *   (runBest.noteCloudBest).
 *
 * With clips off, every call here does nothing: useAttachedGame gives null.
 */

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

import { useAttachedGame, useClipSource } from "@/shared/clips";
import { startRun, type RunBest } from "@/shared/lib/runBest";

/** What the game is doing, for the clip service. */
export type HillClimbClipPhase = "start" | "garage" | "playing" | "paused" | "gameOver";

export interface HillClimbClipState {
  phase: HillClimbClipPhase;
  /** The distance of the run so far, in metres. */
  distance: number;
  /** The saved best. The store raises it only at the end of a run. */
  bestDistance: number;
}

/** The words and picture of the new-best moment (the viewer's filmstrip star). */
export const NEW_BEST_MOMENT = { kind: "new-best", label: "New best!", emoji: "🏆", priority: "featured" } as const;

export function useHillClimbClips(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  { phase, distance, bestDistance }: HillClimbClipState,
): void {
  const game = useAttachedGame();
  const run = useRef<{ best: RunBest; marked: boolean } | null>(null);
  const before = useRef<{ phase: HillClimbClipPhase; game: typeof game }>({ phase, game: null });
  const gameRef = useRef(game);
  useLayoutEffect(() => {
    gameRef.current = game;
  });

  const bestRef = useRef(bestDistance);
  useEffect(() => {
    bestRef.current = bestDistance;
    // During a run the best rises only through cloud sync (the store raises
    // it at the end of the run), so a higher best here is a record from
    // another device. noteCloudBest never lowers the distance to beat.
    run.current?.best.noteCloudBest(bestDistance);
  }, [bestDistance]);

  // Run phases. This effect runs before useClipSource's break signal below,
  // so at game over the service hears "end" first and keeps the result in
  // the ring (its post-roll), then the break.
  useEffect(() => {
    const prev = before.current;
    before.current = { phase, game };
    if (!game) return;
    const gameArrived = prev.game !== game;
    // Driving after any break but a pause: a new run. A game that arrives
    // while the truck already drives (a restart remount, or a clip service
    // that loads mid-run) starts the run then.
    const drivingStarted = phase === "playing" && prev.phase !== "playing" && prev.phase !== "paused";
    if (drivingStarted || (gameArrived && phase === "playing")) {
      if (run.current && !gameArrived) game.runPhase("end");
      run.current = { best: startRun(bestRef.current), marked: false };
      game.runPhase("start");
    } else if (phase !== "playing" && phase !== "paused" && run.current) {
      // The result, or a run torn down for the Garage: the run is over.
      run.current = null;
      game.runPhase("end");
    }
  }, [phase, game]);

  // The game unmounts with a run open (the header restart remounts it): end
  // that run, so the next mount's run stands on its own.
  useEffect(
    () => () => {
      if (run.current && gameRef.current) gameRef.current.runPhase("end");
      run.current = null;
    },
    [],
  );

  // The new best: once per run, the moment the distance passes the old record.
  useEffect(() => {
    const current = run.current;
    if (!game || !current || current.marked || phase !== "playing") return;
    if (!current.best.brokeRecord(distance)) return;
    current.marked = true;
    game.markMoment({ ...NEW_BEST_MOMENT });
  }, [game, distance, phase]);

  useClipSource(canvasRef, { isPlaying: phase === "playing" });
}
