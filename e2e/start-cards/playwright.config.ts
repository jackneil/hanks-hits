/**
 * Playwright config for the start-card check (e2e/start-cards).
 *
 * Run it from the repo root against a server that is already up:
 *   pnpm --filter web build
 *   pnpm --filter web start            (serves http://127.0.0.1:3000)
 *   pnpm e2e:start-cards http://127.0.0.1:3000
 *
 * The runner (scripts/e2e/run-playwright.mjs) builds nothing and starts no
 * server. It gives this config the base URL in E2E_BASE_URL and gives the
 * spec "playwright/test" through NODE_PATH, because the repo has no
 * Playwright dependency.
 *
 * One test per screen size; each test checks every route that the home
 * page lists. Extra arguments go to Playwright, for example --workers=1 on
 * a busy machine, or -g "390x844" for one screen.
 */
import { tmpdir } from "node:os";
import path from "node:path";

import { defineConfig } from "playwright/test";

const BASE_URL = process.env.E2E_BASE_URL;
if (!BASE_URL) {
  throw new Error(
    "E2E_BASE_URL is not set. Run the check with: pnpm e2e:start-cards <base-url>, for example http://127.0.0.1:3000"
  );
}

export default defineConfig({
  testDir: __dirname,
  testMatch: /.*\.spec\.ts$/,
  // Screenshots and traces go to a temp folder, never into the repo.
  outputDir: path.join(process.env.E2E_OUT ?? path.join(tmpdir(), "hh-start-cards"), "playwright"),
  fullyParallel: true,
  workers: 2,
  retries: 0,
  // One test visits every listed route (about 33) on one screen size. A
  // route takes a few seconds; a busy machine can take much longer.
  timeout: 30 * 60_000,
  expect: { timeout: 45_000 },
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    navigationTimeout: 90_000,
    actionTimeout: 30_000,
  },
});
