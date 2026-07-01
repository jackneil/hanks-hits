'use client';

import { useState, useEffect } from 'react';
import {
  getChallengeProgress,
  useGameStore,
  type Challenge,
} from '../lib/store';

interface GameUIProps {
  speed: number;
  isMobile: boolean;
  onPause: () => void;
  onOpenGarage: () => void;
}

function ChallengeRow({
  challenge,
  progress,
}: {
  challenge: Challenge;
  progress: number;
}) {
  const cappedProgress = Math.min(progress, challenge.target);
  const progressPercent = (cappedProgress / challenge.target) * 100;

  return (
    <div className="rounded-xl bg-white/10 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-bold text-white">{challenge.name}</div>
          <div className="text-sm text-gray-300">{challenge.description}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-bold text-yellow-300">+{challenge.reward}</div>
          <div className="text-xs text-yellow-200">coins</div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="h-3 flex-1 overflow-hidden rounded-full bg-black/40">
          <div
            className={`h-full rounded-full ${
              challenge.completed
                ? 'bg-green-400'
                : 'bg-gradient-to-r from-orange-500 to-yellow-300'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="w-20 text-right text-sm font-mono text-gray-200">
          {Math.floor(cappedProgress)}/{challenge.target}
        </div>
      </div>
      {challenge.completed && (
        <div className="mt-2 text-sm font-bold text-green-300">Completed</div>
      )}
    </div>
  );
}

function ChallengesPanel() {
  const challenges = useGameStore((s) => s.challenges);
  const setShowChallenges = useGameStore((s) => s.setShowChallenges);
  const sessionCoins = useGameStore((s) => s.sessionCoins);
  const sessionAirtime = useGameStore((s) => s.sessionAirtime);
  const sessionFlips = useGameStore((s) => s.sessionFlips);
  const sessionDestructions = useGameStore((s) => s.sessionDestructions);
  const starsCollected = useGameStore((s) => s.starsCollected);
  const progressSnapshot = {
    sessionCoins,
    sessionAirtime,
    sessionFlips,
    sessionDestructions,
    starsCollected,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 pointer-events-auto">
      <div className="w-full max-w-lg rounded-2xl bg-gray-900 p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">🏁 Challenges</h2>
          <button
            onClick={() => setShowChallenges(false)}
            className="rounded-lg bg-white/10 px-3 py-2 font-bold text-white hover:bg-white/20"
            aria-label="Close challenges"
          >
            ✕
          </button>
        </div>
        <div className="space-y-3">
          {challenges.map((challenge) => (
            <ChallengeRow
              key={challenge.id}
              challenge={challenge}
              progress={getChallengeProgress(progressSnapshot, challenge)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function GameUI({ speed, isMobile, onPause, onOpenGarage }: GameUIProps) {
  const coins = useGameStore((s) => s.coins);
  const sessionCoins = useGameStore((s) => s.sessionCoins);
  const nosCharge = useGameStore((s) => s.nosCharge);
  const nosMaxCharge = useGameStore((s) => s.nosMaxCharge);
  const starsCollected = useGameStore((s) => s.starsCollected);
  const showChallenges = useGameStore((s) => s.showChallenges);
  const setShowChallenges = useGameStore((s) => s.setShowChallenges);

  // Coin animation state
  const [animatedCoins, setAnimatedCoins] = useState(coins);
  const [coinDiff, setCoinDiff] = useState(0);

  useEffect(() => {
    if (coins !== animatedCoins) {
      const diff = coins - animatedCoins;
      const updateTimer = setTimeout(() => {
        setCoinDiff(diff);
        setAnimatedCoins(coins);
      }, 0);

      // Clear the diff after animation
      const timer = setTimeout(() => setCoinDiff(0), 1500);
      return () => {
        clearTimeout(updateTimer);
        clearTimeout(timer);
      };
    }
  }, [coins, animatedCoins]);

  const nosPercent = (nosCharge / nosMaxCharge) * 100;
  const speedMph = Math.round(speed * 2.237); // Convert m/s to mph

  return (
    <div className="fixed inset-0 pointer-events-none z-40">
      {/* Top left - Coins */}
      <div className="absolute top-4 left-4 flex flex-col gap-2">
        {/* Coin counter */}
        <div className="bg-black/60 backdrop-blur-sm rounded-xl px-4 py-2 flex items-center gap-2">
          <span className="text-3xl">🪙</span>
          <span className="text-2xl font-bold text-yellow-400 font-mono">
            {coins.toLocaleString()}
          </span>
          {/* Coin gain popup */}
          {coinDiff > 0 && (
            <span className="text-green-400 font-bold animate-bounce">
              +{coinDiff}
            </span>
          )}
        </div>

        {/* Stars counter */}
        <div className="bg-black/60 backdrop-blur-sm rounded-xl px-4 py-2 flex items-center gap-2">
          <span className="text-2xl">⭐</span>
          <span className="text-xl font-bold text-yellow-300 font-mono">
            {starsCollected}
          </span>
        </div>

        {/* Session coins */}
        <div className="bg-black/40 rounded-lg px-3 py-1 text-sm text-gray-300">
          Session: +{sessionCoins}
        </div>

        <button
          onClick={() => setShowChallenges(true)}
          className="pointer-events-auto bg-emerald-600 hover:bg-emerald-500 rounded-lg px-3 py-2 text-sm font-bold text-white transition-colors"
        >
          🏁 Challenges
        </button>
      </div>

      {/* Top right - NOS and Speed */}
      <div className="absolute top-4 right-4 flex flex-col gap-2 items-end">
        {/* NOS meter */}
        <div className="bg-black/60 backdrop-blur-sm rounded-xl px-4 py-2 w-40">
          <div className="flex items-center justify-between mb-1">
            <span className="text-cyan-400 font-bold">NOS</span>
            <span className="text-cyan-300 text-sm">{Math.round(nosPercent)}%</span>
          </div>
          <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-100 ${
                nosPercent > 50
                  ? 'bg-gradient-to-r from-cyan-500 to-cyan-300'
                  : nosPercent > 20
                  ? 'bg-gradient-to-r from-yellow-500 to-yellow-300'
                  : 'bg-gradient-to-r from-red-500 to-red-300'
              }`}
              style={{ width: `${nosPercent}%` }}
            />
          </div>
        </div>

        {/* Speedometer */}
        <div className="bg-black/60 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
          <div className="text-4xl font-bold text-white font-mono">
            {speedMph}
          </div>
          <div className="text-xs text-gray-400">MPH</div>
        </div>
      </div>

      {/* Bottom right - Pause and Garage (not on mobile - they have different controls) */}
      {!isMobile && (
        <div className="absolute bottom-4 right-4 flex gap-2 pointer-events-auto">
          <button
            onClick={onOpenGarage}
            className="bg-orange-600 hover:bg-orange-500 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 transition-colors"
          >
            🔧 Garage
          </button>
          <button
            onClick={onPause}
            className="bg-gray-600 hover:bg-gray-500 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 transition-colors"
          >
            ⏸️ Pause
          </button>
        </div>
      )}

      {/* Desktop controls hint */}
      {!isMobile && (
        <div className="absolute bottom-4 left-4 bg-black/50 rounded-lg px-3 py-2 text-xs text-gray-300">
          <div className="font-bold mb-1">Controls:</div>
          <div>WASD / Arrows - Drive</div>
          <div>Space - NOS Boost</div>
          <div>H - Horn</div>
          <div>R - Reset</div>
        </div>
      )}

      {/* Mobile pause button */}
      {isMobile && (
        <div className="absolute top-4 right-20 pointer-events-auto">
          <button
            onClick={onPause}
            className="bg-gray-600/80 text-white w-12 h-12 rounded-full flex items-center justify-center text-xl"
          >
            ⏸️
          </button>
        </div>
      )}

      {showChallenges && <ChallengesPanel />}
    </div>
  );
}

// Popup for bonuses/achievements
export function BonusPopup({
  text,
  coins,
  onComplete,
}: {
  text: string;
  coins: number;
  onComplete: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onComplete, 2000);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="fixed top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-none animate-bounce">
      <div className="bg-gradient-to-r from-yellow-600 to-orange-600 rounded-2xl px-8 py-4 text-center shadow-2xl">
        <div className="text-3xl font-bold text-white mb-1">{text}</div>
        <div className="text-2xl font-bold text-yellow-300">+{coins} 🪙</div>
      </div>
    </div>
  );
}

// Pause menu
export function PauseMenu({
  onResume,
  onGarage,
  onQuit,
}: {
  onResume: () => void;
  onGarage: () => void;
  onQuit: () => void;
}) {
  const coins = useGameStore((s) => s.coins);
  const sessionCoins = useGameStore((s) => s.sessionCoins);
  const soundEnabled = useGameStore((s) => s.soundEnabled);
  const musicEnabled = useGameStore((s) => s.musicEnabled);
  const toggleSound = useGameStore((s) => s.toggleSound);
  const toggleMusic = useGameStore((s) => s.toggleMusic);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-gradient-to-b from-gray-800 to-gray-900 rounded-3xl p-8 max-w-md w-full mx-4 shadow-2xl">
        <h2 className="text-4xl font-bold text-center text-white mb-6">
          ⏸️ PAUSED
        </h2>

        {/* Session stats */}
        <div className="bg-black/30 rounded-xl p-4 mb-6">
          <div className="flex justify-between text-lg">
            <span className="text-gray-400">Total Coins:</span>
            <span className="text-yellow-400 font-bold">🪙 {coins}</span>
          </div>
          <div className="flex justify-between text-lg">
            <span className="text-gray-400">This Session:</span>
            <span className="text-green-400 font-bold">+{sessionCoins}</span>
          </div>
        </div>

        {/* Settings */}
        <div className="flex justify-center gap-4 mb-6">
          <button
            onClick={toggleSound}
            className={`p-3 rounded-xl ${soundEnabled ? 'bg-green-600' : 'bg-gray-600'}`}
          >
            {soundEnabled ? '🔊' : '🔇'}
          </button>
          <button
            onClick={toggleMusic}
            className={`p-3 rounded-xl ${musicEnabled ? 'bg-green-600' : 'bg-gray-600'}`}
          >
            {musicEnabled ? '🎵' : '🎵❌'}
          </button>
        </div>

        {/* Buttons */}
        <div className="flex flex-col gap-3">
          <button
            onClick={onResume}
            className="bg-green-600 hover:bg-green-500 text-white py-4 px-8 rounded-xl font-bold text-xl transition-colors"
          >
            ▶️ RESUME
          </button>
          <button
            onClick={onGarage}
            className="bg-orange-600 hover:bg-orange-500 text-white py-4 px-8 rounded-xl font-bold text-xl transition-colors"
          >
            🔧 GARAGE
          </button>
          <button
            onClick={onQuit}
            className="bg-gray-600 hover:bg-gray-500 text-white py-3 px-8 rounded-xl font-bold text-lg transition-colors"
          >
            🏠 QUIT TO MENU
          </button>
        </div>
      </div>
    </div>
  );
}
