'use client';

import { useState } from 'react';
import { useFullscreen } from '../hooks/useFullscreen';
import { IOSInstallPrompt } from './IOSInstallPrompt';

/**
 * Platform-aware fullscreen button
 *
 * - Android/Desktop/iPad: Shows expand icon, uses fullscreen API
 * - iPhone: Shows install icon, opens IOSInstallPrompt
 * - PWA mode: Hidden (already fullscreen)
 */

interface FullscreenButtonProps {
  className?: string;
  /**
   * "floating": the original dark circle for free placement in a game's own
   * layout. "header": compact transparent style sized to sit inside the
   * GameShell header row next to the leaderboard/pause buttons (the floating
   * circle used to be absolutely positioned at top-4 and rendered half-under
   * the sticky header on ~30 pages — 2026-07-10 audit, High).
   * "menu": a wide labelled button for the pause menu. GameShell moves
   * Fullscreen there on very narrow phones (headerBudget.ts, step 5). The
   * visible label is also what the pause menu reads out loud.
   */
  variant?: 'floating' | 'header' | 'menu';
}

function ExpandIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  );
}

function CompressIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
    </svg>
  );
}

const MENU_CLASSES =
  'btn btn-lg w-full text-xl gap-3 shadow-lg hover:scale-105 transition-transform';

export function FullscreenButton({ className = '', variant = 'floating' }: FullscreenButtonProps) {
  const { isSupported, isFullscreen, isIPhone, isPWA, toggle } = useFullscreen();
  const [showIOSPrompt, setShowIOSPrompt] = useState(false);

  const baseClasses =
    variant === 'header'
      ? 'min-w-[44px] min-h-[44px] flex items-center justify-center text-white hover:scale-110 transition-transform active:scale-95'
      : 'w-12 h-12 rounded-full flex items-center justify-center text-white shadow-lg active:scale-95 transition-all';

  // Hide if already in PWA mode (already fullscreen)
  if (isPWA) return null;

  // iPhone: Show install prompt button. The kid asked for the steps, so
  // the prompt opens as a requested sheet: it shows even during play and
  // above the pause menu.
  if (isIPhone) {
    const prompt = showIOSPrompt && (
      <IOSInstallPrompt requested onClose={() => setShowIOSPrompt(false)} />
    );

    if (variant === 'menu') {
      return (
        <>
          <button
            type="button"
            onClick={() => setShowIOSPrompt(true)}
            className={`${MENU_CLASSES} ${className}`}
          >
            <span className="text-2xl" aria-hidden="true">📲</span>
            Full Screen
          </button>
          {prompt}
        </>
      );
    }

    return (
      <>
        <button
          onClick={() => setShowIOSPrompt(true)}
          className={`
            ${baseClasses}
            ${variant === 'floating' ? 'bg-blue-600 hover:bg-blue-500' : ''}
            text-2xl
            ${className}
          `}
          aria-label="Install app for fullscreen"
          title="Add to Home Screen for fullscreen"
        >
          📲
        </button>
        {prompt}
      </>
    );
  }

  // Not supported (shouldn't happen for non-iPhone, but safety check)
  if (!isSupported) return null;

  if (variant === 'menu') {
    return (
      <button type="button" onClick={toggle} className={`${MENU_CLASSES} ${className}`}>
        {isFullscreen ? <CompressIcon /> : <ExpandIcon />}
        {isFullscreen ? 'Leave Full Screen' : 'Full Screen'}
      </button>
    );
  }

  // Android/Desktop/iPad: Standard fullscreen toggle
  return (
    <button
      onClick={toggle}
      className={`
        ${baseClasses}
        ${variant === 'floating' ? 'bg-gray-800/80 hover:bg-gray-700' : ''}
        ${className}
      `}
      aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
      title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
    >
      {isFullscreen ? <CompressIcon /> : <ExpandIcon />}
    </button>
  );
}
