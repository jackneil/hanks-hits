/**
 * Game checks for the board games and Oregon Trail (phone UX audit, PR-G6),
 * on the four iPhone screens, by touch only, with an iPhone user agent:
 *
 *   fits       the whole board is inside the play box, and big: it takes
 *              90% of the box's height sideways (it was 512 px in a 263 px
 *              box, so 4 of 8 rows showed) and nearly the full width
 *              upright. Nothing on the page scrolls.
 *   cells      a board cell is 24 px or more (the phone gate's floor for
 *              [data-game-board]); upright a chess or checkers square is
 *              a full 44 px.
 *   controls   every other control on the play screen is 44 px or more,
 *              on the screen, and covers neither another nor the board.
 *   plays      a real turn by finger: Quoridor moves by a tap beside the
 *              dot and places a wall with Wall, a drag and Place; Chess
 *              plays e2-e4; Checkers moves a piece. The computer answers.
 *   turns      the kid turns the phone mid-game: the board still fits.
 *   result     Chess: Give up (two taps) shows the result card and the
 *              shared chip clear of each other; Play again is a new game
 *              with no start card.
 *   journey    Oregon Trail from the start card to a hunt: the setup, the
 *              store, three days on the trail and a hunt, with the next
 *              action on screen at every step, one bullet per tap, and the
 *              food back at the wagon.
 *
 * Run it with the gate: pnpm e2e:phone <base-url>. E2E_ROUTES limits it.
 */
import { expect, test, type Locator, type Page } from "playwright/test";

import { Finger, measure, noProblems, number, oneScreen, openGame, SCREENS, wanted, type Screen } from "./touch";

const tapStart = async (page: Page, finger: Finger, name: RegExp) => {
  const start = page.getByTestId("game-start-overlay").getByRole("button", { name }).last();
  await start.waitFor();
  await finger.tap(start);
};

async function dismissTip(page: Page, finger: Finger) {
  const keepPlaying = page.getByRole("button", { name: /Keep playing/ });
  await page.waitForTimeout(600);
  if (await keepPlaying.isVisible()) await finger.tap(keepPlaying);
  await page.waitForTimeout(300);
}

/** The board's box and the play box's, in CSS px. */
async function boxes(page: Page, board: string) {
  return page.evaluate((sel) => {
    const r = document.querySelector(sel)!.getBoundingClientRect();
    const b = document.querySelector("[data-play-box]")!.getBoundingClientRect();
    return { board: { x: r.x, y: r.y, w: r.width, h: r.height }, box: { x: b.x, y: b.y, w: b.width, h: b.height } };
  }, board);
}

async function checkBoard(page: Page, board: string, controls: string, sideways: boolean, where: string, cellMin: number) {
  await oneScreen(page);
  const { board: r, box: b } = await boxes(page, board);
  expect(r.x, `${where}: board inside the play box (left)`).toBeGreaterThanOrEqual(b.x - 0.5);
  expect(r.y, `${where}: board inside the play box (top)`).toBeGreaterThanOrEqual(b.y - 0.5);
  expect(r.x + r.w, `${where}: board inside the play box (right)`).toBeLessThanOrEqual(b.x + b.w + 0.5);
  expect(r.y + r.h, `${where}: board inside the play box (bottom)`).toBeLessThanOrEqual(b.y + b.h + 0.5);
  if (sideways) expect(r.h / b.h, `${where}: the board uses the height`).toBeGreaterThanOrEqual(0.9);
  else expect(r.w, `${where}: the board uses the width`).toBeGreaterThanOrEqual(b.w - 40);
  // The cells: the buttons on the board (chess pieces, checkers squares, Quoridor dots).
  const small = await page.evaluate(
    ({ sel, min }) =>
      [...document.querySelectorAll(`${sel} button, ${sel} [role="button"]`)]
        .map((el) => el.getBoundingClientRect())
        .filter((c) => c.width > 1 && (c.width < min - 0.5 || c.height < min - 0.5))
        .map((c) => `${Math.round(c.width)}x${Math.round(c.height)}`),
    { sel: board, min: cellMin }
  );
  expect(small, `${where}: board cells ${cellMin} px or more`).toEqual([]);
  if (controls) noProblems(`${where} controls`, await page.evaluate(measure, { selector: controls, extra: [board] }));
}

/** Plays a few seconds of each game, then the checks, then turns the phone. */
interface BoardGame {
  route: string;
  name: string;
  board: string;
  controls: string;
  /** Upright a square is a finger target of its own (chess, checkers). */
  uprightCell: number;
  play: (page: Page, finger: Finger) => Promise<void>;
}

const centre = async (l: Locator) => {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
};

const waitForTurn = (page: Page, status: string, text: RegExp) => expect(page.getByTestId(status)).toHaveText(text, { timeout: 10_000 });

const GAMES: BoardGame[] = [
  {
    route: "/games/quoridor",
    name: "Quoridor",
    board: '[data-testid="quoridor-board"]',
    controls: '[data-testid="quoridor-controls"] button',
    uprightCell: 44,
    play: async (page, finger) => {
      // A tap on the groove just under the dot above the pawn moves it there.
      const dot = page.getByTestId("quoridor-move-1-4");
      const pawn = await centre(page.getByTestId("quoridor-pawn-1"));
      const d = await centre(dot);
      await finger.tapAt(d.x + 3, (d.y + pawn.y) / 2 - 2);
      await expect(page.getByTestId("quoridor-status")).toHaveText(/Thinking|Your turn/);
      await waitForTurn(page, "quoridor-status", /Your turn/);
      // Wall: a wall shows at once, a finger drags it, Place places it.
      await finger.tap(page.getByRole("button", { name: /Wall/ }));
      const preview = page.getByTestId("quoridor-wall-preview");
      await expect(preview).toBeVisible();
      const before = await centre(preview);
      const board = await centre(page.getByTestId("quoridor-board"));
      await finger.drag(board.x - board.w / 4, board.y, board.w / 3);
      const after = await centre(preview);
      expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y), "the drag moved the wall").toBeGreaterThan(4);
      await expect(page.getByTestId("quoridor-walls-1")).toHaveAttribute("aria-label", /10 walls left/);
      await finger.tap(page.getByTestId("quoridor-place"));
      await expect(page.getByTestId("quoridor-walls-1")).toHaveAttribute("aria-label", /: 9 walls left/);
      await waitForTurn(page, "quoridor-status", /Your turn/);
    },
  },
  {
    route: "/games/chess",
    name: "Chess",
    board: '[data-testid="chess-board"]',
    controls: '[data-testid="chess-actions"] button',
    uprightCell: 44,
    play: async (page, finger) => {
      await finger.tap(page.locator("#hank-chess-square-e2"));
      await finger.tap(page.locator("#hank-chess-square-e4"));
      await expect(page.locator("#hank-chess-square-e4 [data-piece='wP']")).toHaveCount(1);
      await waitForTurn(page, "chess-status", /Your turn/);
    },
  },
  {
    route: "/games/checkers",
    name: "Checkers",
    board: '[data-testid="checkers-board"]',
    // The play screen is the board and the turn strip: no other control.
    controls: "",
    uprightCell: 44,
    play: async (page, finger) => {
      await finger.tap(page.locator('[data-square="5-2"]'));
      await expect(page.getByRole("button", { name: "Move here" }).first()).toBeVisible();
      await finger.tap(page.getByRole("button", { name: "Move here" }).first());
      await expect(page.locator('[data-square="5-2"]')).toHaveAccessibleName("Empty square");
      await waitForTurn(page, "checkers-status", /Your turn/);
    },
  },
];

for (const game of GAMES) {
  test(`board: ${game.name} on four iPhone screens`, async ({ browser }) => {
    test.skip(!wanted(game.route), "not in E2E_ROUTES");
    test.setTimeout(SCREENS.length * 90_000);
    for (const screen of SCREENS) {
      await test.step(screen.name, async () => {
        const sideways = screen.width > screen.height;
        const { context, page, finger, errors } = await openGame(browser, screen, game.route);
        try {
          await tapStart(page, finger, /Play/);
          await page.locator(game.board).waitFor();
          await dismissTip(page, finger);
          await checkBoard(page, game.board, game.controls, sideways, screen.name, sideways ? 24 : game.uprightCell);
          await game.play(page, finger);
          await checkBoard(page, game.board, game.controls, sideways, `${screen.name} after a turn`, sideways ? 24 : game.uprightCell);

          // turns
          await page.setViewportSize({ width: screen.height, height: screen.width });
          await dismissTip(page, finger);
          // A turned screen is not a real iPhone size (311x667 is the SE's
          // sideways box stood on end), so its cells get the board floor.
          await checkBoard(page, game.board, game.controls, !sideways, `${screen.name} turned`, 24);
          expect(errors).toEqual([]);
        } finally {
          await context.close();
        }
      });
    }
  });
}

test("board: Chess gives up into the shared result, and Play again is a new game", async ({ browser }) => {
  test.skip(!wanted("/games/chess"), "not in E2E_ROUTES");
  test.setTimeout(SCREENS.length * 60_000);
  for (const screen of SCREENS) {
    await test.step(screen.name, async () => {
      const { context, page, finger, errors } = await openGame(browser, screen, "/games/chess");
      try {
        await tapStart(page, finger, /Play/);
        await dismissTip(page, finger);
        const giveUp = page.getByTestId("chess-give-up");
        await finger.tap(giveUp);
        await expect(giveUp).toContainText("Sure? Tap again");
        await finger.tap(giveUp);
        const chip = page.getByTestId("result-chip");
        await expect(chip).toBeVisible();
        await expect(page.getByTestId("chess-result-card")).toContainText("You gave up");
        const covered = await page.evaluate(() => {
          const c = document.querySelector('[data-testid="chess-result-card"]')?.firstElementChild?.getBoundingClientRect();
          const k = document.querySelector('[data-testid="result-chip"]')?.getBoundingClientRect();
          if (!c || !k) return null;
          const ox = Math.min(c.right, k.right) - Math.max(c.left, k.left);
          const oy = Math.min(c.bottom, k.bottom) - Math.max(c.top, k.top);
          return ox > 2 && oy > 2 ? Math.round(ox * oy) : 0;
        });
        expect(covered, `${screen.name}: the result card is not under the chip`).toBe(0);
        await page.waitForTimeout(700); // the chip's grace
        await finger.tap(chip.getByRole("button", { name: /play again/i }));
        await expect(chip).toBeHidden();
        await expect(page.getByTestId("game-start-overlay")).toHaveCount(0);
        await expect(page.getByTestId("chess-status")).toHaveText(/Your turn/);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
});

/** The whole of `l` is inside the viewport and its scroll box. */
async function inView(l: Locator): Promise<boolean> {
  return l.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const box = el.closest(".overflow-y-auto")?.getBoundingClientRect();
    const top = Math.max(0, box?.top ?? 0);
    const bottom = Math.min(innerHeight, box?.bottom ?? innerHeight);
    return r.top >= top - 0.5 && r.bottom <= bottom + 0.5;
  });
}

/** The main action of the screen is on screen, and a finger can reach it. */
async function onScreenAction(page: Page, name: RegExp, where: string): Promise<Locator> {
  const action = page.getByTestId("oregon-actions").getByRole("button", { name }).first();
  await expect(action, `${where}: "${name.source}" shows`).toBeVisible();
  const b = (await action.boundingBox())!;
  const vh = page.viewportSize()!.height;
  expect(b.y + b.height, `${where}: "${name.source}" is on the screen`).toBeLessThanOrEqual(vh + 0.5);
  expect(b.height, `${where}: "${name.source}" is 44 px or more`).toBeGreaterThanOrEqual(43.5);
  return action;
}

async function journey(page: Page, finger: Finger, screen: Screen) {
  const where = screen.name;
  await tapStart(page, finger, /Start Journey/);

  // Name and job. The keyboard types the name: that is the one thing the
  // phone's own keyboard is for here.
  // At open, every job sits above the action bar: on a sideways iPhone SE
  // the bar's hint row hid them under it (seen on the real phone).
  const bar = (await page.getByTestId("oregon-actions").boundingBox())!;
  const jobs = page.getByTestId("oregon-jobs").getByRole("button");
  for (let i = 0; i < (await jobs.count()); i++) {
    const job = (await jobs.nth(i).boundingBox())!;
    expect(job.y + job.height, `${where}: job ${i + 1} is above the action bar at open`).toBeLessThanOrEqual(bar.y + 0.5);
  }
  await page.getByRole("textbox", { name: "Your name" }).fill("Hank");
  await oneScreen(page);
  noProblems(`${where} jobs`, await page.evaluate(measure, { selector: '[data-testid="oregon-jobs"] button' }));
  await finger.tap(page.getByRole("button", { name: /Carpenter/ }));
  await finger.tap(await onScreenAction(page, /Next/, `${where} name`));
  await finger.tap(await onScreenAction(page, /Next/, `${where} family`));
  await finger.tap(page.getByTestId("oregon-months").getByRole("button", { name: /April/ }));
  await finger.tap(await onScreenAction(page, /Start the journey/, `${where} month`));

  // The store: money stays on screen, Leave waits for an ox.
  await expect(page.getByTestId("oregon-store")).toBeVisible();
  await expect(page.getByTestId("oregon-money")).toBeInViewport();
  const leave = await onScreenAction(page, /Leave the store/, `${where} store`);
  await expect(leave).toBeDisabled();
  // A finger swipes the list up until the row is on screen (the list
  // scrolls under the pinned money and Leave; the page never does).
  const list = page.getByTestId("oregon-store").locator("ul");
  // The list's scroll position once it stands still (a swipe can fling on
  // for a while), and how far it can scroll at most.
  const settledScroll = () =>
    list.evaluate(
      (el) =>
        new Promise<{ top: number; max: number }>((resolve) => {
          const scroller = el.parentElement!;
          let last = -1;
          let still = 0;
          const tick = () => {
            const top = scroller.scrollTop;
            still = top === last ? still + 1 : 0;
            last = top;
            if (still >= 3) resolve({ top, max: scroller.scrollHeight - scroller.clientHeight });
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        })
    );
  const buy = async (item: string, times: number) => {
    const row = page.getByTestId(`oregon-item-${item}`);
    for (let swipe = 0; swipe < 6 && !(await inView(row)); swipe++) {
      const before = await settledScroll();
      // At the end of the list a swipe cannot scroll, so the row must show
      // by now. (A strict "it scrolled" check here failed at random when an
      // earlier swipe had already flung the list to its end.)
      if (before.top >= before.max - 1) {
        expect(await inView(row), `${where}: the store list is at its end and ${item} is still not on screen`).toBe(true);
        break;
      }
      // From the middle of the part of the list that shows (the list's own
      // middle can be under the pinned Leave button).
      const scroller = await list.evaluate((el) => {
        const r = el.parentElement!.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await finger.swipe(scroller.x, scroller.y + 30, 0, -80);
      const after = await settledScroll();
      expect(after.top, `${where}: a finger swipe scrolls the store list`).toBeGreaterThan(before.top);
    }
    for (let i = 0; i < times; i++) await finger.tap(row.getByRole("button", { name: /^Buy/ }));
  };
  await buy("oxen", 3);
  await buy("food", 4);
  await buy("ammunition", 1);
  await expect(page.getByTestId("oregon-item-ammunition")).toContainText("You have 20 bullets");
  await finger.tap(await onScreenAction(page, /Leave the store/, `${where} store`));

  // Three days on the trail: Continue is on screen every day, whatever the day brought.
  for (let day = 0; day < 3; day++) {
    await expect(page.getByTestId("oregon-actions")).toBeVisible();
    await oneScreen(page);
    const onTrail = await page.getByTestId("oregon-travel").isVisible();
    if (onTrail) {
      await finger.tap(await onScreenAction(page, /Continue/, `${where} day ${day}`));
    } else if (await page.getByTestId("oregon-river").isVisible()) {
      await finger.tap(await onScreenAction(page, /Ferry|Ford/, `${where} river`));
    } else if (await page.getByTestId("oregon-store").isVisible()) {
      await finger.tap(await onScreenAction(page, /Leave the store/, `${where} fort store`));
    } else {
      await finger.tap(await onScreenAction(page, /Continue|Visit the store/, `${where} day ${day} stop`));
    }
    await page.waitForTimeout(250);
  }
  // Back on the trail, then a hunt.
  for (let i = 0; i < 6 && !(await page.getByTestId("oregon-travel").isVisible()); i++) {
    await finger.tap(page.getByTestId("oregon-actions").getByRole("button").first());
    await page.waitForTimeout(250);
  }
  await expect(page.getByTestId("oregon-travel")).toBeVisible();
  const bullets = number(await page.getByTestId("oregon-supplies").getByLabel(/bullets/).textContent());
  await finger.tap(await onScreenAction(page, /Hunt/, `${where} travel`));
  const field = page.getByTestId("hunt-field");
  await expect(field).toBeVisible();
  await oneScreen(page);
  const f = await centre(field);
  await finger.tapAt(f.x, f.y + f.h / 4);
  await expect(page.getByTestId("hunt-ammo")).toHaveText(String(bullets - 1));
  await finger.tapAt(f.x - 40, f.y + f.h / 4);
  await expect(page.getByTestId("hunt-ammo")).toHaveText(String(bullets - 2));
  // Spend the rest: the hunt ends when the bullets do.
  for (let i = 2; i < bullets; i++) await finger.tapAt(f.x + ((i * 37) % 200) - 100, f.y + f.h / 4);
  await expect(page.getByTestId("oregon-hunt-done")).toBeVisible();
  await finger.tap(await onScreenAction(page, /Take the food/, `${where} hunt done`));
  await expect(page.getByTestId("oregon-travel")).toBeVisible();
}

test("board: Oregon Trail from the start card to a hunt, on four iPhone screens", async ({ browser }) => {
  test.skip(!wanted("/games/oregon-trail"), "not in E2E_ROUTES");
  test.setTimeout(SCREENS.length * 120_000);
  for (const screen of SCREENS) {
    await test.step(screen.name, async () => {
      const { context, page, finger, errors } = await openGame(browser, screen, "/games/oregon-trail");
      try {
        await journey(page, finger, screen);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
});
