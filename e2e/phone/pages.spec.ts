/**
 * The pages outside the game shell on four iPhone screens: the home page,
 * the lists, the profile, the sign-in pages and the licenses. The phone
 * gate opens only the game routes, so these pages had no check, and the
 * home header read "Hank's H..." on a real iPhone SE (2026-10-01) while
 * "Hall of Fame" was cut on a phone held sideways.
 *
 * Each page: no button, link, select or heading shows its words cut, and
 * every visible button and link is 44 px or more. These pages scroll, so
 * the page height is not checked.
 *
 * Run it with the gate: pnpm e2e:phone <base-url>. It always opens all
 * seven pages (about 20 s): E2E_ROUTES names game routes only, and the
 * phone gate rejects a route the home page does not list.
 */
import { expect, test } from "playwright/test";

import { cutLabels, measure, openGame, SCREENS } from "./touch";

const PAGES = ["/", "/leaderboards", "/trophies", "/profile", "/login", "/signup", "/licenses"];

for (const screen of SCREENS) {
  test(`pages on ${screen.name}`, async ({ browser }) => {
    const problems: string[] = [];
    for (const route of PAGES) {
      const { context, page } = await openGame(browser, screen, route);
      try {
        await page.waitForTimeout(800);
        for (const cut of await page.evaluate(cutLabels)) problems.push(`${route}: ${cut}`);
        const geometry = await page.evaluate(measure, { selector: 'button, [role="button"], a[href]' });
        for (const small of geometry.small) problems.push(`${route}: small ${small}`);
      } finally {
        await context.close();
      }
    }
    expect(problems, `${screen.name}: words whole and targets 44 px on every page`).toEqual([]);
  });
}
