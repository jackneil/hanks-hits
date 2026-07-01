'use client';

import { useState, useEffect } from 'react';

/**
 * Orientation warning overlay
 *
 * Shows "Rotate your phone" message when device is in portrait mode.
 * Games work best in landscape orientation.
 * Includes "Continue anyway" button for users who can't or don't want to rotate.
 */

interface OrientationWarningProps {
  /** Override to hide the warning even in portrait */
  disabled?: boolean;
}

export function OrientationWarning({ disabled = false }: OrientationWarningProps) {
  const [isPortrait, setIsPortrait] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const checkOrientation = () => {
      // Use matchMedia for more reliable detection
      const portrait = window.matchMedia('(orientation: portrait)').matches;
      setIsPortrait(portrait);
      if (!portrait) {
        setDismissed(false);
      }
    };

    // Initial check
    checkOrientation();

    // Listen for orientation changes
    const mediaQuery = window.matchMedia('(orientation: portrait)');
    mediaQuery.addEventListener('change', checkOrientation);

    // Also listen for resize (backup)
    window.addEventListener('resize', checkOrientation);

    return () => {
      mediaQuery.removeEventListener('change', checkOrientation);
      window.removeEventListener('resize', checkOrientation);
    };
  }, []);

  // Don't show if disabled, dismissed, or in landscape
  if (disabled || dismissed || !isPortrait) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center p-8">
      {/* Animated rotating phone */}
      <div className="text-8xl mb-6 animate-tilt">
        📱
      </div>

      <h2 className="text-white text-2xl font-bold text-center mb-2">
        Rotate Your Phone
      </h2>

      <p className="text-white/70 text-center mb-8 max-w-xs">
        This game works best in landscape mode. Turn your phone sideways for the best experience!
      </p>

      {/* Rotation arrow indicator */}
      <div className="text-4xl text-white/50 mb-8 animate-pulse">
        ↻
      </div>

      {/* Continue anyway button */}
      <button
        onClick={() => setDismissed(true)}
        className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-full text-sm transition-colors"
      >
        Continue in portrait anyway
      </button>

      <style>{`
        @keyframes tilt {
          0%, 100% {
            transform: rotate(0deg);
          }
          25% {
            transform: rotate(-15deg);
          }
          75% {
            transform: rotate(90deg);
          }
        }
        .animate-tilt {
          animation: tilt 2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
