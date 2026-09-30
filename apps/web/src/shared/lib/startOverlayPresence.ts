"use client";

import { create } from "zustand";

/**
 * Counts how many start cards (GameStartOverlay) are on screen right now,
 * and remembers the route where the last start card left.
 *
 * Why: the iOS "Add to Home Screen" banner is a fixed sheet at the bottom
 * of the screen. On an iPhone it covered the Play button of almost every
 * game (2026-09-05 sweep). Anything that wants to stay out of the way of
 * a start card reads this store instead of sniffing the DOM.
 *
 * leftOn: an app page (under /apps/) has no game shell that counts as
 * play (gameBreaks.ts, shellHasPlay). When the start card of an app
 * leaves, the kid has pressed Start and is in the app: a Trivia quiz with
 * a 20 s timer. A nudge reads leftOn to keep out of the way there too
 * (gameBreaks.ts, useNudgePlacement). Before this, the install sheet
 * showed over the four answers the moment the start card left.
 */
type StartOverlayPresence = {
  count: number;
  /** The route where the newest start card mounted. */
  enteredOn: string | null;
  /** The route where a start card last left, or null. */
  leftOn: string | null;
  enter: () => void;
  leave: () => void;
};

function currentRoute(): string | null {
  return typeof window === "undefined" ? null : window.location.pathname;
}

export const useStartOverlayPresence = create<StartOverlayPresence>((set) => ({
  count: 0,
  enteredOn: null,
  leftOn: null,
  enter: () => set((s) => ({ count: s.count + 1, enteredOn: currentRoute() })),
  // A card also leaves in the commit of a route change, when the URL is
  // already the next route. The route it entered on is the one it left.
  leave: () =>
    set((s) => ({
      count: Math.max(0, s.count - 1),
      leftOn: s.enteredOn ?? currentRoute(),
    })),
}));

/** True while at least one start card is mounted. */
export function useStartOverlayShowing(): boolean {
  return useStartOverlayPresence((s) => s.count > 0);
}

/** The route where a start card last left, or null. */
export function useStartCardLeftOn(): string | null {
  return useStartOverlayPresence((s) => s.leftOn);
}
