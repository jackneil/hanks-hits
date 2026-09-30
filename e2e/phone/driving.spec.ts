/**
 * Game checks for the driving games (phone UX audit, PR-G1).
 *
 * The phone gate (phone-gate.spec.ts) proves what every game must do on a
 * phone. This spec proves what a driving game must do, on the same four
 * iPhone screens, by touch only, with an iPhone user agent:
 *
 *   drives        holding the pedal makes the ride go
 *   pause-holds   the header pause button opens the pause menu, and the
 *                 ride stands still under it
 *   controls      no control covers another, none is under 44 px, and
 *                 none is off the screen (in play, and in the other states
 *                 each game has: tilt on, on foot)
 *   sheets        every button in each sheet is on the screen, or in a
 *                 part of the sheet that scrolls
 *
 * Run it with the gate: pnpm e2e:phone <base-url>. E2E_ROUTES limits it to
 * the routes named there, the same as the gate.
 */
import { expect, test, type Browser, type BrowserContextOptions, type Locator, type Page } from "playwright/test";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1";
const IPHONE: BrowserContextOptions = { isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: IPHONE_UA };

/** The inner sizes of iPhone Safari with its toolbars shown (the gate's SCREENS). */
const SCREENS = [
  { name: "375x549", width: 375, height: 549 },
  { name: "667x311", width: 667, height: 311 },
  { name: "390x664", width: 390, height: 664 },
  { name: "844x340", width: 844, height: 340 },
] as const;

type Screen = (typeof SCREENS)[number];

const MIN_TARGET = 44;

/** True when E2E_ROUTES is unset or names this route. */
function wanted(route: string): boolean {
  const raw = process.env.E2E_ROUTES?.trim();
  if (!raw) return true;
  return raw.split(",").map((r) => r.trim().replace(/\/+$/, "")).includes(route);
}

/** A finger: taps and holds by real touch events, never a mouse click. */
class Finger {
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

async function openGame(browser: Browser, screen: Screen, route: string) {
  const context = await browser.newContext({ ...IPHONE, viewport: { width: screen.width, height: screen.height } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const cdp = await context.newCDPSession(page);
  const finger = new Finger(page, (type, touchPoints) => cdp.send("Input.dispatchTouchEvent", { type: type as "touchStart", touchPoints }));
  await page.goto(route, { waitUntil: "load" });
  return { context, page, finger, errors };
}

interface Geometry {
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
function measure({ selector, extra = [] }: { selector: string; extra?: string[] }): Geometry {
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
function unreachableInSheet(): string[] | null {
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
async function oneScreen(page: Page) {
  const { doc, inner } = await page.evaluate(() => ({ doc: document.scrollingElement!.scrollHeight, inner: innerHeight }));
  expect(doc, "the page is never taller than the screen").toBeLessThanOrEqual(inner);
}

function noProblems(where: string, g: Geometry) {
  expect(g.overlaps, `${where}: no control covers another`).toEqual([]);
  expect(g.small, `${where}: every control is at least ${MIN_TARGET} px`).toEqual([]);
  expect(g.off, `${where}: every control is on the screen`).toEqual([]);
}

const number = (text: string | null) => Number((text ?? "").match(/-?\d+/)?.[0] ?? NaN);

// ------------------------------------------------------------ Hill Climb

test("driving: Hill Climb on four iPhone screens", async ({ browser }) => {
  test.skip(!wanted("/games/hill-climb"), "not in E2E_ROUTES");
  for (const screen of SCREENS) {
    await test.step(screen.name, async () => {
      const { context, page, finger, errors } = await openGame(browser, screen, "/games/hill-climb");
      try {
        await page.getByRole("button", { name: /Play Now/ }).first().waitFor();
        await finger.tap(page.getByRole("button", { name: /Play Now/ }).first());
        const distance = page.getByTestId("hill-climb-distance");
        await distance.waitFor();
        await oneScreen(page);
        noProblems(
          `${screen.name} play`,
          await page.evaluate(measure, { selector: '[data-testid="hill-climb-touch"] button, [data-testid="hill-climb-hud"] button' }),
        );

        // drives, then pause-holds: a thumb on the GAS chip (the right half of
        // the play box is the gas; the chip marks where a kid presses), and
        // the other thumb taps Pause mid-drive.
        const speed = page.getByTestId("hill-climb-speed");
        const before = number(await distance.textContent());
        const paused = await finger.holdWith(page.getByTestId("hill-climb-gas-chip"), 2500, async (otherThumb) => {
          expect(number(await distance.textContent()), `${screen.name}: holding gas drives`).toBeGreaterThan(before);
          await otherThumb(page.getByRole("button", { name: "Pause game" }));
          await expect(page.getByTestId("hill-climb-pause")).toBeVisible();
          return { distance: await distance.textContent(), speed: await speed.textContent() };
        });
        expect(number(paused.speed), `${screen.name}: paused while moving`).toBeGreaterThan(0);
        await page.waitForTimeout(1500);
        expect({ distance: await distance.textContent(), speed: await speed.textContent() }, `${screen.name}: the ride stands still under pause`).toEqual(paused);
        expect(await page.evaluate(unreachableInSheet), `${screen.name}: pause sheet`).toEqual([]);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
});

// ---------------------------------------------------------- Monster Truck

test("driving: Monster Truck on four iPhone screens", async ({ browser }) => {
  test.skip(!wanted("/games/monster-truck"), "not in E2E_ROUTES");
  const CONTROLS = '[data-testid="monster-truck-mobile-controls"] button, [data-testid="monster-truck-hud"] button';
  for (const screen of SCREENS) {
    await test.step(screen.name, async () => {
      const { context, page, finger, errors } = await openGame(browser, screen, "/games/monster-truck");
      try {
        await finger.tap(page.getByRole("button", { name: /Play/ }).first());
        const speed = page.getByTestId("monster-truck-speed");
        await speed.waitFor();
        await oneScreen(page);
        noProblems(`${screen.name} play`, await page.evaluate(measure, { selector: CONTROLS }));

        // Tilt on (no sensor here): the note or CALIBRATE shows, clear of the rest.
        await finger.tap(page.getByTestId("tilt-toggle"));
        await page.waitForTimeout(500);
        noProblems(`${screen.name} tilt`, await page.evaluate(measure, { selector: CONTROLS }));
        await finger.tap(page.getByTestId("tilt-toggle"));

        // sheets: Challenges.
        await finger.tap(page.getByRole("button", { name: /Challenges/ }).first());
        await expect(page.getByTestId("monster-truck-challenges")).toBeVisible();
        expect(await page.evaluate(unreachableInSheet), `${screen.name}: challenges sheet`).toEqual([]);
        await finger.tap(page.getByRole("button", { name: /Keep driving/ }).first());

        // drives, then pause-holds: the other thumb taps Pause mid-drive.
        const paused = await finger.holdWith(page.getByRole("button", { name: "Gas" }), 1500, async (otherThumb) => {
          expect(number(await speed.textContent()), `${screen.name}: holding Gas drives`).toBeGreaterThan(0);
          await otherThumb(page.getByRole("button", { name: "Pause game" }));
          await expect(page.getByTestId("monster-truck-pause")).toBeVisible();
          return speed.textContent();
        });
        expect(number(paused), `${screen.name}: paused while moving`).toBeGreaterThan(0);
        await page.waitForTimeout(1200);
        expect(await speed.textContent(), `${screen.name}: the truck stands still under pause`).toBe(paused);
        expect(await page.evaluate(unreachableInSheet), `${screen.name}: pause sheet`).toEqual([]);

        await finger.tap(page.getByRole("button", { name: /Garage/ }).first());
        await expect(page.getByTestId("monster-truck-garage")).toBeVisible();
        expect(await page.evaluate(unreachableInSheet), `${screen.name}: garage sheet`).toEqual([]);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
});

// -------------------------------------------------- Four-Wheeler Adventure

test("driving: Four-Wheeler Adventure on four iPhone screens", async ({ browser }) => {
  test.skip(!wanted("/games/four-wheeler-adventure"), "not in E2E_ROUTES");
  for (const screen of SCREENS) {
    await test.step(screen.name, async () => {
      const { context, page, finger, errors } = await openGame(browser, screen, "/games/four-wheeler-adventure");
      try {
        await finger.tap(page.getByRole("button", { name: /Play/ }).first());
        const frame = page.frameLocator("iframe");
        await frame.locator("#btnGas").waitFor();
        await page.waitForTimeout(1000); // The rails lay out on the next frame.
        await oneScreen(page);
        const game = page.frames().find((f) => f !== page.mainFrame())!;
        // The game is one page in a frame: its own controls, rails and HUD.
        noProblems(`${screen.name} play`, await game.evaluate(measure, { selector: "#touch .tbtn, .rail > button, body.touch #nosBtn" }));
        const speedoClash = await game.evaluate(() => {
          const s = document.getElementById("speedo")?.getBoundingClientRect();
          if (!s || s.width === 0) return [];
          return [...document.querySelectorAll("#touch .tbtn, .rail > button, #nosBtn")]
            .filter((b) => {
              const r = b.getBoundingClientRect();
              return r.width > 0 && Math.min(r.right, s.right) - Math.max(r.left, s.left) > 2 && Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top) > 2;
            })
            .map((b) => b.id || b.textContent);
        });
        expect(speedoClash, `${screen.name}: nothing covers the speedo`).toEqual([]);

        // drives, then pause-holds: the other thumb taps Pause mid-drive.
        const speed = () => game.evaluate(() => Number(document.getElementById("speed")?.textContent?.match(/\d+/)?.[0] ?? 0));
        const paused = await finger.holdWith(frame.locator("#btnGas"), 1500, async (otherThumb) => {
          expect(await speed(), `${screen.name}: holding GAS drives`).toBeGreaterThan(0);
          await otherThumb(page.getByRole("button", { name: "Pause game" }));
          await expect(page.getByTestId("pause-menu")).toBeVisible();
          return speed();
        });
        expect(paused, `${screen.name}: paused while moving`).toBeGreaterThan(0);
        await page.waitForTimeout(1500);
        expect(await speed(), `${screen.name}: the ride stands still under pause`).toBe(paused);
        await finger.tap(page.getByTestId("pause-menu").getByRole("button", { name: /Resume/ }).first());
        await expect(page.getByTestId("pause-menu")).toBeHidden();

        // Hunting on foot works by touch: a keyboard has G, P, O and B; a
        // phone has buttons in the rails (or behind More when they do not fit).
        const hud = async (id: string) => {
          const own = frame.locator(`#${id}`);
          if (await own.isVisible()) return finger.tap(own);
          const label = ((await own.textContent()) ?? "").trim();
          const rail = await own.evaluate((el) => el.parentElement?.id ?? "");
          await finger.tap(frame.locator(`#${rail} > .railMore`));
          await finger.tap(frame.locator("#moreSheet .moreList button", { hasText: label }).first());
        };
        const value = (expr: string) => game.evaluate(expr);
        // Get out and walk. Next to a parked ride the same button says
        // "Get in the ..." and swaps rides, so drive on until it says Get Out.
        for (let tries = 0; tries < 4; tries++) {
          const label = await frame.locator("#switchBtn").textContent();
          if (label?.includes("Get Out")) break;
          await finger.holdWith(frame.locator("#btnGas"), 1200, async () => undefined);
          await page.waitForTimeout(300);
        }
        await expect(frame.locator("#switchBtn")).toContainText("Get Out");
        await hud("switchBtn");
        await expect.poll(() => value("mode"), { timeout: 5_000 }).toBe("foot");
        await value("feedersToPlace = 1; standsToPlace = 1; cornBags = 1; true"); // bought at the stores
        await page.waitForTimeout(500);
        noProblems(`${screen.name} on foot`, await game.evaluate(measure, { selector: "#touch .tbtn, .rail > button, body.touch #nosBtn" }));
        await hud("gunBtn");
        await expect.poll(() => value("aiming"), { timeout: 3_000 }).toBe(true);
        await hud("gunBtn");
        await expect.poll(() => value("aiming"), { timeout: 3_000 }).toBe(false);
        const feeders = (await value("feeders.length")) as number;
        await hud("feederBtn");
        await expect.poll(() => value("feeders.length"), { timeout: 3_000 }).toBe(feeders + 1);
        const stands = (await value("treestands.length")) as number;
        await hud("standPlaceBtn");
        await expect.poll(() => value("treestands.length"), { timeout: 3_000 }).toBe(stands + 1);
        await hud("cornBtn");
        await expect.poll(() => value("carryingCorn"), { timeout: 3_000 }).toBe(true);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
});

// ------------------------------------------------ Four-Wheeler Adventure 3D

test("driving: Four-Wheeler Adventure 3D on four iPhone screens", async ({ browser }) => {
  test.skip(!wanted("/games/four-wheeler-3d"), "not in E2E_ROUTES");
  const CONTROLS = "button, [role=button]";
  const COVERED = [".fw-speedo-touch", ".fw-navigation", ".fw-balance"];
  for (const screen of SCREENS) {
    await test.step(screen.name, async () => {
      const { context, page, finger, errors } = await openGame(browser, screen, "/games/four-wheeler-3d");
      try {
        const play = page.getByRole("button", { name: "▶ Play!" });
        await play.waitFor();
        await finger.tap(play);
        const readout = page.locator(".fw-speedo-compact");
        await readout.waitFor();
        await page.waitForTimeout(1500);
        await oneScreen(page);
        noProblems(`${screen.name} drive`, await page.evaluate(measure, { selector: CONTROLS, extra: COVERED }));

        // Tilt on: HOLD STILL takes the arrows' place.
        await finger.tap(page.getByRole("button", { name: /TILT/ }));
        await page.waitForTimeout(500);
        noProblems(`${screen.name} tilt`, await page.evaluate(measure, { selector: CONTROLS, extra: COVERED }));
        await finger.tap(page.getByRole("button", { name: /TILT/ }));

        // On foot (parked, so Hop off is allowed): the context slot holds the
        // way back on, clear of everything, and it works by touch.
        await finger.tap(page.getByRole("button", { name: "Hop off" }));
        await page.getByRole("button", { name: "Walk forward" }).waitFor();
        await page.waitForTimeout(800);
        noProblems(`${screen.name} on foot`, await page.evaluate(measure, { selector: CONTROLS, extra: COVERED }));
        await finger.tap(page.locator(".fw-context").getByRole("button", { name: /^Ride / }));
        await page.getByRole("button", { name: "Gas" }).waitFor();

        // drives, then pause-holds: the other thumb taps Pause mid-drive.
        const paused = await finger.holdWith(page.getByRole("button", { name: "Gas" }), 2000, async (otherThumb) => {
          expect(number(await readout.textContent()), `${screen.name}: holding GAS drives`).toBeGreaterThan(0);
          await otherThumb(page.getByRole("button", { name: "Pause game" }));
          await expect(page.getByTestId("pause-menu")).toBeVisible();
          return readout.textContent();
        });
        expect(number(paused), `${screen.name}: paused while moving`).toBeGreaterThan(0);
        await page.waitForTimeout(1500);
        expect(await readout.textContent(), `${screen.name}: the ride stands still under pause`).toBe(paused);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
});
