/**
 * Install-sheet check: the iOS install pill and sheet on real phone screens.
 *
 * On an app page (under /apps/) with no play, an iPhone shows the
 * "Play full screen" pill: one 44 px row in the flow of the page
 * (IOSInstallPrompt.tsx). A tap on the pill opens the steps as a sheet,
 * fixed to the bottom of the screen. An app whose start card has left
 * (Trivia) is in use: it shows no pill and no sheet. This check opens
 * every app page that mounts the prompt (read from the source), with an
 * iPhone user agent, and measures:
 *   0. The pill: in the flow (not fixed), at least 44 px tall, both of its
 *      buttons at least 44x44 px, on screen, and a tap at their centers
 *      hits them. On an app with a start card, Start leaves no pill and
 *      no sheet behind. Close ends the pill for the session: a reload
 *      shows no pill.
 *   1. Sideways (844x390, 667x375, 568x320, 932x430): the sheet is one
 *      short row (the 📲 icon, the two steps, Read it to me, Don't show
 *      this again, Close), no taller than a quarter of the screen. Before
 *      this check the sheet was about 200 px tall there: half of a 390 px
 *      screen.
 *   2. Upright (390x844): the sheet keeps its full layout with its title.
 *   3. Every button is at least 44x44 px and fully on screen, and a tap at
 *      its center hits it. The icon and the steps are on screen, inside
 *      the sheet, and not cut off.
 *   4. "Read it to me" reads the words of the sheet.
 *   5. The page keeps space at its end for the sheet (bottomSheetSpace.ts):
 *      --bottom-sheet-space is the height of the sheet in whole pixels and
 *      the body has that padding. Every control of the page that a kid can
 *      reach with no sheet (scrolled up to the bottom of the screen, a tap
 *      at its center hits it) is also reachable with the sheet up: scrolled
 *      up to the top of the sheet, a tap at its center hits it.
 *   6. When the phone turns, the layout changes and the space follows.
 *   7. Close removes the sheet and the space.
 *
 * A control that a kid cannot reach even with no sheet is a fault of the
 * page itself, not of the sheet: it prints as a NOTE row and does not fail
 * the check. Fix the page, then the NOTE goes away.
 *
 * Every screen prints one PASS or FAIL row per page. Run it: see
 * playwright.config.ts beside this file.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test, type BrowserContext, type BrowserContextOptions, type Page } from "playwright/test";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1";
const IPHONE: BrowserContextOptions = {
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
  userAgent: IPHONE_UA,
};

const SCREENS_DIR = path.join(process.env.E2E_OUT ?? path.join(tmpdir(), "hh-install-sheet"), "screens");

/** IOS_INSTALL_SHEET_SPOKEN in IOSInstallPrompt.tsx (a jsdom test pins that constant). */
const SHEET_SPOKEN =
  "Play full screen! Tap the Share button. Then tap Add to Home Screen. Tap the X to close it. To hide this tip for good, tap Don't show this again.";
/** IOS_INSTALL_PILL_LABEL in IOSInstallPrompt.tsx: the button on the pill that opens the steps. */
const PILL_LABEL = "Play full screen! Show me how";
/** SESSION_KEY in IOSInstallPrompt.tsx: set once the pill showed or was closed. */
const SESSION_KEY = "ios-install-prompt-shown";

/** A sideways sheet may use at most this part of the screen height. */
const MAX_SIDEWAYS_SHARE = 0.25;
/** The smallest tap target for a kid's finger (CSS px). */
const MIN_TARGET = 44;
/** Room (CSS px) for the browser's rounding of edges. */
const EDGE = 1;

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const APP_SRC = path.join(REPO_ROOT, "apps", "web", "src");

/**
 * The app pages that show the sheet by themselves: every app module
 * (src/apps/<id>) that mounts <IOSInstallPrompt> and has a route at
 * /apps/<id>. This reads the checkout the spec runs from, so run it against
 * a server built from the same checkout.
 */
function sheetRoutes(): string[] {
  const appsDir = path.join(APP_SRC, "apps");
  const mounts = (dir: string): boolean =>
    readdirSync(dir, { withFileTypes: true }).some((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name !== "__tests__" && mounts(full);
      return /\.tsx$/.test(entry.name) && /<IOSInstallPrompt\b/.test(readFileSync(full, "utf8"));
    });
  return readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((id) => existsSync(path.join(APP_SRC, "app", "apps", id, "page.tsx")))
    .filter((id) => mounts(path.join(appsDir, id)))
    .sort()
    .map((id) => `/apps/${id}`);
}

const ROUTES = sheetRoutes();

/** The page for the turn and Close checks. */
const TOY_FINDER = "/apps/toy-finder";

interface Screen {
  name: string;
  width: number;
  height: number;
  sideways: boolean;
}

const SCREENS: Screen[] = [
  { name: "sideways 844x390", width: 844, height: 390, sideways: true },
  { name: "sideways 667x375", width: 667, height: 375, sideways: true },
  { name: "sideways 568x320", width: 568, height: 320, sideways: true },
  { name: "sideways 932x430", width: 932, height: 430, sideways: true },
  { name: "upright 390x844", width: 390, height: 844, sideways: false },
];

// ---------------------------------------------------------------- page

/** Records what the page asks the voice to say, in window.__spoken. */
async function captureSpeech(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const spoken: string[] = [];
    (window as unknown as { __spoken: string[] }).__spoken = spoken;
    const w = window as unknown as Record<string, unknown>;
    if (typeof w.SpeechSynthesisUtterance !== "function") {
      w.SpeechSynthesisUtterance = class {
        text: string;
        constructor(text = "") {
          this.text = text;
        }
      };
    }
    const fake = {
      speaking: false,
      pending: false,
      paused: false,
      speak: (utterance: { text: string }) => {
        spoken.push(utterance.text);
      },
      cancel: () => {},
      pause: () => {},
      resume: () => {},
      getVoices: () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    Object.defineProperty(window, "speechSynthesis", { value: fake, configurable: true });
  });
}

/** Waits until the sheet and the reserved space stop moving (the slide-up, fonts). */
async function settleSheet(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  let last = "";
  for (let i = 0; i < 20; i++) {
    const now = await page.evaluate(() => {
      const sheet = document.querySelector('[data-testid="ios-install-sheet"]');
      const r = sheet?.getBoundingClientRect();
      const space = document.documentElement.style.getPropertyValue("--bottom-sheet-space");
      return r ? `${r.top.toFixed(1)},${r.height.toFixed(1)},${space}` : `-,${space}`;
    });
    if (now === last) return;
    last = now;
    await page.waitForTimeout(300);
  }
}

interface PillProbe {
  fixed: boolean;
  box: Box;
  buttons: Part[];
}

/** Measures the pill: its position in the flow, its size and its buttons. */
function probePill(page: Page): Promise<PillProbe> {
  return page.evaluate(() => {
    const pill = document.querySelector<HTMLElement>('[data-testid="ios-install-pill"]')!;
    const boxOf = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    };
    let fixed = false;
    for (let node: HTMLElement | null = pill; node; node = node.parentElement) {
      const position = getComputedStyle(node).position;
      if (position === "fixed" || position === "sticky") fixed = true;
    }
    const part = (el: HTMLElement | null, name: string) => {
      if (!el) return { name, box: null, shown: false, hit: false, cutOff: false };
      const box = boxOf(el);
      const hitEl = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2);
      return {
        name,
        box,
        shown: box.width > 0 && box.height > 0,
        hit: !!hitEl && (hitEl === el || el.contains(hitEl)),
        cutOff: false,
      };
    };
    const buttons = [...pill.querySelectorAll<HTMLElement>("button")];
    const label = (b: HTMLElement) => (b.getAttribute("aria-label") ?? b.textContent ?? "").replace(/\s+/g, " ").trim();
    return {
      fixed,
      box: boxOf(pill),
      buttons: buttons.map((b) => part(b, label(b))),
    };
  });
}

/** Everything wrong with the pill, in words. */
function pillProblems(probe: PillProbe, viewport: { width: number; height: number }): string[] {
  const problems: string[] = [];
  if (probe.fixed) problems.push("the pill is fixed or sticky: it must sit in the flow of the page");
  if (probe.box.height < MIN_TARGET - 0.5) problems.push(`the pill is ${round(probe.box.height)} px tall, under ${MIN_TARGET} px`);
  if (probe.buttons.length !== 2) problems.push(`the pill has ${probe.buttons.length} buttons, not 2`);
  for (const button of probe.buttons) {
    if (!button.box || !button.shown) {
      problems.push(`${button.name}: not on screen`);
      continue;
    }
    const inScreen =
      button.box.left >= -EDGE &&
      button.box.top >= -EDGE &&
      button.box.right <= viewport.width + EDGE &&
      button.box.bottom <= viewport.height + EDGE;
    if (!inScreen) problems.push(`${button.name}: outside the screen`);
    if (button.box.width < MIN_TARGET - 0.5 || button.box.height < MIN_TARGET - 0.5) {
      problems.push(`${button.name}: ${round(button.box.width)}x${round(button.box.height)} px, under ${MIN_TARGET} px`);
    }
    if (!button.hit) problems.push(`${button.name}: a tap at its center hits something else`);
  }
  return problems;
}

/**
 * Opens the page and waits for the prompt. An app with a start card holds
 * the tip inside the start screen (the start-card check covers that);
 * after Start the app is in use, and no pill and no sheet may show. An
 * app with no start card shows the pill.
 */
async function openPrompt(page: Page, route: string): Promise<"pill" | "in-play"> {
  await page.goto(route, { waitUntil: "load" });
  const pill = page.getByTestId("ios-install-pill");
  const card = page.getByTestId("start-card");
  await expect(pill.or(card).first()).toBeVisible();
  // A start card can mount a moment after the first paint: wait until
  // what is on screen stops changing.
  let last = "";
  for (let i = 0, same = 0; i < 30 && same < 3; i++) {
    const now = `${await pill.isVisible()},${await card.isVisible()}`;
    same = now === last ? same + 1 : 0;
    last = now;
    await page.waitForTimeout(200);
  }
  if (await card.isVisible()) {
    const start = card
      .getByTestId("start-card-actions")
      .getByRole("button")
      .filter({ hasNotText: "Read it to me" })
      .first();
    await start.tap();
    await expect(card).toBeHidden();
    // The kid is in the app now (a quiz with a timer): nothing may show.
    await page.waitForTimeout(500);
    await expect(page.getByTestId("ios-install-sheet")).toHaveCount(0);
    await expect(pill).toHaveCount(0);
    return "in-play";
  }
  await expect(pill).toBeVisible();
  return "pill";
}

/** Taps the pill's words: the steps open as the sheet. */
async function openSheetFromPill(page: Page): Promise<void> {
  await page.getByTestId("ios-install-pill").getByRole("button", { name: PILL_LABEL }).tap();
  await expect(page.getByTestId("ios-install-sheet")).toBeVisible();
  await expect(page.getByTestId("ios-install-pill")).toHaveCount(0);
  await settleSheet(page);
}

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

interface Part {
  name: string;
  box: Box | null;
  shown: boolean;
  hit: boolean;
  cutOff: boolean;
}

interface SheetProbe {
  viewport: { width: number; height: number };
  sheet: Box;
  card: Box;
  titleShown: boolean;
  icon: Part;
  steps: Part;
  buttons: Part[];
  space: string;
  bodyPaddingBottom: string;
}

function probeSheet(page: Page): Promise<SheetProbe> {
  return page.evaluate(() => {
    const boxOf = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    };
    const isShown = (el: Element) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const part = (name: string, el: HTMLElement | null) => {
      if (!el) return { name, box: null, shown: false, hit: false, cutOff: false };
      const box = boxOf(el);
      const hitEl = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2);
      return {
        name,
        box,
        shown: isShown(el),
        hit: !!hitEl && (hitEl === el || el.contains(hitEl)),
        cutOff: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
      };
    };

    const sheet = document.querySelector<HTMLElement>('[data-testid="ios-install-sheet"]')!;
    const card = sheet.querySelector<HTMLElement>(":scope > div")!;
    const spans = [...sheet.querySelectorAll<HTMLElement>("span")];
    const addToHome = spans.find((s) => s.textContent?.trim() === "Add to Home Screen");
    const icon = spans.find((s) => s.textContent?.trim() === "📲") ?? null;
    const buttons = [...sheet.querySelectorAll<HTMLElement>("button")];
    const button = (name: string) =>
      buttons.find((b) => {
        const label = (b.getAttribute("aria-label") ?? b.textContent ?? "").replace(/\s+/g, " ").trim();
        return label === name;
      }) ?? null;
    const title = sheet.querySelector("h3");

    return {
      viewport: { width: innerWidth, height: innerHeight },
      sheet: boxOf(sheet),
      card: boxOf(card),
      titleShown: !!title && isShown(title),
      icon: part("icon", icon),
      steps: part("steps", addToHome?.parentElement ?? null),
      buttons: [
        part("Read it to me", button("Read it to me")),
        part("Don't show this again", button("Don't show this again")),
        part("Close", button("Close")),
      ],
      space: document.documentElement.style.getPropertyValue("--bottom-sheet-space"),
      bodyPaddingBottom: getComputedStyle(document.body).paddingBottom,
    };
  });
}

/** A tap on "Yay!" closes a celebration card; it can cover a control for about 4 s. */
async function dismissCelebrations(page: Page): Promise<void> {
  const card = page.getByTestId("achievement-card");
  for (let i = 0; i < 20; i++) {
    if (!(await card.first().isVisible())) return;
    await card.first().getByRole("button", { name: "Dismiss celebration" }).tap();
    await page.waitForTimeout(300);
  }
}

interface Reach {
  name: string;
  reachable: boolean;
  /** What a tap at the center of the control reaches. */
  hitWhat: string;
}

/**
 * For each control of the page (not in the sheet, not in a fixed or sticky
 * bar): can a kid scroll it into view and tap it? The control is scrolled
 * to the middle of the screen, then to the bottom of the free part, then
 * to the top, and a tap at its center must hit it at one of them, above
 * the sheet. The bottom of the free part is the top of the sheet: html has
 * scroll-padding-bottom equal to the sheet space, so scrollIntoView stops
 * there. With no sheet it is the bottom of the screen.
 *
 * scrollIntoView also scrolls a box with overflow hidden, which a finger
 * cannot. A try that needed such a scroll does not count, and the box goes
 * back to where it was.
 */
function reachControls(page: Page): Promise<Reach[]> {
  return page.evaluate(() => {
    const sheet = document.querySelector('[data-testid="ios-install-sheet"]');
    const inFixedBar = (el: HTMLElement) => {
      for (let node: HTMLElement | null = el; node; node = node.parentElement) {
        const position = getComputedStyle(node).position;
        if (position === "fixed" || position === "sticky") return true;
      }
      return false;
    };
    const describe = (node: Element | null) => {
      if (!node) return "nothing (off the screen)";
      const holder = node.closest("[data-testid]");
      const testId = holder ? ` in [data-testid=${holder.getAttribute("data-testid")}]` : "";
      return `<${node.tagName.toLowerCase()}> "${(node.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 30)}"${testId}`;
    };
    const controls = [
      ...document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [role="button"]'),
    ].filter((el) => {
      if ((sheet && sheet.contains(el)) || inFixedBar(el)) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
    });
    const clips = (overflow: string) => overflow === "hidden" || overflow === "clip";
    /** The boxes around `el` that clip on an axis with no scroll for a finger (overflow hidden or clip). */
    const clippingBoxes = (el: HTMLElement) => {
      const boxes: { box: HTMLElement; x: boolean; y: boolean; top: number; left: number }[] = [];
      for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);
        const x = clips(style.overflowX);
        const y = clips(style.overflowY);
        if (x || y) boxes.push({ box: node, x, y, top: node.scrollTop, left: node.scrollLeft });
      }
      return boxes;
    };
    return controls.map((el, index) => {
      const limit = () => (sheet ? sheet.getBoundingClientRect().top : innerHeight);
      const boxes = clippingBoxes(el);
      const fingerCannotScroll = () =>
        boxes.some(({ box, x, y, top, left }) => (y && box.scrollTop !== top) || (x && box.scrollLeft !== left));
      const putBoxesBack = () => boxes.forEach(({ box, top, left }) => box.scrollTo({ top, left, behavior: "instant" }));
      let hitWhat = "";
      let reachable = false;
      for (const block of ["center", "end", "start"] as const) {
        el.scrollIntoView({ block, inline: "nearest", behavior: "instant" });
        if (fingerCannotScroll()) {
          putBoxesBack();
          hitWhat = "a spot only a scroll of an overflow-hidden box can show";
          continue;
        }
        const r = el.getBoundingClientRect();
        const x = (r.left + r.right) / 2;
        const y = (r.top + r.bottom) / 2;
        const onScreen = x >= 0 && x < innerWidth && y >= 0 && y < innerHeight;
        const hitEl = onScreen ? document.elementFromPoint(x, y) : null;
        hitWhat = describe(hitEl);
        if (r.bottom <= limit() + 1 && !!hitEl && (hitEl === el || el.contains(hitEl))) {
          reachable = true;
          break;
        }
      }
      putBoxesBack();
      const label = (el.getAttribute("aria-label") ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
      return { name: `#${index} ${el.tagName.toLowerCase()} "${label.slice(0, 30)}"`, reachable, hitWhat };
    });
  });
}

// ---------------------------------------------------------------- checks

const round = (n: number) => Math.round(n * 10) / 10;

function inViewport(box: Box, probe: SheetProbe): boolean {
  return (
    box.left >= -EDGE &&
    box.top >= -EDGE &&
    box.right <= probe.viewport.width + EDGE &&
    box.bottom <= probe.viewport.height + EDGE
  );
}

function inside(box: Box, outer: Box): boolean {
  return (
    box.left >= outer.left - EDGE &&
    box.right <= outer.right + EDGE &&
    box.top >= outer.top - EDGE &&
    box.bottom <= outer.bottom + EDGE
  );
}

/** Everything wrong with one open sheet, in words. */
function sheetProblems(probe: SheetProbe, screen: Screen): string[] {
  const problems: string[] = [];
  const share = probe.sheet.height / probe.viewport.height;

  if (screen.sideways && share > MAX_SIDEWAYS_SHARE) {
    problems.push(
      `sheet is ${round(probe.sheet.height)} px tall, ${Math.round(share * 100)}% of the screen (at most ${MAX_SIDEWAYS_SHARE * 100}%)`
    );
  }

  const row = [probe.icon, probe.steps, ...probe.buttons];
  for (const item of row) {
    if (!item.box || !item.shown) {
      problems.push(`${item.name}: not on screen`);
      continue;
    }
    if (!inViewport(item.box, probe)) problems.push(`${item.name}: outside the screen`);
    if (!inside(item.box, probe.card)) problems.push(`${item.name}: outside the sheet`);
  }
  for (const button of probe.buttons) {
    if (!button.box) continue;
    if (button.box.width < MIN_TARGET - 0.5 || button.box.height < MIN_TARGET - 0.5) {
      problems.push(`${button.name}: ${round(button.box.width)}x${round(button.box.height)} px, under ${MIN_TARGET} px`);
    }
    if (!button.hit) problems.push(`${button.name}: a tap at its center hits something else`);
  }
  if (probe.steps.box && probe.steps.cutOff) problems.push("steps: the words are cut off");

  if (screen.sideways) {
    // One row: every part shares a horizontal band.
    const boxes = row.map((item) => item.box).filter((box): box is Box => !!box);
    const bandTop = Math.max(...boxes.map((box) => box.top));
    const bandBottom = Math.min(...boxes.map((box) => box.bottom));
    if (boxes.length !== row.length || bandTop >= bandBottom) {
      problems.push("the icon, the steps and the buttons are not in one row");
    }
  } else if (!probe.titleShown) {
    problems.push("upright: the title 'Play Fullscreen!' is missing");
  }

  const expectedSpace = `${Math.ceil(probe.sheet.height)}px`;
  if (probe.space !== expectedSpace) {
    problems.push(`--bottom-sheet-space is "${probe.space}", the sheet is ${expectedSpace}`);
  }
  if (probe.bodyPaddingBottom !== expectedSpace) {
    problems.push(`body padding-bottom is ${probe.bodyPaddingBottom}, the sheet is ${expectedSpace}`);
  }
  return problems;
}

function slug(route: string): string {
  return route.split("/").filter(Boolean).join("-");
}

// ---------------------------------------------------------------- tests

test.beforeAll(() => {
  mkdirSync(SCREENS_DIR, { recursive: true });
});

test("install sheet: the app pages that show the sheet are found", () => {
  // An empty list would make every screen pass without a check.
  expect(ROUTES).toContain(TOY_FINDER);
  console.log(`routes: ${ROUTES.join(", ")}`);
});

for (const screen of SCREENS) {
  test(`install sheet: ${screen.name}`, async ({ browser }) => {
    const rows: string[] = [];
    const failures: string[] = [];
    /** Faults of the page itself, with or without the sheet: printed, not failed. */
    const notes: string[] = [];

    for (const route of ROUTES) {
      const context = await browser.newContext({
        ...IPHONE,
        viewport: { width: screen.width, height: screen.height },
      });
      await captureSpeech(context);
      const page = await context.newPage();
      try {
        const shot = `${slug(route)}-${screen.width}x${screen.height}`;
        const opened = await openPrompt(page, route);
        if (opened === "in-play") {
          await page.screenshot({ path: path.join(SCREENS_DIR, `${shot}-in-play.png`) });
          rows.push(`PASS ${screen.name} ${route}: in use after Start, no pill and no sheet`);
          continue;
        }
        await dismissCelebrations(page);
        // The pill sits where the app mounts it: at the top of the page, or
        // in a control row at the bottom (the drum machine, the virtual
        // pet). A finger scrolls the page to it.
        await page.getByTestId("ios-install-pill").scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        const problems = pillProblems(await probePill(page), { width: screen.width, height: screen.height });
        await page.screenshot({ path: path.join(SCREENS_DIR, `${shot}-pill.png`) });

        await openSheetFromPill(page);
        await dismissCelebrations(page);
        await settleSheet(page);
        const probe = await probeSheet(page);
        await page.screenshot({ path: path.join(SCREENS_DIR, `${shot}-top.png`) });

        problems.push(...sheetProblems(probe, screen));

        // Read it to me reads the words of the sheet.
        const readAloud = page.getByTestId("ios-install-sheet").getByRole("button", { name: "Read it to me" });
        if (await readAloud.isVisible()) {
          await readAloud.tap();
          const spoken = await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
          if (spoken.at(-1) !== SHEET_SPOKEN) {
            problems.push(`Read it to me said ${JSON.stringify(spoken.at(-1) ?? "nothing")}`);
          }
          // Stop the voice again, so the button is back to its first state.
          await readAloud.tap();
        }

        // Every control a kid can reach with no sheet is reachable with the
        // sheet up too.
        const withSheet = await reachControls(page);
        await page.screenshot({ path: path.join(SCREENS_DIR, `${shot}-end.png`) });
        await page.getByTestId("ios-install-sheet").getByRole("button", { name: "Close" }).tap();
        await expect(page.getByTestId("ios-install-sheet")).toHaveCount(0);
        await settleSheet(page);
        // Close ends the pill for the session: not now, and not on a reload.
        if ((await page.getByTestId("ios-install-pill").count()) > 0) problems.push("the pill is back after Close");
        const remembered = await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY);
        if (remembered !== "true") problems.push(`sessionStorage ${SESSION_KEY} is ${JSON.stringify(remembered)} after Close`);
        const withoutSheet = await reachControls(page);
        if (withSheet.length === 0) problems.push("the page has no control to check");
        if (withSheet.length !== withoutSheet.length) {
          problems.push(`the page has ${withSheet.length} controls with the sheet and ${withoutSheet.length} without it`);
        } else {
          withSheet.forEach((control, i) => {
            if (!withoutSheet[i].reachable) {
              notes.push(`${screen.name} ${route}: ${control.name} cannot be reached even with no sheet (a tap hits ${withoutSheet[i].hitWhat})`);
            } else if (!control.reachable) {
              problems.push(`${control.name} is reachable with no sheet, but not with the sheet up (a tap hits ${control.hitWhat})`);
            }
          });
        }

        // The next visit in this session shows no pill.
        await page.reload({ waitUntil: "load" });
        await page.waitForTimeout(700);
        if ((await page.getByTestId("ios-install-pill").count()) > 0) problems.push("the pill is back on a second visit in the same session");
        if ((await page.getByTestId("ios-install-sheet").count()) > 0) problems.push("the sheet is back on a second visit in the same session");

        const summary = `sheet ${round(probe.sheet.height)} px (${Math.round((probe.sheet.height / probe.viewport.height) * 100)}%), space ${probe.space || "none"}`;
        if (problems.length === 0) {
          rows.push(`PASS ${screen.name} ${route}: ${summary}`);
        } else {
          rows.push(`FAIL ${screen.name} ${route}: ${summary}\n       - ${problems.join("\n       - ")}`);
          failures.push(`${route}: ${problems.join("; ")}`);
        }
      } catch (error) {
        // One broken page must not hide the rows of the others.
        const message = (error instanceof Error ? error.message : String(error)).split("\n")[0];
        rows.push(`FAIL ${screen.name} ${route}: ${message}`);
        failures.push(`${route}: ${message}`);
      } finally {
        await context.close();
      }
    }

    console.log([...rows, ...notes.map((note) => `NOTE ${note}`)].join("\n"));
    expect(failures, failures.join("\n")).toEqual([]);
  });
}

test("install sheet: turning the phone changes the layout, and the space follows", async ({ browser }) => {
  const upright: Screen = SCREENS.find((s) => s.name === "upright 390x844")!;
  const sideways: Screen = SCREENS.find((s) => s.name === "sideways 844x390")!;
  const context = await browser.newContext({ ...IPHONE, viewport: { width: 390, height: 844 } });
  await captureSpeech(context);
  const page = await context.newPage();
  try {
    expect(await openPrompt(page, TOY_FINDER)).toBe("pill");
    await openSheetFromPill(page);
    await dismissCelebrations(page);
    await settleSheet(page);
    const first = await probeSheet(page);
    expect(sheetProblems(first, upright)).toEqual([]);

    await page.setViewportSize({ width: 844, height: 390 });
    await settleSheet(page);
    const turned = await probeSheet(page);
    await page.screenshot({ path: path.join(SCREENS_DIR, "turned-844x390.png") });
    expect(sheetProblems(turned, sideways)).toEqual([]);
    expect(turned.sheet.height).toBeLessThan(first.sheet.height);

    await page.setViewportSize({ width: 390, height: 844 });
    await settleSheet(page);
    const back = await probeSheet(page);
    expect(sheetProblems(back, upright)).toEqual([]);
    expect(back.space).toBe(first.space);
  } finally {
    await context.close();
  }
});

test("install sheet: Close removes the sheet and the space, sideways too", async ({ browser }) => {
  const context = await browser.newContext({ ...IPHONE, viewport: { width: 568, height: 320 } });
  const page = await context.newPage();
  try {
    expect(await openPrompt(page, TOY_FINDER)).toBe("pill");
    await openSheetFromPill(page);
    await page.getByTestId("ios-install-sheet").getByRole("button", { name: "Close" }).tap();
    await expect(page.getByTestId("ios-install-sheet")).toHaveCount(0);
    const after = await page.evaluate(() => ({
      space: document.documentElement.style.getPropertyValue("--bottom-sheet-space"),
      padding: getComputedStyle(document.body).paddingBottom,
    }));
    expect(after).toEqual({ space: "", padding: "0px" });
  } finally {
    await context.close();
  }
});
