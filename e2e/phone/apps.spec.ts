/**
 * App checks (phone UX audit, PR-G8), on the four iPhone screens, by touch
 * only, with an iPhone user agent:
 *
 *   Drawing app     nothing covers the canvas, a finger stroke draws on it
 *                   (sideways the tools sat on the canvas and a stroke drew
 *                   nothing), and every tool is on the screen.
 *   Drum machine    every pad is on the screen and uncovered (sideways the
 *                   dock sat on the pads, so a tap on Kick hit Stop), Play
 *                   and the dock are on the screen, and with the beat grid
 *                   on, every control can be reached.
 *   Joke generator  the joke, Show Punchline, the punchline and Tell me a
 *                   joke are all on the screen (sideways the card was a
 *                   35 px sliver and the punchline was off the screen).
 *   Trivia          when a question starts, all four answers are on the
 *                   screen (sideways the first answer was at y=392 of 311).
 *   Virtual pet     the five care buttons and the shop are on the screen
 *                   when the app opens (they were at y=672 of 549).
 *
 * Run it with the gate: pnpm e2e:phone <base-url>. E2E_ROUTES limits it.
 */
import { expect, test, type Locator, type Page } from "playwright/test";

import { measure, noProblems, oneScreen, openGame, SCREENS, wanted } from "./touch";

/** The whole box of `l` is inside the viewport. */
async function wholeOnScreen(page: Page, l: Locator, what: string) {
  const b = await l.boundingBox();
  expect(b, `${what} has a box`).not.toBeNull();
  const vp = page.viewportSize()!;
  expect(b!.y, `${what}: top on screen`).toBeGreaterThanOrEqual(-0.5);
  expect(b!.y + b!.height, `${what}: bottom on screen`).toBeLessThanOrEqual(vp.height + 0.5);
  expect(b!.x + b!.width, `${what}: right on screen`).toBeLessThanOrEqual(vp.width + 0.5);
}

/** The element at the middle of `l` is `l` or inside it: nothing covers it. */
async function uncovered(l: Locator, what: string) {
  const free = await l.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === el || el.contains(hit));
  });
  expect(free, `${what}: nothing covers it`).toBe(true);
}

/** The Keep playing button of the orientation tip, when it shows. */
async function dismissTip(page: Page) {
  const keep = page.getByRole("button", { name: /Keep playing/ });
  await page.waitForTimeout(600);
  if (await keep.isVisible()) await keep.tap();
  await page.waitForTimeout(300);
}

for (const screen of SCREENS) {
  test(`apps on ${screen.name}`, async ({ browser }) => {
    test.setTimeout(180_000);

    if (wanted("/apps/drawing-app")) {
      await test.step("drawing app", async () => {
        const { context, page, finger, errors } = await openGame(browser, screen, "/apps/drawing-app");
        try {
          const canvas = page.locator('[data-testid="drawing-canvas-area"] canvas');
          // The frame is what shows: the canvas never shrinks (a drawing
          // made sideways survives a turn upright), so it may reach past it.
          const frame = page.locator('[data-testid="drawing-canvas-area"] > div').first();
          await canvas.waitFor();
          await dismissTip(page);
          await oneScreen(page);
          await uncovered(frame, `${screen.name} canvas frame`);
          // Wholly on the screen: a 240 px minimum pushed it past the bottom
          // under the install pill, which the play box clips, so nothing
          // else here saw it (found on the real iPhone SE).
          await wholeOnScreen(page, frame, `${screen.name} canvas frame`);
          const before = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
          const box = (await frame.boundingBox())!;
          // A third of the screen at least, with the install pill showing.
          // Measured: 37% at 375x549 with the pill (48% once it is closed),
          // 44% sideways. The bug this guards against was a 15 px sliver.
          expect(box.width * box.height, `${screen.name}: the canvas gets a real share of the screen`).toBeGreaterThan(
            0.33 * page.viewportSize()!.width * page.viewportSize()!.height
          );
          await finger.drag(box.x + box.width * 0.25, box.y + box.height / 2, box.width * 0.5);
          await page.waitForTimeout(200);
          const after = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
          expect(after, `${screen.name}: a finger stroke draws`).not.toBe(before);
          for (const name of ["Undo", "Pencil", "Colors and brush", "Save"]) {
            await wholeOnScreen(page, page.getByRole("button", { name, exact: true }).first(), `${screen.name} ${name}`);
          }
          expect(errors).toEqual([]);
        } finally {
          await context.close();
        }
      });
    }

    if (wanted("/apps/drum-machine")) {
      await test.step("drum machine", async () => {
        const { context, page, finger, errors } = await openGame(browser, screen, "/apps/drum-machine");
        try {
          await page.getByTestId("drum-transport").waitFor();
          await dismissTip(page);
          await oneScreen(page);
          const pads = page.getByTestId("drum-main").getByRole("button").filter({ hasNotText: /^$/ });
          const count = await pads.count();
          expect(count, `${screen.name}: the pads show`).toBeGreaterThanOrEqual(8);
          // All eight pads fit the screen at once, with the install pill
          // shown above them (a pad box under the pill ran past the
          // screen by the pill's height, so the second row was cut).
          const box = page.getByTestId("drum-pad-box").getByRole("button");
          expect(await box.count(), `${screen.name}: eight pads`).toBe(8);
          for (let i = 0; i < 8; i++) await wholeOnScreen(page, box.nth(i), `${screen.name} pad ${i + 1} at open`);
          for (let i = 0; i < count; i++) {
            const pad = pads.nth(i);
            if (!(await pad.isVisible())) continue;
            await pad.scrollIntoViewIfNeeded();
            await uncovered(pad, `${screen.name} pad ${i + 1}`);
          }
          await wholeOnScreen(page, page.getByRole("button", { name: "Play", exact: true }), `${screen.name} Play`);
          noProblems(`${screen.name} drum controls`, await page.evaluate(measure, { selector: '[data-testid="drum-transport"] button' }));
          // The beat grid adds the steps row: the tallest the controls get.
          // Every control is still on the screen, or one scroll of its own
          // column away (never lost above the column's top).
          await finger.tap(page.getByRole("button", { name: /Beat grid/ }));
          await page.getByRole("button", { name: "More steps" }).waitFor();
          // The controls outside drum-main (the pads and the grid are
          // checked above, and the grid scrolls in its own box).
          const controls = page.locator(
            '[data-testid="drum-root"] :is(button, select, input):not([data-testid="drum-main"] *)'
          );
          for (let i = 0; i < (await controls.count()); i++) {
            const c = controls.nth(i);
            await c.scrollIntoViewIfNeeded();
            await wholeOnScreen(page, c, `${screen.name} beat-grid control ${i + 1}`);
          }
          await oneScreen(page);
          expect(errors).toEqual([]);
        } finally {
          await context.close();
        }
      });
    }

    if (wanted("/apps/joke-generator")) {
      await test.step("joke generator", async () => {
        const { context, page, finger, errors } = await openGame(browser, screen, "/apps/joke-generator");
        try {
          const tell = page.getByRole("button", { name: /TELL ME A JOKE/ });
          await tell.waitFor();
          await dismissTip(page);
          // A joke with a punchline (single-line jokes have none).
          for (let i = 0; i < 8 && !(await page.getByRole("button", { name: /Show Punchline/ }).isVisible()); i++) {
            await finger.tap(tell);
            await page.waitForTimeout(400);
          }
          const reveal = page.getByRole("button", { name: /Show Punchline/ });
          await wholeOnScreen(page, reveal, `${screen.name} Show Punchline`);
          await wholeOnScreen(page, tell, `${screen.name} Tell me a joke`);
          await finger.tap(reveal);
          await page.waitForTimeout(700);
          const punchline = page.locator("p.text-purple-600").first();
          await wholeOnScreen(page, punchline, `${screen.name} punchline`);
          expect(errors).toEqual([]);
        } finally {
          await context.close();
        }
      });
    }

    if (wanted("/apps/trivia")) {
      await test.step("trivia", async () => {
        const { context, page, finger, errors } = await openGame(browser, screen, "/apps/trivia");
        try {
          const start = page.getByTestId("game-start-overlay").getByRole("button", { name: /Start Quiz/ }).last();
          await start.waitFor();
          await finger.tap(start);
          await page.getByTestId("trivia-answers").waitFor();
          await dismissTip(page);
          const answers = page.getByTestId("trivia-answers").getByRole("button");
          expect(await answers.count()).toBe(4);
          for (let i = 0; i < 4; i++) await wholeOnScreen(page, answers.nth(i), `${screen.name} answer ${i + 1}`);
          await oneScreen(page);
          noProblems(`${screen.name} answers`, await page.evaluate(measure, { selector: '[data-testid="trivia-answers"] button' }));
          expect(errors).toEqual([]);
        } finally {
          await context.close();
        }
      });
    }

    if (wanted("/apps/virtual-pet")) {
      await test.step("virtual pet", async () => {
        const { context, page, errors } = await openGame(browser, screen, "/apps/virtual-pet");
        try {
          await page.getByTestId("pet-actions").waitFor();
          await dismissTip(page);
          await oneScreen(page);
          const actions = page.getByTestId("pet-actions").getByRole("button");
          expect(await actions.count()).toBe(5);
          for (let i = 0; i < 5; i++) await wholeOnScreen(page, actions.nth(i), `${screen.name} care button ${i + 1}`);
          await wholeOnScreen(page, page.getByRole("button", { name: /Shop/ }), `${screen.name} Shop`);
          expect(errors).toEqual([]);
        } finally {
          await context.close();
        }
      });
    }
  });
}
