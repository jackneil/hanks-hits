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
 * computed background of <html> and of <body> on each page. On the real
 * phone (2026-10-01) the band under the bottom toolbar took <body>'s
 * colour, not <html>'s: a white body kept a white band under every game in
 * play after <html> was dark.
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
  // The top edge: the first painted box under the middle of the top line.
  // Safari fills the strip under the status bar from it. Measured on a real
  // iPhone SE (2026-10-01): the home header (80% opaque, backdrop-blur-xl)
  // got a white strip; four-wheeler-3d's bar (88% opaque, no blur) got its
  // own dark colour. So a blur behind the top edge is the fault.
  let top = "";
  for (let el = document.elementFromPoint(innerWidth / 2, 1); el; el = el.parentElement) {
    const style = getComputedStyle(el);
    const bg = style.backgroundColor;
    const painted = !(bg === "rgba(0, 0, 0, 0)" || bg === "transparent");
    if (style.backdropFilter !== "none") {
      top = `${el.tagName.toLowerCase()} ${bg}, backdrop-filter ${style.backdropFilter}`;
      break;
    }
    if (painted) break;
  }
  return { root: getComputedStyle(document.documentElement).backgroundColor, body: getComputedStyle(document.body).backgroundColor, top, chrome };
};

test("safari chrome: every page gives the root and body the header bar's colour, with no blur at the top edge", async ({ browser }) => {
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
      const { root, body, top, chrome } = await page.evaluate(rootAndChrome);
      if (root !== chrome) wrong.push(`${route}: root ${root}, chrome ${chrome}`);
      if (body !== chrome) wrong.push(`${route}: body ${body}, chrome ${chrome}`);
      if (top) wrong.push(`${route}: the top edge has a backdrop blur (${top})`);
    }
    expect(wrong, "the root and body are the header bar colour, and nothing blurs behind the top edge, on every page").toEqual([]);
  } finally {
    await context.close();
  }
});
