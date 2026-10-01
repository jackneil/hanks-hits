'use client';

/**
 * Hill Climb Racing - Game UI (HUD)
 *
 * One row at the top of the play area: the distance and the coins on the
 * left, the pause button in the middle, the fuel and nitro bars and the
 * speed on the right. The lower two thirds of the screen stay clear for
 * the truck and the touch chips. The old HUD stacked 216 px wide gauges
 * down the right side and covered 73% of a phone held sideways, with the
 * pause button on the fuel gauge upright (phone UX audit 2026-09-29).
 */

import { useHillClimbStore } from '../lib/store';
import { useSecondFingerClick } from '@/shared/lib/input';
import { FUEL } from '../lib/constants';

interface GameUIProps {
  fuel: number;
  maxFuel: number;
  nitro: number;
  maxNitro: number;
  nitroActive: boolean;
  distance: number;
  speed: number;
}

/** A translucent HUD box. */
const BOX = 'rounded-xl bg-black/55 text-white';

export function GameUI({ fuel, maxFuel, nitro, maxNitro, nitroActive, distance, speed }: GameUIProps) {
  const { coins, sessionCoins, sessionFlips, bestDistance, combo, pauseGame } = useHillClimbStore();
  // Pause works for the other thumb while one holds the gas (a browser makes
  // no click for a second finger).
  const pauseTap = useSecondFingerClick<HTMLButtonElement>(pauseGame);

  const fuelPercent = (fuel / maxFuel) * 100;
  const isLowFuel = fuel < FUEL.LOW_FUEL_THRESHOLD;
  const nitroPercent = (nitro / maxNitro) * 100;
  const isNitroLow = nitroPercent < 20;

  return (
    // Anchored BELOW the GameShell header (fixed, --shell-header-h, z-[1000]):
    // a plain inset-0 layer put the pause button and stat boxes underneath
    // it, which made pause unreachable by touch or mouse.
    <div data-testid="hill-climb-hud" className="fixed inset-x-0 bottom-0 top-[var(--shell-header-h)] pointer-events-none z-40">
      <div className="absolute inset-x-2 top-2 flex items-start justify-between gap-2 short:top-1.5">
        {/* Left: distance, then the coins of this run and the total */}
        <div className="flex min-w-0 flex-col gap-1.5 short:flex-row short:items-start short:gap-1.5">
          <div className={`${BOX} px-3 py-1.5 short:px-2 short:py-1`}>
            <div className="text-2xl font-bold leading-none short:text-lg" data-testid="hill-climb-distance">
              {Math.floor(distance)}m
            </div>
            <div className="mt-0.5 text-sm text-gray-300 short:text-xs">Best {Math.floor(bestDistance)}m</div>
          </div>
          <div className={`${BOX} flex items-center gap-2 px-3 py-1.5 short:px-2 short:py-1`}>
            <span className="text-base font-bold text-yellow-400 short:text-sm">🪙 +{sessionCoins}</span>
            <span className="text-sm text-gray-300 short:text-xs">💰 {coins.toLocaleString()}</span>
          </div>
          {sessionFlips > 0 && (
            <div className={`${BOX} px-3 py-1 text-base font-bold short:px-2 short:text-sm`}>🔄 {sessionFlips} flips</div>
          )}
          {combo > 0 && (
            <div className="rounded-xl bg-orange-500/90 px-3 py-1 text-base font-bold text-white short:px-2 short:text-sm">
              x{combo} COMBO!
            </div>
          )}
        </div>

        {/* Middle: pause. A button, so the touch zones never read it as gas. */}
        <button
          type="button"
          {...pauseTap}
          aria-label="Pause game"
          className="pointer-events-auto flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-black/55 text-2xl text-white touch-manipulation active:scale-95 short:h-11 short:w-11"
          title="Pause (Esc)"
        >
          ⏸️
        </button>

        {/* Right: fuel, nitro and the speed */}
        <div className="flex flex-col items-end gap-1.5 short:flex-row short:items-start short:gap-1.5">
          <div className={`${BOX} px-3 py-1.5 short:px-2 short:py-1`}>
            <div className="flex items-center gap-1.5">
              <span className="text-base leading-none short:text-sm">⛽</span>
              <span className={`text-sm font-bold ${isLowFuel ? 'animate-pulse text-red-400' : ''}`}>
                {Math.ceil(fuel)}%
              </span>
            </div>
            <div className="mt-1 h-2.5 w-28 overflow-hidden rounded-full bg-gray-700 short:w-24">
              <div
                className={`h-full transition-all duration-200 ${
                  isLowFuel ? 'animate-pulse bg-red-500' : fuelPercent > 50 ? 'bg-green-500' : 'bg-yellow-500'
                }`}
                style={{ width: `${fuelPercent}%` }}
              />
            </div>
          </div>
          <div
            className={`rounded-xl px-3 py-1.5 text-white short:px-2 short:py-1 ${
              nitroActive ? 'bg-cyan-600/80 ring-2 ring-cyan-300' : 'bg-black/55'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span className="text-base leading-none short:text-sm">🚀</span>
              <span className={`text-sm font-bold ${nitroActive ? 'animate-pulse' : isNitroLow ? 'text-gray-400' : 'text-cyan-300'}`}>
                {nitroActive ? 'BOOST!' : `${Math.ceil(nitro)}%`}
              </span>
            </div>
            <div className="mt-1 h-2.5 w-28 overflow-hidden rounded-full bg-gray-700 short:w-24">
              <div
                className={`h-full transition-all duration-200 ${
                  nitroActive ? 'animate-pulse bg-cyan-300' : isNitroLow ? 'bg-gray-500' : 'bg-cyan-500'
                }`}
                style={{ width: `${nitroPercent}%` }}
              />
            </div>
          </div>
          <div className={`${BOX} px-3 py-1.5 text-right short:px-2 short:py-1`}>
            <span className="text-xl font-bold leading-none short:text-base" data-testid="hill-climb-speed">{speed}</span>
            <span className="ml-1 text-sm text-gray-300 short:text-xs">km/h</span>
          </div>
        </div>
      </div>

      {/* Low fuel warning, under the HUD row, never over the truck */}
      {isLowFuel && (
        <div className="absolute left-1/2 top-24 -translate-x-1/2 short:top-16">
          <div className="animate-pulse rounded-xl bg-red-600/90 px-5 py-2 short:px-3 short:py-1">
            <span className="text-xl font-bold text-white short:text-base">⚠️ LOW FUEL!</span>
          </div>
        </div>
      )}
    </div>
  );
}
