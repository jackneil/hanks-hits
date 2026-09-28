'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';

import { useBreakSlot, useGameShellMounted } from '../lib/gameBreaks';
import { useStartOverlayShowing } from '../lib/startOverlayPresence';
import { ReadAloudButton } from './ReadAloudButton';

/**
 * iOS "Add to Home Screen" prompt
 *
 * Shows only on iPhone (not iPad, which supports fullscreen), and never in
 * the installed app. It has two modes.
 *
 * Automatic (the default, mounted by a game or an app):
 * - It never shows during active play (issue #32). While a GameShell is on
 *   screen, it shows only inside a break surface: when the pause menu is
 *   open, the tip renders into the menu's break slot, as part of the menu,
 *   so it cannot cover a game control or a menu button.
 * - It stays hidden while a start card is on screen, because a bottom sheet
 *   sits over the Play button on an iPhone.
 * - On a page with no GameShell, it is a bottom sheet.
 * - "Don't show this again" is remembered in localStorage.
 *
 * Requested (`requested`, used by the 📲 button): the kid asked for the
 * steps, so the sheet opens at once, in any state, above the pause menu.
 */

const DISMISS_KEY = 'ios-install-prompt-dismissed';

/** The words that the read-aloud control speaks for this prompt. */
export const IOS_INSTALL_SPOKEN =
  'Play full screen! Tap the Share button. Then tap Add to Home Screen.';

interface IOSInstallPromptProps {
  onClose?: () => void;
  /** The kid tapped a button that asked for these steps. */
  requested?: boolean;
}

function isEligibleIPhone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  const isIPhone = /iPhone|iPod/.test(nav.userAgent);
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
  return isIPhone && !isStandalone;
}

function wasDismissedForever(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return !!localStorage.getItem(DISMISS_KEY);
  } catch {
    return false;
  }
}

function ShareIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 5v14M5 12l7-7 7 7" />
      <rect x="4" y="14" width="16" height="6" rx="1" />
    </svg>
  );
}

function Steps() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm bg-blue-800 rounded-lg p-2 mb-3">
      <ShareIcon />
      <span>Tap</span>
      <span className="font-bold bg-blue-900 px-2 py-0.5 rounded">Share</span>
      <span>then</span>
      <span className="font-bold bg-blue-900 px-2 py-0.5 rounded">Add to Home Screen</span>
    </div>
  );
}

function DontShowAgainButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-[44px] px-2 text-sm text-blue-100 underline hover:text-white"
    >
      Don&apos;t show this again
    </button>
  );
}

function InstallSheet({
  layer,
  onClose,
  onDontShowAgain,
}: {
  layer: 'page' | 'requested';
  onClose: () => void;
  onDontShowAgain: () => void;
}) {
  // "requested" sits above the pause menu (z-2000) and below the restart
  // dialog (z-3000); "page" is the plain page-level banner.
  const z = layer === 'requested' ? 'z-[2500]' : 'z-[200]';

  return (
    <section
      aria-label="Play full screen"
      data-testid="ios-install-sheet"
      className={`ios-install-sheet fixed inset-x-0 bottom-0 ${z} px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]`}
    >
      <div className="relative bg-blue-700 text-white rounded-2xl p-4 shadow-lg">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-1 right-1 w-11 h-11 flex items-center justify-center text-3xl leading-none text-blue-100 hover:text-white"
          aria-label="Close"
        >
          ×
        </button>

        <div className="flex items-start gap-3 pr-10">
          <span className="shrink-0 text-4xl" aria-hidden="true">
            📲
          </span>
          <div className="min-w-0">
            <h3 className="font-bold text-lg mb-1">Play Fullscreen!</h3>
            <p className="text-sm text-blue-100 mb-3">Add this game to your Home Screen:</p>
          </div>
        </div>

        <Steps />

        <div className="flex items-center justify-between gap-2">
          <ReadAloudButton variant="icon" text={IOS_INSTALL_SPOKEN} />
          <DontShowAgainButton onClick={onDontShowAgain} />
        </div>
      </div>

      <style>{`
        @keyframes ios-install-slide-up {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @media (prefers-reduced-motion: no-preference) {
          .ios-install-sheet {
            animation: ios-install-slide-up 250ms cubic-bezier(0.22, 1, 0.36, 1);
          }
        }
      `}</style>
    </section>
  );
}

/**
 * The tip inside a break surface. It has no close button: closing the
 * surface hides it. The pause menu reads the data-read-aloud words.
 */
function InstallTip({ onDontShowAgain }: { onDontShowAgain: () => void }) {
  return (
    <div
      data-testid="ios-install-tip"
      data-read-aloud={IOS_INSTALL_SPOKEN}
      className="rounded-2xl bg-blue-700 p-4 text-left text-white"
    >
      <div className="mb-2 flex items-center gap-2 text-lg font-bold">
        <span aria-hidden="true">📲</span>
        Play Fullscreen!
      </div>
      <Steps />
      <DontShowAgainButton onClick={onDontShowAgain} />
    </div>
  );
}

export function IOSInstallPrompt({ onClose, requested = false }: IOSInstallPromptProps) {
  // Read once per mount: the phone and the saved choice do not change
  // while the page is open.
  const [eligible] = useState(isEligibleIPhone);
  const [dismissedForever, setDismissedForever] = useState(wasDismissedForever);
  const [closed, setClosed] = useState(false);

  const startCardShowing = useStartOverlayShowing();
  const shellMounted = useGameShellMounted();
  const breakSlot = useBreakSlot();

  const close = () => {
    setClosed(true);
    onClose?.();
  };

  const dontShowAgain = () => {
    try {
      localStorage.setItem(DISMISS_KEY, 'true');
    } catch {
      // Storage can be full or blocked; hiding for this visit still works.
    }
    setDismissedForever(true);
    close();
  };

  if (closed) return null;

  if (requested) {
    return createPortal(
      <InstallSheet layer="requested" onClose={close} onDontShowAgain={dontShowAgain} />,
      document.body
    );
  }

  if (!eligible || dismissedForever) return null;

  // Play is stopped and a break surface is up: be part of it.
  if (breakSlot) {
    return createPortal(<InstallTip onDontShowAgain={dontShowAgain} />, breakSlot);
  }

  // A game or an app is on screen and running: never cover its controls.
  if (shellMounted) return null;

  // A start card is up: the sheet would cover the Play button.
  if (startCardShowing) return null;

  return createPortal(
    <InstallSheet layer="page" onClose={close} onDontShowAgain={dontShowAgain} />,
    document.body
  );
}
