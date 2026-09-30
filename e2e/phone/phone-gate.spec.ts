/**
 * Phone gate: every game and app route works on a real iPhone screen.
 *
 * The test reads the routes that the home page lists (every /games/... and
 * /apps/... link) and opens each one on four iPhone Safari inner sizes:
 * 375x549 and 390x664 (upright), 667x311 and 844x340 (sideways), with
 * touch and an iPhone user agent. A tap is a real touch
 * (Input.dispatchTouchEvent), never a mouse click, and no key is pressed:
 * a kid on a phone has fingers only.
 *
 * For each route and screen it checks:
 *   page-height-start   the page is not taller than the screen at the
 *                       start card (document.scrollingElement.scrollHeight
 *                       <= innerHeight + 1). The play box scrolls, the page
 *                       never does (phone UX audit 2026-09-29, S1).
 *   start-visible       the start control (Play, or the choice buttons of
 *                       a picker that starts the game) is on screen and a
 *                       tap at its centre hits it.
 *   enters-play         a touch on the start control leaves the start card.
 *   page-height-play    the page is not taller than the screen 2 s into
 *                       play.
 *   fixed-over-play     during the first 5 s of play, no element with
 *                       position: fixed intersects the play box, other than
 *                       the GameShell header, the game's own controls (in
 *                       the play box), the orientation tip (it holds the
 *                       game while it shows; main-loop decision 2) and the
 *                       result chip (it mounts only when the run is over,
 *                       so it covers no play: a runner can end inside 5 s).
 *   tip-holds-game      while the orientation tip is up, the game is held:
 *                       the picture in the play box (the first canvas,
 *                       sampled pixel by pixel, or the text of a DOM game)
 *                       changes by TIP_HOLD_MAX_CHANGE or less of its
 *                       samples over TIP_HOLD_MS. A held game with a
 *                       decorative animation (the bird's wing, a coin's
 *                       sparkle, keyed on Date.now) changes 0.4% of its
 *                       samples at most; a game that moves on its own
 *                       (the bird falls, the runner runs) and is not
 *                       held changes 2% or more (measured, see
 *                       TIP_HOLD_MAX_CHANGE). A game that waits for a
 *                       touch (the platformer) draws the same picture
 *                       either way, so the check proves the hold for the
 *                       games that move on their own, the ones that
 *                       died under the tip. Checked before Keep playing
 *                       is tapped; the change while the game then runs
 *                       is printed in the row, so both numbers are on
 *                       the record.
 *   keyboard-copy       no visible text says a keyboard phrase (Press
 *                       SPACE, arrow keys, WASD, Escape, Click ...) on a
 *                       coarse pointer, at the start card or in play.
 *   button-size         every visible button is at least 44x44 px, at the
 *                       start card and in play.
 *   prevent-default     the console logs no "Unable to preventDefault"
 *                       (a preventDefault() inside a passive React
 *                       onTouch* handler, which also doubles the tap).
 *
 * KNOWN FAILURES. The genre PRs (PR-G1 to PR-G8 in the phone UX audit)
 * fix the games one family at a time. Until then, the rows that fail
 * today are listed in KNOWN_FAILURES below, one line per route and check,
 * with the screens it fails on, each naming the PR that fixes it. The
 * gate is green while the failures match the list exactly, screen by
 * screen:
 *   - a failing row that is not in the list fails the gate (a regression,
 *     also on a screen that a line does not name);
 *   - a listed screen that passes fails the gate too (the entry is stale:
 *     the PR that fixed it must delete the screen, or the whole line).
 * A genre PR deletes its lines; it never adds one.
 *
 * Every route and screen prints one PASS, KNOWN or FAIL row. Run it: see
 * playwright.config.ts beside this file. E2E_ROUTES (a comma-separated
 * list, for example /games/flappy-bird,/games/endless-runner) runs only
 * those routes; the stale check then covers only the lines of those routes.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Browser, type BrowserContextOptions, type CDPSession, type Page } from "playwright/test";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const APP_SRC = path.join(REPO_ROOT, "apps", "web", "src");

// ---------------------------------------------------------------- known failures

type Check =
  | "page-height-start"
  | "start-visible"
  | "enters-play"
  | "page-height-play"
  | "fixed-over-play"
  | "tip-holds-game"
  | "keyboard-copy"
  | "button-size"
  | "prevent-default";

const CHECKS: Check[] = [
  "page-height-start",
  "start-visible",
  "enters-play",
  "page-height-play",
  "fixed-over-play",
  "tip-holds-game",
  "keyboard-copy",
  "button-size",
  "prevent-default",
];

/** The names of the four screens (SCREENS below). */
type ScreenName = "375x549" | "667x311" | "390x664" | "844x340";

const UPRIGHT: ScreenName[] = ["375x549", "390x664"];
const SIDEWAYS: ScreenName[] = ["667x311", "844x340"];
const EVERY_SCREEN: ScreenName[] = [...UPRIGHT, ...SIDEWAYS];

interface KnownFailure {
  route: string;
  check: Check;
  /** The screens the row fails on. A screen not named here must pass. */
  screens: ScreenName[];
  /** The genre PR of the phone UX audit that fixes it. */
  fixedBy: string;
}

/**
 * The rows that fail today, one line per route and check, with the
 * screens it fails on. Each genre PR deletes its own lines (or screens)
 * when its games pass; the gate fails on a stale entry. Never add a line
 * or a screen: a new failure is a regression to fix.
 */
const KNOWN_FAILURES: KnownFailure[] = [
  // PR-G1: Driving. four-wheeler-3d's own start screen puts Play under the
  // fold at 667x311; its toolbelt buttons are 40 px tall upright and its
  // icon buttons 29 px wide; monster-truck's Challenges pill is 36 px tall.
  { route: "/games/four-wheeler-3d", check: "start-visible", screens: ["667x311"], fixedBy: "PR-G1" },
  { route: "/games/four-wheeler-3d", check: "button-size", screens: EVERY_SCREEN, fixedBy: "PR-G1" },
  { route: "/games/monster-truck", check: "button-size", screens: EVERY_SCREEN, fixedBy: "PR-G1" },
  // PR-G5: Puzzle and word. Wordle's keyboard keys are 32 px wide upright
  // (sideways the row has room, and the keys are 44 px or wider).
  { route: "/games/wordle", check: "button-size", screens: UPRIGHT, fixedBy: "PR-G5" },
  // PR-G8: Apps. The drum machine's Pads and Sequencer tabs are 40 px
  // tall. The joke generator and the virtual pet have no start card and
  // no break surface, so the First Play trophy shows as the 60 px strip at
  // the bottom of the page for 4 s, over the app's bottom row.
  { route: "/apps/drum-machine", check: "button-size", screens: EVERY_SCREEN, fixedBy: "PR-G8" },
  { route: "/apps/joke-generator", check: "fixed-over-play", screens: EVERY_SCREEN, fixedBy: "PR-G8" },
  { route: "/apps/virtual-pet", check: "fixed-over-play", screens: EVERY_SCREEN, fixedBy: "PR-G8" },
];

/** `${route}|${check}|${screen}` of a known failure. */
const knownKey = (route: string, check: string, screen: string) => `${route}|${check}|${screen}`;

/**
 * The routes to run: every route the home page lists, or the ones in
 * E2E_ROUTES (comma-separated) for a targeted run.
 */
function routeFilter(): Set<string> | null {
  const raw = process.env.E2E_ROUTES?.trim();
  if (!raw) return null;
  return new Set(raw.split(",").map((r) => r.trim().replace(/\/+$/, "")).filter(Boolean));
}

// ---------------------------------------------------------------- screens

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1";
const IPHONE: BrowserContextOptions = {
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
  userAgent: IPHONE_UA,
};

/** The inner sizes of iPhone Safari with its toolbars shown (main-loop decision 1). */
const SCREENS: { name: ScreenName; options: BrowserContextOptions }[] = [
  { name: "375x549", options: { ...IPHONE, viewport: { width: 375, height: 549 } } },
  { name: "667x311", options: { ...IPHONE, viewport: { width: 667, height: 311 } } },
  { name: "390x664", options: { ...IPHONE, viewport: { width: 390, height: 664 } } },
  { name: "844x340", options: { ...IPHONE, viewport: { width: 844, height: 340 } } },
];

/** How many screens run at once. Two: a WebGL game on a busy machine needs the room. */
const SCREENS_AT_ONCE = 2;

/** The keyboard phrases a phone must never show (the same list as keyboardCopySources.test.ts). */
const KEYBOARD_COPY_SOURCE = [
  String.raw`\bPress [A-Z]`,
  String.raw`\bpress (E|R|T|Q|M|P|C|I|Space|Enter|Escape|any key|SPACE)\b`,
  String.raw`\bEscape\b`,
  String.raw`\bClick `,
  String.raw`\bWASD\b`,
  String.raw`\bArrow [Kk]eys?\b`,
  String.raw`\bSPACE\b`,
  String.raw`\bESC\b`,
  String.raw`\bSpace (to|bar|for|or|=|/)`,
].join("|");

/** A font family name that matches the regex. */
const NOT_KEYBOARD_COPY = ["Press Start 2P"];

const MIN_TARGET = 44;
/** The first seconds of play under watch for a fixed element over the play box. */
const PLAY_WATCH_MS = 5_000;
const PLAY_SAMPLE_MS = 400;
/** When the in-play page height, copy and buttons are measured. */
const PLAY_PROBE_AT_MS = 2_000;
/** The tip is on screen: this long for the shell's hold to land before the first picture. */
const TIP_HOLD_SETTLE_MS = 300;
/** The time between the two pictures of the play box under the tip, and again in play. */
const TIP_HOLD_MS = 700;
/**
 * The largest share of the picture's samples that may change under the
 * tip. Measured on the three tip games on the four screens (2026-09-30):
 * held, with the wing, run-frame and sparkle animations still drawing,
 * 0.0% to 0.4% of the samples change in TIP_HOLD_MS (platformer, which
 * pauses through onPause, 0.3% to 0.4%). Not held, a game that moves on
 * its own changes 1.9% to 2.8% (endless-runner, a flat ground) and 14.0%
 * to 14.6% (flappy-bird): on the build before the hold reached the games,
 * flappy-bird changed 12.1% to 13.4% under the tip and endless-runner
 * 2.3% to 2.6%. The platformer waits for a touch and changes 0.8% to 1.1%
 * while free, so the check cannot tell its hold apart; its hold has the
 * unit tests. 1% sits between the held set and the self-moving set with
 * room on both sides; the row prints both numbers, so a drift is on the
 * record.
 */
const TIP_HOLD_MAX_CHANGE = 0.01;

// ---------------------------------------------------------------- source

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/**
 * True when the route's module mounts GameStartOverlay (the shared start
 * card). The module folders come from the route's page.tsx imports
 * (@/games/<id>, @/apps/<id>). This reads the checkout the spec runs
 * from, so run it against a server built from the same checkout.
 */
function mountsStartCard(route: string): boolean {
  const pageFile = path.join(APP_SRC, "app", ...route.split("/").filter(Boolean), "page.tsx");
  if (!existsSync(pageFile)) throw new Error(`no page file at ${path.relative(REPO_ROOT, pageFile)}`);
  const pageSource = readFileSync(pageFile, "utf8");
  const moduleDirs = [
    ...new Set([...pageSource.matchAll(/["']@\/((?:games|apps)\/[a-z0-9-]+)/g)].map((m) => m[1])),
  ].map((m) => path.join(APP_SRC, m));
  const files = [pageFile, ...moduleDirs.filter(existsSync).flatMap(sourceFiles)];
  return files.some((file) => /<GameStartOverlay\b/.test(readFileSync(file, "utf8")));
}

// ---------------------------------------------------------------- page

async function homeRoutes(page: Page): Promise<string[]> {
  await page.goto("/", { waitUntil: "load" });
  await expect(page.locator('a[href^="/games/"]').first()).toBeVisible();
  const hrefs = await page.$$eval('a[href^="/games/"], a[href^="/apps/"]', (links) =>
    links.map((a) => a.getAttribute("href") ?? "")
  );
  return [...new Set(hrefs.map((href) => href.split(/[?#]/)[0].replace(/\/+$/, "")))].sort();
}

/** A real finger: a touch start and a touch end at one point. */
async function tapAt(cdp: CDPSession, x: number, y: number): Promise<void> {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** Waits until the page stops moving (fonts, the start card, the tip). */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => undefined);
  let last = "";
  for (let i = 0; i < 12; i++) {
    const now = await page.evaluate(() => {
      const ids = ["game-start-overlay", "start-card", "start-card-actions", "orientation-tip", "ios-install-tip"];
      return ids
        .map((id) => {
          const el = document.querySelector(`[data-testid="${id}"]`);
          if (!el) return `${id}:-`;
          const r = el.getBoundingClientRect();
          return `${id}:${r.top.toFixed(0)},${r.bottom.toFixed(0)},${r.left.toFixed(0)},${r.right.toFixed(0)}`;
        })
        .join("|");
    });
    if (now === last) return;
    last = now;
    await page.waitForTimeout(250);
  }
}

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

interface Control {
  name: string;
  box: Box;
  onScreen: boolean;
  hit: boolean;
}

/** The start control: the start card's Play, or the choice buttons that start the game. */
function probeStartControls(page: Page): Promise<Control[]> {
  return page.evaluate(() => {
    const vw = innerWidth;
    const vh = innerHeight;
    const actions = document.querySelector<HTMLElement>('[data-testid="start-card-actions"]');
    if (!actions) return [];
    const buttons = [...actions.querySelectorAll<HTMLElement>("button")].filter(
      (b) => b.dataset.testid !== "read-aloud-button"
    );
    return buttons.map((button) => {
      const r = button.getBoundingClientRect();
      const hitEl = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      return {
        name: (button.getAttribute("aria-label") ?? button.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40),
        box: { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height },
        onScreen: r.top >= -0.5 && r.bottom <= vh + 0.5 && r.left >= -0.5 && r.right <= vw + 0.5,
        hit: !!hitEl && (hitEl === button || button.contains(hitEl)),
      };
    });
  });
}

/** A module with its own launcher (no shared start card): its Play or Start button, if any. */
function probeOwnStart(page: Page): Promise<Control | null> {
  return page.evaluate(() => {
    const vw = innerWidth;
    const vh = innerHeight;
    const buttons = [...document.querySelectorAll<HTMLElement>('button, [role="button"]')];
    const start = buttons.find((b) => {
      const name = (b.getAttribute("aria-label") ?? b.textContent ?? "").trim();
      const r = b.getBoundingClientRect();
      return /^(▶\s*)?(play|start)\b/i.test(name) && r.width > 0 && r.height > 0;
    });
    if (!start) return null;
    const r = start.getBoundingClientRect();
    const hitEl = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    return {
      name: (start.getAttribute("aria-label") ?? start.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40),
      box: { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height },
      onScreen: r.top >= -0.5 && r.bottom <= vh + 0.5 && r.left >= -0.5 && r.right <= vw + 0.5,
      hit: !!hitEl && (hitEl === start || start.contains(hitEl)),
    };
  });
}

interface PageProbe {
  scrollHeight: number;
  innerHeight: number;
  keyboardCopy: string[];
  smallButtons: string[];
}

/** The page height, the keyboard phrases on screen and the buttons under 44 px. */
function probePage(page: Page): Promise<PageProbe> {
  return page.evaluate(
    ({ pattern, notCopy, minTarget }) => {
      const regex = new RegExp(pattern);
      const vw = innerWidth;
      const vh = innerHeight;
      const visible = (el: Element) => {
        const style = getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) < 0.01) return false;
        const r = el.getBoundingClientRect();
        // A 1x1 px box is sr-only text; a box off the screen is not on it.
        return r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
      };

      const keyboardCopy: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!text || !regex.test(text) || notCopy.some((s: string) => text.includes(s))) continue;
        const parent = node.parentElement;
        if (!parent || !visible(parent)) continue;
        keyboardCopy.push(text.slice(0, 60));
      }

      const smallButtons: string[] = [];
      for (const button of document.querySelectorAll<HTMLElement>('button, [role="button"]')) {
        if (!visible(button)) continue;
        const r = button.getBoundingClientRect();
        if (r.width >= minTarget - 0.5 && r.height >= minTarget - 0.5) continue;
        const name = (button.getAttribute("aria-label") ?? button.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 30);
        smallButtons.push(`"${name || button.className.slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      }

      return {
        scrollHeight: document.scrollingElement?.scrollHeight ?? document.documentElement.scrollHeight,
        innerHeight: vh,
        keyboardCopy: [...new Set(keyboardCopy)],
        smallButtons: [...new Set(smallButtons)],
      };
    },
    { pattern: KEYBOARD_COPY_SOURCE, notCopy: NOT_KEYBOARD_COPY, minTarget: MIN_TARGET }
  );
}

/**
 * Fixed elements that lie over the play box right now, other than the
 * header, the game's own layers (inside the play box) and the orientation
 * tip. Returns a short name for each.
 */
function probeFixedOverPlay(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const box = document.querySelector<HTMLElement>("[data-play-box]");
    if (!box) return ["no play box on the page"];
    const b = box.getBoundingClientRect();
    const header = document.querySelector('[data-testid="game-shell-header"]');
    const tip = document.querySelector('[data-testid="orientation-tip"]');
    // The result chip is the break surface after a run: it and what waits
    // in it (a celebration) cover no play. The result card (the run's words,
    // over the top of the picture) comes with it.
    const chip = document.querySelector('[data-testid="result-chip"]');
    const cards = [...document.querySelectorAll("[data-result-card]")];
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (el === header || el === box) continue;
      if (header?.contains(el) || box.contains(el) || tip?.contains(el) || el === tip) continue;
      if (chip?.contains(el) || el === chip) continue;
      if (cards.some((card) => card.contains(el))) continue;
      const style = getComputedStyle(el);
      if (style.position !== "fixed") continue;
      if (style.visibility === "hidden" || Number(style.opacity) < 0.01) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const overlaps = r.left < b.right - 0.5 && r.right > b.left + 0.5 && r.top < b.bottom - 0.5 && r.bottom > b.top + 0.5;
      if (!overlaps) continue;
      // A fixed parent whose fixed child is the thing on screen: name the parent once.
      const id = el.dataset.testid ? `[${el.dataset.testid}]` : `${el.tagName.toLowerCase()}.${el.className.toString().split(/\s+/).slice(0, 3).join(".")}`;
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 30);
      out.push(`${id}${text ? ` "${text}"` : ""} at ${Math.round(r.top)}-${Math.round(r.bottom)}`);
    }
    return [...new Set(out)];
  });
}

/**
 * The picture in the play box right now: every 8th pixel of the first
 * canvas (a 2D context), the data URL of a WebGL canvas, or the text of a
 * DOM game. Two pictures compare sample by sample (pictureChange).
 */
type Picture = { kind: "canvas" | "canvas-url" | "text"; samples: (number | string)[] };

function probePicture(page: Page): Promise<Picture> {
  return page.evaluate(() => {
    const box = document.querySelector<HTMLElement>("[data-play-box]");
    const canvas = box?.querySelector("canvas") ?? null;
    if (canvas) {
      // getContext("2d") on a canvas that already has a 2D context returns
      // that context; on a WebGL canvas it returns null.
      const ctx = canvas.getContext("2d");
      if (ctx && canvas.width > 0 && canvas.height > 0) {
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const samples: number[] = [];
        for (let i = 0; i < data.length; i += 32) {
          samples.push(data[i] | (data[i + 1] << 8) | (data[i + 2] << 16));
        }
        return { kind: "canvas" as const, samples };
      }
      return { kind: "canvas-url" as const, samples: [canvas.toDataURL()] };
    }
    return { kind: "text" as const, samples: [(box?.innerText ?? "").replace(/\s+/g, " ")] };
  });
}

/** The share of samples that differ between two pictures (0 to 1). */
function pictureChange(a: Picture, b: Picture): number {
  if (a.kind !== b.kind || a.samples.length !== b.samples.length) return 1;
  if (a.samples.length === 0) return 0;
  let changed = 0;
  for (let i = 0; i < a.samples.length; i++) if (a.samples[i] !== b.samples[i]) changed++;
  return changed / a.samples.length;
}

/** Two pictures of the play box, `ms` apart: the share that changed. */
async function probePictureChange(page: Page, ms: number): Promise<number> {
  const before = await probePicture(page);
  await page.waitForTimeout(ms);
  const after = await probePicture(page);
  return pictureChange(before, after);
}

/** The orientation tip is up: tap Keep playing, by touch. */
async function passOrientationTip(page: Page, cdp: CDPSession): Promise<boolean> {
  const tip = page.getByTestId("orientation-tip");
  if (!(await tip.count())) return false;
  const button = tip.getByRole("button", { name: /Keep playing/ });
  const box = await button.boundingBox();
  if (!box) return false;
  await tapAt(cdp, box.x + box.width / 2, box.y + box.height / 2);
  await expect(tip).toBeHidden();
  return true;
}

/**
 * page.screenshot, tried again when Chromium says "Unable to capture
 * screenshot" (the moment after a heavy WebGL page closes).
 */
async function capture(page: Page, file: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await page.screenshot({ path: file });
      return;
    } catch (error) {
      if (attempt >= 6 || !/Unable to capture screenshot/.test(String(error))) return;
      await page.waitForTimeout(500 * attempt);
    }
  }
}

const px = (n: number) => Math.round(n);

interface RouteResult {
  route: string;
  screen: string;
  problems: Partial<Record<Check, string>>;
  summary: string;
  errors: string[];
}

/** Opens one route on one screen, plays its first seconds by touch, and judges every check. */
async function checkRoute(browser: Browser, screen: (typeof SCREENS)[number], route: string, shotPath: string): Promise<RouteResult> {
  const context = await browser.newContext(screen.options);
  const page = await context.newPage();
  const problems: Partial<Record<Check, string>> = {};
  const errors: string[] = [];
  const preventDefault: string[] = [];
  const notes: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error.message).split("\n")[0].slice(0, 120)));
  page.on("console", (message) => {
    const text = message.text();
    if (/Unable to preventDefault/.test(text)) preventDefault.push(text.slice(0, 120));
  });

  try {
    const cdp = await context.newCDPSession(page);
    const expectCard = mountsStartCard(route);
    await page.goto(route, { waitUntil: "load" });
    if (expectCard) await expect(page.getByTestId("game-start-overlay")).toBeVisible();
    await settle(page);

    // At the start card (or the first screen of a module with no card).
    const start = await probePage(page);
    if (start.scrollHeight > start.innerHeight + 1) {
      problems["page-height-start"] = `page ${start.scrollHeight} px tall on a ${start.innerHeight} px screen at the start`;
    }
    if (start.keyboardCopy.length) problems["keyboard-copy"] = `at the start: ${start.keyboardCopy.map((s) => `"${s}"`).join(", ")}`;
    if (start.smallButtons.length) problems["button-size"] = `at the start: ${start.smallButtons.join(", ")}`;

    // The start control, and a touch on it.
    let startControl: Control | null = null;
    let controlCount = 0;
    if (expectCard) {
      const controls = await probeStartControls(page);
      controlCount = controls.length;
      if (!controls.length) {
        problems["start-visible"] = "no Play or choice button in the start card's action row";
      } else {
        // Play is the last button of the row (a pinned picker comes before
        // it); a picker that starts the game has its choices in the row.
        startControl = controls[controls.length - 1];
        const bad = controls.filter((c) => !c.onScreen || !c.hit);
        if (bad.length) {
          problems["start-visible"] = bad
            .map((c) => `"${c.name}" ${!c.onScreen ? `off screen (${px(c.box.top)}-${px(c.box.bottom)} of ${start.innerHeight})` : "covered at its centre"}`)
            .join("; ");
        }
      }
    } else {
      startControl = await probeOwnStart(page);
      if (startControl && (!startControl.onScreen || !startControl.hit)) {
        problems["start-visible"] = `"${startControl.name}" ${!startControl.onScreen ? "off screen" : "covered at its centre"}`;
      }
    }

    if (startControl) {
      const { box } = startControl;
      await tapAt(cdp, (box.left + box.right) / 2, (box.top + box.bottom) / 2);
      if (expectCard) {
        const overlay = page.getByTestId("game-start-overlay");
        try {
          await expect(overlay).toBeHidden({ timeout: 3_000 });
        } catch {
          // A picker with two steps (an age, then a level): tap the first choice.
          if (controlCount > 1) {
            const again = await probeStartControls(page);
            if (again.length) await tapAt(cdp, (again[0].box.left + again[0].box.right) / 2, (again[0].box.top + again[0].box.bottom) / 2);
          }
          try {
            await expect(overlay).toBeHidden({ timeout: 3_000 });
          } catch {
            problems["enters-play"] = `the start card is still up after a touch on "${startControl.name}"`;
          }
        }
      }
      notes.push(`start "${startControl.name}"`);
    } else {
      notes.push("no start control (in use from load)");
    }

    // The first seconds of play, under watch.
    const t0 = Date.now();
    let probedInPlay = false;
    let tipPassed = false;
    let probedRunning = false;
    const fixedSeen = new Set<string>();
    while (Date.now() - t0 < PLAY_WATCH_MS) {
      if (!tipPassed && (await page.getByTestId("orientation-tip").count())) {
        // The tip holds the game: the picture must stand still under it.
        await page.waitForTimeout(TIP_HOLD_SETTLE_MS);
        const held = await probePictureChange(page, TIP_HOLD_MS);
        const pct = (held * 100).toFixed(1);
        if (held > TIP_HOLD_MAX_CHANGE) {
          problems["tip-holds-game"] = `${pct}% of the play box picture changed in ${TIP_HOLD_MS} ms under the orientation tip (limit ${TIP_HOLD_MAX_CHANGE * 100}%)`;
        }
        if (await passOrientationTip(page, cdp)) {
          tipPassed = true;
          notes.push(`passed the orientation tip (held: ${pct}% changed`);
        }
      } else if (tipPassed && !probedRunning) {
        // The same measure with the game running, for the record.
        probedRunning = true;
        const running = await probePictureChange(page, TIP_HOLD_MS);
        notes[notes.length - 1] += `; running: ${(running * 100).toFixed(1)}%)`;
      }
      for (const name of await probeFixedOverPlay(page)) fixedSeen.add(name);
      if (!probedInPlay && Date.now() - t0 >= PLAY_PROBE_AT_MS) {
        probedInPlay = true;
        const play = await probePage(page);
        if (play.scrollHeight > play.innerHeight + 1) {
          problems["page-height-play"] = `page ${play.scrollHeight} px tall on a ${play.innerHeight} px screen in play`;
        }
        if (play.keyboardCopy.length) {
          problems["keyboard-copy"] = [problems["keyboard-copy"], `in play: ${play.keyboardCopy.map((s) => `"${s}"`).join(", ")}`].filter(Boolean).join("; ");
        }
        if (play.smallButtons.length) {
          problems["button-size"] = [problems["button-size"], `in play: ${play.smallButtons.join(", ")}`].filter(Boolean).join("; ");
        }
      }
      await page.waitForTimeout(PLAY_SAMPLE_MS);
    }
    if (fixedSeen.size) problems["fixed-over-play"] = [...fixedSeen].join(", ");
    if (preventDefault.length) problems["prevent-default"] = `${preventDefault.length} console message(s): ${preventDefault[0]}`;

    if (Object.keys(problems).length) await capture(page, shotPath);
  } catch (error) {
    problems["enters-play"] = `error: ${String(error instanceof Error ? error.message : error).split("\n")[0].slice(0, 200)}`;
    await capture(page, shotPath);
  }
  await context.close();
  return { route, screen: screen.name, problems, summary: notes.join("; "), errors };
}

/** Runs `items` through `work`, `limit` at a time, in order of start. */
async function inBatches<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await work(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------- the gate

test("phone gate: every listed route on four iPhone screens", async ({ browser }, testInfo) => {
  const home = await browser.newContext(SCREENS[0].options);
  const listed = await homeRoutes(await home.newPage());
  await home.close();
  expect(listed.length, "the home page lists games and apps").toBeGreaterThan(10);

  const filter = routeFilter();
  if (filter) {
    for (const route of filter) expect(listed, `E2E_ROUTES names a route the home page does not list: ${route}`).toContain(route);
  }
  const routes = filter ? listed.filter((r) => filter.has(r)) : listed;

  // A known entry names a route the home page lists, a real check, and
  // real screens, each once.
  const screenNames = SCREENS.map((s) => s.name);
  const known = new Map<string, string>();
  for (const k of KNOWN_FAILURES) {
    expect(listed, `KNOWN_FAILURES names a route the home page does not list: ${k.route}`).toContain(k.route);
    expect(CHECKS, `KNOWN_FAILURES names an unknown check: ${k.check}`).toContain(k.check);
    expect(k.screens.length, `KNOWN_FAILURES ${k.route} ${k.check} names no screen`).toBeGreaterThan(0);
    for (const screen of k.screens) {
      expect(screenNames, `KNOWN_FAILURES ${k.route} ${k.check} names an unknown screen: ${screen}`).toContain(screen);
      const key = knownKey(k.route, k.check, screen);
      expect(known.has(key), `KNOWN_FAILURES names ${k.route} ${k.check} ${screen} twice`).toBe(false);
      known.set(key, k.fixedBy);
    }
  }

  const results = await inBatches(SCREENS, SCREENS_AT_ONCE, async (screen) => {
    const rows: RouteResult[] = [];
    for (const route of routes) {
      const shot = testInfo.outputPath(`${screen.name}_${route.replace(/^\//, "").replace(/\//g, "_")}.png`);
      const row = await checkRoute(browser, screen, route, shot);
      const failed = Object.keys(row.problems) as Check[];
      const fixedBy = (c: Check) => known.get(knownKey(route, c, screen.name));
      const unknown = failed.filter((c) => !fixedBy(c));
      const status = failed.length === 0 ? "PASS" : unknown.length === 0 ? "KNOWN" : "FAIL";
      const detail = failed
        .map((c) => `${c}${fixedBy(c) ? ` (${fixedBy(c)})` : ""}: ${row.problems[c]}`)
        .join(" | ");
      const info = row.errors.length ? ` | page errors: ${row.errors.join(" ; ")}` : "";
      console.log(`${status} | ${screen.name} | ${route} | ${row.summary}${detail ? ` | ${detail}` : ""}${info}`);
      rows.push(row);
    }
    return rows;
  });
  const rows = results.flat();

  // Judge: a failure outside the list, and a listed screen that passes.
  const failures: string[] = [];
  const seenFailing = new Set<string>();
  for (const row of rows) {
    for (const check of Object.keys(row.problems) as Check[]) {
      const key = knownKey(row.route, check, row.screen);
      seenFailing.add(key);
      if (!known.has(key)) failures.push(`${row.screen} ${row.route} ${check}: ${row.problems[check]}`);
    }
  }
  const stale = KNOWN_FAILURES.flatMap((k) =>
    routes.includes(k.route)
      ? k.screens
          .filter((screen) => !seenFailing.has(knownKey(k.route, k.check, screen)))
          .map((screen) => `${k.route} ${k.check} (${k.fixedBy}) passes at ${screen}: delete that screen (or the line) from KNOWN_FAILURES`)
      : []
  );

  const counts = { PASS: 0, KNOWN: 0, FAIL: 0 };
  for (const row of rows) {
    const failed = Object.keys(row.problems) as Check[];
    if (!failed.length) counts.PASS++;
    else if (failed.every((c) => known.has(knownKey(row.route, c, row.screen)))) counts.KNOWN++;
    else counts.FAIL++;
  }
  const perCheck = CHECKS.map((c) => `${c} ${rows.filter((r) => r.problems[c]).length}`).join(", ");
  console.log(
    `phone gate: ${rows.length} rows (${routes.length} routes x ${SCREENS.length} screens): ${counts.PASS} PASS, ${counts.KNOWN} KNOWN, ${counts.FAIL} FAIL; failing rows per check: ${perCheck}; ${KNOWN_FAILURES.length} known lines (${known.size} screens), ${stale.length} stale`
  );

  expect(failures, "rows that fail outside KNOWN_FAILURES (a regression, or a new line for the genre PR that owns it)").toEqual([]);
  expect(stale, "stale KNOWN_FAILURES entries").toEqual([]);
});
