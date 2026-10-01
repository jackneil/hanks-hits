#!/usr/bin/env node
/**
 * Runs one Playwright suite from e2e/ against a server that is already up.
 *
 *   node scripts/e2e/run-playwright.mjs <config> <base-url> [playwright args...]
 *
 * Root package.json scripts call it, for example
 *   pnpm e2e:start-cards http://127.0.0.1:3000
 *   pnpm e2e:start-cards http://127.0.0.1:3000 --workers=1
 *
 * It builds nothing and starts no server. Build and start the app first
 * (pnpm --filter web build, then pnpm --filter web start), or point it at
 * any other server. The base URL can also come from E2E_BASE_URL.
 *
 * The root package.json pins Playwright (a devDependency, so `pnpm e2e:typecheck`
 * can check the specs), and `pnpm install` puts it in the repo. The runner
 * uses that copy. With no install, it uses a folder on NODE_PATH or the npx
 * cache (`npx --no-install playwright`). It gives the specs their
 * "playwright/test" through NODE_PATH, so the specs and the runner use one
 * copy.
 *
 * No Playwright on the machine: the runner prints NOT RUN and exits 1.
 * You asked for this check, so a check that did not run must not look
 * like a pass. Run `pnpm install`, then get the browser with
 * `pnpm exec playwright install chromium`.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const INNER = "--hh-inner";

function fail(message) {
  console.error(`e2e: NOT RUN: ${message}`);
  process.exit(1);
}

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

/** Splits `<config> <base-url> [args]`; the URL may also come from E2E_BASE_URL. */
function parseArgs(argv) {
  const [config, ...rest] = argv;
  if (!config) fail("give the Playwright config, for example e2e/start-cards/playwright.config.ts");
  const configPath = path.resolve(REPO_ROOT, config);
  if (!existsSync(configPath)) fail(`no config at ${configPath}`);
  let baseUrl = process.env.E2E_BASE_URL;
  if (rest[0] && /^https?:\/\//.test(rest[0])) baseUrl = rest.shift();
  if (!baseUrl) {
    fail("give the base URL of a running server, for example: pnpm e2e:start-cards http://127.0.0.1:3000");
  }
  return { configPath, baseUrl: baseUrl.replace(/\/+$/, ""), args: rest };
}

function runPlaywright(modules, { configPath, baseUrl, args }) {
  const cli = path.join(modules, "playwright", "cli.js");
  if (!existsSync(cli)) fail(`${cli} is missing`);
  const env = {
    ...process.env,
    E2E_BASE_URL: baseUrl,
    NODE_PATH: [modules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter),
  };
  console.log(`e2e: ${path.relative(REPO_ROOT, configPath)} against ${baseUrl}`);
  const child = spawn(process.execPath, [cli, "test", "-c", configPath, ...args], {
    cwd: REPO_ROOT,
    env,
    stdio: "inherit",
  });
  child.on("error", (error) => fail(`could not start Playwright: ${error.message}`));
  child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
}

const argv = process.argv.slice(2);
if (argv[0] === INNER) {
  const modules = npxPlaywright();
  if (!modules) fail("npx did not give a Playwright package");
  runPlaywright(modules, parseArgs(argv.slice(1)));
} else {
  const parsed = parseArgs(argv);
  const local = localPlaywright();
  if (local) {
    runPlaywright(local, parsed);
  } else {
    // --no-install: never download here.
    const probe = spawnSync("npx", ["--no-install", "playwright", "--version"], {
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    if (probe.error || probe.status !== 0) {
      fail("Playwright is not on this machine (npx --no-install playwright --version failed)");
    }
    console.log(`e2e: ${probe.stdout.trim()} (npx)`);
    const child = spawn(
      "npx",
      [
        "--no-install",
        "-p",
        "playwright",
        "node",
        fileURLToPath(import.meta.url),
        INNER,
        path.relative(REPO_ROOT, parsed.configPath),
        parsed.baseUrl,
        ...parsed.args,
      ],
      { cwd: REPO_ROOT, stdio: "inherit", shell: process.platform === "win32" }
    );
    child.on("error", (error) => fail(`npx could not start: ${error.message}`));
    child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
  }
}
