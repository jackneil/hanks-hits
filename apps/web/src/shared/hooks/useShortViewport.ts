"use client";

import { useSyncExternalStore } from "react";

/**
 * The media query of the `short:` variant (globals.css): a screen 480 px
 * tall or less, a phone held sideways. Keep the two the same.
 */
export const SHORT_VIEWPORT_QUERY = "(max-height: 480px)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(SHORT_VIEWPORT_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * True on a short screen (a phone held sideways), the same screens that
 * the `short:` CSS variant covers. For a layout decision that CSS cannot
 * make: to leave a part out (the pause menu's install tip), not to style
 * it. False on the server.
 */
export function useShortViewport(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(SHORT_VIEWPORT_QUERY).matches,
    () => false
  );
}
