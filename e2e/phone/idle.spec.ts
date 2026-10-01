/**
 * Game checks for the idle game, the retro arcade and the two small apps
 * (phone UX audit, PR-G7), on the four iPhone screens, by touch only, with
 * an iPhone user agent:
 *
 *   Cookie Clicker  the count, the whole cookie and the top of the shop
 *                   are on one screen (the shop was 650 px under the cookie
 *                   upright, and the cookie did not fit sideways); two
 *                   thumbs count two taps; a kid buys a Cursor without
 *                   scrolling; the achievement notice goes by itself (the
 *                   first one stayed for the whole game).
 *   Retro Arcade    the consoles with games are first and on screen, the
 *                   ones that need a file wait under a fold on a phone;
 *                   the catalog opens at its top with the search on
 *                   screen (it opened 355-569 px down); an uploader shows
 *                   Choose File on the first screen.
 *   Toy Finder      the first toys show on the first screen (the first card
 *                   was under the fold); the filters are single rows.
 *   Weather         the city buttons are on screen and nothing covers them.
 *
 * Run it with the gate: pnpm e2e:phone <base-url>. E2E_ROUTES limits it.
 */
import { expect, test, type Locator, type Page } from "playwright/test";

import { measure, noProblems, oneScreen, openGame, SCREENS, wanted } from "./touch";

async function dismissTip(page: Page) {
  const keepPlaying = page.getByRole("button", { name: /Keep playing/ });
  await page.waitForTimeout(600);
  if (await keepPlaying.isVisible()) await keepPlaying.tap();
  await page.waitForTimeout(300);
}

/** The whole box of `l` is inside the viewport. */
async function wholeOnScreen(page: Page, l: Locator, what: string) {
  const b = await l.boundingBox();
  expect(b, `${what} has a box`).not.toBeNull();
  const vp = page.viewportSize()!;
  expect(b!.y, `${what}: top on screen`).toBeGreaterThanOrEqual(-0.5);
  expect(b!.x, `${what}: left on screen`).toBeGreaterThanOrEqual(-0.5);
  expect(b!.y + b!.height, `${what}: bottom on screen`).toBeLessThanOrEqual(vp.height + 0.5);
  expect(b!.x + b!.width, `${what}: right on screen`).toBeLessThanOrEqual(vp.width + 0.5);
}

/** Nothing covers the middle of `l` (the element there is `l` or inside it). */
async function uncovered(l: Locator, what: string) {
  const free = await l.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === el || el.contains(hit));
  });
  expect(free, `${what}: nothing covers it`).toBe(true);
}

const cookies = async (page: Page) => Number(((await page.getByTestId("cookie-count").textContent()) ?? "").match(/([\d,]+) cookies/)?.[1].replace(/,/g, "") ?? NaN);

test("idle: Cookie Clicker on four iPhone screens", async ({ browser }) => {
  test.skip(!wanted("/games/cookie-clicker"), "not in E2E_ROUTES");
  test.setTimeout(SCREENS.length * 60_000);
  for (const screen of SCREENS) {
    await test.step(screen.name, async () => {
      const { context, page, finger, errors } = await openGame(browser, screen, "/games/cookie-clicker");
      try {
        await page.evaluate(() => localStorage.clear());
        await page.reload({ waitUntil: "load" });
        const play = page.getByTestId("game-start-overlay").getByRole("button", { name: /Play/ }).last();
        await play.waitFor();
        await finger.tap(play);
        await dismissTip(page);
        await oneScreen(page);

        const cookie = page.getByRole("button", { name: "cookie", exact: true });
        await wholeOnScreen(page, page.getByTestId("cookie-count"), `${screen.name} count`);
        await wholeOnScreen(page, cookie, `${screen.name} cookie`);
        const shop = await page.getByTestId("cookie-shop").boundingBox();
        expect(shop!.y + 80, `${screen.name}: the shop's top is on the first screen`).toBeLessThanOrEqual(page.viewportSize()!.height);

        // Two thumbs at once: two taps.
        const before = await cookies(page);
        await finger.holdWith(cookie, 60, async (other) => other(cookie));
        await expect.poll(() => cookies(page), { message: `${screen.name}: two thumbs, two cookies` }).toBeGreaterThanOrEqual(before + 2);

        // The first achievement shows, clear of the cookie, then goes by itself.
        await expect(page.getByTestId("cookie-achievement")).toBeVisible();
        const notice = (await page.getByTestId("cookie-achievement").locator("div").first().boundingBox())!;
        const round = (await cookie.boundingBox())!;
        expect(notice.y + notice.height, `${screen.name}: the notice ends above the cookie`).toBeLessThanOrEqual(round.y + 1);
        await expect(page.getByTestId("cookie-achievement"), `${screen.name}: the notice goes by itself`).toBeHidden({ timeout: 6_000 });

        // Bake 15 and buy a Cursor, with no page scroll.
        while ((await cookies(page)) < 15) await finger.tap(cookie);
        const cursor = page.getByRole("button", { name: /^Buy Cursor/ });
        await cursor.scrollIntoViewIfNeeded();
        await uncovered(cursor, `${screen.name} Buy Cursor`);
        await finger.tap(cursor);
        await expect(cursor).toHaveAccessibleName(/You have 1\./);
        await oneScreen(page);
        noProblems(`${screen.name} shop`, await page.evaluate(measure, { selector: '[data-testid="cookie-shop"] button:not([disabled])' }));
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
});

test("idle: Retro Arcade picker, catalog and uploader on four iPhone screens", async ({ browser }) => {
  test.skip(!wanted("/games/retro-arcade"), "not in E2E_ROUTES");
  test.setTimeout(SCREENS.length * 60_000);
  for (const screen of SCREENS) {
    await test.step(screen.name, async () => {
      const { context, page, finger, errors } = await openGame(browser, screen, "/games/retro-arcade");
      try {
        await page.getByTestId("retro-picker").waitFor();
        await dismissTip(page);
        // The consoles with games first, whole on the first screen.
        await wholeOnScreen(page, page.getByTestId("console-snes"), `${screen.name} SNES card`);
        await wholeOnScreen(page, page.getByTestId("console-atari2600"), `${screen.name} Atari card`);
        await expect(page.getByTestId("console-nes"), `${screen.name}: the file consoles are folded on a phone`).toHaveCount(0);
        noProblems(`${screen.name} picker`, await page.evaluate(measure, { selector: '[data-testid="retro-picker"] button' }));

        // The catalog opens at its top: the search is on screen.
        await finger.tap(page.getByTestId("console-atari2600"));
        await page.getByTestId("retro-catalog").waitFor();
        await wholeOnScreen(page, page.getByPlaceholder(/Search Atari 2600 games/), `${screen.name} search`);
        await wholeOnScreen(page, page.getByTestId("catalog-game").first(), `${screen.name} first game`);
        await oneScreen(page);
        await finger.tap(page.getByRole("button", { name: /← Back/ }));

        // A file console: Choose File on the first screen.
        await page.getByTestId("retro-picker").waitFor();
        await finger.tap(page.getByTestId("show-file-consoles"));
        const nes = page.getByTestId("console-nes");
        await nes.scrollIntoViewIfNeeded();
        await finger.tap(nes);
        await page.getByTestId("retro-uploader").waitFor();
        await wholeOnScreen(page, page.getByRole("button", { name: /Choose File/ }), `${screen.name} Choose File`);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
});

test("idle: Toy Finder and Weather show their first things on the first screen", async ({ browser }) => {
  test.skip(!wanted("/apps/toy-finder") && !wanted("/apps/weather"), "not in E2E_ROUTES");
  test.setTimeout(SCREENS.length * 60_000);
  for (const screen of SCREENS) {
    await test.step(screen.name, async () => {
      if (wanted("/apps/toy-finder")) {
        const { context, page, errors } = await openGame(browser, screen, "/apps/toy-finder");
        try {
          const firstCard = page.getByTestId("toy-card").first();
          await firstCard.waitFor();
          await dismissTip(page);
          const card = (await firstCard.boundingBox())!.y;
          expect(card, `${screen.name}: the first toy starts on the first screen`).toBeLessThan(page.viewportSize()!.height - 40);
          for (const row of ["toy-categories", "toy-ages"]) {
            // One row: every chip's top within 8 px of the first (the picked
            // chip is scaled up a little, so its top moves by a pixel).
            const spread = await page.getByTestId(row).evaluate((el) => {
              const tops = [...el.children].map((c) => c.getBoundingClientRect().top);
              return Math.max(...tops) - Math.min(...tops);
            });
            expect(spread, `${screen.name}: ${row} is one row`).toBeLessThan(8);
          }
          expect(errors).toEqual([]);
        } finally {
          await context.close();
        }
      }
      if (wanted("/apps/weather")) {
        const { context, page, errors } = await openGame(browser, screen, "/apps/weather");
        try {
          const denver = page.getByRole("button", { name: /Denver/ });
          await denver.waitFor();
          await dismissTip(page);
          await denver.scrollIntoViewIfNeeded();
          for (const city of ["New York", "Los Angeles", "Chicago", "Denver"]) {
            const button = page.getByRole("button", { name: new RegExp(city) });
            await uncovered(button, `${screen.name} ${city}`);
            const b = await button.boundingBox();
            expect(b!.height, `${screen.name} ${city}: 44 px`).toBeGreaterThanOrEqual(43.5);
          }
          expect(errors).toEqual([]);
        } finally {
          await context.close();
        }
      }
    });
  }
});
