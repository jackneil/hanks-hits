/**
 * Game checks for the arcade grid games (phone UX audit, PR-G4): Snake,
 * Blitz Bomber, Bomberman and Hextris, on the four iPhone screens, by touch
 * only, with an iPhone user agent:
 *
 *   fits        the whole field is inside the play box, and it is big:
 *               sideways at least 80 percent of the box's height (the
 *               Hextris hexagon and the Blitz Bomber ground used to be
 *               below the screen), upright at least 35 percent of it or the
 *               full width
 *   controls    the thumb buttons are at least 44 px, on the screen, and
 *               cover neither each other nor the field
 *   turns       the kid turns the phone mid-run and the field still moves
 *               (a layout that remounted the field or its pad under a new
 *               parent froze it: the Bomberman d-pad went dead)
 *   result      a run ends in the shared result chip, every chip button is
 *               on the screen, the result card (where there is one) is not
 *               under the chip, and Play again starts play at once, with no
 *               start card
 *
 * Every run ends the way a kid ends it: Snake (walls made solid in the
 * pause menu; they wrap around by default) runs into the wall, Blitz
 * Bomber (Hard) flies into a building, Bomberman stands on its own bombs,
 * Hextris lets the blocks stack.
 *
 * Run it with the gate: pnpm e2e:phone <base-url>. E2E_ROUTES limits it.
 */
import { expect, test, type Locator, type Page } from "playwright/test";

import { Finger, measure, noProblems, oneScreen, openGame, SCREENS, wanted } from "./touch";

interface GridGame {
  route: string;
  name: string;
  start: (page: Page) => Locator;
  /** The field. */
  picture: string;
  /** The thumb buttons, if the game has them. */
  buttons?: string;
  resultCard?: string;
  /** Plays until the run ends by itself. */
  playToTheEnd: (page: Page, finger: Finger) => Promise<void>;
}

const RUN_BUDGET_MS = 150_000;
const chipShows = (page: Page) => page.getByTestId("result-chip").isVisible();
const waitForChip = async (page: Page) => {
  await page.getByTestId("result-chip").waitFor({ timeout: RUN_BUDGET_MS });
};

const GAMES: GridGame[] = [
  {
    route: "/games/snake",
    name: "Snake",
    start: (page) => page.getByRole("button", { name: /Play/ }).first(),
    picture: '[data-testid="snake-board"]',
    buttons: '[data-testid="snake-dpad"] button',
    // Walls wrap around by default (a kid-friendly choice), so a snake that
    // is left alone never ends. A kid makes them solid in the pause menu,
    // goes on, and runs into one.
    playToTheEnd: async (page, finger) => {
      await finger.tap(page.getByRole("button", { name: "Pause game" }));
      const walls = page.getByRole("button", { name: /Walls: wrap around/ });
      await walls.waitFor();
      await finger.tap(walls);
      await page.getByRole("button", { name: /Walls: solid/ }).waitFor();
      await finger.tap(page.getByRole("button", { name: /▶️ Resume/ }));
      await waitForChip(page);
    },
  },
  {
    route: "/games/blitz-bomber",
    name: "Blitz Bomber",
    start: (page) => page.getByRole("button", { name: /Hard/ }),
    picture: '[data-testid="blitz-bomber-field"]',
    resultCard: '[data-testid="blitz-bomber-result-card"]',
    // Hands off: each pass flies lower, into the buildings.
    playToTheEnd: waitForChip,
  },
  {
    route: "/games/bomberman",
    name: "Bomberman",
    start: (page) => page.getByRole("button", { name: /Play/ }).first(),
    picture: '[data-testid="bomberman-arena"]',
    buttons: '[data-testid="bomberman-dpad"] button, [aria-label="Drop a bomb"]',
    resultCard: '[data-testid="bomberman-result-card"]',
    // Drop a bomb and stand on it, a try at a time.
    playToTheEnd: async (page, finger) => {
      const until = Date.now() + RUN_BUDGET_MS;
      while (Date.now() < until && !(await chipShows(page))) {
        const bomb = await page.getByRole("button", { name: "Drop a bomb" }).boundingBox({ timeout: 500 }).catch(() => null);
        if (bomb) await finger.tapAt(bomb.x + bomb.width / 2, bomb.y + bomb.height / 2);
        await page.waitForTimeout(1500);
      }
    },
  },
  {
    route: "/games/hextris",
    name: "Hextris",
    start: (page) => page.getByRole("button", { name: /Play/ }).first(),
    picture: '[data-testid="hextris-viewport"]',
    buttons: '[data-testid="hextris-spin-left"], [data-testid="hextris-spin-right"]',
    resultCard: '[data-testid="hextris-result-card"]',
    // Hands off: the blocks stack until a side is full.
    playToTheEnd: waitForChip,
  },
];

/** The field's box and the play box's, in CSS px. */
async function pictureFit(page: Page, picture: string) {
  return page.evaluate((sel) => {
    const r = document.querySelector(sel)!.getBoundingClientRect();
    const b = document.querySelector("[data-play-box]")!.getBoundingClientRect();
    return { picture: { x: r.x, y: r.y, w: r.width, h: r.height }, box: { x: b.x, y: b.y, w: b.width, h: b.height } };
  }, picture);
}

/** True when the field changes within 1.5 s. */
async function moves(picture: Locator, page: Page) {
  const first = await picture.screenshot();
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(250);
    if (!first.equals(await picture.screenshot())) return true;
  }
  return false;
}

async function dismissTip(page: Page, finger: Finger) {
  // A game held the other way up shows the orientation tip once; a kid
  // taps Keep playing (the game stands still under the tip).
  const keepPlaying = page.getByRole("button", { name: /Keep playing/ });
  await page.waitForTimeout(600);
  if (await keepPlaying.isVisible()) await finger.tap(keepPlaying);
  await page.waitForTimeout(300);
}

for (const game of GAMES) {
  test(`grid: ${game.name} on four iPhone screens`, async ({ browser }) => {
    test.skip(!wanted(game.route), "not in E2E_ROUTES");
    test.setTimeout(SCREENS.length * (RUN_BUDGET_MS + 60_000));
    for (const screen of SCREENS) {
      await test.step(screen.name, async () => {
        const { context, page, finger, errors } = await openGame(browser, screen, game.route);
        try {
          const start = game.start(page);
          await start.waitFor();
          await finger.tap(start);
          await page.locator(game.picture).waitFor();
          await dismissTip(page, finger);
          await oneScreen(page);

          // fits
          const { picture, box } = await pictureFit(page, game.picture);
          expect(picture.x, `${screen.name}: field inside the play box (left)`).toBeGreaterThanOrEqual(box.x - 0.5);
          expect(picture.y, `${screen.name}: field inside the play box (top)`).toBeGreaterThanOrEqual(box.y - 0.5);
          expect(picture.x + picture.w, `${screen.name}: field inside the play box (right)`).toBeLessThanOrEqual(box.x + box.w + 0.5);
          expect(picture.y + picture.h, `${screen.name}: field inside the play box (bottom)`).toBeLessThanOrEqual(box.y + box.h + 0.5);
          const pct = Math.round((picture.h / box.h) * 100);
          if (screen.width > screen.height) {
            expect(picture.h / box.h, `${screen.name}: the field uses the height (${pct}%)`).toBeGreaterThanOrEqual(0.8);
          } else {
            const tall = picture.h / box.h >= 0.35;
            const fullWidth = picture.w >= box.w - 40;
            expect(tall || fullWidth, `${screen.name}: the field is big (${pct}% tall, ${Math.round(picture.w)} of ${Math.round(box.w)} px wide)`).toBe(true);
          }

          // controls
          if (game.buttons) noProblems(`${screen.name} play`, await page.evaluate(measure, { selector: game.buttons, extra: [game.picture] }));

          // turns
          const field = page.locator(game.picture);
          expect(await moves(field, page), `${screen.name}: the field moves in play`).toBe(true);
          await page.setViewportSize({ width: screen.height, height: screen.width });
          await dismissTip(page, finger);
          if (!(await chipShows(page))) {
            expect(await moves(field, page), `${screen.name}: the field still moves after the phone turns`).toBe(true);
            if (game.buttons) noProblems(`${screen.name} turned`, await page.evaluate(measure, { selector: game.buttons, extra: [game.picture] }));
          }
          await page.setViewportSize({ width: screen.width, height: screen.height });
          await dismissTip(page, finger);

          // result
          await game.playToTheEnd(page, finger);
          const chip = page.getByTestId("result-chip");
          await chip.waitFor({ timeout: 5_000 });
          await page.waitForTimeout(400);
          const offChip = await chip.evaluate((el) =>
            [...el.querySelectorAll("button, a[href]")]
              .filter((b) => {
                const r = b.getBoundingClientRect();
                return r.height > 0 && (r.top < -0.5 || r.bottom > innerHeight + 0.5 || r.left < -0.5 || r.right > innerWidth + 0.5);
              })
              .map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 24)),
          );
          expect(offChip, `${screen.name}: every result button on the screen`).toEqual([]);
          if (game.resultCard) {
            await expect(page.locator(game.resultCard), `${screen.name}: the result card shows`).toBeVisible();
            const covered = await page.evaluate(
              ({ card }) => {
                const c = document.querySelector(card)?.firstElementChild?.getBoundingClientRect();
                const k = document.querySelector('[data-testid="result-chip"]')?.getBoundingClientRect();
                if (!c || !k) return null;
                const ox = Math.min(c.right, k.right) - Math.max(c.left, k.left);
                const oy = Math.min(c.bottom, k.bottom) - Math.max(c.top, k.top);
                return ox > 2 && oy > 2 ? Math.round(ox * oy) : 0;
              },
              { card: game.resultCard },
            );
            expect(covered, `${screen.name}: the result card is not under the chip`).toBe(0);
          }
          await page.waitForTimeout(700); // the chip's grace
          await finger.tap(chip.getByRole("button", { name: /play again/i }));
          await expect(chip, `${screen.name}: the result goes away`).toBeHidden();
          await expect(page.getByTestId("game-start-overlay"), `${screen.name}: no start card between runs`).toHaveCount(0);
          expect(errors).toEqual([]);
        } finally {
          await context.close();
        }
      });
    }
  });
}
