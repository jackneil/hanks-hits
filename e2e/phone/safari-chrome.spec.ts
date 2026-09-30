/**
 * Safari's toolbar band (phone UX, real iPhone SE check 2026-09-30).
 *
 * Safari on iOS 26 and later draws the page behind its see-through
 * toolbars, and where no fixed element touches the edge it paints the root
 * background. The root was white while every page is dark at its edges,
 * so the phone showed a white band under the bottom toolbar (and a white
 * strip under the status bar on the home page). The root now has the
 * colour of the dark header bar on every page (globals.css).
 *
 * Chromium cannot show Safari's toolbars, so this checks the cause: the
 * computed background of <html> on each page.
 *
 * Run it with the gate: pnpm e2e:phone <base-url>. E2E_ROUTES limits it.
 */
import { expect, test } from "playwright/test";

import { openGame, SCREENS, wanted } from "./touch";

/** The root's background, and the colour of the header bar (bg-slate-950). */
const rootAndChrome = () => {
  const probe = document.createElement("div");
  probe.className = "bg-slate-950";
  document.body.append(probe);
  const chrome = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return { root: getComputedStyle(document.documentElement).backgroundColor, chrome };
};

test("safari chrome: every page gives the root the colour of the header bar", async ({ browser }) => {
  const { context, page } = await openGame(browser, SCREENS[0], "/");
  try {
    await page.waitForTimeout(800);
    const games = await page.evaluate(() =>
      [...new Set([...document.querySelectorAll('a[href^="/games/"], a[href^="/apps/"]')].map((a) => a.getAttribute("href")!))],
    );
    expect(games.length).toBeGreaterThan(20);
    // The pages outside the game shell too: the home page, the lists, the sign-in pages.
    const pages = ["/", "/leaderboards", "/trophies", "/profile", "/login", "/signup", "/licenses"];
    const wrong: string[] = [];
    for (const route of [...pages, ...games].filter(wanted)) {
      await page.goto(route, { waitUntil: "load" });
      await page.waitForTimeout(300);
      const { root, chrome } = await page.evaluate(rootAndChrome);
      if (root !== chrome) wrong.push(`${route}: root ${root}, chrome ${chrome}`);
    }
    expect(wrong, "the root background is the header bar colour on every page").toEqual([]);
  } finally {
    await context.close();
  }
});
