/**
 * Browser facts for the clip surfaces. Nothing here runs at import time,
 * so a server render never reads navigator or window.
 */

import type { SavePlatform } from "./copy";

interface NavigatorLike {
  userAgent?: string;
  maxTouchPoints?: number;
  userAgentData?: { mobile?: boolean };
}

/**
 * Which "Save to ..." button this device gets (plan 12).
 *
 * It looks at the device family only, never at a version number (plan 3a:
 * feature-probe, never parse versions). An iPad that asks for the desktop
 * site says "Macintosh" but has touch points, so it counts as "photos".
 */
export function detectSavePlatform(nav: NavigatorLike | undefined = typeof navigator === "undefined" ? undefined : navigator): SavePlatform {
  if (!nav) return "computer";
  const ua = nav.userAgent ?? "";
  if (/iPhone|iPad|iPod/.test(ua)) return "photos";
  if (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1) return "photos";
  if (/Android/.test(ua) || nav.userAgentData?.mobile === true) return "phone";
  return "computer";
}

/** Nothing on the page can change the platform, so there is nothing to watch. */
export function subscribeToNothing(): () => void {
  return () => {};
}

/** The media query for players who ask for less motion. */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** True when the player asks for less motion. False on the server. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** Subscribe to changes of the reduced-motion setting. */
export function subscribeToReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  if (typeof query.addEventListener !== "function") return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** The current time in ms, on the same clock as PressToken.downAtMs. */
export function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
