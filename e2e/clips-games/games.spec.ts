/**
 * Clips on every clip game: a live-surface check that a kid can make a
 * clip of each game, that the kid can watch it, and that the file is a
 * real video with the game's picture and sound.
 *
 * The games come from the source, not from a list: every module whose
 * metadata.ts has `clips: true`, read with the product's own reader
 * (metadataLiterals.ts, the one the home page and the build use), under
 * src/games/<id> or src/apps/<id>. A game that gets `clips: true` is in the
 * check at once. E2E_ROUTES (comma-separated routes) limits the run to
 * those games. The list comes from this checkout, so a server older than
 * the checkout can lack a game's clip button: that row says so.
 *
 * Each game gets one test, in a desktop Chrome with a touch screen
 * (1280x800, hasTouch). Every tap is a real touch (Input.dispatchTouchEvent).
 * Nothing calls into the clip service: the check uses the controls that a
 * kid uses. The test:
 *   1. Asks the server: GET /api/clips-config must say capture true. If it
 *      does not, the row fails and the game is not played.
 *   2. Opens the game, taps the start control, and plays the game the way
 *      its driver says (lib/drivers.ts): it jumps, flaps, ducks, drops a
 *      bomb or holds a pedal, so the game stays alive and makes sound.
 *   3. Makes a clip. The clip button path: when the button shows "ready"
 *      (data-state), the kid plays 3 s more and taps it (1.5 s after a run
 *      that ended with no clip).
 *      A tap that does not start a clip (the button turned "resting" in
 *      between, so the Capture menu opened) is closed and tried again, up
 *      to two times. When a run ends: the result chip's clip button ("Watch
 *      the whole run", "Make the whole run a video" or "Watch the end").
 *      A chip with no clip button: Play again, up to three runs; after the
 *      third, the header clip button at the break, when it reads ready,
 *      made or suspended (those clip the ring with no press token,
 *      pressGesture.ts).
 *   4. Opens the clip: a tap on the new-clip chip. A game that can pause
 *      opens the viewer at once. A game that cannot pause opens it at the
 *      next break, so the kid lets the run end (or taps the game's own
 *      Pause). The result chip path opens the viewer by itself.
 *   5. Checks the viewer: it shows the clip (not broken, not missing) once
 *      it has read its library row, it names this game, and its video
 *      loads. The kid starts it by touch: a tap on the player's play button
 *      must land on the video (document.elementFromPoint at the tap point)
 *      and start it, a row of its own. When the touch fails, the check
 *      starts the video with play() only so that the next rows still
 *      measure the file. It plays past 1.5 s and on to the end, with the
 *      shown-frame count rising and no media error; for a game with a sound
 *      switch the player is not muted, its volume is up, and its decoded
 *      sound bytes rise.
 *   6. Taps "Save to computer". The page's Content Security Policy blocks a
 *      fetch() of the video's blob: URL (connect-src has no blob:), so the
 *      bytes come out the way the kid gets them: the download of the same
 *      File object that the video plays.
 *   7. Reads the file with ffprobe and ffmpeg (lib/media.ts):
 *        container       the file starts with an ftyp box and ffprobe
 *                        reads it as MP4
 *        video stream    exactly one, with its codec and size
 *        length          the file 2 s to 60 s; the video track too, with
 *                        frames, and within 0.25 s of the file
 *        decodes cleanly a full decode prints no error (ffmpeg exits 0 on
 *                        corrupt H.264, so the check reads its errors)
 *        not blank       the game picture (the letterbox bars left out,
 *                        inside the middle of the frame, where the
 *                        compositor paints no name, score or host) at 25%
 *                        and 75% of the length has a luma spread (a
 *                        standard deviation of at least 2 steps and a
 *                        range of at least 24)
 *        moves           with the score's band or chip blanked, one of the
 *                        frames from 25% to 75% (read 10 a second) has at
 *                        least 50 pixels that differ by more than 64 luma
 *                        steps from the first of them. A result screen in
 *                        the clip (a clip made after a run ended) is not
 *                        play: its frames are left out, and when 25% to
 *                        75% is all result screen the play frames of the
 *                        whole clip are measured
 *        never still     over the whole clip (10 frames a second), the
 *                        picture never stands still for more than 2 s
 *                        (frame to frame, under 50 changed pixels), a
 *                        result screen in the clip aside (an INFO row). The
 *                        13 clips of 2026-10-01 stood still for 0.7 s at
 *                        most; a clip frozen after 2 s stands still 4.9 s.
 *                        The row gives the longest time with no new frame
 *                        in the file too, so a hole in the capture (3.0 s
 *                        at a load of 45 on 10 cores, 2026-10-02) shows
 *                        apart from a game picture that stands still
 *        same length     the viewer's video and the file agree (0.25 s)
 *        sound           a game with a sound switch (it calls
 *                        setGameSpeakerEnabled) must give a file with a
 *                        sound track whose peak is at least -50 dB: its
 *                        driver makes a sound (silence measures -91 dB,
 *                        the game sound -9 to -20 dB). A game with no
 *                        sound gets INFO rows. CLIPS_E2E_IDLE=1 makes the
 *                        level an INFO row: an idle kid makes no sound.
 *                        It makes "moves" and "never still" INFO rows too
 *                        for a game whose driver plays a step: the idle
 *                        kid leaves the step out, and the game can wait
 *                        for that tap (Arkanoid's ball on the paddle).
 *   8. Fails on any page error, any console error (except from a
 *      third-party host such as the Cloudflare beacon, which the check
 *      blocks), any "[clips]" warning of the clip service (except a short
 *      named list of recoveries; a clip UI load that failed is one only
 *      when a later try loaded it), and any same-origin request that
 *      failed (except the one a named recovery covers: the clips flag or a
 *      clip UI chunk, failed within 2 s of that recovery's warning). The
 *      allowed lines are INFO rows, so the evidence is on the record.
 *
 * Before each game the check waits (up to 4 min) for a quiet machine: a
 * 1-minute load average at most the number of cores. The test's time
 * limit grows by the wait. The warm-up is a row of its own: on a quiet
 * machine, more than 15 s of "warming" after Play fails (on a busy machine
 * it is an INFO row with the load).
 *
 * Every check prints one PASS, FAIL or INFO row. A step that cannot run
 * (no ffmpeg, no clip button) is a FAIL row: a check that did not run must
 * not look like a pass. The last test prints one summary row per game
 * (game, clip path, length, size, video codec, sound codec, verdict) and
 * the checkout's commit.
 *
 * The check writes nothing to the server: a clip lives only in the test
 * browser, which closes after each game. The clip, its two frames (PNG)
 * and a screenshot of each failure stay in the output folder (see
 * playwright.config.ts beside this file).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import path from "node:path";

import { expect, test, type Browser, type ConsoleMessage, type Locator, type Page } from "playwright/test";

import { MIN_CLIP_SECONDS } from "../../apps/web/src/shared/clips/service/contract";
import { MENU_COPY } from "../../apps/web/src/shared/clips/ui/copy";
import { readMetadataLiterals } from "../../apps/web/src/shared/lib/metadataLiterals";
import { RowReport } from "../clips/lib/report";
import { Finger, wanted } from "../phone/touch";
import { driverFor, IDLE, startActions, type Driver, type PlayContext } from "./lib/drivers";
import {
  changedPixels,
  decodeErrors,
  findTool,
  frameStats,
  gamePicture,
  grayFrame,
  longestFrameGap,
  loudness,
  majorBrand,
  probeClip,
  savePng,
  scanFrames,
  startsWithFtyp,
  withoutHud,
  type FrameStats,
  type GrayFrame,
} from "./lib/media";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const APP_SRC = path.join(REPO_ROOT, "apps", "web", "src");
/** The output folder (playwright.config.ts sets it). The rows live in Playwright's own folder, which each run clears. */
const OUT = process.env.CLIPS_E2E_OUT ?? "";
const ROWS_DIR = path.join(OUT, "playwright", ".rows");

const VIEWPORT = { width: 1280, height: 800 };
/** How long a route may take to mount the game shell after the page's DOM is ready. */
const SHELL_MOUNT_MS = 30_000;
/** How long the kid plays, over all runs, before the clip is made (less when the test is short of time). */
const PLAY_BUDGET_MS = 150_000;
/** The least play time worth a try. Less than this left: the row fails, it does not time out. */
const MIN_PLAY_MS = 30_000;
/**
 * The longest the steps after play can take: the new-clip chip 30 s, the
 * viewer 63 s, its row, name and video 40 s, a 60 s clip played to its end
 * plus 15 s, Save and the download 45 s, ffmpeg and the browser's close.
 */
const AFTER_PLAY_RESERVE_MS = 300_000;
/** The kid plays this long after the button shows "ready", so the clip holds more than the warm-up. */
const EXTRA_PLAY_MS = 3_000;
/**
 * After a run that ended with no clip, the kid plays only this long in the
 * next run once the button reads ready (an idle Flappy Bird run lasts
 * under 2 s). It still puts some play of this run at the clip's end.
 */
const EAGER_PLAY_MS = 1_500;
const MAX_RUNS = 3;
/** The result chip's clip buttons appear a moment after the chip. */
const RESULT_ACTIONS_WAIT_MS = 2_500;
/** The result chip takes taps after a short grace (a thumb still mashing must not restart). */
const CHIP_GRACE_MS = 700;
const MADE_TIMEOUT_MS = 30_000;
/** How long a tap on the clip button has to start a clip (the button turns saving or made). */
const TAP_TAKES_MS = 2_000;
/** Taps on the clip button that did not start a clip, before the row fails. */
const TAP_RETRIES = 2;
/** How often the play loop reads the clip button, the replies and the result chip. */
const LOOK_EVERY_MS = 250;
const VIEWER_AT_ONCE_MS = 3_000;
const VIEWER_AT_BREAK_MS = 60_000;
/**
 * The most "warming" after Play on a quiet machine. Every game was ready
 * 4.5 s to 7 s after Play at a load of 6 to 7 on 10 cores (2026-10-01).
 */
const WARM_LIMIT_SEC = 15;

const MIN_LENGTH_SEC = 2;
const MAX_LENGTH_SEC = 60;
/** A blank game picture (one colour) has a luma standard deviation under 1 and a range of a few steps. */
const NOT_BLANK_MIN_SD = 2;
const NOT_BLANK_MIN_RANGE = 24;
/** A pixel "changes" when its luma differs by more than this. */
const MOVE_LUMA_STEPS = 64;
/** The fewest changed pixels for "the picture moves" (an 8x8 ball that moves is 128). */
const MOVE_MIN_PIXELS = 50;
/** How many frames a second the motion checks read. */
const MOVE_SAMPLE_FPS = 10;
/** The longest the picture may stand still. Real clips: 0.7 s at most; a clip frozen after 2 s: 4.9 s. */
const STILL_LIMIT_SEC = 2;
const SAME_LENGTH_SEC = 0.25;
/** The run ends this long, at most, before its result chip shows. */
const RUN_END_SLACK_MS = 1_500;
/** A still stretch counts as a result screen when it lies within one, give or take this (the clip's clock against the test's). */
const SCREEN_SLACK_SEC = 1;
/** The quietest peak a game with sound may give. Silence is -91 dB; game sound measured -9 to -20 dB. */
const SOUND_MIN_PEAK_DB = -50;
/**
 * CLIPS_E2E_PATH=result-chip: the kid never taps the clip button, and makes
 * the clip from the result chip when the run ends. Use it with a game whose
 * run ends by itself, for example Blitz Bomber with CLIPS_E2E_IDLE=1.
 */
const RESULT_CHIP_ONLY = process.env.CLIPS_E2E_PATH === "result-chip";

/** Button states where the result chip offers a run clip (ResultChipClipActions.tsx RUN_CLIP_STATES). */
const RUN_CLIP_STATES = new Set(["ready", "made", "suspended", "resting", "saving"]);
/** Button states where a tap clips the ring with no press token (pressGesture.ts CLIP_WITHOUT_TOKEN). */
const CLIP_AT_BREAK = new Set(["ready", "made", "suspended"]);
/** Button states that show a tap started a clip. */
const CLIP_STARTED = new Set(["saving", "made", "exporting"]);

/** Hosts whose failures are not the site's: the Cloudflare beacon (the check blocks it, so no visit is counted). */
const THIRD_PARTY_HOSTS = ["cloudflareinsights.com"];
/** What the check saw that tells whether a recovery worked. */
interface RecoveryFacts {
  /** The last time the clip button was on the page (the clip UI had loaded), or 0. */
  buttonSeenAt: number;
}

/**
 * "[clips]" warnings that name a recovery, not a failure: INFO rows. A
 * warning with `recovered` is a recovery only when the check saw it work
 * (`at` is the time of the warning's last showing); else it fails the row,
 * like every other "[clips]" warning. `request` names the same-origin
 * request (its path) whose failure the recovery covers: a failed request
 * on that path within RECOVERY_PAIR_MS of the recovery's warning is an
 * INFO row too, not a network failure.
 */
const BENIGN_CLIP_WARNINGS: Array<{
  pattern: RegExp;
  why: string;
  recovered?: (at: number, facts: RecoveryFacts) => boolean;
  notRecovered?: string;
  request?: RegExp;
}> = [
  { pattern: /\[clips\] the sound encoder restarted/, why: "the service restarts it by itself; the sound row still measures the clip" },
  { pattern: /\[clips\] the encoder refused its settings; probing again/, why: "the capability probe tries the next settings by itself" },
  {
    // config.ts loadClipsVerdict. The other ending, "clips are off for now", is not a recovery.
    pattern: /\[clips\] could not read the clips flag \([^)]{0,64}\); using the last answer/,
    why: "the flag request failed and the page used its saved answer (config.ts); the server row read capture true",
    request: /^\/api\/clips-config$/,
  },
  {
    // ClipUiMount.tsx warnLoadFailed: it tries again after UI_RETRY_DELAYS_MS.
    pattern: /\[clips\] ui: load failed \([A-Za-z]{1,64}, try \d+\)/,
    why: "the clip UI loads again by itself, and a later try loaded it (the clip button showed after the warning)",
    recovered: (at, facts) => facts.buttonSeenAt > at,
    notRecovered: "no later try loaded the clip UI: the clip button did not show after it",
    request: /^\/_next\/static\/chunks\/[^?]+\.js$/,
  },
];
/**
 * A failed request and the recovery warning it caused are this close in
 * time. The page logs the warning as the load fails; the two events reach
 * the check on separate CDP channels, so either can come first.
 */
const RECOVERY_PAIR_MS = 2_000;

// ---------------------------------------------------------------- the games

interface ClipGame {
  id: string;
  name: string;
  route: string;
  /** The module folder (src/games/<id> or src/apps/<id>). */
  dir: string;
  /** The module calls setGameSpeakerEnabled: it has a sound switch, so it makes sound. */
  soundSwitch: boolean;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/**
 * Every module with `clips: true`, from the checkout the spec runs from.
 * The product's rule (game-registry.ts parseMetadata): the fields come
 * from readMetadataLiterals, a module needs a name, an emoji and a
 * category, and its id is its folder name when it has none.
 */
function clipGames(): ClipGame[] {
  const games: ClipGame[] = [];
  for (const kind of ["games", "apps"] as const) {
    const root = path.join(APP_SRC, kind);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, entry.name);
      const metaFile = path.join(dir, "metadata.ts");
      if (!existsSync(metaFile)) continue;
      const fields = readMetadataLiterals(readFileSync(metaFile, "utf8"));
      if (fields.clips !== true || !fields.name || !fields.emoji || !fields.category) continue;
      const soundSwitch = sourceFiles(dir).some((file) => /\bsetGameSpeakerEnabled\(/.test(readFileSync(file, "utf8")));
      games.push({ id: fields.id ?? entry.name, name: fields.name, route: `/${kind}/${entry.name}`, dir, soundSwitch });
    }
  }
  return games.sort((a, b) => a.id.localeCompare(b.id));
}

const GAMES = clipGames();
const WANTED = GAMES.filter((game) => wanted(game.route));

/** The checkout's commit, for the report: the game list comes from it. */
function checkoutCommit(): string {
  const sha = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" });
  if (sha.status !== 0) return "unknown";
  const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: REPO_ROOT, encoding: "utf8" });
  return `${sha.stdout.trim()}${dirty.stdout.trim() ? " with local changes" : ""}`;
}

// ---------------------------------------------------------------- the summary row

type ClipPath = "button" | "break-button" | "result-chip" | "none";

interface SummaryRow {
  id: string;
  name: string;
  route: string;
  path: ClipPath;
  durationSec: number | null;
  size: string;
  videoCodec: string;
  audioCodec: string;
  verdict: "PASS" | "FAIL";
  failed: string[];
  startedAt: number;
  endedAt: number;
}

function saveRow(row: SummaryRow): void {
  mkdirSync(ROWS_DIR, { recursive: true });
  writeFileSync(path.join(ROWS_DIR, `${row.id}.json`), JSON.stringify(row, null, 1));
}

// ---------------------------------------------------------------- page helpers

/** The browser's own user agent with "HeadlessChrome" put back to "Chrome", as a kid's Chrome sends it. */
async function chromeUserAgent(browser: Browser): Promise<string> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    return (await page.evaluate(() => navigator.userAgent)).replace(/HeadlessChrome/g, "Chrome");
  } finally {
    await context.close();
  }
}

/**
 * The clip button's data-state, or "absent". A warming button adds the fill
 * of its warming ring (the svg's data-progress, 0..1: the footage in the
 * ring over the 3 s it needs), so a ring that never fills shows as 0.00.
 * (buttonFace.ts draws the ring for a warming button.)
 */
async function clipState(page: Page): Promise<string> {
  const button = page.getByTestId("clip-button");
  const state = (await button.getAttribute("data-state", { timeout: 250 }).catch(() => null)) ?? "absent";
  if (state !== "warming") return state;
  const progress = await button.locator("svg").first().getAttribute("data-progress", { timeout: 250 }).catch(() => null);
  return progress === null ? "warming" : `warming ${progress}`;
}

/** The longest wait for a quiet machine before a game starts. */
const QUIET_WAIT_MS = 4 * 60_000;

/**
 * Waits, up to QUIET_WAIT_MS, until the 1-minute load average is at most
 * the number of cores, and gives the time it waited. On this check's runs
 * (2026-10-01) every game's clip button was ready 4.5 s to 7 s after Play
 * at a load of 6 to 7 on 10 cores. At a load of 27 to 43 (other work on
 * the same machine), the warming ring of Endless Runner and Flappy Bird
 * stayed at 0.00 for 15 s to 27 s, with no "[clips]" warning. The check
 * starts anyway after the wait; the warm-up row then judges nothing and
 * gives the load.
 */
async function waitForQuietMachine(report: RowReport): Promise<number> {
  const cores = cpus().length;
  const from = Date.now();
  while (loadavg()[0] > cores && Date.now() - from < QUIET_WAIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  const waited = Date.now() - from;
  if (waited >= 1_000) {
    const load = loadavg()[0];
    report.info("waited for a quiet machine", `${(waited / 1000).toFixed(0)} s`, load > cores ? `still busy (${load.toFixed(1)} on ${cores} cores): started anyway` : `load ${load.toFixed(1)} on ${cores} cores`);
  }
  return waited;
}

/** The machine load: capture rests or warms slowly when the machine is busy (the clips lab notes it the same way). */
function noteLoad(report: RowReport, when: string): void {
  const load = loadavg()[0];
  const cores = cpus().length;
  report.info(`machine load ${when}`, `${load.toFixed(1)} (1 min), ${cores} cores`, load > cores ? "busy: capture can warm slowly or rest from the load" : undefined);
}

/**
 * The clip button states in the order they showed, with the seconds since
 * play started. A warming stretch keeps the fullest ring it reached.
 */
class StateLog {
  private readonly entries: Array<{ atSec: number; state: string; ring: number | null }> = [];

  constructor(private readonly zero: number) {}

  /** Notes a clipState() value; gives the state word ("warming", "ready", ...). */
  note(value: string): string {
    const [state, ring] = value.split(" ");
    const fill = ring === undefined ? null : Number(ring);
    const last = this.entries[this.entries.length - 1];
    if (last?.state === state) {
      if (fill !== null && (last.ring === null || fill > last.ring)) last.ring = fill;
    } else {
      this.entries.push({ atSec: (Date.now() - this.zero) / 1000, state, ring: fill });
    }
    return state;
  }

  get last(): string {
    const last = this.entries[this.entries.length - 1];
    return last ? `${last.state}${last.ring !== null ? ` (ring ${last.ring.toFixed(2)})` : ""}` : "none";
  }

  text(): string {
    return this.entries.map((e) => `${e.state}${e.ring !== null ? ` (ring up to ${e.ring.toFixed(2)})` : ""} ${e.atSec.toFixed(1)} s`).join(", ") || "none";
  }
}

/**
 * The time the clip button spent "warming" from Play until it first read
 * "ready", and the highest machine load meanwhile (sampled at each look).
 */
class WarmWatch {
  private lastAt: number;
  private lastState = "absent";
  warmMs = 0;
  maxLoad = 0;
  readyAtSec: number | null = null;

  constructor(private readonly zero: number) {
    this.lastAt = zero;
  }

  note(state: string): void {
    if (this.readyAtSec !== null) return;
    const now = Date.now();
    this.maxLoad = Math.max(this.maxLoad, loadavg()[0]);
    if (this.lastState === "warming") this.warmMs += now - this.lastAt;
    this.lastAt = now;
    this.lastState = state;
    if (state === "ready") this.readyAtSec = (now - this.zero) / 1000;
  }
}

/** Polls `done` until it says yes or the time runs out. */
async function waitUntil(page: Page, timeoutMs: number, done: () => Promise<boolean>, pauseMs = 100): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (await done()) return true;
    if (Date.now() >= end) return false;
    await page.waitForTimeout(pauseMs);
  }
}

/** The first visible button among the result chip's clip actions (ResultChipClipActions.tsx data-action). */
async function resultClipAction(page: Page): Promise<{ button: Locator; label: string } | null> {
  const chip = page.getByTestId("result-chip");
  for (const id of ["watchRun", "wholeRun", "watchEnd"]) {
    const button = chip.locator(`[data-action="${id}"]`).first();
    if (await button.isVisible().catch(() => false)) {
      return { button, label: ((await button.textContent()) ?? id).trim() };
    }
  }
  return null;
}

/** The words of the clip reply toast, if one shows. */
async function replyText(page: Page): Promise<string | null> {
  const reply = page.getByTestId("clip-reply").first();
  if (!(await reply.isVisible().catch(() => false))) return null;
  return ((await reply.textContent().catch(() => "")) ?? "").replace(/🔊/g, "").trim() || null;
}

/**
 * The default start: the last button of the start card's action row (Play).
 * Every game with a picker has its own start in its driver; the caller's
 * wait for the start card to leave judges the tap.
 */
async function defaultStart(ctx: PlayContext): Promise<void> {
  const actions = startActions(ctx.page);
  await actions.last().waitFor();
  await ctx.finger.tap(actions.last());
}

interface PageErrors {
  page: string[];
  /** Console errors, with the URL the message came from. */
  console: Array<{ text: string; url: string }>;
  /** "[clips]" warnings, with the time each showed. */
  clipWarnings: Array<{ text: string; at: number }>;
  failedRequests: Array<{ url: string; error: string; at: number }>;
}

function watchErrors(page: Page): PageErrors {
  const errors: PageErrors = { page: [], console: [], clipWarnings: [], failedRequests: [] };
  const onConsole = (where: string) => (message: ConsoleMessage) => {
    const text = `${where}${message.text()}`.slice(0, 300);
    if (message.type() === "error") errors.console.push({ text, url: message.location().url ?? "" });
    else if (message.type() === "warning" && /\[clips\]/.test(text)) errors.clipWarnings.push({ text, at: Date.now() });
  };
  page.on("pageerror", (error) => errors.page.push(`${error.name}: ${error.message}\n${error.stack ?? ""}`.slice(0, 600)));
  page.on("console", onConsole(""));
  page.on("worker", (worker) => worker.on("console", onConsole("worker: ")));
  page.on("requestfailed", (request) => errors.failedRequests.push({ url: request.url(), error: request.failure()?.errorText ?? "failed", at: Date.now() }));
  return errors;
}

const unique = <T>(items: T[], key: (item: T) => string = String): T[] => [...new Map(items.map((item) => [key(item), item])).values()];
const firstLine = (text: string) => text.split("\n")[0];
const short = (url: string) => (url.length > 120 ? `${url.slice(0, 117)}...` : url);

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

const thirdParty = (url: string) => {
  const host = hostOf(url);
  return THIRD_PARTY_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
};

function describeFrame(s: FrameStats): string {
  return `luma mean ${s.mean.toFixed(1)}, sd ${s.sd.toFixed(2)}, ${s.min}..${s.max}`;
}

/**
 * GET /api/clips-config: capture is true only when the server says so. A
 * request with no answer in 15 s is tried again, up to three times (the
 * network of this machine drops a request now and then); every try is in
 * the row.
 */
async function clipsConfig(baseURL: string): Promise<{ capture: boolean; text: string }> {
  const tries: string[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(new URL("/api/clips-config", baseURL), { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const body = (await response.json().catch(() => null)) as { capture?: unknown } | null;
      const text = `${response.status} ${JSON.stringify(body)}`;
      return { capture: response.ok && body?.capture === true, text: tries.length ? `${text} (try ${attempt}; before: ${tries.join(", ")})` : text };
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      tries.push(timedOut ? "no answer in 15 s" : `failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { capture: false, text: tries.join(", ") };
}

/** The video element's playback facts. */
interface Playback {
  paused: boolean;
  ended: boolean;
  currentTime: number;
  duration: number;
  readyState: number;
  error: number | null;
  shown: number;
  dropped: number;
  muted: boolean;
  volume: number;
  /** The bytes of sound the player has decoded (Chrome's webkitAudioDecodedByteCount), or null when the browser does not say. */
  audioBytes: number | null;
}

async function playback(video: Locator): Promise<Playback | null> {
  return video
    .evaluate((v: HTMLVideoElement & { webkitAudioDecodedByteCount?: number }) => {
      const q = v.getVideoPlaybackQuality();
      return {
        paused: v.paused,
        ended: v.ended,
        currentTime: v.currentTime,
        duration: v.duration,
        readyState: v.readyState,
        error: v.error ? v.error.code : null,
        shown: q.totalVideoFrames,
        dropped: q.droppedVideoFrames,
        muted: v.muted,
        volume: v.volume,
        audioBytes: typeof v.webkitAudioDecodedByteCount === "number" ? v.webkitAudioDecodedByteCount : null,
      };
    })
    .catch(() => null);
}

const describePlayback = (p: Playback | null) =>
  p ? `${p.currentTime.toFixed(2)} of ${p.duration.toFixed(2)} s, ${p.shown} frames shown (${p.dropped} dropped), readyState ${p.readyState}${p.error !== null ? `, media error ${p.error}` : ""}${p.ended ? ", ended" : p.paused ? ", paused" : ", playing"}` : "no video element";

// ---------------------------------------------------------------- one game

async function checkGame(game: ClipGame, browser: Browser, baseURL: string, report: RowReport, row: SummaryRow, t0: number): Promise<void> {
  const testInfo = test.info();
  const timeLeft = () => testInfo.timeout - (Date.now() - t0);

  // 1. The server says capture is on.
  const config = await clipsConfig(baseURL);
  if (!report.check("server: GET /api/clips-config says capture", config.capture, config.text, '{"capture":true} (CLIPS_MODE=on)')) {
    return;
  }

  const ffprobe = findTool("ffprobe");
  const ffmpeg = findTool("ffmpeg");
  if (!report.check("tools: ffprobe and ffmpeg", ffprobe !== null && ffmpeg !== null, `ffprobe ${ffprobe ?? "missing"}, ffmpeg ${ffmpeg ?? "missing"}`, "both installed (brew install ffmpeg)")) {
    return;
  }

  // The wait is not the game's time: the test's limit grows by it.
  const waited = await waitForQuietMachine(report);
  if (waited > 0) testInfo.setTimeout(testInfo.timeout + waited);
  noteLoad(report, "at the start");
  const driver: Driver = driverFor(game.id);
  report.info("driver", driver.note ?? "taps Play and lets the game run");
  report.info("sound switch in the code", game.soundSwitch ? "yes (setGameSpeakerEnabled)" : "no");

  const context = await browser.newContext({
    viewport: VIEWPORT,
    hasTouch: true,
    acceptDownloads: true,
    userAgent: await chromeUserAgent(browser),
  });
  // The Cloudflare beacon would count each test as a real visit to the site.
  await context.route(/cloudflareinsights\.com/, (route) => route.abort());
  const page = await context.newPage();
  const errors = watchErrors(page);
  /** The last time the check saw the clip button on the page: the clip UI had loaded (a ui load retry recovered). */
  let buttonSeenAt = 0;
  const replies: string[] = [];
  const noteReply = async () => {
    const text = await replyText(page);
    if (text && replies[replies.length - 1] !== text) replies.push(text);
  };
  try {
    const cdp = await context.newCDPSession(page);
    const finger = new Finger(page, (type, touchPoints) => cdp.send("Input.dispatchTouchEvent", { type: type as "touchStart", touchPoints }));
    const ctx: PlayContext = { page, finger };

    // 2. Open the game and start it.
    const response = await page.goto(game.route, { waitUntil: "domcontentloaded" });
    if (!report.check("page answers", response?.ok() ?? false, `status ${response?.status() ?? "none"}`, "200")) return;
    await page.locator("[data-play-box]").waitFor({ state: "attached", timeout: SHELL_MOUNT_MS });
    const button = page.getByTestId("clip-button");
    const buttonShows = await button.waitFor({ state: "visible", timeout: 30_000 }).then(
      () => true,
      () => false,
    );
    if (buttonShows) buttonSeenAt = Date.now();
    if (
      !report.check(
        "the clip button shows on the start card",
        buttonShows,
        `state ${await clipState(page)}`,
        "a visible [data-testid=clip-button]",
        buttonShows ? undefined : `this checkout (${checkoutCommit()}) says clips: true; is the server older than this checkout?`,
      )
    ) {
      await page.screenshot({ path: testInfo.outputPath(`${game.id}-no-button.png`) });
      return;
    }

    await (driver.start ?? defaultStart)(ctx);
    const overlay = page.getByTestId("game-start-overlay");
    const started = await overlay.waitFor({ state: "hidden", timeout: 10_000 }).then(
      () => true,
      () => false,
    );
    if (!report.check("a touch on the start control starts play", started, started ? "the start card left" : "the start card is still up")) {
      await page.screenshot({ path: testInfo.outputPath(`${game.id}-start.png`) });
      return;
    }
    const tip = page.getByTestId("orientation-tip");
    if (await tip.isVisible().catch(() => false)) {
      await finger.tap(tip.getByRole("button", { name: /Keep playing/ }));
      report.info("orientation tip", "tapped Keep playing");
    }
    await driver.begin?.(ctx);

    // 3. Play, then make the clip.
    const playStart = Date.now();
    const states = new StateLog(playStart);
    const warm = new WarmWatch(playStart);
    const playBudget = Math.min(PLAY_BUDGET_MS, timeLeft() - AFTER_PLAY_RESERVE_MS);
    if (!report.check("time left to play", playBudget >= MIN_PLAY_MS, `${(playBudget / 1000).toFixed(0)} s`, `>= ${MIN_PLAY_MS / 1000} s, with ${AFTER_PLAY_RESERVE_MS / 1000} s kept for the clip, the viewer and the file`)) {
      return;
    }
    const step = async () => {
      if (driver.step) await driver.step(ctx);
      else await page.waitForTimeout(150);
    };
    const look = async (): Promise<string> => {
      const value = await clipState(page);
      if (value !== "absent") buttonSeenAt = Date.now();
      const state = states.note(value);
      warm.note(state);
      await noteReply();
      return state;
    };
    let tapTries = 0;
    let tapWhen = "";
    /** When the press that made the clip went down: the clip ends there (the press token freezes the end). */
    let pressAt = 0;
    /**
     * The result screens in play, on this test's clock: from a moment before
     * the chip showed (the run ended under it) to the chip leaving (Play
     * again), or open when the clip was made at the break. A result screen
     * stands still by design, so the still check skips a still stretch
     * inside one.
     */
    const breaks: Array<{ from: number; to: number | null }> = [];
    /**
     * A tap on the clip button, and proof that it started a clip: the
     * button turns saving or made, or the new-clip chip shows, in 2 s. A
     * tap on a button that turned "resting" between the read and the tap
     * opens the Capture menu instead; the kid closes it.
     */
    const tapClipButton = async (when: string): Promise<boolean> => {
      tapTries++;
      const downAt = Date.now();
      await finger.tap(button);
      const menu = page.getByTestId("capture-menu");
      let after = "";
      const took = await waitUntil(
        page,
        TAP_TAKES_MS,
        async () => {
          after = (await clipState(page)).split(" ")[0];
          if (CLIP_STARTED.has(after)) return true;
          if (await page.getByTestId("clip-new-chip").isVisible().catch(() => false)) return true;
          return menu.isVisible().catch(() => false);
        },
        50,
      );
      const menuOpen = await menu.isVisible().catch(() => false);
      states.note(after || "absent");
      if (took && !menuOpen) {
        tapWhen = when;
        pressAt = downAt;
        return true;
      }
      await noteReply();
      if (menuOpen) {
        report.info(`clip tap ${tapTries}`, `the Capture menu opened (the button read "${after}")`, "closed it; the kid taps again when the button reads ready");
        await finger.tap(menu.getByRole("button", { name: new RegExp(`^(${MENU_COPY.close}|${MENU_COPY.back})$`) })).catch(() => undefined);
        await menu.waitFor({ state: "hidden", timeout: 3_000 }).catch(() => undefined);
      } else {
        report.info(`clip tap ${tapTries}`, `no clip started in ${TAP_TAKES_MS / 1000} s: the button read "${after}"`, replies[replies.length - 1] ?? "no reply");
      }
      return false;
    };

    let path: ClipPath = "none";
    let runs = 1;
    let runStart = playStart;
    let readySince: number | null = null;
    // After a run that ended with no clip (often inside the extra play), the kid taps sooner.
    let eager = false;
    let chipSince: number | null = null;
    let resultLabel = "";
    // The page is read every LOOK_EVERY_MS; a runner's bot steps in between (it needs a short loop).
    let lookedAt = 0;
    let state = "absent";
    while (Date.now() - playStart < playBudget && tapTries <= TAP_RETRIES) {
      if (Date.now() - lookedAt < LOOK_EVERY_MS) {
        await step();
        continue;
      }
      lookedAt = Date.now();
      state = await look();
      if (await page.getByTestId("result-chip").isVisible().catch(() => false)) {
        if (chipSince === null) {
          chipSince = Date.now();
          breaks.push({ from: chipSince - RUN_END_SLACK_MS, to: null });
        }
        const action = await resultClipAction(page);
        if (action) {
          await page.waitForTimeout(CHIP_GRACE_MS);
          await finger.release();
          resultLabel = action.label;
          await finger.tap(action.button);
          path = "result-chip";
          break;
        }
        if (Date.now() - chipSince < RESULT_ACTIONS_WAIT_MS) {
          await page.waitForTimeout(200);
          continue;
        }
        const runSec = (chipSince - runStart) / 1000;
        report.info(
          `run ${runs} ended`,
          `after ${runSec.toFixed(1)} s (${((chipSince - playStart) / 1000).toFixed(1)} s of play); the result chip has no clip button`,
          RUN_CLIP_STATES.has(state)
            ? `the run was too short to clip: under ${MIN_CLIP_SECONDS} s plus one keyframe gap`
            : `the clip button read "${states.last}"; the chip offers a run clip only when it reads ${[...RUN_CLIP_STATES].join(", ")}`,
        );
        // A run ended with no clip: from now on the kid taps soon after the button reads ready.
        eager = true;
        await finger.release();
        if (runs >= MAX_RUNS) {
          // The last run: the header clip button at the break clips the ring (the last seconds of
          // play and the result screen). Before that, the kid plays again: a clip made in play
          // holds more play than one made on the result screen.
          if (!RESULT_CHIP_ONLY && CLIP_AT_BREAK.has(state)) {
            await page.waitForTimeout(CHIP_GRACE_MS);
            if (await tapClipButton(`at the break after run ${runs}`)) path = "break-button";
          }
          break;
        }
        runs++;
        await page.waitForTimeout(CHIP_GRACE_MS);
        await finger.tap(page.getByTestId("result-chip").getByRole("button", { name: /play again|next/i }).first());
        await page.getByTestId("result-chip").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);
        breaks[breaks.length - 1].to = Date.now();
        runStart = Date.now();
        chipSince = null;
        readySince = null;
        await driver.begin?.(ctx);
        continue;
      }
      if (state === "ready" && !RESULT_CHIP_ONLY) {
        readySince ??= Date.now();
        if (Date.now() - readySince >= (eager ? EAGER_PLAY_MS : EXTRA_PLAY_MS)) {
          if (await tapClipButton(eager ? `after ${EAGER_PLAY_MS / 1000} s of play in run ${runs} (a run had ended with no clip)` : `after ${EXTRA_PLAY_MS / 1000} s more play`)) {
            path = "button";
            break;
          }
          readySince = null;
          continue;
        }
      } else {
        readySince = null;
      }
      await step();
    }
    row.path = path;
    report.info("clip button states in play", states.text());
    const cores = cpus().length;
    const warmText = `${(warm.warmMs / 1000).toFixed(1)} s warming${warm.readyAtSec !== null ? `, ready ${warm.readyAtSec.toFixed(1)} s after Play` : ", never ready"}; load up to ${warm.maxLoad.toFixed(1)} on ${cores} cores`;
    if (warm.maxLoad > cores) {
      report.info("the clip button warms up (busy machine: not judged)", warmText);
    } else {
      report.check(`the clip button warms up in ${WARM_LIMIT_SEC} s (quiet machine)`, warm.warmMs / 1000 <= WARM_LIMIT_SEC, warmText, `<= ${WARM_LIMIT_SEC} s of "warming" at a load <= ${cores}`);
    }
    if (driver.seen) report.info("driver: what it saw", driver.seen() ?? "nothing");
    if (
      !report.check(
        "the kid can make a clip",
        path !== "none",
        path === "button" || path === "break-button"
          ? `clip button tapped ${tapWhen} at ${((Date.now() - playStart) / 1000).toFixed(1)} s`
          : path === "result-chip"
            ? `result chip: "${resultLabel}"`
            : `no way in ${runs} run(s) and ${tapTries} tap(s): button ${states.last}`,
        "a ready clip button, a clip button on the result chip, or the clip button at a break",
      )
    ) {
      await page.screenshot({ path: testInfo.outputPath(`${game.id}-no-clip.png`) });
      return;
    }

    // 4. Open the clip.
    const viewer = page.getByTestId("clip-viewer");
    const viewerOpen = () => viewer.isVisible().catch(() => false);
    if (path === "button" || path === "break-button") {
      const chip = page.getByTestId("clip-new-chip");
      // The game goes on while the clip saves: the kid keeps playing.
      let madeLookedAt = 0;
      const made = await waitUntil(
        page,
        MADE_TIMEOUT_MS,
        async () => {
          if (Date.now() - madeLookedAt >= LOOK_EVERY_MS) {
            madeLookedAt = Date.now();
            await look();
            if (await chip.isVisible().catch(() => false)) return true;
          }
          if (path === "button") await step();
          else await page.waitForTimeout(100);
          return false;
        },
        0,
      );
      if (
        !report.check(
          "the tap makes a clip (the new-clip chip shows)",
          made,
          `button: ${states.text()}`,
          `[data-testid=clip-new-chip] in ${MADE_TIMEOUT_MS / 1000} s`,
          replies.length ? `replies: ${replies.join(" | ")}` : undefined,
        )
      ) {
        await page.screenshot({ path: testInfo.outputPath(`${game.id}-no-chip.png`) });
        return;
      }
      await finger.tap(chip);
      let open = await waitUntil(page, VIEWER_AT_ONCE_MS, viewerOpen);
      if (!open) {
        // A game that cannot pause: the clip opens at the next break.
        await noteReply();
        report.info("the clip opens at the next break", replies[replies.length - 1] ?? "no reply");
        if (driver.toBreak) await driver.toBreak(ctx);
        else await finger.release();
        open = await waitUntil(page, VIEWER_AT_BREAK_MS, async () => {
          await noteReply();
          return viewerOpen();
        });
      }
      if (!report.check("a tap on the new-clip chip opens the viewer", open, open ? "the viewer is open" : "no viewer", `[data-testid=clip-viewer] in ${(VIEWER_AT_ONCE_MS + VIEWER_AT_BREAK_MS) / 1000} s`)) {
        await page.screenshot({ path: testInfo.outputPath(`${game.id}-no-viewer.png`) });
        return;
      }
    } else {
      const open = await waitUntil(page, 30_000, async () => {
        await noteReply();
        return viewerOpen();
      });
      if (!report.check("the result chip's clip button opens the viewer", open, open ? "the viewer is open" : "no viewer", "[data-testid=clip-viewer] in 30 s")) {
        await page.screenshot({ path: testInfo.outputPath(`${game.id}-no-viewer.png`) });
        return;
      }
    }
    await finger.release();
    report.info("kid replies seen", replies.join(" | ") || "none");

    // 5. The viewer. It shows "loading" until it has read the clip's library row; then the video, or broken, or missing.
    const video = page.getByTestId("clip-viewer-video");
    const broken = page.getByTestId("clip-viewer-broken");
    const missing = page.getByTestId("clip-viewer-missing");
    const settled = await waitUntil(page, 15_000, async () => (await video.count()) + (await broken.count()) + (await missing.count()) > 0);
    const isBroken = await broken.isVisible().catch(() => false);
    const isMissing = await missing.isVisible().catch(() => false);
    report.check(
      "the viewer shows the clip",
      settled && !isBroken && !isMissing,
      !settled ? "still loading after 15 s" : isBroken ? "broken (the file cannot be read)" : isMissing ? "missing (no clip)" : "the video is there",
      "clip-viewer-video in 15 s, not clip-viewer-broken, not clip-viewer-missing",
    );
    // The viewer says "A game you played" until it has read the library row, then the game's name.
    let gameLine = "";
    let shownFirst = "";
    const nameFrom = Date.now();
    await waitUntil(
      page,
      10_000,
      async () => {
        gameLine = ((await page.getByTestId("clip-viewer-game").textContent().catch(() => "")) ?? "").trim();
        shownFirst ||= gameLine;
        return gameLine.includes(game.name);
      },
      50,
    );
    const nameMs = Date.now() - nameFrom;
    report.check(
      "the viewer names this game",
      gameLine.includes(game.name),
      gameLine || "no game line",
      `${game.name} (in 10 s)`,
      shownFirst !== gameLine ? `it said "${shownFirst}" for about ${nameMs} ms first` : undefined,
    );
    const videoShows = await video.waitFor({ state: "attached", timeout: 15_000 }).then(
      () => true,
      () => false,
    );
    let meta: { readyState: number; duration: number; width: number; height: number; blob: boolean; error: number | null } | null = null;
    if (videoShows) {
      await waitUntil(page, 15_000, async () => video.evaluate((v: HTMLVideoElement) => v.readyState >= 1 || v.error !== null).catch(() => false));
      meta = await video
        .evaluate((v: HTMLVideoElement) => ({
          readyState: v.readyState,
          duration: v.duration,
          width: v.videoWidth,
          height: v.videoHeight,
          blob: v.currentSrc.startsWith("blob:"),
          error: v.error ? v.error.code : null,
        }))
        .catch(() => null);
    }
    const metaOk = !!meta && meta.readyState >= 1 && Number.isFinite(meta.duration) && meta.duration > 0 && meta.width > 0 && meta.error === null;
    report.check(
      "the viewer's video loads its metadata",
      metaOk,
      meta ? `${meta.width}x${meta.height}, ${meta.duration.toFixed(2)} s, readyState ${meta.readyState}${meta.error !== null ? `, error ${meta.error}` : ""}${meta.blob ? ", blob: URL" : ""}` : "no video element",
      "readyState >= 1, a length, a size, no error",
    );
    if (metaOk && meta) {
      // The kid taps the player's play button to watch it. It is Chrome's
      // own control (in the video's user-agent shadow tree, so no locator
      // reaches it): the left end of the button row, 24 px in and 48 px up
      // from the video's bottom edge. A first tap can only show the
      // controls, so the kid taps again. A tap counts only when the point
      // is on the video (document.elementFromPoint gives the video for a
      // point on its shadow controls): a tap on something over the video
      // never reaches its play button, whatever then plays the video.
      const isPlaying = async () => {
        const p = await playback(video);
        return !!p && !p.paused && p.currentTime > 0;
      };
      const playing = () => waitUntil(page, 2_000, isPlaying);
      // Before the first tap: the sound row compares the decoded sound with this.
      const before = await playback(video);
      const box = await video.boundingBox();
      const taps: string[] = [];
      let byTap = false;
      for (let tap = 0; tap < 2 && box && !byTap; tap++) {
        const at: [number, number] = [box.x + 24, box.y + box.height - 48];
        const hit = await video
          .evaluate((v: HTMLVideoElement, [x, y]: [number, number]) => {
            const el = document.elementFromPoint(x, y);
            if (!el) return { video: false, what: "nothing" };
            const id = el.getAttribute("data-testid");
            return { video: el === v, what: `<${el.tagName.toLowerCase()}${id ? ` data-testid=${id}` : ""}>` };
          }, at)
          .catch(() => ({ video: false, what: "unknown (the page did not answer)" }));
        await finger.tapAt(at[0], at[1]);
        const started = await playing();
        taps.push(`tap ${tap + 1} at (${at[0].toFixed(0)}, ${at[1].toFixed(0)}) is on ${hit.what}: ${started ? "it plays" : "it does not play"}`);
        if (started && hit.video) byTap = true;
        // It plays, but the tap was not on the video: one more tap would pause it.
        else if (started) break;
      }
      report.check(
        "the kid starts the clip by touch (a tap on the player's play button)",
        byTap,
        box ? taps.join("; ") : "the video has no box on the screen",
        "the tap point is on the video (document.elementFromPoint) and the clip plays in 2 s",
      );
      if (!byTap && !(await isPlaying())) {
        // Only so that the rows below still measure the file. The row above failed: a kid could not start it this way.
        const answer = await video.evaluate((v: HTMLVideoElement) => v.play().then(() => "playing", (e: unknown) => String(e))).catch((e: unknown) => String(e));
        report.info("the viewer's video: started by play() to measure the file", `play(): ${answer}`, "not a kid's touch: the touch row above failed");
      }
      const first = await playback(video);
      await waitUntil(page, 15_000, async () => {
        const p = await playback(video);
        return !p || p.error !== null || p.ended || p.currentTime >= 1.5;
      });
      const later = await playback(video);
      report.check(
        "the viewer plays the clip",
        !!first && !!later && later.error === null && later.currentTime >= 1.5 && later.readyState >= 2 && later.shown > first.shown,
        `${describePlayback(later)}; ${first?.shown ?? 0} frames shown at the start; started by ${byTap ? "a tap on the play button" : "the check, not a touch (see the touch row)"}`,
        "past 1.5 s, more frames shown, readyState >= 2, no media error",
      );
      const endWithin = Math.max(0, meta.duration - (later?.currentTime ?? 0)) * 1000 + 15_000;
      await waitUntil(page, endWithin, async () => {
        const p = await playback(video);
        return !p || p.error !== null || p.ended;
      }, 250);
      const end = await playback(video);
      report.check(
        "the viewer plays the clip to the end",
        !!end && end.ended && end.error === null && end.shown >= (later?.shown ?? 0),
        describePlayback(end),
        `ended in ${(endWithin / 1000).toFixed(0)} s, no media error`,
      );
      // The kid hears the clip: the player is not muted, its volume is up, and it decodes sound while it plays.
      const heard = later && end ? { muted: later.muted || end.muted, volume: Math.min(later.volume, end.volume), from: before?.audioBytes ?? 0, to: end.audioBytes } : null;
      const heardText = heard
        ? `${heard.muted ? "muted" : "not muted"}, volume ${heard.volume.toFixed(2)}, sound decoded ${heard.from} -> ${heard.to ?? "not given by this browser"} bytes`
        : "no video element";
      if (game.soundSwitch) {
        report.check(
          "the viewer plays the clip with sound",
          !!heard && !heard.muted && heard.volume > 0 && heard.to !== null && heard.to > heard.from,
          heardText,
          "not muted, volume > 0, and the decoded sound bytes rise while it plays (webkitAudioDecodedByteCount)",
        );
      } else {
        report.info("the viewer's sound (the game has no sound switch)", heardText);
      }
    }

    // 6. Save to computer: the file the kid gets.
    const viewerAction = viewer.locator('[data-action="save"]');
    const saveReady = await expect(viewerAction)
      .toBeEnabled({ timeout: 15_000 })
      .then(
        () => true,
        () => false,
      );
    const saveLabel = ((await viewerAction.textContent().catch(() => "")) ?? "").trim();
    if (!report.check("the viewer's Save button is ready", saveReady, saveLabel || "no Save button", "[data-action=save], enabled")) {
      await page.screenshot({ path: testInfo.outputPath(`${game.id}-no-save.png`) });
      return;
    }
    const downloading = page.waitForEvent("download", { timeout: 30_000 });
    await finger.tap(viewerAction);
    const download = await downloading.catch(() => null);
    if (!report.check(`"${saveLabel}" gives a file`, download !== null, download ? "a download started" : "no download", "a download in 30 s")) return;
    const fileName = download!.suggestedFilename();
    report.check("the file is named for this game", new RegExp(`-${game.id}-\\d{8}-\\d{4}\\.mp4$`).test(fileName), fileName, `<host>-${game.id}-<yyyymmdd>-<hhmm>.mp4`);
    const file = testInfo.outputPath(`${game.id}.mp4`);
    await download!.saveAs(file);
    const bytes = readFileSync(file);
    report.info("file", `${file} (${bytes.length} bytes)`);
    const status = ((await page.getByTestId("clip-viewer-status").textContent().catch(() => "")) ?? "").trim();
    report.info("viewer reply after Save", status || "none");

    // 7. The file.
    report.check("container: the file is MP4", startsWithFtyp(bytes), `ftyp ${majorBrand(bytes)}`, "an ftyp box at byte 4");
    const probe = probeClip(ffprobe!, file);
    report.check("container: ffprobe reads MP4", /mp4/.test(probe.formatName), probe.formatName || "unreadable", "mov,mp4,...");
    const v = probe.video[0];
    row.videoCodec = v ? `${v.codec}${v.profile ? ` ${v.profile}` : ""}` : "none";
    row.size = v ? `${v.width}x${v.height}` : "-";
    report.check(
      "video: exactly one video stream",
      probe.video.length === 1 && !!v && v.width > 0 && v.height > 0,
      v ? `${probe.video.length} stream: ${row.videoCodec}, ${v.width}x${v.height}, ${v.fps?.toFixed(1) ?? "?"} fps` : `${probe.video.length} streams`,
      "1, with a size",
    );
    const fileLength = probe.durationSec;
    row.durationSec = fileLength;
    report.check(
      `video: the file's length ${MIN_LENGTH_SEC} s to ${MAX_LENGTH_SEC} s`,
      fileLength !== null && fileLength >= MIN_LENGTH_SEC && fileLength <= MAX_LENGTH_SEC,
      fileLength === null ? "no length" : `${fileLength.toFixed(2)} s`,
      `${MIN_LENGTH_SEC}..${MAX_LENGTH_SEC} s (the longer track)`,
    );
    // The file's length is the longer track's; a video track that ends early must not hide behind the sound.
    const videoLength = v?.durationSec ?? null;
    report.check(
      "video: the video track's own length, with frames",
      videoLength !== null &&
        videoLength >= MIN_LENGTH_SEC &&
        videoLength <= MAX_LENGTH_SEC &&
        (v?.frames ?? 0) > 0 &&
        fileLength !== null &&
        Math.abs(videoLength - fileLength) <= SAME_LENGTH_SEC,
      videoLength === null ? "no length" : `${videoLength.toFixed(2)} s, ${v?.frames ?? "?"} frames; the file ${fileLength?.toFixed(2) ?? "?"} s`,
      `${MIN_LENGTH_SEC}..${MAX_LENGTH_SEC} s, frames > 0, within ${SAME_LENGTH_SEC} s of the file`,
    );
    const decode = decodeErrors(ffmpeg!, file);
    report.check(
      "video: the whole file decodes cleanly",
      decode.status === 0 && decode.lines.length === 0,
      decode.lines.length ? `${decode.lines.length} error line(s): ${decode.lines.slice(0, 2).join(" | ")}` : `exit ${decode.status}, no error`,
      "ffmpeg -v error prints nothing",
    );
    if (meta && fileLength !== null) {
      report.check(
        "video: the viewer and the file agree on the length",
        Math.abs(meta.duration - fileLength) <= SAME_LENGTH_SEC,
        `viewer ${meta.duration.toFixed(2)} s, file ${fileLength.toFixed(2)} s`,
        `within ${SAME_LENGTH_SEC} s`,
      );
    }
    const length = videoLength ?? fileLength;
    if (v && length !== null && length > 0) {
      // The result screens inside a clip made by a tap (a run clip holds only its run), on the clip's clock.
      const screens =
        path === "result-chip" || pressAt === 0
          ? []
          : breaks.map((b) => ({ fromSec: length - (pressAt - b.from) / 1000, toSec: b.to === null ? length : length - (pressAt - b.to) / 1000 })).filter((w) => w.toSec > 0);
      // An idle kid leaves out the driver's step: such a game can wait for a tap, so its picture may stand still.
      const motionJudged = !(IDLE && driver.idleSkipsStep);
      const gap = longestFrameGap(ffprobe!, file);
      await checkPicture(report, ffmpeg!, file, game.id, v.width, v.height, length, screens, motionJudged, gap);
    }
    const audio = probe.audio[0];
    row.audioCodec = audio ? audio.codec : "none";
    const audioText = audio ? `${probe.audio.length} stream: ${audio.codec}${audio.profile ? ` ${audio.profile}` : ""}, ${audio.sampleRate ?? "?"} Hz, ${audio.channels ?? "?"} ch` : "no sound track";
    if (game.soundSwitch) {
      report.check("sound: the file has a sound track (the game has a sound switch)", !!audio, audioText, "a sound track");
    } else {
      report.info("sound: track (the game has no sound switch)", audioText);
    }
    if (audio) {
      const level = loudness(ffmpeg!, file);
      const levelText = level ? `mean ${level.meanDb} dB, peak ${level.maxDb} dB` : "not measured";
      if (game.soundSwitch && !IDLE) {
        report.check(
          "sound: the game's sound is in the clip",
          !!level && level.maxDb >= SOUND_MIN_PEAK_DB,
          levelText,
          `peak >= ${SOUND_MIN_PEAK_DB} dB (silence is -91 dB); the driver makes a sound, so the clip must hold it`,
        );
      } else {
        report.info("sound: level (volumedetect)", levelText, game.soundSwitch ? "an idle kid makes no sound: INFO only" : "the game makes no sound");
      }
    }
    if (probe.other.length) report.info("other streams", probe.other.join(", "));
  } finally {
    // 8. Errors.
    const origin = originOf(baseURL);
    // The named recoveries first: a recovery that worked covers its warning, the request that failed, and Chrome's console line for it.
    // unique keeps the last showing of each text: a recovery must work after it.
    const warnings = unique(errors.clipWarnings, (w) => w.text);
    const facts: RecoveryFacts = { buttonSeenAt };
    const named = (w: { text: string }) => BENIGN_CLIP_WARNINGS.find((b) => b.pattern.test(w.text));
    const benign = warnings.filter((w) => {
      const rule = named(w);
      return !!rule && (!rule.recovered || rule.recovered(w.at, facts));
    });
    // Every showing of a recovery that worked and names the request it covers (not unique: each try has its own failed request).
    const recoveries = errors.clipWarnings.filter((w) => {
      const rule = named(w);
      return !!rule?.request && (!rule.recovered || rule.recovered(w.at, facts));
    });
    const coveredBy = (r: { url: string; at: number }) =>
      recoveries.find((w) => {
        const pathname = originOf(r.url) === origin ? new URL(r.url).pathname : "";
        return named(w)!.request!.test(pathname) && Math.abs(w.at - r.at) <= RECOVERY_PAIR_MS;
      });
    const failed = unique(errors.failedRequests, (r) => `${r.url}@${r.error}`);
    const ownAll = failed.filter((r) => originOf(r.url) === origin && r.error !== "net::ERR_ABORTED");
    // A URL is covered only when every one of its failures is (the rows show each URL once).
    const recovered = ownAll.filter((r) => errors.failedRequests.filter((f) => f.url === r.url && f.error === r.error).every((f) => !!coveredBy(f)));
    const ownFailed = ownAll.filter((r) => !recovered.includes(r));
    const otherFailed = failed.filter((r) => !ownAll.includes(r));
    /** Chrome's own console line for a request that failed ("Failed to load resource: ...", at the request's URL). */
    const resourceLine = (e: { text: string; url: string }) => /^Failed to load resource: /.test(e.text) && recovered.some((r) => r.url === e.url);

    const pageErrors = unique(errors.page);
    report.check("errors: no page error", pageErrors.length === 0, pageErrors.length ? pageErrors.map(firstLine).join(" | ") : "none", "none");
    const consoleErrors = unique(errors.console, (e) => `${e.text}@${e.url}`);
    const ownConsole = consoleErrors.filter((e) => !thirdParty(e.url) && !resourceLine(e));
    const coveredConsole = consoleErrors.filter((e) => !thirdParty(e.url) && resourceLine(e));
    const otherConsole = consoleErrors.filter((e) => thirdParty(e.url));
    report.check(
      "errors: no console error",
      ownConsole.length === 0,
      ownConsole.length ? ownConsole.map((e) => `${e.text} @ ${short(e.url) || "?"}`).join(" | ") : "none",
      `none (third-party hosts, and the load error of a request a named recovery covers, aside: ${THIRD_PARTY_HOSTS.join(", ")})`,
    );
    if (coveredConsole.length) report.info("errors: console lines of requests a named recovery covers", coveredConsole.map((e) => `${e.text} @ ${short(e.url)}`).join(" | "));
    if (otherConsole.length) report.info("errors: console errors from third-party hosts", otherConsole.map((e) => `${e.text} @ ${short(e.url)}`).join(" | "));
    const clipWarnings = warnings
      .filter((w) => !benign.includes(w))
      .map((w) => {
        const rule = named(w);
        return rule?.notRecovered ? `${w.text} (${rule.notRecovered})` : w.text;
      });
    report.check("errors: no [clips] warning from the clip service", clipWarnings.length === 0, clipWarnings.join(" | ") || "none", "none (named recoveries aside)");
    if (benign.length) {
      report.info("errors: [clips] recoveries", benign.map((w) => `${w.text} (${named(w)?.why})`).join(" | "));
    }
    report.check(
      "network: no request to the site failed",
      ownFailed.length === 0,
      ownFailed.length ? ownFailed.map((r) => `${short(r.url)}: ${r.error}`).join(" | ") : "none",
      `none from ${origin} (a request the page itself cancelled, net::ERR_ABORTED, and a request a named recovery covers, aside)`,
    );
    if (recovered.length) {
      report.info(
        "network: failed requests a named recovery covers",
        recovered.map((r) => `${short(r.url)}: ${r.error}`).join(" | "),
        `each failure came within ${RECOVERY_PAIR_MS / 1000} s of a recovery's warning, and the recovery worked`,
      );
    }
    if (otherFailed.length) report.info("network: other failed requests", otherFailed.map((r) => `${short(r.url)}: ${r.error}`).join(" | "));
    noteLoad(report, "at the end");
    if (report.failures().length) await page.screenshot({ path: testInfo.outputPath(`${game.id}-end.png`) }).catch(() => undefined);
    await context.close();
  }
}

/**
 * The picture rows: the game picture at 25% and 75% is not blank, and with
 * the score's band or chip blanked the picture moves between 25% and 75%
 * and never stands still for more than STILL_LIMIT_SEC. One ffmpeg pass
 * reads the whole clip, MOVE_SAMPLE_FPS frames a second. A still stretch
 * inside one of `screens` (a result screen that was in play when the clip
 * was made, in clip seconds) is an INFO row: a result screen stands still
 * by design. With `motionJudged` false (CLIPS_E2E_IDLE=1 on a game whose
 * driver plays a step), the two motion rows are INFO rows: the game can
 * wait for the tap that the idle kid leaves out (Arkanoid's ball rests on
 * the paddle). The "not blank" rows are judged always.
 */
async function checkPicture(
  report: RowReport,
  ffmpeg: string,
  file: string,
  id: string,
  width: number,
  height: number,
  length: number,
  screens: Array<{ fromSec: number; toSec: number }>,
  motionJudged: boolean,
  gap: { gapSec: number; fromSec: number } | null,
): Promise<void> {
  const testInfo = test.info();
  const motionRow = (check: string, ok: boolean, value: string, limit: string) => {
    if (motionJudged) return report.check(check, ok, value, limit);
    report.info(check, value, `${ok ? "meets" : "misses"} ${limit}; not judged: an idle kid (CLIPS_E2E_IDLE=1) leaves out this game's driver step, and the game can wait for that tap`);
    return ok;
  };
  const at25 = length * 0.25;
  const at75 = length * 0.75;
  let a: GrayFrame;
  let b: GrayFrame;
  try {
    a = grayFrame(ffmpeg, file, at25, width, height);
    b = grayFrame(ffmpeg, file, at75, width, height);
  } catch (error) {
    report.check("picture: the frames at 25% and 75% decode", false, firstLine(error instanceof Error ? error.message : String(error)), "two frames");
    return;
  }
  savePng(ffmpeg, file, at25, testInfo.outputPath(`${id}-25.png`));
  savePng(ffmpeg, file, at75, testInfo.outputPath(`${id}-75.png`));
  for (const [label, frame] of [
    ["25%", a],
    ["75%", b],
  ] as const) {
    const picture = gamePicture(frame);
    const s = frameStats(picture);
    const r = picture.rect;
    report.check(
      `picture: the game picture at ${label} is not blank`,
      s.sd >= NOT_BLANK_MIN_SD && s.max - s.min >= NOT_BLANK_MIN_RANGE,
      `${describeFrame(s)}; over ${r.w}x${r.h} px at (${r.x}, ${r.y})`,
      `sd >= ${NOT_BLANK_MIN_SD}, range >= ${NOT_BLANK_MIN_RANGE} (the game picture, the letterbox bars left out, inside x 20-80%, y 15-85% of the frame)`,
    );
  }
  // Every frame against the one before it (still stretches), and the play
  // frames from 25% to 75% against the first of them. Two frames alone can
  // miss a sprite that goes back and forth: a Bomberman balloon was in the
  // same cell at 25% and 75%. A frame on a result screen is not play: when
  // 25% to 75% is all result screen, the play frames of the whole clip are
  // measured instead.
  const onAScreen = (atSec: number) => screens.some((w) => atSec >= w.fromSec && atSec <= w.toSec);
  let previous: { frame: GrayFrame; atSec: number } | null = null;
  const stretches: Array<{ fromSec: number; toSec: number }> = [];
  let open: { fromSec: number; toSec: number } | null = null;
  const spanMove = { reference: null as GrayFrame | null, frames: 0, most: 0, at: -1 };
  const playMove = { reference: null as GrayFrame | null, frames: 0, most: 0, at: -1 };
  const measure = (m: typeof spanMove, frame: GrayFrame, atSec: number) => {
    m.frames++;
    if (!m.reference) {
      m.reference = frame;
      return;
    }
    const changed = changedPixels(m.reference, frame, MOVE_LUMA_STEPS);
    if (changed > m.most) {
      m.most = changed;
      m.at = atSec;
    }
  };
  let frames = 0;
  try {
    frames = await scanFrames(ffmpeg, file, { fromSec: 0, toSec: null, fps: MOVE_SAMPLE_FPS, width, height }, (raw, atSec) => {
      const frame = withoutHud(raw);
      if (previous) {
        if (changedPixels(previous.frame, frame, MOVE_LUMA_STEPS) < MOVE_MIN_PIXELS) {
          if (open) open.toSec = atSec;
          else {
            open = { fromSec: previous.atSec, toSec: atSec };
            stretches.push(open);
          }
        } else {
          open = null;
        }
      }
      previous = { frame, atSec };
      if (onAScreen(atSec)) return;
      measure(playMove, frame, atSec);
      if (atSec >= at25 - 0.5 / MOVE_SAMPLE_FPS && atSec <= at75 + 0.5 / MOVE_SAMPLE_FPS) measure(spanMove, frame, atSec);
    });
  } catch (error) {
    report.check("picture: the clip's frames decode", false, firstLine(error instanceof Error ? error.message : String(error)), `every frame, ${MOVE_SAMPLE_FPS} a second`);
    return;
  }
  const useSpan = spanMove.frames >= 2;
  const move = useSpan ? spanMove : playMove;
  const playSec = playMove.frames / MOVE_SAMPLE_FPS;
  motionRow(
    useSpan ? "picture: it moves between 25% and 75%" : "picture: it moves in the play part of the clip (25% to 75% is a result screen)",
    move.frames >= 2 && move.most >= MOVE_MIN_PIXELS,
    move.frames >= 2
      ? `up to ${move.most} pixels changed by > ${MOVE_LUMA_STEPS} (${((move.most / a.pixels.length) * 100).toFixed(2)}%)${move.at >= 0 ? ` at ${move.at.toFixed(1)} s` : ""}; ${move.frames} frames; ${playSec.toFixed(1)} s of play in the clip`
      : `no play to measure: ${playSec.toFixed(1)} s of the clip is outside a result screen`,
    `>= ${MOVE_MIN_PIXELS} pixels in one frame (the score's band or chip blanked)`,
  );
  const seconds = (w: { fromSec: number; toSec: number }) => w.toSec - w.fromSec;
  const onScreen = (w: { fromSec: number; toSec: number }) =>
    screens.some((s) => w.fromSec >= s.fromSec - SCREEN_SLACK_SEC && w.toSec <= s.toSec + SCREEN_SLACK_SEC);
  const judged = stretches.filter((w) => !onScreen(w));
  const resultScreens = stretches.filter((w) => onScreen(w) && seconds(w) > STILL_LIMIT_SEC);
  if (resultScreens.length) {
    report.info(
      "picture: still on a result screen",
      resultScreens.map((w) => `${seconds(w).toFixed(1)} s (${w.fromSec.toFixed(1)}-${w.toSec.toFixed(1)} s)`).join(", "),
      `the clip was made with a result screen in it (${screens.map((s) => `${Math.max(0, s.fromSec).toFixed(1)}-${s.toSec.toFixed(1)} s`).join(", ")}); a result screen stands still by design`,
    );
  }
  const longest = judged.reduce<{ fromSec: number; toSec: number } | null>((best, w) => (!best || seconds(w) > seconds(best) ? w : best), null);
  motionRow(
    `picture: it never stands still for more than ${STILL_LIMIT_SEC} s`,
    frames > 1 && (!longest || seconds(longest) <= STILL_LIMIT_SEC),
    `longest still stretch ${longest ? `${seconds(longest).toFixed(1)} s (${longest.fromSec.toFixed(1)}-${longest.toSec.toFixed(1)} s)` : "0.0 s"}; ${frames} frames over ${length.toFixed(2)} s; ${
      gap ? `the longest time with no new frame in the file ${gap.gapSec.toFixed(2)} s (${gap.fromSec.toFixed(2)}-${(gap.fromSec + gap.gapSec).toFixed(2)} s)${gap.gapSec > STILL_LIMIT_SEC ? ": a hole in the capture" : ""}` : "frame times not read"
    }`,
    `<= ${STILL_LIMIT_SEC} s with < ${MOVE_MIN_PIXELS} pixels changed frame to frame (a result screen in the clip aside)`,
  );
}

// ---------------------------------------------------------------- the tests

test("clip games: the source has games with clips: true", () => {
  expect(GAMES.length, "no metadata.ts under src/games or src/apps has clips: true").toBeGreaterThan(0);
  const raw = process.env.E2E_ROUTES?.trim();
  if (raw) {
    const routes = raw.split(",").map((r) => r.trim().replace(/\/+$/, "")).filter(Boolean);
    const known = new Set(GAMES.map((game) => game.route));
    expect(routes.filter((r) => !known.has(r)), "E2E_ROUTES names a route that is not a clip game").toEqual([]);
  }
  console.log(`clip games (${GAMES.length}) in this checkout (${checkoutCommit()}): ${GAMES.map((g) => g.id).join(" ")}`);
});

for (const game of GAMES) {
  test(`${game.name} (${game.route}): a kid makes a clip, and the file is a real video`, async ({ browser, baseURL }) => {
    const t0 = Date.now();
    test.skip(!wanted(game.route), "not in E2E_ROUTES");
    const report = new RowReport(`${game.name} (${game.route})`);
    const row: SummaryRow = {
      id: game.id,
      name: game.name,
      route: game.route,
      path: "none",
      durationSec: null,
      size: "-",
      videoCodec: "-",
      audioCodec: "-",
      verdict: "FAIL",
      failed: [],
      startedAt: t0,
      endedAt: 0,
    };
    try {
      if (!existsSync(path.join(APP_SRC, "app", ...game.route.split("/").filter(Boolean), "page.tsx"))) {
        report.check("route: the module has a page", false, `no page.tsx for ${game.route}`, "src/app<route>/page.tsx");
      } else {
        await checkGame(game, browser, baseURL!, report, row, t0);
      }
    } catch (error) {
      report.check("the check ran to the end", false, firstLine(error instanceof Error ? error.message : String(error)).slice(0, 300));
    } finally {
      row.endedAt = Date.now();
      row.failed = report.failures().map((r) => r.check);
      row.verdict = row.failed.length ? "FAIL" : "PASS";
      saveRow(row);
      const text = report.text();
      console.log(`\n${text}\n== ${row.verdict} ${game.id} in ${((row.endedAt - row.startedAt) / 1000).toFixed(0)} s\n`);
      await test.info().attach("rows", { body: text, contentType: "text/plain" });
    }
    expect(report.failures(), report.text()).toEqual([]);
  });
}

test("clip games: summary", () => {
  const rows = new Map<string, SummaryRow>();
  if (existsSync(ROWS_DIR)) {
    for (const name of readdirSync(ROWS_DIR)) {
      const row = JSON.parse(readFileSync(path.join(ROWS_DIR, name), "utf8")) as SummaryRow;
      rows.set(row.id, row);
    }
  }
  const header = ["game", "clip path", "length", "size", "video codec", "sound codec", "verdict"];
  const lines = WANTED.map((game) => {
    const row = rows.get(game.id);
    if (!row) return [game.id, "-", "-", "-", "-", "-", "NOT RUN"];
    return [
      game.id,
      row.path,
      row.durationSec === null ? "-" : `${row.durationSec.toFixed(2)} s`,
      row.size,
      row.videoCodec,
      row.audioCodec,
      row.verdict === "PASS" ? "PASS" : `FAIL (${row.failed.join("; ")})`,
    ];
  });
  const widths = header.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));
  const format = (cells: string[]) => cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]))).join(" | ");
  const done = [...rows.values()];
  const wall = done.length ? (Math.max(...done.map((r) => r.endedAt)) - Math.min(...done.map((r) => r.startedAt))) / 1000 : 0;
  const pass = lines.filter((l) => l[6] === "PASS").length;
  console.log(
    [
      "",
      `== clips on every clip game (checkout ${checkoutCommit()}, ${test.info().project.use.baseURL ?? "?"})`,
      format(header),
      widths.map((w) => "-".repeat(w)).join("-|-"),
      ...lines.map(format),
      `${pass} of ${lines.length} PASS; games took ${Math.round(wall)} s`,
      "",
    ].join("\n"),
  );
  const notRun = lines.filter((l) => l[6] === "NOT RUN").map((l) => l[0]);
  expect(notRun, "games with no result: the check did not run for them").toEqual([]);
});
