/**
 * Browser facts for the clip surfaces. Nothing here runs at import time,
 * so a server render never reads navigator or window.
 */

import type { SavePlatform } from "./copy";

interface NavigatorLike {
  userAgent?: string;
  maxTouchPoints?: number;
  userAgentData?: { mobile?: boolean; platform?: string };
  share?: unknown;
  userActivation?: { hasBeenActive?: boolean };
}

function currentNavigator(): NavigatorLike | undefined {
  return typeof navigator === "undefined" ? undefined : (navigator as unknown as NavigatorLike);
}

/**
 * Which "Save to ..." button this device gets (plan 12).
 *
 * It looks at the device family only, never at a version number (plan 3a:
 * feature-probe, never parse versions). An iPad that asks for the desktop
 * site says "Macintosh" but has touch points, so it counts as "photos".
 */
export function detectSavePlatform(nav: NavigatorLike | undefined = currentNavigator()): SavePlatform {
  if (!nav) return "computer";
  const ua = nav.userAgent ?? "";
  if (/iPhone|iPad|iPod/.test(ua)) return "photos";
  if (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1) return "photos";
  if (/Android/.test(ua) || nav.userAgentData?.mobile === true) return "phone";
  return "computer";
}

/**
 * True on a Mac, iPhone or iPad, where the keyboard says Option, not Alt.
 * It looks at the device family only (plan 3a: never parse versions).
 */
export function isApplePlatform(nav: NavigatorLike | undefined = currentNavigator()): boolean {
  if (!nav) return false;
  if (/Macintosh|iPhone|iPad|iPod/.test(nav.userAgent ?? "")) return true;
  return /mac|ios/i.test(nav.userAgentData?.platform ?? "");
}

/**
 * True when the browser has a share sheet at all (navigator.share). Where it
 * has none (Firefox on a computer, Chrome on Linux, some in-app browsers),
 * the viewer shows no Share button (plan 12). Whether the share sheet takes
 * one file is the service's answer (ShareOutcome), not this probe.
 */
export function canShareHere(nav: NavigatorLike | undefined = currentNavigator()): boolean {
  return !!nav && typeof nav.share === "function";
}

/**
 * True when the player has tapped or typed on this page (the browser lets
 * the voice speak only after that). A browser that cannot tell counts as yes.
 */
export function pageHasBeenActive(nav: NavigatorLike | undefined = currentNavigator()): boolean {
  return nav?.userActivation?.hasBeenActive !== false;
}

/** The left and right safe-area insets in px (a notch or rounded corners in landscape). */
export interface SideInsets {
  left: number;
  right: number;
}

export const NO_INSETS: SideInsets = Object.freeze({ left: 0, right: 0 });

/**
 * Read env(safe-area-inset-left/right) with a hidden probe element. It
 * gives 0 where the browser has no insets or no env().
 */
export function readSideInsets(): SideInsets {
  if (typeof document === "undefined" || !document.body || typeof getComputedStyle !== "function") return NO_INSETS;
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;pointer-events:none;padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px)";
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const px = (value: string) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };
  const left = px(style.paddingLeft);
  const right = px(style.paddingRight);
  probe.remove();
  return left === 0 && right === 0 ? NO_INSETS : { left, right };
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
