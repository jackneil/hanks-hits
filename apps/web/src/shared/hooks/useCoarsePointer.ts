"use client";

import { useEffect, useState } from "react";

const COARSE_QUERY = "(pointer: coarse)";

/**
 * True when the PRIMARY pointer is coarse (finger on a touchscreen),
 * false for mouse/trackpad viewports. Live-updates if the primary
 * pointer changes (e.g. a convertible laptop flipping to tablet mode).
 *
 * Drives which controls copy a game shows: touch viewports must never
 * see keyboard-only instructions (2026-07-10 audit).
 */
export function useCoarsePointer(): boolean {
  const [isCoarse, setIsCoarse] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(COARSE_QUERY).matches;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia(COARSE_QUERY);
    const handleChange = () => setIsCoarse(mediaQuery.matches);
    // Sync once in case the value changed between render and effect
    handleChange();
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return isCoarse;
}
