/**
 * The shapes of the world (lib/geometry.ts): one floor line, crates on it,
 * air bars above a ducking runner, and a jump that clears every crate at
 * every speed the game reaches.
 */
import { describe, expect, it } from "vitest";

import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  COIN,
  FLOOR_Y,
  GROUND,
  MAX_STEPS_PER_UPDATE,
  OBSTACLE,
  PHYSICS,
  PLAYER,
  SPEED,
} from "../lib/constants";
import {
  JUMP_AIRTIME_STEPS,
  MIN_GAP_STEPS,
  SPAWN_X,
  coinRect,
  gapAfter,
  jumpArc,
  obstacleRect,
  overlaps,
  runnerCoinBox,
  runnerHitbox,
  runnerSilhouette,
} from "../lib/geometry";

const crate = (x: number) => ({ x, type: "ground" as const, width: OBSTACLE.GROUND_WIDTH, height: OBSTACLE.GROUND_HEIGHT });
const bar = (x: number) => ({ x, type: "air" as const, width: OBSTACLE.AIR_WIDTH, height: OBSTACLE.AIR_HEIGHT });
const standing = { y: PLAYER.GROUND_Y, isDucking: false };
const ducking = { y: PLAYER.GROUND_Y, isDucking: true };
/** An obstacle right on the runner (its box spans the runner's x). */
const ON_RUNNER = PLAYER.X - 10;

describe("one floor line", () => {
  it("the runner's floor is the top of the drawn grass", () => {
    expect(FLOOR_Y).toBe(CANVAS_HEIGHT - GROUND.HEIGHT);
    expect(PLAYER.GROUND_Y).toBe(FLOOR_Y);
  });

  it("a crate stands on the floor, 40 px tall", () => {
    expect(obstacleRect(crate(300))).toEqual({ left: 300, right: 340, top: FLOOR_Y - 40, bottom: FLOOR_Y, width: 40, height: 40 });
  });

  it("an air bar hangs at AIR_Y, 30 px tall, with its bottom 30 px above the floor", () => {
    expect(obstacleRect(bar(500))).toEqual({
      left: 500,
      right: 560,
      top: OBSTACLE.AIR_Y,
      bottom: OBSTACLE.AIR_Y + 30,
      width: 60,
      height: 30,
    });
    expect(FLOOR_Y - obstacleRect(bar(500)).bottom).toBe(30);
  });
});

describe("an obstacle's size is its own whole number", () => {
  it("is exact where right - left is not (a float x)", () => {
    const x = 467.7500931567046;
    expect(obstacleRect(bar(x)).right - obstacleRect(bar(x)).left).not.toBe(60);
    expect(obstacleRect(bar(x)).width).toBe(60);
    expect(obstacleRect(bar(x)).height).toBe(30);
  });
});

describe("the runner's drawing is the coin box", () => {
  it("standing: the hair 84 px up to the feet, arm to arm", () => {
    expect(runnerSilhouette(standing)).toEqual({ left: PLAYER.X - 25, right: PLAYER.X + 25, top: FLOOR_Y - 84, bottom: FLOOR_Y });
    expect(runnerCoinBox(standing)).toEqual(runnerSilhouette(standing));
  });

  it("ducking: the low slide, 27 px up, the head in front", () => {
    expect(runnerSilhouette(ducking)).toEqual({ left: PLAYER.X - 20, right: PLAYER.X + 24, top: FLOOR_Y - 27, bottom: FLOOR_Y });
    expect(runnerCoinBox(ducking)).toEqual(runnerSilhouette(ducking));
  });

  it("the forgiving obstacle hitbox stays inside the drawing", () => {
    for (const pose of [standing, ducking]) {
      const hit = runnerHitbox(pose);
      const drawn = runnerSilhouette(pose);
      expect(hit.left).toBeGreaterThan(drawn.left);
      expect(hit.right).toBeLessThan(drawn.right);
      expect(hit.top).toBeGreaterThan(drawn.top);
      expect(hit.bottom).toBeLessThan(drawn.bottom);
    }
  });
});

describe("coin heights", () => {
  const at = (y: number) => coinRect({ x: PLAYER.X, y });
  it("LOW coins touch the runner standing and ducking", () => {
    expect(overlaps(runnerCoinBox(standing), at(COIN.LOW_Y))).toBe(true);
    expect(overlaps(runnerCoinBox(ducking), at(COIN.LOW_Y))).toBe(true);
  });

  it("MID coins pass just over the standing runner's hair; a hop of a few px reaches them", () => {
    expect(overlaps(runnerCoinBox(standing), at(COIN.MID_Y))).toBe(false);
    const clearance = runnerCoinBox(standing).top - at(COIN.MID_Y).bottom;
    expect(clearance).toBeGreaterThan(0);
    expect(clearance).toBeLessThanOrEqual(10);
    // The first step of a jump is already high enough.
    expect(overlaps(runnerCoinBox({ y: FLOOR_Y - jumpArc()[0], isDucking: false }), at(COIN.MID_Y))).toBe(true);
  });

  it("HIGH coins need a real jump: well over the head, under the top of the jump", () => {
    expect(overlaps(runnerCoinBox(standing), at(COIN.HIGH_Y))).toBe(false);
    const reach = jumpArc().filter((h) => overlaps(runnerCoinBox({ y: FLOOR_Y - h, isDucking: false }), at(COIN.HIGH_Y)));
    // Over the runner for most of a jump, but not its first steps.
    expect(reach.length).toBeGreaterThanOrEqual(20);
    expect(overlaps(runnerCoinBox({ y: FLOOR_Y - jumpArc()[0], isDucking: false }), at(COIN.HIGH_Y))).toBe(false);
  });

  it("every coin height is on the canvas, under the score line", () => {
    for (const y of [COIN.LOW_Y, COIN.MID_Y, COIN.HIGH_Y]) {
      expect(y - COIN.SIZE / 2).toBeGreaterThan(60);
      expect(y + COIN.SIZE / 2).toBeLessThan(FLOOR_Y);
    }
  });
});

describe("where obstacles enter", () => {
  it("is far enough right that their coins start off the picture after the largest scroll", () => {
    // An obstacle enters at most one update's scroll left of SPAWN_X, and
    // its coins start COIN.LEAD in front of it.
    const worst = SPAWN_X - SPEED.MAX * MAX_STEPS_PER_UPDATE - COIN.LEAD - COIN.SIZE / 2;
    expect(worst).toBeGreaterThanOrEqual(CANVAS_WIDTH);
  });
});

describe("jump crates, duck bars", () => {
  it("a crate hits a standing runner and a ducking runner alike", () => {
    expect(overlaps(runnerHitbox(standing), obstacleRect(crate(ON_RUNNER)))).toBe(true);
    expect(overlaps(runnerHitbox(ducking), obstacleRect(crate(ON_RUNNER)))).toBe(true);
  });

  it("an air bar hits a standing runner and misses a ducking one", () => {
    expect(overlaps(runnerHitbox(standing), obstacleRect(bar(ON_RUNNER)))).toBe(true);
    expect(overlaps(runnerHitbox(ducking), obstacleRect(bar(ON_RUNNER)))).toBe(false);
  });

  it("the forgiving hitbox keeps HITBOX_PADDING on every side", () => {
    const box = runnerHitbox(standing);
    expect(box.right - box.left).toBe(PLAYER.WIDTH - 2 * PLAYER.HITBOX_PADDING);
    expect(box.bottom).toBe(PLAYER.GROUND_Y - PLAYER.HITBOX_PADDING);
    expect(box.top).toBe(PLAYER.GROUND_Y - PLAYER.HEIGHT + PLAYER.HITBOX_PADDING);
  });
});

describe("the jump clears a crate at every speed", () => {
  const arc = jumpArc();
  const apex = Math.max(...arc);
  // Steps in which the hitbox's bottom is above the crate's top (the padding
  // keeps it 8 px above the feet, so the feet need 32 px).
  const clearHeight = OBSTACLE.GROUND_HEIGHT - PLAYER.HITBOX_PADDING;
  const clearSteps = arc.map((h, i) => (h >= clearHeight ? i + 1 : 0)).filter(Boolean);
  const hitboxWidth = PLAYER.WIDTH - 2 * PLAYER.HITBOX_PADDING;

  it("measures today's arc: 37 steps in the air, 133 px high", () => {
    expect(JUMP_AIRTIME_STEPS).toBe(arc.length);
    expect(arc.length).toBe(37);
    expect(apex).toBeCloseTo(133.2, 1);
    expect(arc[arc.length - 1]).toBe(0);
    // Above the crate from step 3 to step 34, with no dip in between.
    expect(clearSteps[0]).toBe(3);
    expect(clearSteps[clearSteps.length - 1]).toBe(34);
    expect(clearSteps).toHaveLength(32);
    expect(PHYSICS.JUMP_VELOCITY).toBe(-15);
  });

  for (const speed of [SPEED.INITIAL, 8, SPEED.MAX]) {
    it(`leaves a take-off window of at least a quarter second at speed ${speed}`, () => {
      // The crate is over the hitbox for this many steps.
      const overSteps = (OBSTACLE.GROUND_WIDTH + hitboxWidth) / speed;
      // Any take-off that puts those steps inside the clear steps works.
      const window = clearSteps.length - 1 - overSteps;
      expect(window).toBeGreaterThanOrEqual(15);
    });
  }
});

describe("the clear road between obstacles", () => {
  it("is one jump plus the reaction time, at least", () => {
    expect(MIN_GAP_STEPS).toBe(JUMP_AIRTIME_STEPS + OBSTACLE.REACTION_STEPS);
    for (const speed of [SPEED.INITIAL, 6, 8, 10, SPEED.MAX]) {
      for (const roll of [0, 0.5, 0.999]) {
        expect(gapAfter(speed, roll) / speed).toBeGreaterThanOrEqual(MIN_GAP_STEPS);
      }
    }
  });

  it("keeps the old 300 to 500 px at the starting speed", () => {
    expect(gapAfter(SPEED.INITIAL, 0)).toBeGreaterThanOrEqual(300);
    expect(gapAfter(SPEED.INITIAL, 0.999)).toBeLessThanOrEqual(520);
  });

  it("is never more road than the speed can cover in the planned steps", () => {
    const steps = MIN_GAP_STEPS + 0.5 * OBSTACLE.EXTRA_GAP_STEPS;
    expect(gapAfter(SPEED.MAX, 0.5)).toBeCloseTo(steps * SPEED.MAX, 6);
  });
});
