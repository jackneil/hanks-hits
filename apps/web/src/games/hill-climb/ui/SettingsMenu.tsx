'use client';

/**
 * Hill Climb Racing - Settings Menu
 *
 * Controls for lean sensitivity, sound, and music.
 */

import { useCoarsePointer } from '@/shared/hooks';
import { useHillClimbStore } from '../lib/store';

interface SettingsMenuProps {
  onBack: () => void;
}

export function SettingsMenu({ onBack }: SettingsMenuProps) {
  const isCoarsePointer = useCoarsePointer();
  const {
    leanSensitivity,
    setLeanSensitivity,
    soundEnabled,
    toggleSound,
    musicEnabled,
    toggleMusic,
  } = useHillClimbStore();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-base-100 rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">⚙️</div>
          <h2 className="text-2xl font-bold text-base-content">Settings</h2>
        </div>

        {/* Settings */}
        <div className="space-y-6">
          {/* Lean Sensitivity */}
          <div>
            <label className="block text-base-content font-medium mb-2">
              Lean Sensitivity
            </label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.1"
                value={leanSensitivity}
                onChange={(e) => setLeanSensitivity(parseFloat(e.target.value))}
                className="range range-primary flex-1"
              />
              <span className="text-lg font-bold text-primary min-w-[4rem] text-right">
                {leanSensitivity.toFixed(1)}x
              </span>
            </div>
            <div className="flex justify-between text-xs text-base-content/50 mt-1">
              <span>Slower</span>
              <span>Faster</span>
            </div>
          </div>

          {/* Sound Toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🔊</span>
              <span className="text-base-content font-medium">Sound Effects</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => !soundEnabled && toggleSound()}
                className={`btn btn-sm ${soundEnabled ? 'btn-primary' : 'btn-ghost'}`}
              >
                ON
              </button>
              <button
                onClick={() => soundEnabled && toggleSound()}
                className={`btn btn-sm ${!soundEnabled ? 'btn-error' : 'btn-ghost'}`}
              >
                OFF
              </button>
            </div>
          </div>

          {/* Music Toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🎵</span>
              <span className="text-base-content font-medium">Music</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => !musicEnabled && toggleMusic()}
                className={`btn btn-sm ${musicEnabled ? 'btn-primary' : 'btn-ghost'}`}
              >
                ON
              </button>
              <button
                onClick={() => musicEnabled && toggleMusic()}
                className={`btn btn-sm ${!musicEnabled ? 'btn-error' : 'btn-ghost'}`}
              >
                OFF
              </button>
            </div>
          </div>
        </div>

        {/* Back Button */}
        <div className="mt-8">
          <button onClick={onBack} className="btn btn-outline w-full">
            ← Back
          </button>
        </div>

        {/* Hint */}
        <div className="text-center mt-4 text-base-content/50 text-sm">
          {isCoarsePointer ? 'Tap Back to go back' : 'Press Escape to go back'}
        </div>
      </div>
    </div>
  );
}
