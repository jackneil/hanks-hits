"use client";

import { create } from "zustand";

/**
 * Two signals that keep sheets and nudges out of active play.
 *
 * 1. Shells: how many GameShells are on screen. Every game and app page
 *    mounts one, so a count above 0 means the kid can be playing.
 * 2. Break slots: DOM elements that a break surface (the pause menu, and
 *    later the result chip) puts on screen while play is stopped. A nudge
 *    such as the iOS install tip renders INTO the newest slot, as part of
 *    that surface, instead of floating over the game controls.
 *
 * Why: the iOS "Add to Home Screen" sheet used to float over the bottom
 * game controls during play (issue #32). The start card has its own
 * signal in startOverlayPresence.ts.
 */
type GameBreaks = {
  shells: number;
  slots: HTMLElement[];
  enterShell: () => void;
  leaveShell: () => void;
  addSlot: (el: HTMLElement) => void;
  removeSlot: (el: HTMLElement) => void;
};

export const useGameBreaks = create<GameBreaks>((set) => ({
  shells: 0,
  slots: [],
  enterShell: () => set((s) => ({ shells: s.shells + 1 })),
  leaveShell: () => set((s) => ({ shells: Math.max(0, s.shells - 1) })),
  addSlot: (el) =>
    set((s) => (s.slots.includes(el) ? s : { slots: [...s.slots, el] })),
  removeSlot: (el) =>
    set((s) =>
      s.slots.includes(el) ? { slots: s.slots.filter((slot) => slot !== el) } : s
    ),
}));

/** True while at least one GameShell is mounted. */
export function useGameShellMounted(): boolean {
  return useGameBreaks((s) => s.shells > 0);
}

/** The newest break slot on screen, or null during play. */
export function useBreakSlot(): HTMLElement | null {
  return useGameBreaks((s) => s.slots[s.slots.length - 1] ?? null);
}
