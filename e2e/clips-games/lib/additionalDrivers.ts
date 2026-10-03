/** Real user actions for semantic boards, native 3D canvases and iframe games. */
import type { CDPSession, Locator } from "playwright/test";
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
      const keyboard = page.getByTestId("wordle-keyboard");
      if (!await keyboard.isVisible()) {
        // A submitted guess can end the round before the next driver step.
        // The result chip reveals its real restart action after a short grace.
        const again = page.getByRole("button", { name: /Play again/i });
        if (await again.isVisible() && await again.isEnabled()) {
          await finger.tap(again);
          key = 0;
        }
        return;
      }
      await finger.tap(keyboard.locator(`[data-key="${keys[key++ % keys.length]}"]`));
    }, async ({ page }) => page.getByTestId("wordle-grid").evaluate((grid) => grid.innerHTML), async (ctx) => {
      await ctx.finger.tap(ctx.page.getByTestId("age-picker").getByRole("button", { name: "👶 4yo", exact: true }));
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
      const start = page.getByRole("button", { name: "▶ Start Journey!", exact: true });
      if (await start.isVisible()) {
        await finger.tap(start);
        await page.getByLabel("Your name", { exact: true }).fill("Trail Tester");
        await finger.tap(page.getByTestId("oregon-setup-name").getByRole("button", { name: "Next ▶", exact: true }));
        await finger.tap(page.getByTestId("oregon-setup-party").getByRole("button", { name: "Next ▶", exact: true }));
        await finger.tap(page.getByRole("button", { name: "🐂 Start the journey!", exact: true }));
      } else {
        // Cloud saves restore the journey directly, without a start card.
        // Restart this synthetic account's trip through the same confirmation
        // a player uses, retaining its name/job/family choices and buying anew.
        const restart = page.getByRole("button", { name: "Restart game", exact: true }).filter({ visible: true });
        if (!await restart.isVisible()) {
          await finger.tap(page.getByRole("button", { name: "Pause game", exact: true }));
        }
        await restart.waitFor({ state: "visible" });
        await finger.tap(restart);
        await finger.tap(page.getByRole("button", { name: "Confirm restart", exact: true }));
      }
      await page.getByTestId("oregon-store").waitFor({ state: "visible" });
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
  "monster-truck": monsterTruckDriver,
  "four-wheeler-3d": () => ({ ...gasDriver("Gas", "Honk the horn"), start: async ({ page, finger }) => { await finger.tap(page.getByRole("button", { name: "▶ Play!", exact: true })); } }),
  "four-wheeler-adventure": () => ({
    note: "holds the original game's iframe gas pedal",
    async begin({ page, finger }) { await finger.hold(page.frameLocator('iframe[title="Four-Wheeler Adventure"]').locator("#btnGas")); },
    async step({ page }) { await page.waitForTimeout(150); },
  }),
  "retro-arcade": () => {
    const navigate = async ({ page, finger }: PlayContext) => {
      const pad = page.frameLocator('[data-testid="emulator-view"] iframe').locator(".ejs_dpad_main");
      const box = await pad.boundingBox();
      if (!box) throw new Error("the emulator direction pad is not visible");
      await finger.holdAt(box.x + box.width * .85, box.y + box.height / 2, 200);
      const fire = page.frameLocator('[data-testid="emulator-view"] iframe').locator(".ejs_virtualGamepad_right .b_a");
      await finger.tap(fire);
      await page.waitForTimeout(200);
    };
    const step = async ({ page, finger }: PlayContext) => {
      const jump = page.frameLocator('[data-testid="emulator-view"] iframe').locator(".ejs_virtualGamepad_right .b_a");
      const box = await jump.boundingBox();
      if (!box) throw new Error("the emulator jump button is not visible");
      // Stay safely at the level entrance. A held real press spans emulator
      // frames even when a busy machine processes a quick tap between them.
      await finger.holdAt(box.x + box.width / 2, box.y + box.height / 2, 150);
      await page.waitForTimeout(250);
    };
    return {
    note: "opens Super Mario World, navigates to a level, then jumps safely at its entrance with visible touch controls",
    async start({ page, finger }) {
      await finger.tap(page.getByTestId("console-snes"));
      const title = process.env.E2E_RETRO_GAME ?? "Super Mario World";
      await page.getByPlaceholder("Search SNES games...", { exact: true }).fill(title);
      const game = page.getByTestId("catalog-game")
        .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
        .locator("button:not([aria-label])");
      await game.scrollIntoViewIfNeeded();
      await finger.tap(game);
      const notice = page.getByRole("button", { name: "Play", exact: true });
      const emulator = page.getByTestId("emulator-view").locator("iframe");
      // Catalog selection is delayed briefly; a notice may appear after the touch.
      await notice.or(emulator).first().waitFor();
      if (await notice.isVisible()) await finger.tap(notice);
      await emulator.waitFor();
      const frame = page.frameLocator('[data-testid="emulator-view"] iframe');
      await frame.locator("canvas.ejs_canvas").waitFor({ timeout: 90_000 });
      // On a desktop-sized touch screen EJS defaults the pad to disabled.
      // Enable it through its own settings, after startup's brief pad sizing.
      await page.waitForTimeout(1000);
      const start = frame.locator(".ejs_virtualGamepad_bottom .b_start");
      if (!await start.isVisible()) {
        const menu = frame.locator(".ejs_menu_bar");
        const opener = frame.locator(".ejs_virtualGamepad_open");
        // EJS hides the Settings text from accessibility while it is open,
        // but retains that same text in the button's DOM for its tooltip.
        const settings = menu.locator(".ejs_menu_button").filter({ hasText: /^Settings$/ });
        if (await menu.evaluate(el => el.classList.contains("ejs_menu_bar_hidden"))) {
          await finger.tap(opener);
        }
        await frame.locator(".ejs_menu_bar:not(.ejs_menu_bar_hidden)").waitFor();
        // Finger dispatches raw touches; let the 400 ms slide finish first.
        await page.waitForTimeout(450);
        await finger.tap(settings);
        await finger.tap(frame.locator(".ejs_settings_main_bar:visible").filter({ hasText: /^Virtual Gamepad$/ }));
        await finger.tap(frame.locator(".ejs_settings_main_bar:visible").filter({ hasText: /^Virtual Gamepad/ }));
        await finger.tap(frame.getByRole("button", { name: "Enabled", exact: true }));
        await finger.tap(settings);
        // The opener ignores repeated presses for two seconds. Dismiss the
        // bar as a player would, so it cannot cover the bottom-row pad keys.
        await page.waitForTimeout(2100);
        if (!await menu.evaluate(el => el.classList.contains("ejs_menu_bar_hidden"))) {
          await finger.tap(opener);
          await page.waitForTimeout(450);
        }
      }
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
      // Leave Yoshi's House on the overworld and enter the first level to
      // the right before filling the recording with actual running/jumping.
      await page.waitForTimeout(2000);
      const direction = await frame.locator(".ejs_dpad_main").boundingBox();
      if (!direction) throw new Error("the emulator direction pad is not visible");
      await finger.holdAt(direction.x + direction.width * .85, direction.y + direction.height / 2, 750);
      await page.waitForTimeout(500);
      await finger.tap(accept);
      await page.waitForTimeout(2000);
    },
    async begin(ctx) {
      // Under load the title/story can take longer than wall-clock waits.
      // Finish navigation first, then give the rolling buffer a separate
      // 40 seconds of safe level play before the check offers a clip.
      const navigationUntil = Date.now() + 32_000;
      while (Date.now() < navigationUntil) await navigate(ctx);
      const playUntil = Date.now() + 40_000;
      while (Date.now() < playUntil) await step(ctx);
    },
    step,
  };
  },
};

/** Steer around the spawn ramp; back away if the visible speedometer stalls. */
function monsterTruckDriver(): Driver {
  let cdp: CDPSession | undefined;
  let started = 0;
  let stoppedSince = 0;
  let reverseUntil = 0;
  let turnUntil = 0;
  let lastHorn = 0;
  let pedalName = "Gas";
  let reversals = 0;
  let steps = 0;
  let minMph = Infinity;
  let maxMph = 0;
  let lastMph = 0;
  return {
    note: "drives with gas and steering; reads the speedometer and reverses away from obstacles",
    seen: () => `${steps} driving steps; MPH ${minMph}-${maxMph}, last ${lastMph}; ${reversals} obstacle recoveries using the brake/reverse pedal`,
    async begin({ page, finger }) {
      cdp ??= await page.context().newCDPSession(page);
      started = Date.now();
      stoppedSince = reverseUntil = 0;
      turnUntil = started + 1500;
      pedalName = "Gas";
      await finger.hold(page.getByRole("button", { name: pedalName, exact: true }));
    },
    async step({ page, finger }) {
      const now = Date.now();
      const mph = Number(await page.getByTestId("monster-truck-speed").textContent());
      if (!Number.isFinite(mph)) throw new Error("Monster Truck speedometer is not numeric");
      steps++;
      minMph = Math.min(minMph, mph);
      maxMph = Math.max(maxMph, mph);
      lastMph = mph;
      if (mph <= 1 && now - started > 1000 && now >= reverseUntil) {
        stoppedSince ||= now;
        if (now - stoppedSince >= 350) {
          reverseUntil = now + 1500;
          turnUntil = reverseUntil + 1200;
          stoppedSince = 0;
          reversals++;
        }
      } else stoppedSince = 0;
      const nextPedal = now < reverseUntil ? "Brake" : "Gas";
      const pedal = page.getByRole("button", { name: nextPedal, exact: true });
      if (nextPedal !== pedalName || !finger.holding) {
        pedalName = nextPedal;
        await finger.hold(pedal);
      }
      if (now - lastHorn > 1500) {
        lastHorn = now;
        await finger.tap(page.getByRole("button", { name: "Horn", exact: true }));
        // Reset the primary after a two-thumb tap; do not trust a helper's
        // held flag to prove that Chromium still has that touch pressed.
        await finger.hold(pedal);
      }
      if (now < turnUntil || (now - started) % 6000 < 500) {
        // A held second thumb, unlike a tap, produces a real steering turn.
        // CDP requires touchEnd to have NO points. End the gesture completely,
        // then reapply the primary via Finger so its state matches Chromium.
        const primary = { ...await finger.center(pedal), id: 1 };
        const secondary = { ...await finger.center(page.getByRole("button", {
          name: now < reverseUntil ? "Steer left" : "Steer right", exact: true,
        })), id: 2 };
        await cdp!.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [primary, secondary] });
        try { await page.waitForTimeout(200); }
        finally {
          await cdp!.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await finger.hold(pedal);
        }
      } else await page.waitForTimeout(150);
    },
  };
}

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
