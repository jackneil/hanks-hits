'use client';

import { useState } from 'react';

/**
 * iOS "Add to Home Screen" prompt
 *
 * Shows only on iPhone (not iPad which supports fullscreen).
 * Non-blocking banner at the bottom of the screen.
 * Can be dismissed and remembered via localStorage.
 */

interface IOSInstallPromptProps {
  onClose?: () => void;
}

export function IOSInstallPrompt({ onClose }: IOSInstallPromptProps) {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return true;

    const navigatorWithStandalone = window.navigator as Navigator & {
      standalone?: boolean;
    };
    const isIPhone = /iPhone|iPod/.test(window.navigator.userAgent);
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      navigatorWithStandalone.standalone === true;
    const wasDismissed = localStorage.getItem('ios-install-prompt-dismissed');

    return !isIPhone || isStandalone || !!wasDismissed;
  });

  const handleDismiss = () => {
    setDismissed(true);
    onClose?.();
  };

  const handleDontShowAgain = () => {
    localStorage.setItem('ios-install-prompt-dismissed', 'true');
    setDismissed(true);
    onClose?.();
  };

  if (dismissed) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[200] animate-slide-up">
      <div className="mx-2 mb-2 bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-4 shadow-2xl border border-blue-400/30">
        {/* Close button */}
        <button
          onClick={handleDismiss}
          className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center text-white/70 hover:text-white text-xl"
          aria-label="Close"
        >
          ×
        </button>

        <div className="flex items-start gap-4">
          {/* Animated icon */}
          <div className="flex-shrink-0 text-4xl animate-bounce">
            📲
          </div>

          <div className="flex-1 text-white">
            <h3 className="font-bold text-lg mb-1">
              Play Fullscreen!
            </h3>
            <p className="text-sm text-white/80 mb-3">
              Add to your home screen for the best experience:
            </p>

            {/* Instructions */}
            <div className="flex items-center gap-2 text-sm bg-white/10 rounded-lg p-2 mb-3">
              <span className="text-2xl">
                {/* Safari share icon */}
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12l7-7 7 7" />
                  <rect x="4" y="14" width="16" height="6" rx="1" />
                </svg>
              </span>
              <span>Tap</span>
              <span className="font-bold bg-white/20 px-2 py-0.5 rounded">Share</span>
              <span>→</span>
              <span className="font-bold bg-white/20 px-2 py-0.5 rounded">Add to Home Screen</span>
            </div>

            {/* Don't show again */}
            <button
              onClick={handleDontShowAgain}
              className="text-xs text-white/50 hover:text-white/80 underline"
            >
              Don&apos;t show this again
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slide-up {
          from {
            transform: translateY(100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        .animate-slide-up {
          animation: slide-up 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}
