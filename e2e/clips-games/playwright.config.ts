/**
 * Playwright config for the clips check on every clip game (e2e/clips-games).
 *
 * Run it from the repo root against a server that is already up. The
 * server must have CLIPS_MODE=on (GET /api/clips-config says capture true):
 *   pnpm e2e:clips-games https://hankshits.com
 *   pnpm e2e:clips-games http://127.0.0.1:3000
 *
 * The runner (scripts/e2e/run-playwright.mjs) builds nothing and starts no
 * server. It gives this config the base URL in E2E_BASE_URL and gives the
 * spec "playwright/test" through NODE_PATH.
 *
 * The check writes nothing to the server. A clip lives only in the test
 * browser (its own library in OPFS or IndexedDB), and the browser closes
 * after each game.
 *
 * Environment:
 *   E2E_ROUTES          a comma-separated list of routes, for example
 *                       /games/asteroids,/games/flappy-bird: only those games
 *   CLIPS_E2E_CHANNEL   "chrome" (default, the branded Chrome that kids
 *                       use), "msedge", or "chromium" (the browser that
 *                       Playwright downloads)
 *   CLIPS_E2E_HEADED    "1" shows the browser window
 *   CLIPS_E2E_OUT       where the clips, the frames and the rows go
 *                       (default: the system temp folder, hh-clips-games;
 *                       a second run while one is going gets its own
 *                       folder, hh-clips-games-<pid>, because each run
 *                       clears its folder at the start; the next run
 *                       removes that folder once its run has ended)
 *   CLIPS_E2E_IDLE      "1": the kid taps Play and then does nothing. A
 *                       runner then dies at once, so the run tests Play
 *                       again, the result chip's clip button and the clip
 *                       button at the break. The sound level is then an
 *                       INFO row (an idle kid makes no sound), and so are
 *                       the motion rows of a game whose driver plays a
 *                       step (the game can wait for that tap).
 *   CLIPS_E2E_PATH      "result-chip": the kid never taps the clip button
 *                       and clips the run from the result chip. Use it for
 *                       games whose run ends by itself, for example
 *                       CLIPS_E2E_IDLE=1 E2E_ROUTES=/games/blitz-bomber.
 *
 * One worker, one game at a time: the clip service takes a Web Lock so that
 * one tab captures, and capture needs a quiet machine. Extra arguments go
 * to Playwright, for example -g "Flappy Bird".
 */
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { defineConfig } from "playwright/test";

const BASE_URL = process.env.E2E_BASE_URL;
if (!BASE_URL) {
  throw new Error(
    "E2E_BASE_URL is not set. Run the check with: pnpm e2e:clips-games <base-url>, for example https://hankshits.com"
  );
}

/** The run that holds an output folder: its process id and the time that process started (ps lstart). */
interface Holder {
  pid: number;
  started: string | null;
}

/** One line from ps about a process, or null when it is not running. Undefined when ps cannot run here. */
function ps(pid: number, field: "lstart" | "command"): string | null | undefined {
  const run = spawnSync("ps", ["-o", `${field}=`, "-p", String(pid)], { encoding: "utf8" });
  if (run.error) return undefined;
  const line = run.status === 0 ? run.stdout.trim() : "";
  return line || null;
}

/** The lock's text: JSON {pid, started}, or a bare process id (a lock from before the start time was kept). */
function parseHolder(text: string): Holder | null {
  const bare = text.trim();
  if (/^\d+$/.test(bare)) return { pid: Number(bare), started: null };
  try {
    const value = JSON.parse(bare) as { pid?: unknown; started?: unknown };
    if (typeof value.pid === "number" && Number.isInteger(value.pid) && value.pid > 0) {
      return { pid: value.pid, started: typeof value.started === "string" ? value.started : null };
    }
  } catch {
    // Not JSON: half written, or not a lock of this check.
  }
  return null;
}

/**
 * True when the run that `holder` names still runs. A process id alone is
 * not enough: the system gives a dead run's id to a new process. So the
 * holder is alive when a process with its id started at the same time, or
 * when that process is a Playwright run (a lock with no start time). With
 * no ps on the machine, a process that answers kill(pid, 0) counts.
 */
function holds(holder: Holder): boolean {
  const started = ps(holder.pid, "lstart");
  if (started === undefined) {
    try {
      process.kill(holder.pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM";
    }
  }
  if (started === null) return false;
  if (holder.started !== null && started === holder.started) return true;
  return /playwright/i.test(ps(holder.pid, "command") ?? "");
}

/** A short wait in the config, which Playwright loads with no await. */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Takes the lock file for this process: open with "wx" makes the file only
 * when there is none, so two runs cannot both take it. Gives null when this
 * process has the lock, or the run that holds it. A lock whose run ended is
 * removed (only when its text has not changed, so a run that took the
 * folder a moment ago keeps it) and taken. A lock with no readable holder
 * is a run between its open and its write: young, it is waited for; older
 * than 5 s, it is a run that died there.
 */
function claim(lock: string, me: Holder): Holder | null {
  const text = JSON.stringify(me);
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const fd = openSync(lock, "wx");
      try {
        writeSync(fd, text);
      } finally {
        closeSync(fd);
      }
      return null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    let seen: string;
    let ageMs: number;
    try {
      seen = readFileSync(lock, "utf8");
      ageMs = Date.now() - statSync(lock).mtimeMs;
    } catch {
      continue; // Removed in between: try again.
    }
    const holder = parseHolder(seen);
    if (holder === null && ageMs < 5_000) {
      pause(200);
      continue;
    }
    if (holder !== null && holds(holder)) return holder;
    try {
      if (readFileSync(lock, "utf8") === seen) rmSync(lock);
    } catch {
      // Removed by another run: try again.
    }
  }
  return { pid: 0, started: null };
}

const OWN_FOLDER = /^hh-clips-games-(\d+)$/;

/**
 * Removes the hh-clips-games-<pid> folders of second runs that ended, so
 * the temp folder does not fill up with old clips. A folder is in use when
 * the run in its run.pid (or, with no run.pid, the process <pid>) still
 * runs (holds). The removed folders are named in the output.
 */
function removeEndedFolders(): void {
  const removed: string[] = [];
  for (const name of readdirSync(tmpdir())) {
    const match = OWN_FOLDER.exec(name);
    if (!match || Number(match[1]) === process.pid) continue;
    const folder = path.join(tmpdir(), name);
    const lock = path.join(folder, "run.pid");
    let holder: Holder | null = { pid: Number(match[1]), started: null };
    try {
      if (existsSync(lock)) holder = parseHolder(readFileSync(lock, "utf8")) ?? holder;
    } catch {
      // Unreadable: judge by the folder's process id.
    }
    if (holds(holder)) continue;
    rmSync(folder, { recursive: true, force: true });
    removed.push(name);
  }
  if (removed.length) console.log(`clips check: removed the folders of runs that ended: ${removed.join(", ")}`);
}

/**
 * The default output folder. Playwright clears the output folder when a run
 * starts, so a second run at the same time must not share it: the first
 * run holds the folder (its process id and start time are in run.pid) and
 * the second gets hh-clips-games-<pid>, with its own run.pid. A run that
 * ended (or was killed) frees the folder; its own folder is removed when
 * the next run starts.
 */
function defaultOut(): string {
  removeEndedFolders();
  const me: Holder = { pid: process.pid, started: ps(process.pid, "lstart") ?? null };
  const base = path.join(tmpdir(), "hh-clips-games");
  const lock = path.join(base, "run.pid");
  mkdirSync(base, { recursive: true });
  const holder = claim(lock, me);
  if (holder !== null) {
    const own = path.join(tmpdir(), `hh-clips-games-${process.pid}`);
    mkdirSync(own, { recursive: true });
    writeFileSync(path.join(own, "run.pid"), JSON.stringify(me));
    console.log(
      `clips check: ${holder.pid ? `another run (process ${holder.pid})` : "another run"} holds ${base}; this run writes to ${own}`
    );
    return own;
  }
  process.on("exit", () => {
    try {
      if (readFileSync(lock, "utf8") === JSON.stringify(me)) rmSync(lock);
    } catch {
      // The lock is gone already.
    }
  });
  return base;
}

// The workers load this config too; they inherit the main process's folder through the environment.
const OUT = process.env.CLIPS_E2E_OUT ?? defaultOut();
process.env.CLIPS_E2E_OUT = OUT;

const CHANNEL = process.env.CLIPS_E2E_CHANNEL ?? "chrome";

export default defineConfig({
  testDir: __dirname,
  testMatch: /.*\.spec\.ts$/,
  // Playwright's own output (the clips, frames, screenshots and the summary
  // rows in .rows) goes to a temp folder, never into the repo. Each run clears it.
  outputDir: path.join(OUT, "playwright"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // One game: the page over the internet (up to 90 s), up to 150 s of play
  // over three runs, then up to 300 s for the clip, the viewer (the clip
  // played to its end), the save and ffmpeg. The spec plays less when the
  // time runs short, and it adds its wait for a quiet machine (up to 4 min)
  // to this limit.
  timeout: 12 * 60_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    browserName: "chromium",
    channel: CHANNEL === "chromium" ? undefined : CHANNEL,
    headless: process.env.CLIPS_E2E_HEADED !== "1",
    navigationTimeout: 90_000,
    actionTimeout: 30_000,
  },
});
