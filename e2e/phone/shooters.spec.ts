/**
 * Game checks for the shooters and paddle games (phone UX audit, PR-G3):
 * Breakout, Arkanoid, Space Invaders and Asteroids, on the four iPhone
 * screens, by touch only, with an iPhone user agent:
 *
 *   fits        the whole field is inside the play box, and it is big:
 *               sideways at least 80 percent of the box's height (the
 *               Breakout paddle used to sit 400 px under the fold),
 *               upright at least 35 percent of it or the full width
 *   controls    the thumb buttons and the sound switch are at least 44 px,
 *               on the screen, and cover neither each other nor the field
 *   turns       the kid turns the phone mid-run and the field still moves
 *               (the HUD moves between a row and a column: a canvas that
 *               the new layout remounted would freeze)
 *   result      a run ends in the shared result chip, every chip button is
 *               on the screen, the result card is not under the chip, and
 *               Play again starts play at once, with no start card
 *
 * Every run ends the way a kid ends it: Breakout and Arkanoid launch by a
 * tap and keep the paddle away from the balls, Space Invaders (at "24
 * years old", the aliens that shoot most) waits for the aliens' shots,
 * Asteroids holds Thrust into the rocks.
 *
 * Run it with the gate: pnpm e2e:phone <base-url>. E2E_ROUTES limits it.
 */
import { expect, test, type Locator, type Page } from "playwright/test";

import { Finger, measure, noProblems, oneScreen, openGame, SCREENS, wanted } from "./touch";

interface Shooter {
  route: string;
  name: string;
  root: string;
  /** The field: the canvas the game draws on. */
  picture: string;
  /** The thumb buttons and the sound switch. */
  buttons: string;
  resultCard: string;
  /** The start control on the start card (default: the Play button). */
  start?: (page: Page) => Locator;
  /** Starts the field moving after the start card (a launch tap), if it needs one. */
  getMoving?: (page: Page, finger: Finger) => Promise<void>;
  /** Plays until the run ends by itself. */
  playToTheEnd: (page: Page, finger: Finger) => Promise<void>;
}

const RUN_BUDGET_MS = 150_000;
const chipShows = (page: Page) => page.getByTestId("result-chip").isVisible();

/**
 * A paddle game: while balls fly, drag the paddle from wall to wall every
 * 2 s (a paddle that stays put catches the balls that fall on it, and
 * Arkanoid's balls split on the walls); each time a ball rests on the
 * paddle again (the launch hint shows), tap to launch. Repeat until the
 * last try is gone.
 */
function paddleRun(root: string, hint: string) {
  const dodge = async (page: Page, finger: Finger, side: number, launch: boolean) => {
    const box = (await page.locator(root).boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height * 0.9;
    if (launch) {
      await finger.tapAt(x, y);
      await page.waitForTimeout(150);
    }
    // A relative drag across nine tenths of the root (more than the field
    // is wide on any screen): wall to wall.
    await finger.drag(x - side * box.width * 0.45, y, side * box.width * 0.9);
  };
  return {
    getMoving: async (page: Page, finger: Finger) => {
      await page.getByTestId(hint).waitFor();
      const box = (await page.locator(root).boundingBox())!;
      await finger.tapAt(box.x + box.width / 2, box.y + box.height * 0.9);
    },
    playToTheEnd: async (page: Page, finger: Finger) => {
      let side = 1;
      let flipped = 0;
      const until = Date.now() + RUN_BUDGET_MS;
      while (Date.now() < until && !(await chipShows(page))) {
        const resting = await page.getByTestId(hint).isVisible();
        if (resting || Date.now() - flipped > 2000) {
          side = -side;
          flipped = Date.now();
          await dodge(page, finger, side, resting);
        }
        await page.waitForTimeout(300);
      }
    },
  };
}

const SHOOTERS: Shooter[] = [
  {
    route: "/games/breakout",
    name: "Breakout",
    root: '[data-testid="breakout-root"]',
    picture: '[data-testid="breakout-root"] canvas',
    buttons: '[data-testid="breakout-sound"]',
    resultCard: '[data-testid="breakout-result-card"]',
    ...paddleRun('[data-testid="breakout-root"]', "breakout-launch-hint"),
  },
  {
    route: "/games/arkanoid",
    name: "Arkanoid",
    root: '[data-testid="arkanoid-root"]',
    picture: '[data-testid="arkanoid-canvas"]',
    buttons: '[data-testid="arkanoid-sound"]',
    resultCard: '[data-testid="arkanoid-result-card"]',
    ...paddleRun('[data-testid="arkanoid-root"]', "arkanoid-launch-hint"),
  },
  {
    route: "/games/space-invaders",
    name: "Space Invaders",
    root: '[data-testid="space-invaders-root"]',
    picture: '[data-testid="space-invaders-root"] canvas',
    buttons: '[data-testid="space-invaders-pad-move"] button, [data-testid="space-invaders-pad-fire"] button, [data-testid="space-invaders-sound"]',
    resultCard: '[data-testid="space-invaders-result-card"]',
    // The start card asks the kid's age. At 24 the aliens shoot most, so
    // a kid who never fires loses in seconds (at 8, in minutes).
    start: (page) => page.getByRole("button", { name: /24 years old/ }),
    // The aliens march and shoot; a kid who never fires is hit three times.
    playToTheEnd: async (page) => {
      await page.getByTestId("result-chip").waitFor({ timeout: RUN_BUDGET_MS });
    },
  },
  {
    route: "/games/asteroids",
    name: "Asteroids",
    root: '[data-testid="asteroids-root"]',
    picture: '[data-testid="asteroids-root"] canvas',
    buttons: '[data-testid="asteroids-pad-turn"] button, [data-testid="asteroids-pad-action"] button, [data-testid="asteroids-sound"]',
    resultCard: '[data-testid="asteroids-result-card"]',
    // Hold Thrust, turn a little, again, until every ship has hit a rock.
    // (The pad hides the moment the run ends: find each button fresh, and
    // skip it when it is gone.)
    playToTheEnd: async (page, finger) => {
      const until = Date.now() + RUN_BUDGET_MS;
      const shown = (name: string) => page.getByRole("button", { name }).boundingBox({ timeout: 500 }).catch(() => null);
      while (Date.now() < until && !(await chipShows(page))) {
        const thrust = await shown("Thrust");
        if (!thrust) {
          await page.waitForTimeout(300);
          continue;
        }
        await finger.holdAt(thrust.x + thrust.width / 2, thrust.y + thrust.height / 2, 1500);
        const turn = await shown("Turn left");
        if (turn) await finger.holdAt(turn.x + turn.width / 2, turn.y + turn.height / 2, 250);
      }
    },
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

/**
 * True when the field changes within 1.5 s. (The aliens march in steps, so
 * one short look can fall between two steps.)
 */
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

for (const game of SHOOTERS) {
  test(`shooters: ${game.name} on four iPhone screens`, async ({ browser }) => {
    test.skip(!wanted(game.route), "not in E2E_ROUTES");
    test.setTimeout(SCREENS.length * (RUN_BUDGET_MS + 60_000));
    for (const screen of SCREENS) {
      await test.step(screen.name, async () => {
        const { context, page, finger, errors } = await openGame(browser, screen, game.route);
        try {
          const start = game.start?.(page) ?? page.getByRole("button", { name: /Play/ }).first();
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
          noProblems(`${screen.name} play`, await page.evaluate(measure, { selector: game.buttons, extra: [game.picture] }));

          // turns
          await game.getMoving?.(page, finger);
          const field = page.locator(game.picture);
          expect(await moves(field, page), `${screen.name}: the field moves in play`).toBe(true);
          await page.setViewportSize({ width: screen.height, height: screen.width });
          await dismissTip(page, finger);
          expect(await moves(field, page), `${screen.name}: the field still moves after the phone turns`).toBe(true);
          noProblems(`${screen.name} turned`, await page.evaluate(measure, { selector: game.buttons, extra: [game.picture] }));
          await page.setViewportSize({ width: screen.width, height: screen.height });
          await dismissTip(page, finger);

          // result
          const began = Date.now();
          await game.playToTheEnd(page, finger);
          const chip = page.getByTestId("result-chip");
          await chip.waitFor({ timeout: 5_000 });
          test.info().annotations.push({ type: "run", description: `${game.name} ${screen.name}: the run ended in ${Math.round((Date.now() - began) / 1000)} s` });
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
