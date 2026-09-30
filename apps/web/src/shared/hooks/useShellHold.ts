"use client";

import { createContext, useContext } from "react";

import { useShellOverlayOpen } from "../lib/shellOverlays";

/**
 * True while the shell holds the game: a shell overlay is open (the
 * restart question, the leaderboard, the install steps, a clip sheet, the
 * orientation tip), or the tab is hidden. GameShell provides the value
 * from useGameShell (`isHeld`).
 *
 * For a game that runs its own loop and has no pause menu
 * (`canPause={false}`): read it and stand still while it is true. A
 * requestAnimationFrame loop skips its update and re-seeds its clock when
 * the hold ends (put `held` in the loop effect's dependencies: the effect
 * re-runs, and its first frame is the seed frame); a physics runner stops;
 * a setInterval timer is not set. Before this, no game read the shell's
 * hold, so Flappy Bird fell to the floor under "Turn your phone upright"
 * and Math Attack lost lives in a background tab (phone UX audit
 * 2026-09-29, S7 and S8). The source scan in
 * src/__tests__/shell-hold-adoption.test.ts fails on an own-loop game that
 * does not read it.
 *
 * Outside a GameShell (a unit test of a hook, an R3F scene, which is its
 * own React root) the context has no provider: the value is then the
 * shell overlay count alone, so the overlays still hold the game there.
 */
export const ShellHoldContext = createContext(false);

export function useShellHold(): boolean {
  const fromShell = useContext(ShellHoldContext);
  const overlayOpen = useShellOverlayOpen();
  return fromShell || overlayOpen;
}
