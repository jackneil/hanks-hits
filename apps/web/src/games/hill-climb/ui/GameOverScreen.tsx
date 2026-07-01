'use client';

/**
 * Hill Climb Racing - Game Over Screen
 *
 * Shows stats and restart button.
 */

import { useHillClimbStore } from '../lib/store';
import Link from 'next/link';

interface GameOverScreenProps {
  onRestart: () => void;
  onGoToGarage: () => void;
}

export function GameOverScreen({ onRestart, onGoToGarage }: GameOverScreenProps) {
  const {
    distance,
    bestDistance,
    sessionCoins,
    sessionFlips,
    sessionAirtime,
    gameOverReason,
    coins,
  } = useHillClimbStore();

  const isNewRecord = distance >= bestDistance && distance > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-base-100 rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
        {/* Header */}
        <div className="text-center mb-6">
          {gameOverReason === 'head' ? (
            <>
              <div className="text-6xl mb-2">💀</div>
              <h2 className="text-3xl font-bold text-red-500">CRASHED!</h2>
              <p className="text-base-content/70">Your head hit the ground!</p>
            </>
          ) : (
            <>
              <div className="text-6xl mb-2">⛽</div>
              <h2 className="text-3xl font-bold text-orange-500">OUT OF FUEL!</h2>
              <p className="text-base-content/70">Find more fuel cans next time!</p>
            </>
          )}
        </div>

        {/* New Record */}
        {isNewRecord && (
          <div className="bg-yellow-500/20 border-2 border-yellow-500 rounded-xl p-4 mb-6 text-center animate-pulse">
            <span className="text-2xl">🏆</span>
            <span className="text-xl font-bold text-yellow-500 ml-2">
              NEW RECORD!
            </span>
          </div>
        )}

        {/* Stats */}
        <div className="space-y-3 mb-6">
          {/* Distance */}
          <div className="flex justify-between items-center bg-base-200 rounded-lg p-3">
            <span className="text-base-content/70">Distance</span>
            <span className="text-2xl font-bold">{Math.floor(distance)}m</span>
          </div>

          {/* Coins earned */}
          <div className="flex justify-between items-center bg-base-200 rounded-lg p-3">
            <span className="text-base-content/70">Coins Earned</span>
            <span className="text-2xl font-bold text-yellow-500">
              +{sessionCoins} 🪙
            </span>
          </div>

          {/* Flips */}
          {sessionFlips > 0 && (
            <div className="flex justify-between items-center bg-base-200 rounded-lg p-3">
              <span className="text-base-content/70">Flips</span>
              <span className="text-xl font-bold">{sessionFlips} 🔄</span>
            </div>
          )}

          {/* Airtime */}
          {sessionAirtime > 1 && (
            <div className="flex justify-between items-center bg-base-200 rounded-lg p-3">
              <span className="text-base-content/70">Air Time</span>
              <span className="text-xl font-bold">{sessionAirtime.toFixed(1)}s ✈️</span>
            </div>
          )}

          {/* Total coins */}
          <div className="flex justify-between items-center bg-yellow-500/10 rounded-lg p-3 border border-yellow-500/30">
            <span className="text-base-content/70">Total Coins</span>
            <span className="text-xl font-bold text-yellow-500">
              {coins.toLocaleString()} 💰
            </span>
          </div>
        </div>

        {/* Buttons */}
        <div className="space-y-3">
          <button
            onClick={onRestart}
            className="btn btn-primary btn-lg w-full text-xl"
          >
            🔄 Try Again
          </button>

          <button
            onClick={onGoToGarage}
            className="btn btn-outline btn-lg w-full"
          >
            🔧 Garage
          </button>

          <Link
            href="/"
            className="btn btn-ghost w-full"
          >
            🏠 Home
          </Link>
        </div>
      </div>
    </div>
  );
}
