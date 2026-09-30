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
import { expect, test } from "playwright/test";

import { Finger, measure, noProblems, number, oneScreen, openGame, SCREENS, unreachableInSheet, wanted } from "./touch";

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
