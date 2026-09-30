"use client";

/**
 * The header controls that GameShell moved off the header during play on
 * a phone (headerBudget.ts, step 0), for a game with its own pause screen.
 * The shell pause menu shows them itself; a game's own pause sheet shows
 * them when it passes `shellActions` to GameSheet, so Leaderboard and Sign
 * In are one tap away in every game, not only in games with the shell menu.
 */

import { createContext, useContext, type ReactNode } from "react";

export const ShellSheetActionsContext = createContext<ReactNode>(null);

/** The moved controls, or null when nothing moved (or outside a GameShell). */
export function useShellSheetActions(): ReactNode {
  return useContext(ShellSheetActionsContext);
}
