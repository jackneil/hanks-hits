/** Real user actions for semantic boards, native 3D canvases and iframe games. */
import type { Locator } from "playwright/test";
import { startActions, type Driver, type PlayContext } from "./drivers";

async function play({ page, finger }: PlayContext) {
  await finger.tap(startActions(page).last());
}
async function twoPlayers(ctx: PlayContext) {
  await ctx.finger.tap(ctx.page.getByTestId("mode-picker").getByRole("button", { name: /2 players/ }));
  await play(ctx);
}

/** Count a move only when the visible board changed after a real touch. */
function boardDriver(note: string, action: (ctx: PlayContext) => Promise<void>, snapshot: (ctx: PlayContext) => Promise<string>, start: Driver["start"] = play): Driver {
  let changes = 0;
  return {
    note, start, motion: "turn-based",
    confirmedActions: () => changes,
    seen: () => `${changes} touches changed the visible board`,
    async step(ctx) {
      const before = await snapshot(ctx);
      await action(ctx);
      await ctx.page.waitForTimeout(250);
      if (await snapshot(ctx) !== before) changes++;
    },
  };
}
const textOf = (id: string) => async ({ page }: PlayContext) => (await page.getByTestId(id).textContent()) ?? "";
const pieceMap = async (board: Locator) => board.locator("[data-square]").evaluateAll((squares) => JSON.stringify(squares.map((square) => [square.getAttribute("data-square"), square.querySelector("[data-piece]")?.getAttribute("data-piece") ?? square.getAttribute("aria-label")?.replace(/, can move$/, "").replace("Move here", "Empty square")])));

export const ADDITIONAL_DRIVERS: Record<string, () => Driver> = {
  "2048": () => {
    let direction = 0;
    return boardDriver("swipes the board in four directions; verifies tile changes", async ({ page, finger }) => {
      const box = await page.getByTestId("game-2048-board").boundingBox();
      if (!box) throw new Error("2048 board is not visible");
      const [dx, dy] = [[-1, 0], [0, 1], [1, 0], [0, -1]][direction++ % 4];
      await finger.swipe(box.x + box.width / 2, box.y + box.height / 2, dx * box.width * .3, dy * box.height * .3);
    }, textOf("game-2048-board"));
  },
  snake: () => ({ note: "lets the snake move across its wrapping board", step: async ({ page }) => { await page.waitForTimeout(150); } }),
  chess: () => {
    let move = 0;
    // Legal opening followed by reversible knight moves, using the visible squares.
    const opening = [["e2", "e4"], ["e7", "e5"], ["g1", "f3"], ["b8", "c6"], ["f1", "c4"], ["g8", "f6"], ["d2", "d3"], ["f8", "c5"], ["b1", "c3"], ["d7", "d6"], ["c1", "e3"], ["c8", "e6"], ["a2", "a3"], ["a7", "a6"], ["b2", "b4"], ["c5", "b6"], ["h2", "h3"], ["h7", "h6"], ["g2", "g3"], ["g7", "g6"]];
    const repeat = [["f3", "g1"], ["f6", "g8"], ["g1", "f3"], ["g8", "f6"]];
    return boardDriver("two players make legal opening moves, then move knights", async ({ page, finger }) => {
      const [from, to] = move < opening.length ? opening[move] : repeat[(move - opening.length) % repeat.length];
      const board = page.getByTestId("chess-board");
      const before = await pieceMap(board);
      await finger.tap(board.locator(`[data-square="${from}"]`));
      await finger.tap(board.locator(`[data-square="${to}"]`));
      await page.waitForTimeout(500);
      if (await pieceMap(board) !== before) move++;
    }, ({ page }) => pieceMap(page.getByTestId("chess-board")), twoPlayers);
  },
  checkers: () => boardDriver("two players tap a movable piece and its legal destination", async ({ page, finger }) => {
    const board = page.getByTestId("checkers-board");
    const destinations = board.getByRole("button", { name: "Move here", exact: true });
    if (!await destinations.count()) await finger.tap(board.getByRole("button", { name: /(?:piece|king), can move/ }).first());
    await finger.tap(destinations.first());
  }, ({ page }) => pieceMap(page.getByTestId("checkers-board")), twoPlayers),
  quoridor: () => boardDriver("two players move pawns using the legal green targets", async ({ page, finger }) => {
    // Sideways moves keep both pawns away from the finish long enough to record.
    const sideways = page.getByTestId("quoridor-board").getByRole("button", { name: /Move (left|right)/ });
    await finger.tap(await sideways.count() ? sideways.first() : page.locator('[data-testid^="quoridor-move-"]').first());
  }, ({ page }) => page.locator('[data-testid^="quoridor-pawn-"]').evaluateAll((pawns) => JSON.stringify(pawns.map((pawn) => pawn.getAttribute("style")))), twoPlayers),
  wordle: () => {
    let key = 0;
    const keys = ["C", "A", "T", "ENTER", "D", "O", "G", "ENTER", "S", "U", "N", "ENTER", "H", "A", "T", "ENTER", "B", "A", "T", "ENTER", "C", "A", "R", "ENTER"];
    return boardDriver("enters and submits three-letter guesses on the on-screen keyboard", async ({ page, finger }) => {
      await finger.tap(page.getByTestId("wordle-keyboard").locator(`[data-key="${keys[key++ % keys.length]}"]`));
    }, async ({ page }) => page.getByTestId("wordle-grid").evaluate((grid) => grid.innerHTML), async (ctx) => {
      await ctx.finger.tap(ctx.page.getByTestId("age-picker").getByRole("button", { name: /4yo/ }));
      await play(ctx);
    });
  },
  "memory-match": () => boardDriver("turns over hidden cards; verifies revealed faces", async ({ page, finger }) => {
    const hidden = page.getByTestId("memory-board").getByRole("button", { name: "Hidden card", exact: true });
    const enabled = hidden;
    // A mismatched pair remains visible for a moment before it turns back.
    if (await enabled.first().isEnabled().catch(() => false)) await finger.tap(enabled.first());
    else await page.waitForTimeout(500);
  }, ({ page }) => page.getByTestId("memory-board").getByRole("button").evaluateAll((cards) => JSON.stringify(cards.map((card) => card.getAttribute("aria-label"))))),
  "cookie-clicker": () => boardDriver("taps the cookie repeatedly; verifies the cookie count", async ({ page, finger }) => {
    await finger.tap(page.getByTestId("cookie-area").getByRole("button").first());
  }, textOf("cookie-count")),
  "oregon-trail": () => ({
    note: "starts a journey, buys oxen and ammunition, then hunts with real field taps",
    async start(ctx) {
      const { page, finger } = ctx;
      await play(ctx);
      await page.getByLabel("Your name", { exact: true }).fill("Trail Tester");
      await finger.tap(page.getByTestId("oregon-setup-name").getByRole("button", { name: "Next ▶", exact: true }));
      await finger.tap(page.getByTestId("oregon-setup-party").getByRole("button", { name: "Next ▶", exact: true }));
      await finger.tap(page.getByRole("button", { name: "🐂 Start the journey!", exact: true }));
      await finger.tap(page.getByRole("button", { name: /^Buy .*oxen/i }));
      // Enough ammunition to keep playing across a completed hunt during slow capture.
      for (let pack = 0; pack < 5; pack++) await finger.tap(page.getByRole("button", { name: /^Buy .*bullets/i }));
      await finger.tap(page.getByRole("button", { name: /Leave the store/ }));
      await finger.tap(page.getByRole("button", { name: "🎯 Hunt", exact: true }));
    },
    async step({ page, finger }) {
      const result = page.getByTestId("oregon-hunt-done");
      if (await result.isVisible()) {
        await finger.tap(result.getByRole("button", { name: "🐂 Take the food to the wagon", exact: true }));
        const hunt = page.getByRole("button", { name: "🎯 Hunt", exact: true });
        if (await hunt.isEnabled()) await finger.tap(hunt);
        return;
      }
      const field = page.getByTestId("hunt-field");
      if (await field.isVisible()) {
        const box = await field.boundingBox();
        if (box) await finger.tapAt(box.x + box.width * .65, box.y + box.height * .55);
      }
      await page.waitForTimeout(800);
    },
  }),
  "monster-truck": () => gasDriver("Gas", "Horn"),
  "four-wheeler-3d": () => ({ ...gasDriver("Gas", "Honk the horn"), start: async ({ page, finger }) => { await finger.tap(page.getByRole("button", { name: "▶ Play!", exact: true })); } }),
  "four-wheeler-adventure": () => ({
    note: "holds the original game's iframe gas pedal",
    async begin({ page, finger }) { await finger.hold(page.frameLocator('iframe[title="Four-Wheeler Adventure"]').locator("#btnGas")); },
    async step({ page }) { await page.waitForTimeout(150); },
  }),
  "retro-arcade": () => ({
    note: "opens catalog Super Mario World, starts a one-player save, and uses its visible emulator controls",
    async start({ page, finger }) {
      await finger.tap(page.getByTestId("console-snes"));
      const title = process.env.E2E_RETRO_GAME ?? "Super Mario World";
      await finger.tap(page.getByTestId("catalog-game").filter({ hasText: title }).first().locator("button:not([aria-label])"));
      const notice = page.getByRole("button", { name: "Play", exact: true });
      if (await notice.isVisible().catch(() => false)) await finger.tap(notice);
      await page.getByTestId("emulator-view").locator("iframe").waitFor();
      const frame = page.frameLocator('[data-testid="emulator-view"] iframe');
      const start = frame.locator(".ejs_virtualGamepad_bottom .b_start");
      await start.waitFor({ timeout: 90_000 });
      // SMW: title, first save slot, one-player choice, then its opening story.
      // These are actual pad presses; no emulator memory or injected game input.
      await page.waitForTimeout(4000);
      await finger.tap(start);
      const accept = frame.locator(".ejs_virtualGamepad_right .b_a");
      await page.waitForTimeout(1000);
      await finger.tap(accept);
      await page.waitForTimeout(1000);
      await finger.tap(accept);
      await page.waitForTimeout(16_000);
      await finger.tap(accept);
    },
    async step({ page, finger }) {
      const pad = page.frameLocator('[data-testid="emulator-view"] iframe').locator(".ejs_dpad_main");
      const box = await pad.boundingBox();
      if (box) await finger.holdAt(box.x + box.width * .85, box.y + box.height / 2, 200);
      const fire = page.frameLocator('[data-testid="emulator-view"] iframe').locator(".ejs_virtualGamepad_right .b_a");
      if (await fire.isVisible()) await finger.tap(fire);
      await page.waitForTimeout(200);
    },
  }),
};

function gasDriver(gas: string, horn: string): Driver {
  let last = 0;
  return {
    note: "holds gas and honks while the vehicle moves",
    async begin({ page, finger }) { await finger.hold(page.getByRole("button", { name: gas, exact: true })); },
    async step({ page, finger }) {
      if (Date.now() - last > 1500) {
        last = Date.now();
        await finger.tap(page.getByRole("button", { name: horn, exact: true }));
      }
      await page.waitForTimeout(100);
    },
  };
}
