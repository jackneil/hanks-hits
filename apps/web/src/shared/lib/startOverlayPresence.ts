"use client";

import { create } from "zustand";

/**
 * Counts how many start cards (GameStartOverlay) are on screen right now.
 *
 * Why: the iOS "Add to Home Screen" banner is a fixed sheet at the bottom
 * of the screen. On an iPhone it covered the Play button of almost every
 * game (2026-09-05 sweep). Anything that wants to stay out of the way of
 * a start card reads this store instead of sniffing the DOM.
 */
type StartOverlayPresence = {
  count: number;
  enter: () => void;
  leave: () => void;
};

export const useStartOverlayPresence = create<StartOverlayPresence>((set) => ({
  count: 0,
  enter: () => set((s) => ({ count: s.count + 1 })),
  leave: () => set((s) => ({ count: Math.max(0, s.count - 1) })),
}));

/** True while at least one start card is mounted. */
export function useStartOverlayShowing(): boolean {
  return useStartOverlayPresence((s) => s.count > 0);
}
