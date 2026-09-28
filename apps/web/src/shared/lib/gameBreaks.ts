"use client";

import { useCallback, useRef } from "react";
import { create } from "zustand";

/**
 * Two signals that keep sheets and nudges out of active play.
 *
 * 1. Shells: how many game shells are on screen. Every game page mounts a
 *    GameShell, so a count above 0 means the kid can be playing. A shell on
 *    an app page (under /apps/) does not count: an app has no play to
 *    cover (see shellHasPlay).
 * 2. Break slots: DOM elements that a break surface (the start card, the
 *    pause menu, and later the result chip) puts on screen while play is
 *    stopped. A nudge such as the iOS install tip renders INTO the newest
 *    slot, as part of that surface, instead of floating over the game
 *    controls.
 *
 * Why: the iOS "Add to Home Screen" sheet used to float over the bottom
 * game controls during play (issue #32). The start card also has its own
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

/**
 * True when a GameShell on this route can hold active play. App pages
 * ("/apps/weather") have no play to cover, so a nudge may show there as it
 * does on a page with no shell (issue #32: "Show it only on non-game pages
 * or at a natural break").
 */
export function shellHasPlay(pathname: string): boolean {
  return !/^\/apps(\/|$)/.test(pathname);
}

/** True while at least one game shell is mounted. */
export function useGameShellMounted(): boolean {
  return useGameBreaks((s) => s.shells > 0);
}

/** The newest break slot on screen, or null during play. */
export function useBreakSlot(): HTMLElement | null {
  return useGameBreaks((s) => s.slots[s.slots.length - 1] ?? null);
}

/** The data-read-aloud words of the notes inside a container, in DOM order. */
export function readAloudNotesIn(container: HTMLElement | null): string[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll("[data-read-aloud]"))
    .map((el) => el.getAttribute("data-read-aloud")?.trim() ?? "")
    .filter(Boolean);
}

/**
 * Make an element a break slot while it is mounted. A break surface puts
 * `slotRef` on an empty element, and reads the notes that nudges rendered
 * into it with `readNotes()` (for its read-aloud text).
 */
export function useRegisterBreakSlot(): {
  slotRef: (el: HTMLElement | null) => (() => void) | undefined;
  readNotes: () => string[];
} {
  const addSlot = useGameBreaks((s) => s.addSlot);
  const removeSlot = useGameBreaks((s) => s.removeSlot);
  const slotEl = useRef<HTMLElement | null>(null);

  const slotRef = useCallback(
    (el: HTMLElement | null) => {
      slotEl.current = el;
      if (!el) return undefined;
      addSlot(el);
      return () => {
        slotEl.current = null;
        removeSlot(el);
      };
    },
    [addSlot, removeSlot]
  );

  const readNotes = useCallback(() => readAloudNotesIn(slotEl.current), []);

  return { slotRef, readNotes };
}
