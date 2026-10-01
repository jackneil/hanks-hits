/**
 * Game checks for the puzzle and word games (phone UX audit, PR-G5):
 * 2048, Memory Match, Wordle and Math Attack, on the four iPhone screens,
 * by touch only, with an iPhone user agent:
 *
 *   fits        the whole board (the grid, the cards, the sky) is inside
 *               the play box and big: sideways at least 70 percent of the
 *               box's height, upright at least 35 percent of it or the
 *               full width
 *   controls    every control on the play screen is at least 44 px, on the
 *               screen, and covers neither another nor the board (Wordle's
 *               keys were 32 px wide; Math Attack opened the system
 *               keyboard)
 *   turns       the kid turns the phone mid-game and the board is still
 *               there, whole, and the controls still fit
 *   result      a game played to its end shows the shared result chip with
 *               every button on screen, the result card clear of the chip,
 *               and Play again with no start card (2048 is left out here: a
 *               board takes hundreds of moves to fill; its unit tests cover
 *               its result)
 *
 * The games end the way a kid ends them: Wordle after six real guesses,
 * Memory Match by a player who remembers every card, Math Attack at the
 * hardest age with the pad left alone.
 *
 * Run it with the gate: pnpm e2e:phone <base-url>. E2E_ROUTES limits it.
 */
import { expect, test, type Page } from "playwright/test";

import { WORDS_4 } from "../../apps/web/src/games/wordle/lib/words";
import { Finger, measure, noProblems, oneScreen, openGame, SCREENS, wanted } from "./touch";

interface PuzzleGame {
  route: string;
  name: string;
  /** Picks a choice on the start card (if any) and starts. */
  start: (page: Page, finger: Finger) => Promise<void>;
  board: string;
  buttons: string;
  resultCard?: string;
  playToTheEnd?: (page: Page, finger: Finger) => Promise<void>;
}

const RUN_BUDGET_MS = 150_000;
const tapStart = async (page: Page, finger: Finger, name: RegExp) => {
  const start = page.getByTestId("game-start-overlay").getByRole("button", { name }).last();
  await start.waitFor();
  await finger.tap(start);
};

const GAMES: PuzzleGame[] = [
  {
    route: "/games/2048",
    name: "2048",
    start: (page, finger) => tapStart(page, finger, /Play/),
    board: '[data-testid="game-2048-board"]',
    buttons: '[data-testid="game-2048-score"] button',
  },
  {
    route: "/games/memory-match",
    name: "Memory Match",
    start: (page, finger) => tapStart(page, finger, /Play/),
    board: '[data-testid="memory-board"]',
    buttons: '[data-testid="memory-board"] button',
    resultCard: '[data-testid="memory-result-card"]',
    // A player who remembers every card: flip each unknown card, and as soon
    // as a picture has shown twice, flip that pair.
    playToTheEnd: async (page, finger) => {
      const cards = page.getByTestId("memory-board").getByRole("button");
      const count = await cards.count();
      const seen = new Map<number, string>();
      const matched = new Set<number>();
      const flip = async (i: number) => {
        await finger.tap(cards.nth(i));
        await page.waitForTimeout(450);
        const label = (await cards.nth(i).getAttribute("aria-label")) ?? "";
        if (label !== "Hidden card") seen.set(i, label);
        return label;
      };
      const pairOf = (label: string, not: number) => [...seen.entries()].find(([j, l]) => l === label && j !== not && !matched.has(j))?.[0];
      const until = Date.now() + RUN_BUDGET_MS;
      const knownPair = (): [number, number] | null => {
        const open = [...seen.entries()].filter(([i]) => !matched.has(i));
        for (const [i, label] of open) {
          const j = open.find(([k, l]) => k !== i && l === label)?.[0];
          if (j !== undefined) return [i, j];
        }
        return null;
      };
      while (matched.size < count && Date.now() < until && !(await page.getByTestId("result-chip").isVisible())) {
        const pair = knownPair();
        if (pair) {
          await flip(pair[0]);
          await flip(pair[1]);
          matched.add(pair[0]);
          matched.add(pair[1]);
          await page.waitForTimeout(900);
          continue;
        }
        const next = [...Array(count).keys()].find((i) => !matched.has(i) && !seen.has(i));
        const first = next ?? [...Array(count).keys()].find((i) => !matched.has(i))!;
        const label = await flip(first);
        const known = pairOf(label, first);
        const second = known ?? [...Array(count).keys()].find((i) => !matched.has(i) && !seen.has(i) && i !== first);
        if (second === undefined) break;
        const label2 = await flip(second);
        if (label2 === label) {
          matched.add(first);
          matched.add(second);
        }
        await page.waitForTimeout(900);
      }
      await page.getByTestId("result-chip").waitFor({ timeout: 10_000 });
    },
  },
  {
    route: "/games/wordle",
    name: "Wordle",
    start: (page, finger) => tapStart(page, finger, /Start Game/),
    board: '[data-testid="wordle-grid"]',
    buttons: '[data-testid="wordle-keyboard"] button',
    resultCard: '[data-testid="wordle-result-card"]',
    // Six real four-letter guesses (8 years old is the start card's age).
    playToTheEnd: async (page, finger) => {
      const guesses = WORDS_4.slice(0, 8);
      for (const word of guesses) {
        if (await page.getByTestId("result-chip").isVisible()) break;
        for (const letter of word.toUpperCase()) await finger.tap(page.getByRole("button", { name: letter, exact: true }));
        await finger.tap(page.getByRole("button", { name: "Enter", exact: true }));
        await page.waitForTimeout(400);
      }
      await page.getByTestId("result-chip").waitFor({ timeout: 10_000 });
    },
  },
  {
    route: "/games/math-attack",
    name: "Math Attack",
    // The hardest age (the last choice): problems fall fastest, fewest lives.
    start: async (page, finger) => {
      const ages = page.getByTestId("age-picker").getByRole("button");
      await ages.last().waitFor();
      await finger.tap(ages.last());
      await tapStart(page, finger, /Start Game/);
    },
    board: '[data-testid="math-attack-sky"]',
    buttons: '[data-testid="math-attack-pad"] button',
    resultCard: '[data-testid="math-attack-result-card"]',
    playToTheEnd: async (page) => {
      await page.getByTestId("result-chip").waitFor({ timeout: RUN_BUDGET_MS });
    },
  },
];

async function boardFit(page: Page, board: string) {
  return page.evaluate((sel) => {
    const r = document.querySelector(sel)!.getBoundingClientRect();
    const b = document.querySelector("[data-play-box]")!.getBoundingClientRect();
    return { board: { x: r.x, y: r.y, w: r.width, h: r.height }, box: { x: b.x, y: b.y, w: b.width, h: b.height } };
  }, board);
}

async function dismissTip(page: Page, finger: Finger) {
  const keepPlaying = page.getByRole("button", { name: /Keep playing/ });
  await page.waitForTimeout(600);
  if (await keepPlaying.isVisible()) await finger.tap(keepPlaying);
  await page.waitForTimeout(300);
}

async function checkFit(page: Page, game: PuzzleGame, width: number, height: number, where: string) {
  const { board, box } = await boardFit(page, game.board);
  expect(board.x, `${where}: board inside the play box (left)`).toBeGreaterThanOrEqual(box.x - 0.5);
  expect(board.y, `${where}: board inside the play box (top)`).toBeGreaterThanOrEqual(box.y - 0.5);
  expect(board.x + board.w, `${where}: board inside the play box (right)`).toBeLessThanOrEqual(box.x + box.w + 0.5);
  expect(board.y + board.h, `${where}: board inside the play box (bottom)`).toBeLessThanOrEqual(box.y + box.h + 0.5);
  const pct = Math.round((board.h / box.h) * 100);
  if (width > height) {
    expect(board.h / box.h, `${where}: the board uses the height (${pct}%)`).toBeGreaterThanOrEqual(0.7);
  } else {
    const tall = board.h / box.h >= 0.35;
    const fullWidth = board.w >= box.w - 40;
    expect(tall || fullWidth, `${where}: the board is big (${pct}% tall, ${Math.round(board.w)} of ${Math.round(box.w)} px wide)`).toBe(true);
  }
  noProblems(`${where} play`, await page.evaluate(measure, { selector: game.buttons, extra: [game.board] }));
}

for (const game of GAMES) {
  test(`puzzle: ${game.name} on four iPhone screens`, async ({ browser }) => {
    test.skip(!wanted(game.route), "not in E2E_ROUTES");
    test.setTimeout(SCREENS.length * (RUN_BUDGET_MS + 60_000));
    for (const screen of SCREENS) {
      await test.step(screen.name, async () => {
        const { context, page, finger, errors } = await openGame(browser, screen, game.route);
        try {
          await game.start(page, finger);
          await page.locator(game.board).waitFor();
          await dismissTip(page, finger);
          await oneScreen(page);

          // fits and controls
          await checkFit(page, game, screen.width, screen.height, screen.name);

          // turns
          await page.setViewportSize({ width: screen.height, height: screen.width });
          await dismissTip(page, finger);
          if (!(await page.getByTestId("result-chip").isVisible())) {
            await oneScreen(page);
            await checkFit(page, game, screen.height, screen.width, `${screen.name} turned`);
          }
          await page.setViewportSize({ width: screen.width, height: screen.height });
          await dismissTip(page, finger);

          // result
          if (!game.playToTheEnd) {
            expect(errors).toEqual([]);
            return;
          }
          await game.playToTheEnd(page, finger);
          const chip = page.getByTestId("result-chip");
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
          await expect(page.getByTestId("game-start-overlay"), `${screen.name}: no start card between games`).toHaveCount(0);
          expect(errors).toEqual([]);
        } finally {
          await context.close();
        }
      });
    }
  });
}
