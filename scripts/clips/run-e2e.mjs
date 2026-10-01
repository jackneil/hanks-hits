#!/usr/bin/env node
/**
 * Runs the clips E2E A/V harness (e2e/clips, plan 15.3): `pnpm clips:e2e`.
 *
 * The root package.json pins Playwright, and `pnpm install` puts it in the
 * repo. This runner uses that copy. With no install, it uses the Playwright
 * that `npx playwright` finds on this machine (the npx cache, or a global
 * install). It gives the specs its "playwright/test" through NODE_PATH.
 * - Playwright here: it runs `playwright test -c e2e/clips/playwright.config.ts`
 *   with every argument you give (for example `-g "WebGL2"` or `--headed`).
 * - No Playwright: it prints a SKIPPED row and exits 0, so a clone without
 *   the tool never fails. Run `pnpm install`, then get the browser with
 *   `pnpm exec playwright install`.
 *
 * Environment: see e2e/clips/playwright.config.ts and e2e/clips/lib/lab.ts
 * (CLIPS_E2E_PORT, CLIPS_E2E_BASE_URL, CLIPS_E2E_CHANNEL, CLIPS_E2E_HEADED,
 * CLIPS_E2E_AUDIBLE, CLIPS_E2E_OUT).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const CONFIG = path.join(REPO_ROOT, "e2e", "clips", "playwright.config.ts");
const INNER = "--hh-inner";

/** A node_modules folder that has playwright, from a local install or NODE_PATH. */
function localPlaywright() {
  try {
    const pkg = createRequire(path.join(REPO_ROOT, "package.json")).resolve("playwright/package.json");
    return path.dirname(path.dirname(pkg));
  } catch {
    // Not installed in the repo.
  }
  for (const dir of (process.env.NODE_PATH ?? "").split(path.delimiter).filter(Boolean)) {
    if (existsSync(path.join(dir, "playwright", "package.json"))) return dir;
  }
  return null;
}

/** Inside `npx -p playwright`: npx puts <npx cache>/node_modules/.bin first on PATH. */
function npxPlaywright() {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (path.basename(dir) !== ".bin") continue;
    const modules = path.dirname(dir);
    if (existsSync(path.join(modules, "playwright", "package.json"))) return modules;
  }
  return null;
}

function skip(reason) {
  console.log(`SKIPPED | clips E2E (Playwright) | - | skipped: ${reason}`);
  process.exit(0);
}

function runPlaywright(modules, args) {
  const cli = path.join(modules, "playwright", "cli.js");
  if (!existsSync(cli)) skip(`${cli} is missing`);
  const env = { ...process.env, NODE_PATH: [modules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter) };
  const child = spawn(process.execPath, [cli, "test", "-c", CONFIG, ...args], { cwd: REPO_ROOT, env, stdio: "inherit" });
  child.on("error", (error) => {
    console.error(`clips:e2e: could not start Playwright: ${error.message}`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
}

const args = process.argv.slice(2);
if (args[0] === INNER) {
  const modules = npxPlaywright();
  if (!modules) skip("npx did not give a Playwright package");
  runPlaywright(modules, args.slice(1));
} else {
  const local = localPlaywright();
  if (local) {
    runPlaywright(local, args);
  } else {
    // --no-install: never download here. A machine without Playwright gets a SKIPPED row.
    const probe = spawnSync("npx", ["--no-install", "playwright", "--version"], { encoding: "utf8", shell: process.platform === "win32" });
    if (probe.error || probe.status !== 0) skip("Playwright is not on this machine (npx playwright --version failed)");
    console.log(`clips:e2e: ${probe.stdout.trim()} (npx)`);
    const child = spawn("npx", ["--no-install", "-p", "playwright", "node", fileURLToPath(import.meta.url), INNER, ...args], {
      cwd: REPO_ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", (error) => skip(`npx could not start: ${error.message}`));
    child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
  }
}
