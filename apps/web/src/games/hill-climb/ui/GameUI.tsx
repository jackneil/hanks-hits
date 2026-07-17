'use client';

/**
 * Hill Climb Racing - Game UI (HUD)
 *
 * Displays fuel, distance, coins, and other game stats.
 */

import { useHillClimbStore } from '../lib/store';
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

export function GameUI({ fuel, maxFuel, nitro, maxNitro, nitroActive, distance, speed }: GameUIProps) {
  const { coins, sessionCoins, sessionFlips, bestDistance, combo, pauseGame } = useHillClimbStore();

  const fuelPercent = (fuel / maxFuel) * 100;
  const isLowFuel = fuel < FUEL.LOW_FUEL_THRESHOLD;
  const nitroPercent = (nitro / maxNitro) * 100;
  const isNitroLow = nitroPercent < 20;

  return (
    // Anchored BELOW the GameShell header (fixed, h-12 md:h-14, z-[1000]):
    // a plain inset-0 layer put the top-4 pause button and stat boxes
    // underneath it, which made pause unreachable by touch or mouse.
    <div className="fixed inset-x-0 bottom-0 top-12 md:top-14 pointer-events-none z-40">
      {/* Top Center - Pause Button */}
      <div className="absolute top-4 left-1/2 transform -translate-x-1/2">
        <button
          onClick={pauseGame}
          aria-label="Pause game"
          className="pointer-events-auto w-12 h-12 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center text-white text-2xl transition-colors active:scale-95"
          title="Pause (Esc)"
        >
          ⏸️
        </button>
      </div>

      {/* Top Left - Stats */}
      <div className="absolute top-4 left-4 space-y-2">
        {/* Distance */}
        <div className="bg-black/50 rounded-lg px-4 py-2 text-white">
          <div className="text-3xl font-bold">{Math.floor(distance)}m</div>
          <div className="text-sm text-gray-300">
            Best: {Math.floor(bestDistance)}m
          </div>
        </div>

        {/* Session coins */}
        <div className="bg-black/50 rounded-lg px-4 py-2 text-white flex items-center gap-2">
          <span className="text-2xl">🪙</span>
          <span className="text-2xl font-bold text-yellow-400">
            +{sessionCoins}
          </span>
        </div>

        {/* Flips */}
        {sessionFlips > 0 && (
          <div className="bg-black/50 rounded-lg px-4 py-2 text-white flex items-center gap-2">
            <span className="text-xl">🔄</span>
            <span className="text-xl font-bold">{sessionFlips} flips</span>
          </div>
        )}

        {/* Combo */}
        {combo > 0 && (
          <div className="bg-purple-600/80 rounded-lg px-4 py-2 text-white animate-pulse">
            <span className="text-xl font-bold">x{combo} COMBO!</span>
          </div>
        )}
      </div>

      {/* Top Right - Fuel & Speed */}
      <div className="absolute top-4 right-4 space-y-2">
        {/* Fuel gauge */}
        <div className="bg-black/50 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">⛽</span>
            <span className={`text-lg font-bold ${isLowFuel ? 'text-red-500 animate-pulse' : 'text-white'}`}>
              {Math.ceil(fuel)}%
            </span>
          </div>
          <div className="w-48 h-4 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-200 ${
                isLowFuel ? 'bg-red-500 animate-pulse' : fuelPercent > 50 ? 'bg-green-500' : 'bg-yellow-500'
              }`}
              style={{ width: `${fuelPercent}%` }}
            />
          </div>
        </div>

        {/* Nitro gauge */}
        <div className={`rounded-lg p-3 transition-all duration-150 ${
          nitroActive
            ? 'bg-cyan-500/40 ring-2 ring-cyan-400 shadow-lg shadow-cyan-500/50'
            : 'bg-black/50'
        }`}>
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xl ${nitroActive ? 'animate-bounce' : ''}`}>🚀</span>
            <span className={`text-lg font-bold ${
              nitroActive ? 'text-white animate-pulse' : isNitroLow ? 'text-gray-400' : 'text-cyan-400'
            }`}>
              {Math.ceil(nitro)}%
            </span>
            {nitroActive && <span className="text-sm text-cyan-300 animate-pulse">BOOST!</span>}
          </div>
          <div className="w-48 h-4 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-200 ${
                nitroActive ? 'bg-cyan-400 animate-pulse' : isNitroLow ? 'bg-gray-500' : 'bg-cyan-500'
              }`}
              style={{ width: `${nitroPercent}%` }}
            />
          </div>
        </div>

        {/* Speed */}
        <div className="bg-black/50 rounded-lg px-4 py-2 text-white text-right">
          <div className="text-2xl font-bold">{speed}</div>
          <div className="text-sm text-gray-300">km/h</div>
        </div>
      </div>

      {/* Total coins (bottom left) */}
      <div className="absolute bottom-4 left-4">
        <div className="bg-black/50 rounded-lg px-4 py-2 text-white flex items-center gap-2">
          <span className="text-xl">💰</span>
          <span className="text-xl font-bold">{coins.toLocaleString()}</span>
        </div>
      </div>

      {/* Low fuel warning */}
      {isLowFuel && (
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
          <div className="bg-red-600/90 rounded-xl px-8 py-4 animate-pulse">
            <span className="text-2xl font-bold text-white">⚠️ LOW FUEL!</span>
          </div>
        </div>
      )}
    </div>
  );
}
