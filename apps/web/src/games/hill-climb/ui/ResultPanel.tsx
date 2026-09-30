'use client';

/**
 * Hill Climb Racing - the result over the crash.
 *
 * A compact card in the play area (never a full-screen sheet): the crash
 * stays in view under it, and the shared ResultChip at the bottom holds
 * the buttons (read it to me, Play again, Leaderboard, Garage). The old
 * card was a fixed, centred, 686 px column: on a phone held sideways Try
 * Again showed 9 px of itself and Garage and Home were off screen (phone
 * UX audit 2026-09-29).
 */

import { useHillClimbStore } from '../lib/store';

interface ResultPanelProps {
  /** The distance beat the best from before the run (the store has already raised the best). */
  newRecord: boolean;
}

export function ResultPanel({ newRecord: isNewRecord }: ResultPanelProps) {
  const { distance, sessionCoins, sessionFlips, sessionAirtime, gameOverReason, coins } = useHillClimbStore();

  const crashed = gameOverReason !== 'fuel';

  return (
    <div
      data-testid="hill-climb-result"
      className="pointer-events-none absolute inset-x-2 top-14 z-40 flex justify-center short:top-12"
    >
      <div className="w-full max-w-sm rounded-2xl bg-base-100/95 px-4 py-3 text-center text-base-content shadow-xl short:max-w-xl short:py-2">
        <div className="flex items-center justify-center gap-2">
          <span className="text-3xl short:text-2xl" aria-hidden="true">
            {crashed ? '💥' : '⛽'}
          </span>
          <h2 className={`text-2xl font-bold short:text-xl ${crashed ? 'text-red-500' : 'text-orange-500'}`}>
            {crashed ? 'You crashed!' : 'Out of fuel!'}
          </h2>
          {isNewRecord && (
            <span className="rounded-full bg-yellow-400 px-2 py-0.5 text-sm font-bold text-yellow-950">
              🏆 New record!
            </span>
          )}
        </div>
        <dl className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-base short:mt-1">
          <div className="flex items-baseline gap-1">
            <dt className="text-base-content/60">Distance</dt>
            <dd className="text-xl font-bold">{Math.floor(distance)}m</dd>
          </div>
          <div className="flex items-baseline gap-1">
            <dt className="text-base-content/60">Coins</dt>
            <dd className="text-xl font-bold text-yellow-600">+{sessionCoins}</dd>
          </div>
          {sessionFlips > 0 && (
            <div className="flex items-baseline gap-1">
              <dt className="text-base-content/60">Flips</dt>
              <dd className="text-xl font-bold">{sessionFlips}</dd>
            </div>
          )}
          {sessionAirtime > 1 && (
            <div className="flex items-baseline gap-1">
              <dt className="text-base-content/60">Air time</dt>
              <dd className="text-xl font-bold">{sessionAirtime.toFixed(1)}s</dd>
            </div>
          )}
          <div className="flex items-baseline gap-1">
            <dt className="text-base-content/60">Total</dt>
            <dd className="text-xl font-bold">💰 {coins.toLocaleString()}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
