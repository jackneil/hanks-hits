/**
 * Playwright config for the phone gate (e2e/phone).
 *
 * Run it from the repo root against a server that is already up:
 *   pnpm --filter web build
 *   pnpm --filter web start            (serves http://127.0.0.1:3000)
 *   pnpm e2e:phone http://127.0.0.1:3000
 *
 * The runner (scripts/e2e/run-playwright.mjs) builds nothing and starts no
 * server. It gives this config the base URL in E2E_BASE_URL and gives the
 * spec "playwright/test" through NODE_PATH, because the repo has no
 * Playwright dependency.
 *
 * One test: it visits every route that the home page lists on four iPhone
 * screens (two at a time) and judges the rows against the known-failure
 * list in the spec. Extra arguments go to Playwright, for example
 * --headed, or -g "phone gate".
 */
import { tmpdir } from "node:os";
import path from "node:path";

import { defineConfig } from "playwright/test";

const BASE_URL = process.env.E2E_BASE_URL;
if (!BASE_URL) {
  throw new Error(
    "E2E_BASE_URL is not set. Run the check with: pnpm e2e:phone <base-url>, for example http://127.0.0.1:3000"
  );
}

export default defineConfig({
  testDir: __dirname,
  testMatch: /.*\.spec\.ts$/,
  // Screenshots of failing rows go to a temp folder, never into the repo.
  outputDir: path.join(process.env.E2E_OUT ?? path.join(tmpdir(), "hh-phone-gate"), "playwright"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // 33 routes on four screens, two screens at a time, about 10 s per
  // route and screen; a busy machine can take much longer.
  timeout: 60 * 60_000,
  expect: { timeout: 45_000 },
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    navigationTimeout: 90_000,
    actionTimeout: 30_000,
  },
});
