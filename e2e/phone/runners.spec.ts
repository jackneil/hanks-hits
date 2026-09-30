/**
 * Game checks for the runners (phone UX audit, PR-G2): Flappy Bird, Dino
 * Runner, Endless Runner and Hank's Hopper, on the four iPhone screens, by
 * touch only, with an iPhone user agent:
 *
 *   fits        the whole picture is inside the play box, and it is big:
 *               at least 80 percent of the box's height sideways (the
 *               ground used to be below the screen), and upright at
 *               least 35 percent of it or the full width for a very wide
 *               world (it used to be a 19 to 32 percent strip)
 *   controls    the thumb buttons are at least 44 px, on the screen, and
 *               cover neither each other nor the picture
 *   result      a run ends in the shared result chip, every chip button is
 *               on the screen, the result text is not under the chip, and
 *               Play again (or Next level) starts play at once, with no
 *               start card in between
 *
 * Run it with the gate: pnpm e2e:phone <base-url>. E2E_ROUTES limits it.
 */
import { expect, test, type Locator, type Page } from "playwright/test";

import { Finger, measure, noProblems, oneScreen, openGame, SCREENS, wanted } from "./touch";

interface Runner {
  route: string;
  name: string;
  /** The start control on the start card. */
  start: (page: Page) => Locator;
  /** The picture: the viewport around the canvas, or the canvas. */
  picture: string;
  /** The thumb buttons, if the game has them. */
  buttons?: string;
  /** The DOM result card over the picture, if the game has one. */
  resultCard?: string;
  /** Plays until the run ends by itself, with a finger when the game needs one. */
  playToTheEnd?: (page: Page, finger: Finger) => Promise<void>;
  /** The button that starts play again from the result. */
  again: (page: Page) => Locator;
  /** True when the picture moves on its own during play (a runner runs). */
  moves?: boolean;
}

const playAgain = (page: Page) => page.getByTestId("result-chip").getByRole("button", { name: /play again/i });

const RUNNERS: Runner[] = [
  {
    route: "/games/flappy-bird",
    name: "Flappy Bird",
    start: (page) => page.getByRole("button", { name: /Play/ }).first(),
    picture: '[data-testid="flappy-canvas"]',
    resultCard: '[data-testid="flappy-result-card"]',
    again: playAgain,
    // Two flaps, then the bird falls to the ground.
    playToTheEnd: async (page, finger) => {
      await finger.tap(page.getByTestId("flappy-canvas"));
      await page.waitForTimeout(300);
      await finger.tap(page.getByTestId("flappy-canvas"));
    },
  },
  {
    route: "/games/dino-runner",
    name: "Dino Runner",
    moves: true,
    start: (page) => page.getByRole("button", { name: /Play/ }).first(),
    picture: '[data-testid="dino-viewport"]',
    buttons: '[data-testid="dino-jump"], [data-testid="dino-duck"]',
    resultCard: '[data-testid="dino-result-card"]',
    again: playAgain,
  },
  {
    route: "/games/endless-runner",
    name: "Endless Runner",
    moves: true,
    start: (page) => page.getByRole("button", { name: /Play/ }).first(),
    picture: '[data-testid="runner-viewport"]',
    buttons: '[data-testid="runner-jump"], [data-testid="runner-duck"]',
    resultCard: '[data-testid="runner-result-card"]',
    again: playAgain,
  },
  {
    route: "/games/platformer",
    name: "Hank's Hopper",
    start: (page) => page.getByRole("button", { name: /Level 1:/ }),
    picture: '[data-testid="platformer-viewport"]',
    buttons: '[data-testid="platformer-left"], [data-testid="platformer-right"], [data-testid="platformer-jump"]',
    resultCard: '[data-testid="platformer-result-card"]',
    // Level 1 has no pits: hold ▶ to the flag, jumping with the other thumb.
    playToTheEnd: async (page, finger) => {
      await finger.holdWith(page.getByTestId("platformer-right"), 1500, async (otherThumb) => {
        for (let i = 0; i < 40; i++) {
          if (await page.getByTestId("result-chip").isVisible()) return;
          await otherThumb(page.getByTestId("platformer-jump"));
          await page.waitForTimeout(700);
        }
      });
    },
    again: (page) => page.getByTestId("platformer-next"),
  },
];

/** The picture's box and the play box's, in CSS px. */
async function pictureFit(page: Page, picture: string) {
  return page.evaluate((sel) => {
    const r = document.querySelector(sel)!.getBoundingClientRect();
    const b = document.querySelector("[data-play-box]")!.getBoundingClientRect();
    return { picture: { x: r.x, y: r.y, w: r.width, h: r.height }, box: { x: b.x, y: b.y, w: b.width, h: b.height } };
  }, picture);
}

for (const runner of RUNNERS) {
  test(`runners: ${runner.name} on four iPhone screens`, async ({ browser }) => {
    test.skip(!wanted(runner.route), "not in E2E_ROUTES");
    for (const screen of SCREENS) {
      await test.step(screen.name, async () => {
        const { context, page, finger, errors } = await openGame(browser, screen, runner.route);
        try {
          const start = runner.start(page);
          await start.waitFor();
          await finger.tap(start);
          await page.locator(runner.picture).waitFor();
          // A game held the other way up shows the orientation tip once; a
          // kid taps Keep playing (the game stands still under the tip).
          const keepPlaying = page.getByRole("button", { name: /Keep playing/ });
          await page.waitForTimeout(600);
          if (await keepPlaying.isVisible()) await finger.tap(keepPlaying);
          await page.waitForTimeout(300);
          await oneScreen(page);

          // fits
          const { picture, box } = await pictureFit(page, runner.picture);
          expect(picture.x, `${screen.name}: picture inside the play box (left)`).toBeGreaterThanOrEqual(box.x - 0.5);
          expect(picture.y, `${screen.name}: picture inside the play box (top)`).toBeGreaterThanOrEqual(box.y - 0.5);
          expect(picture.x + picture.w, `${screen.name}: picture inside the play box (right)`).toBeLessThanOrEqual(box.x + box.w + 0.5);
          expect(picture.y + picture.h, `${screen.name}: picture inside the play box (bottom)`).toBeLessThanOrEqual(box.y + box.h + 0.5);
          const sideways = screen.width > screen.height;
          if (sideways) {
            expect(picture.h / box.h, `${screen.name}: the picture uses the height`).toBeGreaterThanOrEqual(0.8);
          } else {
            // Upright, a world much wider than tall (Dino's 800 x 300, cropped
            // to the 600 px of road a kid needs) is as big as it can be once
            // it spans the screen's width.
            const tall = picture.h / box.h >= 0.35;
            const fullWidth = picture.w >= box.w - 40;
            expect(tall || fullWidth, `${screen.name}: the picture is big (${Math.round((picture.h / box.h) * 100)}% tall, ${Math.round(picture.w)} of ${Math.round(box.w)} px wide)`).toBe(true);
          }

          // controls
          if (runner.buttons) {
            noProblems(`${screen.name} play`, await page.evaluate(measure, { selector: runner.buttons, extra: [runner.picture] }));
          }

          // turns: the kid turns the phone mid-run. The picture on screen must
          // still move (a canvas remounted by the new layout would keep its
          // loop and listeners on the old, detached one: a frozen picture).
          if (runner.moves) {
            await page.setViewportSize({ width: screen.height, height: screen.width });
            await page.waitForTimeout(600);
            if (await keepPlaying.isVisible()) await finger.tap(keepPlaying);
            await page.waitForTimeout(300);
            const pic = page.locator(runner.picture);
            const first = await pic.screenshot();
            await page.waitForTimeout(400);
            const second = await pic.screenshot();
            expect(first.equals(second), `${screen.name}: the picture still moves after the phone turns`).toBe(false);
            await page.setViewportSize({ width: screen.width, height: screen.height });
            await page.waitForTimeout(600);
            if (await keepPlaying.isVisible()) await finger.tap(keepPlaying);
          }

          // result
          await runner.playToTheEnd?.(page, finger);
          const chip = page.getByTestId("result-chip");
          await chip.waitFor({ timeout: 45_000 });
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
          if (runner.resultCard) {
            const covered = await page.evaluate(
              ({ card }) => {
                const c = document.querySelector(card)?.firstElementChild?.getBoundingClientRect();
                const k = document.querySelector('[data-testid="result-chip"]')?.getBoundingClientRect();
                if (!c || !k) return null;
                const ox = Math.min(c.right, k.right) - Math.max(c.left, k.left);
                const oy = Math.min(c.bottom, k.bottom) - Math.max(c.top, k.top);
                return ox > 2 && oy > 2 ? Math.round(ox * oy) : 0;
              },
              { card: runner.resultCard },
            );
            expect(covered, `${screen.name}: the result text is not under the chip`).toBe(0);
          }
          await page.waitForTimeout(700); // the chip's grace
          await finger.tap(runner.again(page));
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
