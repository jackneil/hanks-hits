"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The pause state of a GameShell.
 *
 * Two things can stop a game:
 * - The pause MENU (`pause`, `resume`, `togglePause`, ESC, a hidden tab
 *   for a game that can pause). `isPaused` is true and GameShell shows
 *   the PauseMenu.
 * - A HOLD (`hold(source)`, `release(source)`): a shell overlay is open
 *   (the restart question, the leaderboard, the install steps, a clip
 *   sheet, the orientation tip), or the tab is hidden for a game that
 *   cannot pause. No menu shows. GameShell holds the game while
 *   shellOverlays.ts counts an open overlay.
 *
 * The game hears about both the same way, once:
 * - `onPause` when the game becomes stopped (menu or hold) and it can
 *   pause; `onResume` when the last reason goes away. A hold that starts
 *   while the menu is open sends nothing; closing the menu while a hold is
 *   still on sends nothing.
 * - `onShellOverlayOpen` when the first hold starts and
 *   `onShellOverlayClose` when the last one ends, whether the game can
 *   pause or not. A game that runs its own loop and has no pause menu
 *   (Flappy Bird, Math Attack) freezes its loop on these.
 * - When `canPause` turns on while a hold is on (the orientation tip
 *   shows in the same commit that starts the run), `onPause` follows.
 *
 * Why: shell overlays used to open over a running game (phone UX audit
 * 2026-09-29, S8), and only a game with `canPause` paused on a hidden tab.
 */

export interface UseGameShellOptions {
  canPause?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  pauseOnBlur?: boolean;
  suppressEscape?: boolean;
  /** The first shell overlay opened over the game (or the tab went hidden). */
  onShellOverlayOpen?: () => void;
  /** The last shell overlay closed (or the tab came back). */
  onShellOverlayClose?: () => void;
}

/** The hold that a hidden tab puts on a game that cannot pause. */
export const HIDDEN_HOLD = "hidden";

export function useGameShell(options: UseGameShellOptions = {}) {
  const {
    canPause = true,
    onPause,
    onResume,
    pauseOnBlur = true,
    suppressEscape = false,
    onShellOverlayOpen,
    onShellOverlayClose,
  } = options;
  const [isPaused, setIsPaused] = useState(false);
  const router = useRouter();

  // The newest options, for callbacks that never change identity.
  const latest = useRef({ canPause, onPause, onResume, onShellOverlayOpen, onShellOverlayClose });
  useLayoutEffect(() => {
    latest.current = { canPause, onPause, onResume, onShellOverlayOpen, onShellOverlayClose };
  });

  const menuRef = useRef(false);
  const holdsRef = useRef(new Set<string>());
  /** True while the game has heard onPause and not yet onResume. */
  const deliveredRef = useRef(false);

  /** Tell the game once when it becomes stopped, and once when it is free again. */
  const sync = useCallback(() => {
    const { canPause: can, onPause: pauseGame, onResume: resumeGame } = latest.current;
    const want = can && (menuRef.current || holdsRef.current.size > 0);
    if (want && !deliveredRef.current) {
      deliveredRef.current = true;
      pauseGame?.();
    } else if (!want && deliveredRef.current) {
      deliveredRef.current = false;
      resumeGame?.();
    }
  }, []);

  const pause = useCallback(() => {
    if (!latest.current.canPause) return;
    menuRef.current = true;
    setIsPaused(true);
    sync();
  }, [sync]);

  const resume = useCallback(() => {
    menuRef.current = false;
    setIsPaused(false);
    sync();
  }, [sync]);

  const togglePause = useCallback(() => {
    if (isPaused) {
      resume();
    } else {
      pause();
    }
  }, [isPaused, pause, resume]);

  const hold = useCallback(
    (source: string) => {
      const holds = holdsRef.current;
      if (holds.has(source)) return;
      holds.add(source);
      if (holds.size === 1) latest.current.onShellOverlayOpen?.();
      sync();
    },
    [sync]
  );

  const release = useCallback(
    (source: string) => {
      const holds = holdsRef.current;
      if (!holds.delete(source)) return;
      if (holds.size === 0) latest.current.onShellOverlayClose?.();
      sync();
    },
    [sync]
  );

  // canPause changed: a hold that started before the run can now pause
  // the game, and a game that ended under a hold is let go.
  useEffect(() => {
    sync();
  }, [canPause, sync]);

  const goHome = useCallback(() => {
    router.push("/");
  }, [router]);

  // ESC key for pause
  useEffect(() => {
    if (!canPause || suppressEscape) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        togglePause();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canPause, suppressEscape, togglePause]);

  // A hidden tab (the kid switched apps): a game that can pause opens its
  // pause menu, which stays until the kid resumes. Any other game is held
  // until the tab comes back, so no game time passes while the kid is away
  // (Math Attack lost two lives in a 25 s background).
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (canPause && pauseOnBlur) {
          pause();
        } else {
          hold(HIDDEN_HOLD);
        }
      } else {
        release(HIDDEN_HOLD);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [canPause, pauseOnBlur, pause, hold, release]);

  return {
    isPaused,
    pause,
    resume,
    togglePause,
    goHome,
    hold,
    release,
  };
}
