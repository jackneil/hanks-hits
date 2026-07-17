'use client';

/**
 * Hill Climb Racing - Pause Menu
 *
 * Overlay menu when game is paused.
 */

import { useRouter } from 'next/navigation';
import { useCoarsePointer } from '@/shared/hooks';
import { useHillClimbStore } from '../lib/store';
import { SettingsMenu } from './SettingsMenu';

interface PauseMenuProps {
  onGoToGarage: () => void;
}

export function PauseMenu({ onGoToGarage }: PauseMenuProps) {
  const router = useRouter();
  const isCoarsePointer = useCoarsePointer();
  const { pauseScreen, resumeGame, setPauseScreen } = useHillClimbStore();

  // If showing settings submenu, render that instead
  if (pauseScreen === 'settings') {
    return <SettingsMenu onBack={() => setPauseScreen('menu')} />;
  }

  const handleResume = () => {
    resumeGame();
    // Refocus the window for keyboard input
    window.focus();
  };

  const handleSettings = () => {
    setPauseScreen('settings');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-base-100 rounded-2xl p-8 max-w-sm w-full mx-4 shadow-2xl">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-5xl mb-2">⏸️</div>
          <h2 className="text-3xl font-bold text-base-content">PAUSED</h2>
        </div>

        {/* Menu Buttons */}
        <div className="space-y-3">
          <button
            onClick={handleResume}
            className="btn btn-primary btn-lg w-full text-xl"
          >
            ▶️ Continue
          </button>

          <button
            onClick={handleSettings}
            className="btn btn-secondary btn-lg w-full text-xl"
          >
            ⚙️ Settings
          </button>

          <button
            onClick={handleGarage}
            className="btn btn-outline btn-lg w-full"
          >
            🔧 Garage
          </button>

          <button
            onClick={handleQuit}
            className="btn btn-ghost w-full"
          >
            🏠 Quit to Main
          </button>
        </div>

        {/* Hint — keyboard copy only makes sense with a keyboard */}
        <div className="text-center mt-4 text-base-content/50 text-sm">
          {isCoarsePointer ? 'Tap Continue to keep driving' : 'Press Escape to resume'}
        </div>
      </div>
    </div>
  );
}
