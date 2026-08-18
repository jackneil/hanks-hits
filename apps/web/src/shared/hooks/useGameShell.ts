"use client";

import { useEffect, useCallback, useState } from "react";
import { useRouter } from "next/navigation";

interface UseGameShellOptions {
  canPause?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  pauseOnBlur?: boolean;
  suppressEscape?: boolean;
}

export function useGameShell(options: UseGameShellOptions = {}) {
  const { canPause = true, onPause, onResume, pauseOnBlur = true, suppressEscape = false } = options;
  const [isPaused, setIsPaused] = useState(false);
  const router = useRouter();

  const pause = useCallback(() => {
    if (!canPause) return;
    setIsPaused(true);
    onPause?.();
  }, [canPause, onPause]);

  const resume = useCallback(() => {
    setIsPaused(false);
    onResume?.();
  }, [onResume]);

  const togglePause = useCallback(() => {
    if (isPaused) {
      resume();
    } else {
      pause();
    }
  }, [isPaused, pause, resume]);

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

  // Pause on visibility change (tab switch)
  useEffect(() => {
    if (!canPause || !pauseOnBlur) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        pause();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [canPause, pauseOnBlur, pause]);

  return {
    isPaused,
    pause,
    resume,
    togglePause,
    goHome,
  };
}
