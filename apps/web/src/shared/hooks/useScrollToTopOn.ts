"use client";

import { useContext, useLayoutEffect } from "react";

import { PlayBoxContext, findPlayBox } from "./usePlayBox";

/**
 * Scrolls the play box (and the page) back to the top each time `key`
 * changes. Put it in a module that swaps screens by state on one route:
 * `useScrollToTopOn(screen)`.
 *
 * Why: a route that swaps its screen by state keeps its scroll position.
 * The Retro Arcade opened its catalog 355 px down (no title, no search),
 * Oregon Trail came back from the store with the wagon scene 219 px above
 * the screen, and Checkers' New Game left the reset board off screen
 * (phone UX audit 2026-09-29, S13). A new screen starts at its top.
 *
 * It runs before the browser paints the new screen, so the kid never
 * sees the old scroll position. The first mount scrolls too.
 */
export function useScrollToTopOn(key: unknown): void {
  const boxRef = useContext(PlayBoxContext);
  useLayoutEffect(() => {
    const box = boxRef?.current ?? findPlayBox();
    if (box) box.scrollTop = 0;
    if (typeof document !== "undefined") {
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }
  }, [key, boxRef]);
}
