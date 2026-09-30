"use client";

import { useLayoutEffect } from "react";
import { create } from "zustand";

/**
 * How many shell overlays are open right now: the restart question, the
 * leaderboard, the install steps that the 📲 button opens, a clip sheet,
 * and the orientation tip.
 *
 * Why: these opened over a running game. Hill Climb kept driving and
 * taking touches under "Restart game?", Asteroids kept moving behind the
 * leaderboard (phone UX audit 2026-09-29, S8). Each overlay counts itself
 * here while it is open, and GameShell holds the game (useGameShell)
 * while the count is above 0: it calls the game's onPause without the
 * pause menu, and onShellOverlayOpen for a game that runs its own loop.
 *
 * An overlay that portals to document.body still counts, because the count
 * is a store, not the DOM tree.
 */
type ShellOverlays = {
  count: number;
  open: () => void;
  close: () => void;
};

export const useShellOverlays = create<ShellOverlays>((set) => ({
  count: 0,
  open: () => set((s) => ({ count: s.count + 1 })),
  close: () => set((s) => ({ count: Math.max(0, s.count - 1) })),
}));

/** Count this overlay while `open` is true. Put it in every shell overlay. */
export function useShellOverlay(open: boolean): void {
  const add = useShellOverlays((s) => s.open);
  const remove = useShellOverlays((s) => s.close);
  // A layout effect: the hold lands in the same commit as the overlay, so
  // the game does not get a frame of input under it.
  useLayoutEffect(() => {
    if (!open) return;
    add();
    return remove;
  }, [open, add, remove]);
}

/** True while at least one shell overlay is open. */
export function useShellOverlayOpen(): boolean {
  return useShellOverlays((s) => s.count > 0);
}
