/**
 * Start-card check: every start card works on real screens.
 *
 * For each screen size, the test reads the routes that the home page lists
 * (every /games/... and /apps/... link), opens each one in a fresh browser
 * context, and checks the start surface (GameStartOverlay):
 *   1. The route shows a start card exactly when its module mounts
 *      GameStartOverlay (read from the route's page.tsx imports), so a card
 *      that fails to render is a failure and not a skipped row.
 *   2. The card is portaled to document.body, and the card itself does not
 *      scroll.
 *   3. Play, or every choice button when the picker starts the game, and
 *      "Read it to me" are inside the card and inside the viewport with no
 *      scroll, and a tap at the centre of each one hits that button.
 *   4. The iOS install tip is never inside the card and never on top of it,
 *      and it is on screen when it shows. The iOS install sheet never shows
 *      while the card is up.
 *   5. The body's scroll cue tells the truth: "more below" only when the
 *      body really overflows, "more above" only after a scroll. The cue
 *      paints no pixel at an edge with nothing past it: nothing on a body
 *      that fits (no gray line; verify finding R8), nothing at the top
 *      before a scroll, and nothing at the bottom at the end of a scroll
 *      (the body is scrolled to its end to check that).
 * The screens: iPhone 320x568, 375x667 and 390x844, an iPhone held
 * sideways (844x390), all with touch and an iPhone user agent (so the iOS
 * install tip can show), and a 1280x800 desktop with a mouse.
 *
 * Every route prints one PASS or FAIL row. Any FAIL row fails the test.
 * Run it: see playwright.config.ts beside this file.
 *
 * Why: verify findings swe19, ui22, R10 and R14. A card whose Play button
 * sat below the visible part of the card shipped once, because only jsdom
 * tests (no layout) guarded the start surface.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type BrowserContextOptions, type Page } from "playwright/test";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const APP_SRC = path.join(REPO_ROOT, "apps", "web", "src");

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1";
const IPHONE: BrowserContextOptions = {
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
  userAgent: IPHONE_UA,
};

const SCREENS: { name: string; options: BrowserContextOptions }[] = [
  { name: "iPhone 320x568", options: { ...IPHONE, viewport: { width: 320, height: 568 } } },
  { name: "iPhone 375x667", options: { ...IPHONE, viewport: { width: 375, height: 667 } } },
  { name: "iPhone 390x844", options: { ...IPHONE, viewport: { width: 390, height: 844 } } },
  { name: "iPhone sideways 844x390", options: { ...IPHONE, viewport: { width: 844, height: 390 } } },
  { name: "desktop 1280x800", options: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } },
];

/** Where the cue must not show, it may change a pixel by this much per channel (the R8 line was 55). */
const NO_CUE = 12;
/** Room (CSS px) past the body's box, for the browser's rounding of its edges. */
const EDGE_MARGIN = 2;
/** The depth (CSS px) of the cue's shadow band: 0.75rem, and a little more. */
const CUE_BAND = 14;

// ---------------------------------------------------------------- source

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/**
 * True when the route's module mounts GameStartOverlay. The module folders
 * come from the route's page.tsx imports (@/games/<id>, @/apps/<id>).
 * This reads the checkout the spec runs from, so run it against a server
 * built from the same checkout.
 */
function mountsStartCard(route: string): boolean {
  const pageFile = path.join(APP_SRC, "app", ...route.split("/").filter(Boolean), "page.tsx");
  if (!existsSync(pageFile)) {
    throw new Error(`no page file at ${path.relative(REPO_ROOT, pageFile)}`);
  }
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

/** Waits until the start surface stops moving (fonts, the break slot, the tip, the rotate card). */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  let last = "";
  for (let i = 0; i < 20; i++) {
    const now = await page.evaluate(() => {
      const ids = [
        "game-start-overlay",
        "start-card",
        "start-card-body",
        "start-card-actions",
        "start-overlay-break-slot",
        "ios-install-tip",
        "ios-install-sheet",
      ];
      const boxes = ids.map((id) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        if (!el) return `${id}:-`;
        const r = el.getBoundingClientRect();
        return `${id}:${r.top.toFixed(1)},${r.bottom.toFixed(1)},${r.left.toFixed(1)},${r.right.toFixed(1)}`;
      });
      const rotate = [...document.querySelectorAll("button")].some((b) =>
        /Continue in portrait anyway/.test(b.textContent ?? "")
      );
      return `${boxes.join("|")}|rotate:${rotate}`;
    });
    if (now === last) return;
    last = now;
    await page.waitForTimeout(300);
  }
}

/** Landscape games ask a portrait phone to turn; the kid can say no. */
async function passRotateCard(page: Page): Promise<boolean> {
  const button = page.getByRole("button", { name: /Continue in portrait anyway/ });
  if (!(await button.isVisible())) return false;
  await button.click();
  await expect(button).toBeHidden();
  await settle(page);
  return true;
}

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface Control {
  name: string;
  box: Box;
  inViewport: boolean;
  inCard: boolean;
  hit: boolean;
}

interface Probe {
  parentIsBody: boolean;
  viewport: { width: number; height: number };
  scrollY: number;
  card: Box;
  cardScrolls: boolean;
  cardColor: string;
  body: Box;
  bodyHidden: number;
  bodyScrollTop: number;
  moreAbove: boolean;
  moreBelow: boolean;
  controls: Control[];
  readAloud: Control | null;
  tip: { box: Box; inCard: boolean; overlapsCard: boolean; inViewport: boolean } | null;
  sheet: boolean;
}

function probeStartCard(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const vw = innerWidth;
    const vh = innerHeight;
    const boxOf = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };
    const overlay = document.querySelector('[data-testid="game-start-overlay"]')!;
    const card = overlay.querySelector<HTMLElement>('[data-testid="start-card"]')!;
    const body = overlay.querySelector<HTMLElement>('[data-testid="start-card-body"]')!;
    const actions = overlay.querySelector<HTMLElement>('[data-testid="start-card-actions"]')!;
    const cardBox = boxOf(card);
    const control = (button: HTMLElement) => {
      const b = boxOf(button);
      const hitEl = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2);
      return {
        name: (button.getAttribute("aria-label") ?? button.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40),
        box: b,
        inViewport: b.top >= -0.5 && b.bottom <= vh + 0.5 && b.left >= -0.5 && b.right <= vw + 0.5,
        inCard:
          b.top >= cardBox.top - 0.5 &&
          b.bottom <= cardBox.bottom + 0.5 &&
          b.left >= cardBox.left - 0.5 &&
          b.right <= cardBox.right + 0.5,
        hit: !!hitEl && (hitEl === button || button.contains(hitEl)),
      };
    };
    const buttons = [...actions.querySelectorAll<HTMLElement>("button")];
    const readAloud = buttons.find((b) => b.dataset.testid === "read-aloud-button") ?? null;
    const tip = document.querySelector('[data-testid="ios-install-tip"]');
    const tipBox = tip ? boxOf(tip) : null;
    return {
      parentIsBody: overlay.parentElement === document.body,
      viewport: { width: vw, height: vh },
      scrollY: scrollY,
      card: cardBox,
      cardScrolls: card.scrollHeight > card.clientHeight + 1,
      cardColor: getComputedStyle(card).backgroundColor,
      body: boxOf(body),
      bodyHidden: body.scrollHeight - body.clientHeight,
      bodyScrollTop: body.scrollTop,
      moreAbove: body.hasAttribute("data-more-above"),
      moreBelow: body.hasAttribute("data-more-below"),
      controls: buttons.filter((b) => b !== readAloud).map(control),
      readAloud: readAloud ? control(readAloud) : null,
      tip:
        tip && tipBox
          ? {
              box: tipBox,
              inCard: card.contains(tip),
              overlapsCard:
                tipBox.top < cardBox.bottom - 0.5 &&
                tipBox.bottom > cardBox.top + 0.5 &&
                tipBox.left < cardBox.right - 0.5 &&
                tipBox.right > cardBox.left + 0.5,
              inViewport: tipBox.top >= -0.5 && tipBox.bottom <= vh + 0.5,
            }
          : null,
      sheet: !!document.querySelector('[data-testid="ios-install-sheet"]'),
    };
  });
}

/**
 * page.screenshot, tried again when Chromium says "Unable to capture
 * screenshot". After a heavy WebGL page closes (four-wheeler-3d comes just
 * before four-wheeler-adventure), the next page cannot capture for a
 * moment: 0.5 s on a quiet machine, a few seconds on a busy one. The same
 * page then captures normally, so this is not a defect of the page. The
 * wait grows with each try (about 27 s in total) before the row fails.
 */
async function capture(page: Page, options: Parameters<Page["screenshot"]>[0]): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await page.screenshot(options);
    } catch (error) {
      if (attempt >= 10 || !/Unable to capture screenshot/.test(String(error))) throw error;
      await page.waitForTimeout(500 * attempt);
    }
  }
}

interface Region {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const NO_CUE_STYLE = "e2e-start-cards-no-scroll-cue";

/**
 * What the scroll cue paints in a region of the screen: the largest
 * per-channel difference between a screenshot with the cue and one with
 * the body's background turned off, over the pixels that are the card
 * color without the cue. So text, the dim layer and a game that moves
 * behind it do not count, and the answer does not depend on how the
 * browser rounds the body's edges to device pixels (a line one device
 * pixel tall still shows: the screenshots are at device scale). The PNGs
 * are decoded in a separate blank page.
 */
async function cuePaint(page: Page, decoder: Page, region: Region, cardColor: string): Promise<number> {
  const viewport = page.viewportSize()!;
  const x0 = Math.max(0, Math.floor(region.x0));
  const y0 = Math.max(0, Math.floor(region.y0));
  const x1 = Math.min(viewport.width, Math.ceil(region.x1));
  const y1 = Math.min(viewport.height, Math.ceil(region.y1));
  if (x1 <= x0 || y1 <= y0) return 0;
  const clip = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };

  const withCue = await capture(page, { clip, animations: "disabled" });
  await page.evaluate((id) => {
    const style = document.createElement("style");
    style.id = id;
    style.textContent = '[data-testid="start-card-body"] { background: none !important; }';
    document.head.append(style);
  }, NO_CUE_STYLE);
  const withoutCue = await capture(page, { clip, animations: "disabled" });
  await page.evaluate((id) => document.getElementById(id)?.remove(), NO_CUE_STYLE);

  return decoder.evaluate(
    async ({ a, b, color }) => {
      const decode = async (b64: string) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, img.width, img.height).data;
      };
      const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
      probe.fillStyle = color;
      probe.fillRect(0, 0, 1, 1);
      const card = probe.getImageData(0, 0, 1, 1).data;
      const cue = await decode(a);
      const bare = await decode(b);
      let worst = 0;
      for (let i = 0; i < bare.length; i += 4) {
        const isCard =
          Math.abs(bare[i] - card[0]) <= 8 && Math.abs(bare[i + 1] - card[1]) <= 8 && Math.abs(bare[i + 2] - card[2]) <= 8;
        if (!isCard) continue;
        worst = Math.max(
          worst,
          Math.abs(cue[i] - bare[i]),
          Math.abs(cue[i + 1] - bare[i + 1]),
          Math.abs(cue[i + 2] - bare[i + 2])
        );
      }
      return worst;
    },
    { a: withCue.toString("base64"), b: withoutCue.toString("base64"), color: cardColor }
  );
}

/** The whole body, or the band along one edge that the cue's shadow covers, with room for rounding. */
function bodyRegion(body: Box, part: "all" | "top" | "bottom"): Region {
  const x0 = body.left - EDGE_MARGIN;
  const x1 = body.right + EDGE_MARGIN;
  if (part === "top") return { x0, x1, y0: body.top - EDGE_MARGIN, y1: body.top + CUE_BAND };
  if (part === "bottom") return { x0, x1, y0: body.bottom - CUE_BAND, y1: body.bottom + EDGE_MARGIN };
  return { x0, x1, y0: body.top - EDGE_MARGIN, y1: body.bottom + EDGE_MARGIN };
}

const px = (n: number) => Math.round(n);
const describeControl = (c: Control) => `${c.name} ${px(c.box.top)}-${px(c.box.bottom)}`;

/** Checks one start card. Returns the problems (empty when it passes) and a short summary. */
async function checkStartCard(page: Page, decoder: Page): Promise<{ problems: string[]; summary: string }> {
  const problems: string[] = [];
  const p = await probeStartCard(page);

  if (!p.parentIsBody) problems.push("the start card is not portaled to document.body");
  if (p.scrollY !== 0) problems.push(`the page scrolled to y ${px(p.scrollY)}`);
  if (p.cardScrolls) problems.push("the card itself scrolls");
  if (p.controls.length === 0) problems.push("no Play or choice button in the action row");
  for (const c of [...p.controls, ...(p.readAloud ? [p.readAloud] : [])]) {
    if (!c.inCard) problems.push(`"${c.name}" is outside the card (${px(c.box.top)}-${px(c.box.bottom)}, card ${px(p.card.top)}-${px(p.card.bottom)})`);
    if (!c.inViewport) problems.push(`"${c.name}" is outside the viewport (${px(c.box.top)}-${px(c.box.bottom)} of ${p.viewport.height})`);
    if (!c.hit) problems.push(`a tap at the centre of "${c.name}" hits something else`);
  }
  if (!p.readAloud) problems.push('no "Read it to me" button');
  if (p.tip) {
    if (p.tip.inCard) problems.push("the iOS install tip is inside the card");
    if (p.tip.overlapsCard) problems.push("the iOS install tip is on top of the card");
    if (!p.tip.inViewport) problems.push("the iOS install tip is below the viewport");
  }
  if (p.sheet) problems.push("the iOS install sheet shows while the start card is up");

  // The scroll cue (nothing scrolled yet). "more below" only when the body
  // overflows, never "more above", and the pixels agree with the flags.
  const overflows = p.bodyHidden > 1;
  if (p.moreAbove) problems.push('the body shows "more above" before any scroll');
  if (p.moreBelow !== overflows) {
    problems.push(
      overflows
        ? `the body overflows by ${px(p.bodyHidden)} px but has no "more below" cue`
        : `the body fits (${px(p.bodyHidden)} px hidden) but has a "more below" cue`
    );
  }
  if (!overflows) {
    const paint = await cuePaint(page, decoder, bodyRegion(p.body, "all"), p.cardColor);
    if (paint > NO_CUE) {
      problems.push(`the cue paints on a body that fits (a line, off by ${paint}; verify finding R8)`);
    }
  } else {
    // (Where more is past an edge, the shadow shows only in the gaps
    // between the body's content: it is the body's background. So the
    // pixels prove only where the cue must NOT paint; the flags above say
    // where it does.)
    const top = await cuePaint(page, decoder, bodyRegion(p.body, "top"), p.cardColor);
    if (top > NO_CUE) problems.push(`the cue paints at the top before any scroll (off by ${top})`);

    // Scroll the body to its end: "more above" now, and nothing at the bottom.
    await page.getByTestId("start-card-body").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect
      .poll(() => page.getByTestId("start-card-body").evaluate((el) => el.hasAttribute("data-more-above")))
      .toBe(true);
    const end = await probeStartCard(page);
    if (end.moreBelow) problems.push('the body has a "more below" cue at the end of its scroll');
    const endBottom = await cuePaint(page, decoder, bodyRegion(end.body, "bottom"), end.cardColor);
    if (endBottom > NO_CUE) problems.push(`the cue paints at the bottom at the end of the scroll (off by ${endBottom})`);
  }

  const tip = p.tip ? `tip ${px(p.tip.box.top)}-${px(p.tip.box.bottom)}` : "no tip";
  const body = overflows ? `body scrolls ${px(p.bodyHidden)} px` : "body fits";
  const summary = `${p.controls.map(describeControl).join(", ")}; card ${px(p.card.top)}-${px(p.card.bottom)}/${p.viewport.height}; ${body}; ${tip}`;
  return { problems, summary };
}

// ---------------------------------------------------------------- tests

for (const screen of SCREENS) {
  test(`start cards on ${screen.name}`, async ({ browser }, testInfo) => {
    const home = await browser.newContext(screen.options);
    const routes = await homeRoutes(await home.newPage());
    await home.close();
    expect(routes.length, "the home page lists games and apps").toBeGreaterThan(10);

    // A blank page to decode screenshots in (no CSP, not the page under test).
    const decoderContext = await browser.newContext();
    const decoder = await decoderContext.newPage();

    const rows: string[] = [];
    const failures: string[] = [];
    let cards = 0;
    for (const route of routes) {
      const context = await browser.newContext(screen.options);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(String(error.message).split("\n")[0].slice(0, 120)));
      let problems: string[] = [];
      let summary = "";
      try {
        const expectCard = mountsStartCard(route);
        await page.goto(route, { waitUntil: "load" });
        const overlay = page.getByTestId("game-start-overlay");
        if (expectCard) {
          await expect(overlay).toBeVisible();
          await settle(page);
          const rotated = await passRotateCard(page);
          ({ problems, summary } = await checkStartCard(page, decoder));
          if (rotated) summary += "; passed the rotate card";
          cards++;
        } else {
          await page.waitForLoadState("networkidle").catch(() => undefined);
          await settle(page);
          if (await overlay.count()) problems.push("a start card shows, but the module does not mount GameStartOverlay");
          summary = "no start card (the module has none)";
        }
        await capture(page, {
          path: testInfo.outputPath(`${route.replace(/^\//, "").replace(/\//g, "_")}.png`),
        });
      } catch (error) {
        problems.push(`error: ${String(error instanceof Error ? error.message : error).split("\n")[0].slice(0, 200)}`);
      }
      const info = errors.length ? ` | page errors: ${errors.join(" ; ")}` : "";
      const row = `${problems.length ? "FAIL" : "PASS"} | ${screen.name} | ${route} | ${summary}${
        problems.length ? ` | ${problems.join("; ")}` : ""
      }${info}`;
      console.log(row);
      rows.push(row);
      if (problems.length) failures.push(row);
      await context.close();
    }
    await decoderContext.close();

    console.log(`${rows.length - failures.length}/${rows.length} PASS on ${screen.name} (${cards} start cards)`);
    expect(cards, "at least one listed route has a start card").toBeGreaterThan(0);
    expect(failures, `start-card rows that failed on ${screen.name}`).toEqual([]);
  });
}
