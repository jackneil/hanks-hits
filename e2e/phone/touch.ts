/**
 * Touch helpers for the game-specific phone checks (e2e/phone/*.spec.ts).
 *
 * The phone gate (phone-gate.spec.ts) proves what every game must do; the
 * genre specs (driving, runners, ...) prove what their games must do, on
 * the same four iPhone screens, by touch only, with an iPhone user agent.
 * They share these helpers:
 *
 *   SCREENS, IPHONE   the four iPhone Safari inner sizes and the context
 *   wanted(route)     honors E2E_ROUTES, the same as the gate
 *   Finger            taps and holds by real touch events, one thumb or two
 *   openGame          a fresh iPhone context on a route, with page errors
 *   measure           control geometry: overlaps, under 44 px, off screen
 *   unreachableInSheet  buttons in the open sheet a finger cannot reach
 *   oneScreen, noProblems, number  small assertions and a digit reader
 */
import { expect, type Browser, type BrowserContextOptions, type Locator, type Page } from "playwright/test";

export const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1";
export const IPHONE: BrowserContextOptions = { isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: IPHONE_UA };

/** The inner sizes of iPhone Safari with its toolbars shown (the gate's SCREENS). */
export const SCREENS = [
  { name: "375x549", width: 375, height: 549 },
  { name: "667x311", width: 667, height: 311 },
  { name: "390x664", width: 390, height: 664 },
  { name: "844x340", width: 844, height: 340 },
] as const;

export type Screen = (typeof SCREENS)[number];

export const MIN_TARGET = 44;

/** True when E2E_ROUTES is unset or names this route. */
export function wanted(route: string): boolean {
  const raw = process.env.E2E_ROUTES?.trim();
  if (!raw) return true;
  return raw.split(",").map((r) => r.trim().replace(/\/+$/, "")).includes(route);
}

/** A finger: taps and holds by real touch events, never a mouse click. */
export class Finger {
  constructor(private readonly page: Page, private readonly send: (type: string, points: { x: number; y: number; id?: number }[]) => Promise<unknown>) {}

  async tap(target: Locator) {
    const box = await target.boundingBox();
    if (!box) throw new Error("the control to tap has no box");
    await this.tapAt(box.x + box.width / 2, box.y + box.height / 2);
  }

  async tapAt(x: number, y: number) {
    await this.send("touchStart", [{ x, y }]);
    await this.send("touchEnd", []);
  }

  /** One finger holds (x, y) for `ms`, then lifts: a held pad button. */
  async holdAt(x: number, y: number, ms: number) {
    await this.send("touchStart", [{ x, y }]);
    try {
      await this.page.waitForTimeout(ms);
    } finally {
      await this.send("touchEnd", []);
    }
  }

  /**
   * One finger lands at (x, y), slides `dx` px sideways in `steps` moves
   * (a frame apart, as a real thumb does), and lifts. This is how a kid
   * drags a paddle.
   */
  async drag(x: number, y: number, dx: number, steps = 12) {
    await this.send("touchStart", [{ x, y }]);
    for (let i = 1; i <= steps; i++) {
      await this.send("touchMove", [{ x: x + (dx * i) / steps, y }]);
      await this.page.waitForTimeout(16);
    }
    await this.send("touchEnd", []);
  }

  /**
   * One thumb holds `target` for `ms`; then `during` runs while it is still
   * down, and can tap another control with the other thumb. The first thumb
   * lifts at the end. This is how a kid pauses mid-drive.
   */
  async holdWith<T>(target: Locator, ms: number, during: (otherThumb: (tap: Locator) => Promise<void>) => Promise<T>): Promise<T> {
    const box = await target.boundingBox();
    if (!box) throw new Error("the control to hold has no box");
    const held = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 };
    await this.send("touchStart", [held]);
    try {
      await this.page.waitForTimeout(ms);
      return await during(async (tap) => {
        const t = await tap.boundingBox();
        if (!t) throw new Error("the control to tap has no box");
        const other = { x: t.x + t.width / 2, y: t.y + t.height / 2, id: 2 };
        await this.send("touchStart", [held, other]);
        // CDP's touchEnd names the points that lift, not the ones that stay.
        await this.send("touchEnd", [other]);
      });
    } finally {
      await this.send("touchEnd", []);
    }
  }
}

export async function openGame(browser: Browser, screen: Screen, route: string) {
  const context = await browser.newContext({ ...IPHONE, viewport: { width: screen.width, height: screen.height } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const cdp = await context.newCDPSession(page);
  const finger = new Finger(page, (type, touchPoints) => cdp.send("Input.dispatchTouchEvent", { type: type as "touchStart", touchPoints }));
  await page.goto(route, { waitUntil: "load" });
  return { context, page, finger, errors };
}

export interface Geometry {
  overlaps: string[];
  small: string[];
  off: string[];
}

/**
 * Measures the controls that match `selector` (and the extra boxes that only
 * must not be covered, such as a speed readout) in the page or a frame.
 * Two boxes overlap when they share more than 4 px2 and neither holds the
 * other.
 */
export function measure({ selector, extra = [] }: { selector: string; extra?: string[] }): Geometry {
  const shows = (el: Element) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
  };
  const header = document.querySelector('[data-testid="game-shell-header"]');
  const label = (el: Element) => (el.getAttribute("aria-label") || el.textContent || el.id || el.tagName).trim().replace(/\s+/g, " ").slice(0, 24);
  const boxes = [
    ...[...document.querySelectorAll(selector)]
      .filter((el) => shows(el) && !(header && header.contains(el)) && !el.closest('[role="dialog"]'))
      .map((el) => ({ el, button: true, label: label(el), r: el.getBoundingClientRect() })),
    ...extra.flatMap((sel) =>
      [...document.querySelectorAll(sel)].filter(shows).map((el) => ({ el, button: false, label: sel, r: el.getBoundingClientRect() })),
    ),
  ];
  const overlaps: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (ox <= 0 || oy <= 0 || ox * oy <= 4) continue;
      // A world marker (a 3D label that follows its spot) may pass under the
      // HUD, but only when the HUD button, which draws above it, takes the tap.
      const world = [a, b].find((x) => x.el.classList.contains("fw-world-bubble"));
      if (world) {
        const other = world === a ? b : a;
        if (!other.button) continue;
        const hit = document.elementFromPoint(Math.max(a.r.left, b.r.left) + ox / 2, Math.max(a.r.top, b.r.top) + oy / 2);
        if (hit && other.el.contains(hit)) continue;
      }
      overlaps.push(`${a.label} x ${b.label} (${Math.round(ox * oy)} px2)`);
    }
  }
  // The size a finger gets is the layout box: a press animation (such as
  // active:scale-95) shrinks the drawn box for a moment and does not count.
  const size = (el: Element, r: DOMRect) =>
    el instanceof HTMLElement ? { w: el.offsetWidth, h: el.offsetHeight } : { w: r.width, h: r.height };
  const small = boxes
    .filter((b) => b.button)
    .map((b) => ({ b, s: size(b.el, b.r) }))
    .filter(({ s }) => s.w < 43.5 || s.h < 43.5)
    .map(({ b, s }) => `${b.label} ${Math.round(s.w)}x${Math.round(s.h)}`);
  // A world marker may sit partly past the edge when its spot does; the same
  // action is always in the HUD's context slot, which must be on screen.
  const off = boxes
    .filter((b) => !b.el.classList.contains("fw-world-bubble"))
    .filter((b) => b.r.left < -0.5 || b.r.top < -0.5 || b.r.right > innerWidth + 0.5 || b.r.bottom > innerHeight + 0.5)
    .map((b) => b.label);
  return { overlaps, small, off };
}

/**
 * Every button and link in the open sheet (the last visible dialog) that a
 * finger cannot reach: off the screen and not inside a part that scrolls.
 */
export function unreachableInSheet(): string[] | null {
  const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter((d) => d.getBoundingClientRect().height > 0);
  const sheet = dialogs[dialogs.length - 1];
  if (!sheet) return null;
  const scrolls = (el: Element | null): boolean => {
    for (let at = el?.parentElement ?? null; at && sheet.contains(at); at = at.parentElement) {
      const s = getComputedStyle(at);
      if (/(auto|scroll)/.test(s.overflowY) && at.scrollHeight > at.clientHeight + 1) return true;
    }
    return false;
  };
  return [...sheet.querySelectorAll("button, a[href]")]
    .filter((el) => el.getBoundingClientRect().height > 0)
    .filter((el) => {
      const r = el.getBoundingClientRect();
      const inView = r.top >= -0.5 && r.bottom <= innerHeight + 0.5 && r.left >= -0.5 && r.right <= innerWidth + 0.5;
      return !inView && !scrolls(el);
    })
    .map((el) => (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24));
}

/** The page is exactly one screen tall. */
export async function oneScreen(page: Page) {
  const { doc, inner } = await page.evaluate(() => ({ doc: document.scrollingElement!.scrollHeight, inner: innerHeight }));
  expect(doc, "the page is never taller than the screen").toBeLessThanOrEqual(inner);
}

export function noProblems(where: string, g: Geometry) {
  expect(g.overlaps, `${where}: no control covers another`).toEqual([]);
  expect(g.small, `${where}: every control is at least ${MIN_TARGET} px`).toEqual([]);
  expect(g.off, `${where}: every control is on the screen`).toEqual([]);
}

export const number = (text: string | null) => Number((text ?? "").match(/-?\d+/)?.[0] ?? NaN);
