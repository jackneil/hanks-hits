'use client';

import { useState, useEffect } from 'react';
import { GameSheet, GAME_SHEET_ACTION } from '@/shared/components';
import { useSecondFingerClick } from '@/shared/lib/input';
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
          <div className="text-base text-gray-300">{challenge.description}</div>
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
                : 'bg-orange-400'
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

  // On the shared GameSheet: it covers the screen under the header (the
  // old panel opened UNDER the touch controls, so the truck drove while
  // the kid read), its list scrolls, and "Keep driving" never leaves the
  // screen. The game stands still while it is open (Game.tsx).
  return (
    <GameSheet
      title="Challenges"
      emoji="🏁"
      testId="monster-truck-challenges"
      className="bg-gray-900 text-white"
      actions={
        <button
          type="button"
          onClick={() => setShowChallenges(false)}
          className={`${GAME_SHEET_ACTION} btn-primary`}
        >
          ▶️ Keep driving
        </button>
      }
    >
      <div className="space-y-3 text-left">
        {challenges.map((challenge) => (
          <ChallengeRow
            key={challenge.id}
            challenge={challenge}
            progress={getChallengeProgress(progressSnapshot, challenge)}
          />
        ))}
      </div>
    </GameSheet>
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
  // In-play buttons work for the other thumb while one holds Gas (a browser
  // makes no click for a second finger).
  const challengesTap = useSecondFingerClick<HTMLButtonElement>(() => setShowChallenges(true));
  const pauseTap = useSecondFingerClick<HTMLButtonElement>(onPause);

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
    // Anchored under the GameShell header. Sideways (short screen) the two
    // columns become rows, so they stay out of the controls' corners.
    <div data-testid="monster-truck-hud" className="fixed inset-x-0 bottom-0 top-[var(--shell-header-h)] pointer-events-none z-40">
      {/* Top left - Coins */}
      <div className="absolute top-2 left-3 flex flex-col gap-2 short:flex-row short:items-center short:gap-1.5">
        {/* Coin counter */}
        <div className="bg-black/60 rounded-xl px-3 py-1.5 flex items-center gap-2 short:px-2 short:py-1">
          <span className="text-3xl short:text-xl" aria-hidden="true">🪙</span>
          <span className="text-2xl font-bold text-yellow-400 font-mono short:text-lg">
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
        <div className="bg-black/60 rounded-xl px-3 py-1.5 flex items-center gap-2 short:px-2 short:py-1">
          <span className="text-2xl short:text-lg" aria-hidden="true">⭐</span>
          <span className="text-xl font-bold text-yellow-300 font-mono short:text-lg">
            {starsCollected}
          </span>
        </div>

        {/* Session coins */}
        {/* The pause sheet shows this run's coins too; sideways there is no room */}
        <div className="bg-black/40 rounded-lg px-3 py-1 text-sm text-gray-200 short:hidden">
          Session: +{sessionCoins}
        </div>

        <button
          type="button"
          {...challengesTap}
          className="pointer-events-auto min-h-[44px] rounded-lg bg-emerald-700 px-3 py-2 text-base font-bold text-white transition-colors hover:bg-emerald-600"
        >
          🏁 Challenges
        </button>
      </div>

      {/* Top right - NOS and Speed */}
      <div className="absolute top-2 right-3 flex flex-col gap-2 items-end short:flex-row short:items-center short:gap-1.5">
        {/* NOS meter */}
        <div className="bg-black/60 rounded-xl px-3 py-1.5 w-36 short:w-28 short:py-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-cyan-400 font-bold">NOS</span>
            <span className="text-cyan-300 text-sm">{Math.round(nosPercent)}%</span>
          </div>
          <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-100 ${
                nosPercent > 50 ? 'bg-cyan-400' : nosPercent > 20 ? 'bg-yellow-400' : 'bg-red-400'
              }`}
              style={{ width: `${nosPercent}%` }}
            />
          </div>
        </div>

        {/* Speedometer */}
        <div className="bg-black/60 rounded-xl px-3 py-2 text-center short:py-1">
          <div className="text-4xl font-bold text-white font-mono short:text-2xl" data-testid="monster-truck-speed">
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

      {/* Mobile pause button: top centre, between the two HUD groups (it
          used to sit inside the NOS meter and hide its label) */}
      {isMobile && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 pointer-events-auto">
          <button
            type="button"
            {...pauseTap}
            aria-label="Pause game"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-700/90 text-xl text-white"
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
      <div className="bg-orange-600 rounded-2xl px-8 py-4 text-center shadow-2xl">
        <div className="text-3xl font-bold text-white mb-1">{text}</div>
        <div className="text-2xl font-bold text-yellow-300">+{coins} 🪙</div>
      </div>
    </div>
  );
}

// Pause menu, on the shared GameSheet: it fits a phone held sideways (the
// old card was 548-580 px tall, so RESUME, GARAGE and QUIT were off the
// screen at 667x311), and it shows Leaderboard and Sign In, which leave the
// header during play on a phone (shellActions).
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
    <GameSheet
      title="Paused"
      emoji="⏸️"
      testId="monster-truck-pause"
      shellActions
      spokenText={`Paused. Monster Truck. Total coins ${coins}. This run, ${sessionCoins} coins. Sound ${soundEnabled ? 'on' : 'off'}. Music ${musicEnabled ? 'on' : 'off'}. Keep driving. Garage. Go Home.`}
      actions={
        <>
          <button type="button" onClick={onResume} className={`${GAME_SHEET_ACTION} btn-primary`}>
            ▶️ Keep driving
          </button>
          <button type="button" onClick={onGarage} className={`${GAME_SHEET_ACTION} btn-secondary`}>
            🔧 Garage
          </button>
          <button type="button" onClick={onQuit} className={`${GAME_SHEET_ACTION} btn-outline`}>
            🏠 Go Home
          </button>
        </>
      }
    >
      <div className="mx-auto max-w-xs space-y-2 text-left short:mx-0">
        <div className="flex justify-between text-lg">
          <span>Total coins</span>
          <span className="font-bold">🪙 {coins.toLocaleString()}</span>
        </div>
        <div className="flex justify-between text-lg">
          <span>This run</span>
          <span className="font-bold">+{sessionCoins}</span>
        </div>
        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-lg">
          <span>🔊 Sound</span>
          <input type="checkbox" className="toggle toggle-primary toggle-lg" checked={soundEnabled} aria-label="Sound" onChange={toggleSound} />
        </label>
        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-lg">
          <span>🎵 Music</span>
          <input type="checkbox" className="toggle toggle-primary toggle-lg" checked={musicEnabled} aria-label="Music" onChange={toggleMusic} />
        </label>
      </div>
    </GameSheet>
  );
}
