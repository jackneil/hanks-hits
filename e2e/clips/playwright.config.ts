/**
 * Playwright config for the clips E2E A/V harness (plan 15.3).
 *
 * Run it with `pnpm clips:e2e` from the repo root. The runner
 * (scripts/clips/run-e2e.mjs) uses the Playwright that the root
 * package.json pins, and gives this file its "playwright/test".
 *
 * The web server: `next dev` for apps/web on CLIPS_E2E_PORT (default 3417),
 * with CLIPS_LAB=1 (the lab route answers 404 without it) and CLIPS_MODE=on.
 * A server that already runs on that port is used as it is, so it must have
 * the same variables. CLIPS_E2E_BASE_URL points the specs at any other
 * server (a production build, a tunnel) and starts no server.
 *
 * One worker, one test at a time: the clip service takes a Web Lock so that
 * only one tab captures, and the timing checks need a quiet machine.
 */
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

import { defineConfig } from "playwright/test";

const PORT = Number(process.env.CLIPS_E2E_PORT ?? 3417);
const EXTERNAL = process.env.CLIPS_E2E_BASE_URL;
const BASE_URL = EXTERNAL ?? `http://127.0.0.1:${PORT}`;
const REPO_ROOT = path.resolve(__dirname, "..", "..");

export default defineConfig({
  testDir: __dirname,
  testMatch: /.*\.spec\.ts$/,
  // Playwright's own output (traces, attachments) goes next to the pulled clips, never into the repo.
  outputDir: path.join(process.env.CLIPS_E2E_OUT ?? path.join(tmpdir(), "hh-clips-e2e"), "playwright"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // 15 s of play, a clip or a 20 s recording, the pull and the analysis; the
  // first test also waits for next dev to compile the lab and the workers.
  timeout: 300_000,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
  },
  webServer: EXTERNAL
    ? undefined
    : {
        command: `pnpm --dir apps/web exec next dev --port ${PORT} --hostname 127.0.0.1`,
        cwd: REPO_ROOT,
        url: `${BASE_URL}/clips-lab`,
        reuseExistingServer: true,
        timeout: 300_000,
        stdout: "ignore",
        stderr: "pipe",
        env: {
          CLIPS_LAB: "1",
          CLIPS_MODE: "on",
          // A throwaway session secret, so next-auth answers /api/auth/session on a clone with no .env.
          AUTH_SECRET: process.env.AUTH_SECRET ?? randomBytes(32).toString("hex"),
        },
      },
});
