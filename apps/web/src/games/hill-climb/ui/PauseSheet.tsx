'use client';

/**
 * Hill Climb Racing - the pause sheet.
 *
 * The game's own pause screen on the shared GameSheet: it covers the play
 * area under the header, its body scrolls on a short screen and its
 * action column never scrolls out of view, so Keep driving, Garage and
 * Go Home are on screen at 667x311 with no scroll. The settings (the
 * lean speed and the sound switch) sit in the body: a separate Settings
 * card put its Back button under the fold on a phone held sideways, and
 * its hint told a finger to press Escape (phone UX audit 2026-09-29).
 */

import { useRouter } from 'next/navigation';
import { GameSheet, GAME_SHEET_ACTION } from '@/shared/components';
import { useHillClimbStore } from '../lib/store';

interface PauseSheetProps {
  onGoToGarage: () => void;
}

/** The labels of the sheet, in screen order. The voice says the same words. */
export const PAUSE_SHEET_LABELS = {
  title: 'Paused',
  resume: '▶️ Keep driving',
  garage: '🔧 Garage',
  home: '🏠 Go Home',
} as const;

export function PauseSheet({ onGoToGarage }: PauseSheetProps) {
  const router = useRouter();
  const { resumeGame, leanSensitivity, setLeanSensitivity, soundEnabled, toggleSound } = useHillClimbStore();

  const handleResume = () => {
    resumeGame();
    // Refocus the window for keyboard input
    window.focus();
  };

  const handleGarage = () => {
    resumeGame();
    onGoToGarage();
  };

  const handleQuit = () => {
    resumeGame();
    router.push('/');
  };

  return (
    <GameSheet
      title={PAUSE_SHEET_LABELS.title}
      emoji="⏸️"
      testId="hill-climb-pause"
      spokenText={`Paused. Hill Climb Racing. Keep driving. Garage. Go Home. Lean speed ${leanSensitivity.toFixed(1)}. Sound ${soundEnabled ? 'on' : 'off'}.`}
      actions={
        <>
          <button type="button" onClick={handleResume} className={`${GAME_SHEET_ACTION} btn-primary`}>
            {PAUSE_SHEET_LABELS.resume}
          </button>
          <button type="button" onClick={handleGarage} className={`${GAME_SHEET_ACTION} btn-secondary`}>
            {PAUSE_SHEET_LABELS.garage}
          </button>
          <button type="button" onClick={handleQuit} className={`${GAME_SHEET_ACTION} btn-outline`}>
            {PAUSE_SHEET_LABELS.home}
          </button>
        </>
      }
    >
      <div className="mx-auto max-w-xs space-y-3 text-left short:mx-0 short:space-y-2">
        {/* Lean speed: a 44 px slider (range-lg) for a thumb */}
        <label className="block">
          <span className="flex items-center justify-between text-base font-medium">
            <span>🤸 Lean speed</span>
            <span className="font-bold text-primary">{leanSensitivity.toFixed(1)}x</span>
          </span>
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            value={leanSensitivity}
            aria-label="Lean speed"
            onChange={(e) => setLeanSensitivity(parseFloat(e.target.value))}
            className="range range-primary range-lg mt-1 w-full"
          />
          <span className="flex justify-between text-sm text-base-content/60">
            <span>Slow</span>
            <span>Fast</span>
          </span>
        </label>

        {/* The sound switch: one real control (the speaker gain of this game) */}
        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-base font-medium">
          <span>🔊 Sound</span>
          <input
            type="checkbox"
            className="toggle toggle-primary toggle-lg"
            checked={soundEnabled}
            aria-label="Sound"
            onChange={toggleSound}
          />
        </label>
      </div>
    </GameSheet>
  );
}
