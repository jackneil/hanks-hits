/**
 * The bakery inside the GameShell play box: the cookie count in a bar at
 * the top, then the cookie and the shop side by side (a phone held
 * sideways, a laptop) or the cookie over the shop (a phone held upright).
 * The shop scrolls on its own; the cookie and the count never scroll away.
 *
 * Why: below 1024 px the page was one column, the cookie over the shop,
 * so the Buildings started at y=660 on a 549 px phone and a kid swiped
 * 650 px down to buy and 650 px back to tap, with the count off screen;
 * sideways the 256 px cookie did not fit in the 211 px left and the right
 * half of the screen was empty (phone UX audit 2026-09-29).
 */

export const COUNT_BAR = 56;
/** The words under the cookie (tap power, total taps). */
export const COOKIE_WORDS = 44;
export const EDGE = 8;
export const GAP = 8;
/** The shop column beside the cookie, sideways. */
export const SHOP_WIDTH = 384;
export const MAX_COOKIE = 288;
export const MIN_COOKIE = 96;

export interface BakeryLayout {
  sideways: boolean;
  /** The cookie, round, in CSS px. */
  cookie: number;
  /** The height of the cookie area upright (the shop gets the rest). */
  cookieArea: number;
  /** The width of the shop column sideways. */
  shopWidth: number;
}

export function bakeryLayout(box: { width: number; height: number }): BakeryLayout {
  const sideways = box.width > box.height;
  const main = Math.max(0, box.height - COUNT_BAR);
  if (sideways) {
    const shopWidth = Math.min(SHOP_WIDTH, Math.round(box.width * 0.55));
    const cookie = Math.min(MAX_COOKIE, main - COOKIE_WORDS - 2 * EDGE, box.width - shopWidth - GAP - 2 * EDGE);
    return { sideways, cookie: Math.max(MIN_COOKIE, Math.floor(cookie)), cookieArea: main, shopWidth };
  }
  // Upright the cookie takes about two fifths of the room, and the shop the rest.
  const cookie = Math.min(MAX_COOKIE, main * 0.4 - COOKIE_WORDS, box.width * 0.6);
  const size = Math.max(MIN_COOKIE, Math.floor(cookie));
  return { sideways, cookie: size, cookieArea: size + COOKIE_WORDS + 2 * EDGE, shopWidth: box.width };
}

/**
 * Game words for a finger: "click" is "tap", "Autoclicks" is "Taps by
 * itself". The upgrade and building words in constants.ts are written for
 * a mouse.
 */
export function touchWords(text: string, touch: boolean): string {
  if (!touch) return text;
  return text
    .replace(/\bAutoclicks\b/g, "Taps by itself")
    .replace(/\bclicks\b/g, "taps")
    .replace(/\bClicks\b/g, "Taps")
    .replace(/\bclick\b/g, "tap")
    .replace(/\bClick\b/g, "Tap");
}
