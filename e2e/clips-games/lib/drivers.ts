/**
 * How the clips check plays each game, the way a kid does: real touches
 * only (Input.dispatchTouchEvent through the phone checks' Finger), never a
 * mouse click, never a key, and never a call into the clip service.
 *
 * - Finger (e2e/phone/touch.ts): one or two thumbs. A thumb can stay down
 *   on a control (a gas pedal, DUCK) while the other thumb taps the clip
 *   button.
 * - Every clip-enabled game needs an explicit real-play driver.
 *   Coverage fails when metadata adds a game without one.
 * - The bots (Dino Runner, Flappy Bird, Endless Runner) read the game's
 *   canvas, one getImageData per step, to know when to jump, flap or duck,
 *   the way a kid looks at the screen. Each read costs the game a little
 *   frame time, so the clip governor can rest capture for a moment
 *   ("resting"); the check waits for "ready" again. Each bot counts the
 *   reads where it could not see its runner, so a bot that stops seeing
 *   (new art, new colours) is named in the report instead of showing up
 *   as a clip failure.
 */
import type { Locator, Page } from "playwright/test";

import { Finger, number } from "../../phone/touch";
import { ADDITIONAL_DRIVERS } from "./additionalDrivers";

export interface PlayContext {
  page: Page;
  finger: Finger;
}

export interface Driver {
  /** Taps the start control. Default: the last button of the start card's action row. */
  start?: (ctx: PlayContext) => Promise<void>;
  /** At the start of each run: put a thumb down (a gas pedal). */
  begin?: (ctx: PlayContext) => Promise<void>;
  /**
   * One short step of play (at most a few hundred ms). The check calls it
   * again and again until the clip is made, so the game stays alive, its
   * picture moves, and a game with sound makes some.
   */
  step?: (ctx: PlayContext) => Promise<void>;
  /**
   * A game that cannot pause opens the clip at the next break ("Your clip
   * is ready when this run ends!"). This gets the kid to that break.
   * Default: the held thumb lifts and play stops, so the run ends by
   * itself.
   */
  toBreak?: (ctx: PlayContext) => Promise<void>;
  /** What the driver does, for the report. */
  note?: string;
  /** What the driver saw while it played (a bot's sight, a stuck truck), for the report. */
  seen?: () => string | null;
  /**
   * CLIPS_E2E_IDLE=1 only: the game's own driver plays a step that the idle
   * kid leaves out. Such a game can wait for the kid (a ball that rests on
   * the paddle until a tap), so its picture can stand still: the motion
   * rows are then INFO rows, like the sound row.
   */
  idleSkipsStep?: boolean;
  /** Boards may wait between moves, but footage must still contain a confirmed move. */
  motion?: "turn-based";
  confirmedActions?: () => number;
}

/** The buttons of the start card's action row, without the read-aloud button. */
export function startActions(page: Page): Locator {
  return page.getByTestId("start-card-actions").locator('button:not([data-testid="read-aloud-button"])');
}

/** A start control by its words. */
function startBy(name: RegExp): Driver["start"] {
  return async ({ page, finger }) => {
    const button = startActions(page).filter({ hasText: name }).first();
    await button.waitFor();
    await finger.tap(button);
  };
}

/** A tap on a control every `everyMs`, with short waits between. */
function tapEvery(target: (page: Page) => Locator, everyMs: number): Driver["step"] {
  let last = 0;
  return async ({ page, finger }) => {
    if (Date.now() - last >= everyMs) {
      last = Date.now();
      const control = target(page);
      if (await control.isVisible().catch(() => false)) await finger.tap(control).catch(() => undefined);
    }
    await page.waitForTimeout(100);
  };
}

/** A paddle game: launch the ball whenever it rests on the paddle (the launch hint shows). */
function launchBall(root: string, hint: string): Driver["step"] {
  return async ({ page, finger }) => {
    if (await page.getByTestId(hint).isVisible().catch(() => false)) {
      const box = await page.locator(root).boundingBox();
      if (box) await finger.tapAt(box.x + box.width / 2, box.y + box.height * 0.9);
    }
    await page.waitForTimeout(150);
  };
}

/**
 * How often a bot could see what it plays: the reads where it saw its
 * runner, and the longest stretch where it saw nothing.
 */
class Sight {
  private reads = 0;
  private blind = 0;
  private blindSince: number | null = null;
  private blindLast = 0;
  private longestBlindMs = 0;

  note(saw: boolean): void {
    this.reads++;
    if (saw) {
      this.closeBlind();
      return;
    }
    this.blind++;
    this.blindLast = Date.now();
    this.blindSince ??= this.blindLast;
  }

  /** A blind stretch lasts from its first blind read to its last one. */
  private closeBlind(): void {
    if (this.blindSince === null) return;
    this.longestBlindMs = Math.max(this.longestBlindMs, this.blindLast - this.blindSince);
    this.blindSince = null;
  }

  text(what: string): string {
    this.closeBlind();
    const longest = this.longestBlindMs / 1000;
    const blindWords = longest >= 2 ? `BLIND for up to ${longest.toFixed(1)} s (the bot may not see the game any more)` : `blind for up to ${longest.toFixed(1)} s`;
    return `saw ${what} in ${this.reads - this.blind} of ${this.reads} reads; ${blindWords}`;
  }
}

// ---------------------------------------------------------------- Dino Runner

/**
 * In the page: where the next cactus is (canvas x of its left edge, or -1),
 * whether the dino is on the ground, and whether the dino shows at all. The
 * canvas is 800 x 300; the dino stands at x 50-94 on the ground at y 260
 * (dino-runner/lib/constants.ts) and jumps up to about y 90. One read of
 * x 56-259, y 80-257. "Ink" is a pixel far from the sky (the mode of the
 * read's top row), so it works in the day and the night palettes.
 */
export function dinoPlan(): { minX: number; ground: boolean; dino: boolean } | null {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="dino-viewport"] canvas');
  const ctx = canvas?.getContext("2d");
  if (!ctx) return null;
  const X0 = 56;
  const W = 204;
  const Y0 = 80;
  const H = 178;
  const d = ctx.getImageData(X0, Y0, W, H).data;
  const lum = (i: number) => 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
  const counts = new Map<number, number>();
  for (let x = 0; x < W; x += 4) {
    const v = Math.round(lum(x * 4) / 8);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let sky = 0;
  let most = -1;
  for (const [v, n] of counts) {
    if (n > most) {
      most = n;
      sky = v * 8;
    }
  }
  const ink = (x: number, y: number) => Math.abs(lum(((y - Y0) * W + (x - X0)) * 4) - sky) > 60;
  // The cacti stand in y 212-257.
  let minX = -1;
  for (let x = 100; x < X0 + W && minX < 0; x++) {
    for (let y = 212; y < Y0 + H; y += 2) {
      if (ink(x, y)) {
        minX = x;
        break;
      }
    }
  }
  let ground = false;
  for (let x = 56; x < 88 && !ground; x += 2) {
    for (let y = 250; y < 258; y++) {
      if (ink(x, y)) {
        ground = true;
        break;
      }
    }
  }
  let dino = ground;
  for (let x = 56; x < 88 && !dino; x += 2) {
    for (let y = Y0; y < 250; y += 2) {
      if (ink(x, y)) {
        dino = true;
        break;
      }
    }
  }
  return { minX, ground, dino };
}

/**
 * Jump when a cactus's left edge is 119-190 px into the canvas. From the
 * physics (jump -12 px/frame, gravity 0.6, speed 6-7 px/frame) a jump
 * clears the widest cactus group when its edge is about 107-200 px in.
 */
function dinoDriver(): Driver {
  let jump: { x: number; y: number } | null = null;
  const sight = new Sight();
  return {
    note: "jumps the cacti (reads the canvas)",
    begin: async () => {
      jump = null;
    },
    step: async ({ page, finger }) => {
      const plan = await page.evaluate(dinoPlan).catch(() => null);
      sight.note(!!plan?.dino);
      if (plan && plan.ground && plan.minX >= 119 && plan.minX <= 190) {
        jump ??= await finger.center(page.getByTestId("dino-jump"));
        await finger.tapAt(jump.x, jump.y);
        await page.waitForTimeout(120);
      }
      await page.waitForTimeout(25);
    },
    seen: () => sight.text("the dino"),
  };
}

// ---------------------------------------------------------------- Flappy Bird

/**
 * In the page: the bird's height and the gap of the next pipe, in canvas
 * px (320 x 480, the ground at y 368: flappy-bird/lib/constants.ts). One
 * read of the canvas above the ground. The bird is yellow (#f9e400) near
 * x 80-114; the pipes are green.
 */
export function flappyPlan(): { birdY: number | null; pipeX: number; gapTop: number | null; gapBottom: number | null } | null {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="flappy-canvas"]');
  const ctx = canvas?.getContext("2d");
  if (!ctx) return null;
  const W = 320;
  const GROUND = 368;
  const d = ctx.getImageData(0, 0, W, GROUND).data;
  const at = (x: number, y: number) => (y * W + x) * 4;
  const yellow = (i: number) => d[i] > 220 && d[i + 1] > 190 && d[i + 2] < 80;
  const green = (i: number) => d[i + 1] > 120 && d[i + 1] - d[i] > 40 && d[i + 2] < 80;
  let sum = 0;
  let n = 0;
  for (let y = 0; y < GROUND; y += 2) {
    for (let x = 66; x < 130; x += 2) {
      if (yellow(at(x, y))) {
        sum += y;
        n++;
      }
    }
  }
  const birdY = n ? sum / n : null;
  let pipeX = -1;
  for (let x = 60; x < W && pipeX < 0; x++) {
    let g = 0;
    for (let y = 0; y < GROUND; y += 8) if (green(at(x, y))) g++;
    if (g >= 4) pipeX = x;
  }
  let gapTop: number | null = null;
  let gapBottom: number | null = null;
  if (pipeX >= 0) {
    const x = Math.min(W - 1, pipeX + 20);
    let best = 0;
    let runStart = -1;
    for (let y = 0; y <= GROUND; y++) {
      const isGreen = y < GROUND && green(at(x, y));
      if (!isGreen && runStart < 0) runStart = y;
      if ((isGreen || y === GROUND) && runStart >= 0) {
        if (y - runStart > best && runStart > 0 && y < GROUND) {
          best = y - runStart;
          gapTop = runStart;
          gapBottom = y;
        }
        runStart = -1;
      }
    }
  }
  return { birdY, pipeX, gapTop, gapBottom };
}

/** Flap when the bird is below a point a little under the middle of the next gap (at most one flap per 200 ms). */
function flappyDriver(): Driver {
  let canvas: { x: number; y: number } | null = null;
  let lastFlap = 0;
  const sight = new Sight();
  return {
    note: "flaps through the gaps (reads the canvas)",
    begin: async () => {
      canvas = null;
    },
    step: async ({ page, finger }) => {
      const plan = await page.evaluate(flappyPlan).catch(() => null);
      sight.note(plan !== null && plan.birdY !== null);
      if (plan && plan.birdY !== null) {
        const gap = plan.gapTop !== null && plan.gapBottom !== null && plan.pipeX < 300;
        const target = gap ? (plan.gapTop! + plan.gapBottom!) / 2 + 22 : 230;
        if (plan.birdY > target && Date.now() - lastFlap > 200) {
          canvas ??= await finger.center(page.getByTestId("flappy-canvas"));
          await finger.tapAt(canvas.x, canvas.y);
          lastFlap = Date.now();
        }
      }
      await page.waitForTimeout(25);
    },
    seen: () => sight.text("the bird"),
  };
}

// ---------------------------------------------------------------- Endless Runner

/**
 * In the page: the obstacles at or ahead of the runner, in canvas px
 * (800 x 400; the runner stands at x 80-120, the grass at y 340-350:
 * endless-runner/lib/constants.ts and lib/geometry.ts). One read of
 * x 70-519, y 200-349. A crate is red (#DC2626), a bar is purple
 * (#7C3AED); the runner (Speedy Sam, orange, the character of a new
 * player) is neither. `ground` is true when the grass shows (the bot can
 * see the game).
 */
export function runnerPlan(): { ground: boolean; obstacles: Array<{ left: number; right: number; top: number; bottom: number }> } | null {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="runner-viewport"] canvas');
  const ctx = canvas?.getContext("2d");
  if (!ctx) return null;
  const X0 = 70;
  const W = 450;
  const Y0 = 200;
  const H = 150;
  const d = ctx.getImageData(X0, Y0, W, H).data;
  const at = (x: number, y: number) => ((y - Y0) * W + (x - X0)) * 4;
  const red = (i: number) => d[i] > 170 && d[i + 1] < 90 && d[i + 2] < 90;
  const purple = (i: number) => d[i + 2] > 170 && d[i] > 70 && d[i] < 180 && d[i + 1] < 110;
  let grass = 0;
  for (let x = X0; x < X0 + W; x += 5) {
    const i = at(x, 345);
    if (d[i + 1] > 110 && d[i] < 80 && d[i + 2] < 80) grass++;
  }
  // Runs of columns with obstacle paint; a gap of more than 3 columns ends a run.
  const obstacles: Array<{ left: number; right: number; top: number; bottom: number }> = [];
  let open: { left: number; right: number; top: number; bottom: number } | null = null;
  for (let x = X0; x < X0 + W; x++) {
    let top = -1;
    let bottom = -1;
    for (let y = Y0; y < 336; y++) {
      const i = at(x, y);
      if (red(i) || purple(i)) {
        if (top < 0) top = y;
        bottom = y;
      }
    }
    if (top >= 0) {
      if (open && x - open.right <= 3) {
        open.right = x;
        open.top = Math.min(open.top, top);
        open.bottom = Math.max(open.bottom, bottom);
      } else {
        open = { left: x, right: x, top, bottom };
        obstacles.push(open);
      }
    }
  }
  return { ground: grass > W / 10, obstacles };
}

/**
 * Ducks while an obstacle that floats (its bottom above y 320: a purple
 * bar, read bottom 309 at y 280-310) is within 200 px of the runner or over
 * it, and jumps an obstacle that stands on the ground line (a crate at
 * y 300-340, read bottom 335 because the read stops at y 335). A crate on
 * the ground is jumped when its
 * left edge is 152-222 px into the canvas: a jump (-15 px/frame, gravity
 * 0.8) clears a 40 px crate from about 30 to 110 px in front of the runner
 * at every speed (5-12 px/frame), and the window leaves room for the time
 * a read takes. The bot reads where an obstacle is, the way a kid sees
 * it, so it also plays a build where the crates still float (before
 * #65pr they were drawn at y 240-280, read bottom 279, and it ducks them).
 * Two obstacles can come close together, so the bot keeps the duck while
 * any floating obstacle is in reach.
 */
function runnerDriver(): Driver {
  let ducks = 0;
  let jumps = 0;
  const sight = new Sight();
  return {
    note: "ducks under what floats, jumps what stands on the ground (reads the canvas)",
    step: async ({ page, finger }) => {
      const plan = await page.evaluate(runnerPlan).catch(() => null);
      sight.note(!!plan?.ground);
      const obstacles = plan?.obstacles ?? [];
      const duck = obstacles.some((o) => o.bottom < 320 && o.left <= 325 && o.right >= 76);
      if (duck && !finger.holding) {
        await finger.hold(page.getByTestId("runner-duck")).catch(() => undefined);
        ducks++;
      } else if (!duck && finger.holding) {
        await finger.release();
      }
      const crate = obstacles.find((o) => o.bottom >= 320 && o.right >= 76);
      if (crate && crate.left >= 152 && crate.left <= 222) {
        await finger.tap(page.getByTestId("runner-jump")).catch(() => undefined);
        jumps++;
        await page.waitForTimeout(150);
      }
      await page.waitForTimeout(20);
    },
    seen: () => `${sight.text("the ground")}; ducked ${ducks} time(s), jumped ${jumps} time(s)`,
  };
}

// ---------------------------------------------------------------- Hill Climb

/**
 * How long the distance readout may stay the same before the kid rocks the
 * truck back. A stuck truck's picture stands still (its spinning spokes,
 * #666 on the wheel, differ by less than the motion rows' 64 luma steps),
 * so this must be well under the check's still limit (STILL_LIMIT_SEC,
 * 2 s, in games.spec.ts), with room for a step (150 ms) and a read. At
 * 2.5 s a stuck truck stood still for 2.3 s in a clip (2026-10-02).
 */
const STUCK_MS = 1_200;

/**
 * Holds the gas. When the distance readout stays the same for STUCK_MS
 * (the truck is stuck in a dip), it holds the brake for 0.7 s, then the
 * gas again: the truck rocks back and gets a run at the slope, so the clip
 * shows driving, not a parked truck with spinning wheels. The readout
 * changing either way counts as moving: a truck that rolls back after a
 * rock is moving too.
 */
function hillClimbDriver(): Driver {
  let last = Number.NaN;
  let changedAt = 0;
  /** When the drive started (the first begin), and the seconds of play at each rock back, for the report. */
  let startedAt = 0;
  const rocks: number[] = [];
  const gas = (page: Page) => page.getByTestId("hill-climb-gas-chip");
  return {
    note: "holds the gas, rocks back on the brake when the truck stops; Pause opens the clip",
    begin: async ({ page, finger }) => {
      last = Number.NaN;
      changedAt = Date.now();
      startedAt ||= changedAt;
      await finger.hold(gas(page));
    },
    step: async ({ page, finger }) => {
      const distance = number(await page.getByTestId("hill-climb-distance").textContent({ timeout: 500 }).catch(() => null));
      if (Number.isFinite(distance) && distance !== last) {
        last = distance;
        changedAt = Date.now();
      } else if (Date.now() - changedAt > STUCK_MS) {
        rocks.push((Date.now() - startedAt) / 1000);
        await finger.hold(page.getByTestId("hill-climb-brake-chip")).catch(() => undefined);
        await page.waitForTimeout(700);
        await finger.hold(gas(page)).catch(() => undefined);
        changedAt = Date.now();
      }
      await page.waitForTimeout(150);
    },
    // A drive ends only at a crash or an empty tank. The pause sheet is a break too.
    toBreak: async ({ page, finger }) => {
      await finger.release();
      await finger.tap(page.getByRole("button", { name: "Pause game" }));
    },
    seen: () => `the truck stopped and rocked back ${rocks.length} time(s)${rocks.length ? ` (at ${rocks.map((t) => t.toFixed(1)).join(", ")} s of play)` : ""}`,
  };
}

// ---------------------------------------------------------------- the drivers


/** A fresh driver for each test (some keep state between steps). */
const DRIVERS: Record<string, () => Driver> = {
  arkanoid: () => ({ note: "launches the ball", step: launchBall('[data-testid="arkanoid-root"]', "arkanoid-launch-hint") }),
  asteroids: () => ({ note: "fires every 1.5 s", step: tapEvery((page) => page.getByRole("button", { name: "Fire" }), 1500) }),
  // Easy: the plane flies longest before it hits a building. A tap on the field drops a bomb (a "drop" sound).
  "blitz-bomber": () => ({
    note: "Easy; drops a bomb every second",
    start: startBy(/Easy/),
    step: tapEvery((page) => page.getByTestId("blitz-bomber-field"), 1000),
  }),
  // One step right, then one step left, from the start corner (the spawn's safe zone is always open):
  // each step is a "step" sound. A d-pad key moves the player while it is held, so the press is 150 ms.
  bomberman: () => {
    let last = 0;
    let right = true;
    return {
      note: "steps right and left in the start corner every 1.5 s",
      step: async ({ page, finger }) => {
        if (Date.now() - last >= 1500) {
          last = Date.now();
          const key = page.locator(`[data-testid="bomberman-dpad"] [data-dir="${right ? "RIGHT" : "LEFT"}"]`);
          right = !right;
          const at = await finger.center(key).catch(() => null);
          if (at) await finger.holdAt(at.x, at.y, 150);
        }
        await page.waitForTimeout(100);
      },
    };
  },
  breakout: () => ({ note: "launches the ball", step: launchBall('[data-testid="breakout-root"]', "breakout-launch-hint") }),
  "dino-runner": dinoDriver,
  "endless-runner": runnerDriver,
  "flappy-bird": flappyDriver,
  // A spin is a "rotate" sound, and it spreads the blocks over the sides.
  hextris: () => ({ note: "spins right every 1.5 s", step: tapEvery((page) => page.getByTestId("hextris-spin-right"), 1500) }),
  "hill-climb": hillClimbDriver,
  // A typed answer that matches no bubble is a "wrong" sound; it costs no life.
  "math-attack": () => {
    let last = 0;
    return {
      note: "types 1 and sends it every 1.5 s",
      step: async ({ page, finger }) => {
        if (Date.now() - last >= 1500) {
          last = Date.now();
          const pad = page.getByTestId("math-attack-pad");
          await finger.tap(pad.locator('[data-key="1"]')).catch(() => undefined);
          await finger.tap(pad.locator('[data-key="⚡"]')).catch(() => undefined);
        }
        await page.waitForTimeout(100);
      },
    };
  },
  // Level 1 has no pits. Short steps right, so the hero moves and the flag is still far.
  platformer: () => {
    let last = 0;
    return {
      note: "Level 1; short steps right",
      start: startBy(/Level 1:/),
      step: async ({ page, finger }) => {
        if (Date.now() - last >= 1500) {
          last = Date.now();
          const at = await finger.center(page.getByTestId("platformer-right")).catch(() => null);
          if (at) await finger.holdAt(at.x, at.y, 300);
        }
        await page.waitForTimeout(100);
      },
    };
  },
  // 8 years old: the aliens shoot least, so the kid lives long.
  "space-invaders": () => ({
    note: "8 years old; fires every 1.5 s",
    start: startBy(/8 years old/),
    step: tapEvery((page) => page.locator('[data-testid="space-invaders-pad-fire"] button').first(), 1500),
  }),
};

/** True when CLIPS_E2E_IDLE=1: the kid taps Play and then does nothing. */
export const IDLE = process.env.CLIPS_E2E_IDLE === "1";

/**
 * The driver for a game. CLIPS_E2E_IDLE=1 gives every game a kid who taps
 * Play (with the game's own start words) and then does nothing: a runner
 * dies at once, so that run tests Play again, the result chip's clip
 * button, and the clip button at the break. The idle kid keeps the game's
 * way to its break (toBreak): Hill Climb's drive never ends by itself, so
 * the kid taps Pause to open the clip, the same as in a played run.
 */
export function hasDriverFor(id: string): boolean { return Boolean(DRIVERS[id] ?? ADDITIONAL_DRIVERS[id]); }

export function driverFor(id: string): Driver {
  const factory = DRIVERS[id] ?? ADDITIONAL_DRIVERS[id];
  if (!factory) throw new Error(`No real-play clip driver for ${id}`);
  const driver = factory();
  if (IDLE) {
    return {
      note: `idle (CLIPS_E2E_IDLE=1): taps Play, then nothing${driver.toBreak ? "; goes to the break the way the driver does" : ""}`,
      start: driver.start,
      toBreak: driver.toBreak,
      idleSkipsStep: driver.step !== undefined,
    };
  }
  return driver;
}
