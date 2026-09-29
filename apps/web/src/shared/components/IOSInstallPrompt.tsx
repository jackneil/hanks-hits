'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useBottomSheetSpace } from '../lib/bottomSheetSpace';
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
 * - It never shows during active play (issue #32). It shows as a tip
 *   INSIDE a break surface (gameBreaks.ts), as part of that surface, so it
 *   cannot cover a game control or a menu button:
 *   - on the start screen, OUTSIDE the start card (below it, or beside it
 *     on a short screen). It never goes in the card, so it never pushes
 *     Play down. The start screen gives it a slot only while the whole
 *     card still fits next to it; if not, the tip waits for the pause menu;
 *   - in the pause menu, below the menu buttons.
 *   Both surfaces read the tip out loud with the rest of their words.
 * - On a game page with no break surface up, the kid is playing: it hides.
 * - On an app page (under /apps/) or a page with no GameShell, there is no
 *   play to cover, so it is a bottom sheet. It stays hidden while a start
 *   card with no break slot is on screen, because the sheet would sit over
 *   the Play button.
 * - "Don't show this again" is remembered in localStorage.
 *
 * While a sheet shows (either mode), the page gets space at its end equal
 * to the sheet's height (bottomSheetSpace.ts), so the kid can scroll the
 * last thing on the page up clear of the sheet. The tip inside a break
 * surface is part of that surface and needs no space.
 *
 * On a short screen (the short: variant in globals.css, a phone held
 * sideways) the sheet is one row: the icon, the steps, Read it to me,
 * Don't show this again and Close. The full sheet was 200 px tall there,
 * over half of the screen. The row keeps the 44 px targets, and the
 * reserved space follows its height.
 *
 * Requested (`requested`, used by the 📲 button): the kid asked for the
 * steps, so the sheet opens at once, in any state, above the pause menu.
 */

const DISMISS_KEY = 'ios-install-prompt-dismissed';

/** The steps, in the words that the read-aloud controls speak. */
export const IOS_INSTALL_SPOKEN =
  'Play full screen! Tap the Share button. Then tap Add to Home Screen.';

const DONT_SHOW_SPOKEN = "To hide this tip for good, tap Don't show this again.";

/** What the tip inside a break surface says: the steps and its one button. */
export const IOS_INSTALL_TIP_SPOKEN = `${IOS_INSTALL_SPOKEN} ${DONT_SHOW_SPOKEN}`;

/** What the sheet says: the steps and both of its buttons. */
export const IOS_INSTALL_SHEET_SPOKEN = `${IOS_INSTALL_SPOKEN} Tap the X to close it. ${DONT_SHOW_SPOKEN}`;

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

/** The two steps. `className` adds to the box (the sheet makes it part of its row). */
function Steps({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-2 text-sm bg-blue-800 rounded-lg p-2 mb-3 ${className}`}>
      <ShareIcon />
      <span>Tap</span>
      <span className="font-bold bg-blue-900 px-2 py-0.5 rounded">Share</span>
      <span>then</span>
      <span className="font-bold bg-blue-900 px-2 py-0.5 rounded">Add to Home Screen</span>
    </div>
  );
}

function DontShowAgainButton({ onClick, className = "" }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[44px] px-2 text-sm text-blue-100 underline hover:text-white ${className}`}
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

  // The sheet is fixed over the bottom of the page: reserve its height at
  // the end of the page while it shows, so nothing stays stuck under it.
  const sheetRef = useRef<HTMLElement>(null);
  useBottomSheetSpace(sheetRef);

  return (
    <section
      ref={sheetRef}
      aria-label="Play full screen"
      data-testid="ios-install-sheet"
      data-layer={layer}
      className={`ios-install-sheet fixed inset-x-0 bottom-0 ${z} pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] pb-[max(0.5rem,env(safe-area-inset-bottom))]`}
    >
      {/* Upright: a card with the title, the steps, then the buttons, and
          Close in the corner. Short screen (sideways): one row in the same
          order as the DOM, so it reads and tabs from left to right. The
          row wraps only if the steps have less than 10rem. */}
      <div className="relative bg-blue-700 text-white rounded-2xl p-4 shadow-lg short:flex short:flex-wrap short:items-center short:gap-x-3 short:gap-y-2 short:p-2 short:pl-3">
        <div className="flex items-start gap-3 pr-10 short:shrink-0 short:pr-0">
          <span className="shrink-0 text-4xl short:text-3xl" aria-hidden="true">
            📲
          </span>
          <div className="min-w-0 short:hidden">
            <h3 className="font-bold text-lg mb-1">Play Fullscreen!</h3>
            <p className="text-sm text-blue-100 mb-3">Add this game to your Home Screen:</p>
          </div>
        </div>

        <Steps className="short:mb-0 short:min-w-40 short:flex-1 short:gap-x-1.5 short:gap-y-1 short:bg-transparent short:p-0" />

        <div className="flex items-center justify-between gap-2 short:shrink-0">
          <ReadAloudButton variant="icon" text={IOS_INSTALL_SHEET_SPOKEN} />
          <DontShowAgainButton onClick={onDontShowAgain} className="short:whitespace-nowrap" />
        </div>

        <button
          type="button"
          onClick={onClose}
          className="absolute top-1 right-1 w-11 h-11 flex items-center justify-center text-3xl leading-none text-blue-100 hover:text-white short:static short:shrink-0"
          aria-label="Close"
        >
          ×
        </button>
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
 * surface hides it. The surface reads the data-read-aloud words, which
 * name the tip's one button too.
 */
function InstallTip({ onDontShowAgain }: { onDontShowAgain: () => void }) {
  return (
    <div
      data-testid="ios-install-tip"
      data-read-aloud={IOS_INSTALL_TIP_SPOKEN}
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

  // Decide where to show only after the first layout pass. A start card or
  // a game shell that mounts in the same commit counts itself in a layout
  // effect, but the store hooks above subscribe only after paint, so the
  // first render cannot see those counts: it showed the sheet over the
  // start card for one frame (/apps/trivia). The layout effect below makes
  // a second render before paint, and that render reads the counts.
  const [laidOut, setLaidOut] = useState(false);
  useLayoutEffect(() => {
    // One extra render per mount, before paint, is the point here: the
    // render after the layout pass is the first one that can read the
    // counts. (React documents layout effect + setState for a correction
    // that must land before paint.)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLaidOut(true);
  }, []);

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

  if (closed || !laidOut) return null;

  if (requested) {
    return createPortal(
      <InstallSheet layer="requested" onClose={close} onDontShowAgain={dontShowAgain} />,
      document.body
    );
  }

  if (!eligible || dismissedForever) return null;

  // Play is stopped and a break surface (start card, pause menu) is up:
  // be part of it.
  if (breakSlot) {
    return createPortal(<InstallTip onDontShowAgain={dontShowAgain} />, breakSlot);
  }

  // A game is on screen and running: never cover its controls. (A shell
  // on an app page does not count: gameBreaks.ts, shellHasPlay.)
  if (shellMounted) return null;

  // A start card with no break slot is up: the sheet would cover Play.
  if (startCardShowing) return null;

  return createPortal(
    <InstallSheet layer="page" onClose={close} onDontShowAgain={dontShowAgain} />,
    document.body
  );
}
