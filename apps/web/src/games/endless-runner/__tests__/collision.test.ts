/**
 * The rules of the run, played through the store: JUMP over the red crates,
 * DUCK under the purple bars. Regression (prod clips harness, 2026-10-01):
 * the crates were 40 px above the runner's feet, so holding DUCK passed under
 * every crate and a run could never be lost.
 *
 * This file uses only the store and the constants, with its own jump
 * integrator as an independent check of the physics.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  STEP_MS,
  type CoinType,
  type Obstacle,
} from "../lib/constants";
import { useEndlessRunnerStore } from "../lib/store";

/** One update of STEP_MS is exactly one step of game time (normalized delta 1). */
const store = () => useEndlessRunnerStore.getState();

/** The runner's forgiving hitbox edges on x. */
const HIT_LEFT = PLAYER.X - PLAYER.WIDTH / 2 + PLAYER.HITBOX_PADDING;
const HIT_RIGHT = PLAYER.X + PLAYER.WIDTH / 2 - PLAYER.HITBOX_PADDING;

/** The jump arc from PHYSICS with a separate integrator: feet height after each step. */
function arc(): number[] {
  const heights: number[] = [];
  let h = 0;
  let v: number = PHYSICS.JUMP_VELOCITY;
  for (;;) {
    v = Math.min(v + PHYSICS.GRAVITY, PHYSICS.MAX_FALL_SPEED);
    h -= v;
    if (h <= 0) {
      heights.push(0);
      return heights;
    }
    heights.push(h);
  }
}
const ARC = arc();
const CLEAR = ARC.map((h, i) => (h >= OBSTACLE.GROUND_HEIGHT - PLAYER.HITBOX_PADDING ? i + 1 : 0)).filter(Boolean);
const FIRST_CLEAR = CLEAR[0];
const LAST_CLEAR = CLEAR[CLEAR.length - 1];

const crate = (x: number, id = 1): Obstacle => ({ x, type: "ground", width: OBSTACLE.GROUND_WIDTH, height: OBSTACLE.GROUND_HEIGHT, id });
const bar = (x: number, id = 1): Obstacle => ({ x, type: "air", width: OBSTACLE.AIR_WIDTH, height: OBSTACLE.AIR_HEIGHT, id });

/** A fresh run with exactly these obstacles and no new ones for a while. */
function begin(obstacles: Obstacle[], speed: number = SPEED.INITIAL) {
  store().reset();
  store().startGame();
  useEndlessRunnerStore.setState({ obstacles, coins: [], currentSpeed: speed, nextObstacleX: 1e9 });
}

function step() {
  store().update(STEP_MS);
}

/** Step until the first obstacle is behind the runner or the run ends. */
function runPast(id = 1) {
  for (let i = 0; i < 400; i++) {
    if (store().gameState !== "playing") return;
    const obs = store().obstacles.find((o) => o.id === id);
    if (!obs || obs.x + obs.width < HIT_LEFT) return;
    step();
  }
  throw new Error("the obstacle never passed");
}

/** Step until the obstacle's front is `steps` steps of travel from the hitbox's front. */
function runUntilStepsAway(steps: number, id = 1) {
  for (let i = 0; i < 400; i++) {
    const obs = store().obstacles.find((o) => o.id === id)!;
    if (obs.x - HIT_RIGHT <= store().currentSpeed * steps) return;
    step();
  }
  throw new Error("the obstacle never came");
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  store().reset();
});

describe("red crates: jump over them", () => {
  it("holding DUCK into a crate ends the run", () => {
    begin([crate(200)]);
    store().startDuck();
    runPast();
    expect(store().gameState).toBe("gameOver");
  });

  it("standing still into a crate ends the run", () => {
    begin([crate(200)]);
    runPast();
    expect(store().gameState).toBe("gameOver");
  });

  for (const speed of [SPEED.INITIAL, 8, SPEED.MAX]) {
    it(`a jump at the right time clears a crate at speed ${speed}`, () => {
      begin([crate(400)], speed);
      // Take off so the crate's time over the runner sits in the middle of
      // the steps the feet are above it.
      const overSteps = (OBSTACLE.GROUND_WIDTH + (HIT_RIGHT - HIT_LEFT)) / speed;
      runUntilStepsAway((FIRST_CLEAR + LAST_CLEAR) / 2 - overSteps / 2);
      store().jump();
      runPast();
      expect(store().gameState).toBe("playing");
    });
  }

  it("a low jump clears it: about 40 px up is over a 40 px crate", () => {
    // The crate reaches the hitbox on the first step the feet are above
    // GROUND_HEIGHT less the padding (step 3, 40 px up). That clears it only when
    // the crate stands on the floor.
    begin([crate(HIT_RIGHT + SPEED.MAX * (FIRST_CLEAR - 0.5))], SPEED.MAX);
    store().jump();
    runPast();
    expect(store().gameState).toBe("playing");
  });

  it("the picture's crate edge is the rule's edge: 1 px over survives, 1 px into it ends the run", () => {
    const crateTop = PLAYER.GROUND_Y - OBSTACLE.GROUND_HEIGHT;
    // Hold the runner in the air with no physics (isJumping false), the crate under it.
    const hover = (hitboxBottom: number) => {
      begin([crate(PLAYER.X - 20)]);
      useEndlessRunnerStore.setState({
        player: { y: hitboxBottom + PLAYER.HITBOX_PADDING, velocity: 0, isJumping: false, isDucking: false },
      });
      step();
      return store().gameState;
    };
    expect(hover(crateTop - 1)).toBe("playing");
    expect(hover(crateTop + 1)).toBe("gameOver");
  });

  it("the crate stands on the drawn grass", () => {
    expect(PLAYER.GROUND_Y).toBe(CANVAS_HEIGHT - GROUND.HEIGHT);
  });
});

describe("purple bars: duck under them", () => {
  it("ducking under a bar survives", () => {
    begin([bar(200)]);
    store().startDuck();
    runPast();
    expect(store().gameState).toBe("playing");
  });

  it("standing into a bar ends the run", () => {
    begin([bar(200)]);
    runPast();
    expect(store().gameState).toBe("gameOver");
  });
});

/** Step until the runner lands. */
function land() {
  for (let i = 0; i < 100 && store().player.isJumping; i++) step();
  expect(store().player.isJumping, "the runner landed").toBe(false);
}

describe("DUCK is a hold", () => {
  // A touch hold fires once on the press, so a DUCK pressed in the air was
  // lost: the kid kept the thumb down, landed standing and hit the bar.
  it("DUCK pressed in the air and held ducks on landing, under the next bar", () => {
    begin([]);
    store().jump();
    for (let i = 0; i < 20; i++) step();
    store().startDuck();
    expect(store().player.isJumping).toBe(true);
    expect(store().player.isDucking, "no duck in the air").toBe(false);
    land();
    expect(store().player.isDucking, "ducked on landing").toBe(true);
    useEndlessRunnerStore.setState({ obstacles: [bar(HIT_RIGHT + 30)] });
    runPast();
    expect(store().gameState).toBe("playing");
  });

  it("DUCK let go in the air lands standing", () => {
    begin([]);
    store().jump();
    store().startDuck();
    store().stopDuck();
    land();
    expect(store().player.isDucking).toBe(false);
  });

  it("holding DUCK, a tap on JUMP jumps the crate and lands ducked again", () => {
    begin([crate(400)]);
    store().startDuck();
    const overSteps = (OBSTACLE.GROUND_WIDTH + (HIT_RIGHT - HIT_LEFT)) / SPEED.INITIAL;
    runUntilStepsAway((FIRST_CLEAR + LAST_CLEAR) / 2 - overSteps / 2);
    store().jump();
    expect(store().player.isJumping, "the jump works from a duck").toBe(true);
    expect(store().player.isDucking).toBe(false);
    runPast();
    expect(store().gameState).toBe("playing");
    land();
    expect(store().player.isDucking, "still held, so ducked again").toBe(true);
  });
});

const coin = (x: number, y: number, id = 1): CoinType => ({ x, y, collected: false, id });

/** A run with one coin and nothing else, the runner standing, ducking or jumping at `jumpAt` steps. */
function coinRun(y: number, pose: "stand" | "duck" | { jumpWhenStepsAway: number }) {
  begin([]);
  useEndlessRunnerStore.setState({ coins: [coin(400, y)] });
  if (pose === "duck") store().startDuck();
  for (let i = 0; i < 200 && store().coins.length > 0; i++) {
    if (typeof pose === "object" && !store().player.isJumping) {
      const c = store().coins[0];
      if (c.x - PLAYER.X <= store().currentSpeed * pose.jumpWhenStepsAway) store().jump();
    }
    step();
  }
  expect(store().gameState).toBe("playing");
  return store().coinsThisRun;
}

describe("coins: what touches the drawn runner is collected", () => {
  it("a coin through the drawn head counts (the head used to be over the coin box)", () => {
    // Centre 70 px up: inside the drawn head (53 to 81 px up).
    expect(coinRun(FLOOR_Y - 70, "stand")).toBe(COIN.VALUE);
  });

  it("LOW coins: running or ducking collects them", () => {
    expect(coinRun(COIN.LOW_Y, "stand")).toBe(COIN.VALUE);
    expect(coinRun(COIN.LOW_Y, "duck")).toBe(COIN.VALUE);
  });

  it("MID coins pass just over a standing runner, and a hop collects them", () => {
    expect(coinRun(COIN.MID_Y, "stand")).toBe(0);
    // A jump started when the coin is 3 steps away: it is over the runner
    // early in the jump.
    expect(coinRun(COIN.MID_Y, { jumpWhenStepsAway: 3 })).toBe(COIN.VALUE);
  });

  it("HIGH coins need a real jump", () => {
    expect(coinRun(COIN.HIGH_Y, "stand")).toBe(0);
    expect(coinRun(COIN.HIGH_Y, { jumpWhenStepsAway: 15 })).toBe(COIN.VALUE);
  });
});

describe("coins slide in from the edge", () => {
  it("every new obstacle's coins start past the right edge of the world, at any speed and frame length", () => {
    for (const speed of [SPEED.INITIAL, SPEED.MAX]) {
      for (const ms of [STEP_MS / 2, STEP_MS, STEP_MS * MAX_STEPS_PER_UPDATE, 1000]) {
        // Coins every time (Math.random below SPAWN_CHANCE), any pattern.
        let r = 0;
        vi.spyOn(Math, "random").mockImplementation(() => [0.1, 0.3, 0.5, 0.7, 0.9][r++ % 5] * COIN.SPAWN_CHANCE);
        store().reset();
        store().startGame();
        const firstLeft = Math.min(...store().coins.map((c) => c.x - COIN.SIZE / 2));
        expect(firstLeft, "the first obstacle's coins").toBeGreaterThanOrEqual(CANVAS_WIDTH);
        const seen = new Set(store().coins.map((c) => c.id));
        let fresh = 0;
        for (let i = 0; i < 3000 && fresh < 20; i++) {
          useEndlessRunnerStore.setState({
            currentSpeed: speed,
            player: { y: -10_000, velocity: 0, isJumping: false, isDucking: false },
          });
          store().update(ms);
          for (const c of store().coins) {
            if (seen.has(c.id)) continue;
            seen.add(c.id);
            fresh++;
            expect(c.x - COIN.SIZE / 2, `coin ${c.id} at speed ${speed}, ${ms} ms`).toBeGreaterThanOrEqual(CANVAS_WIDTH);
          }
        }
        expect(fresh, `new coins at speed ${speed}, ${ms} ms`).toBeGreaterThanOrEqual(20);
        vi.restoreAllMocks();
      }
    }
  });
});

/** A seeded random (mulberry32), so a failing run can be replayed. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("the course is fair", () => {
  it("leaves at least one jump plus a third of a second of clear road behind every obstacle, at every speed", () => {
    const leastSteps = ARC.length + 20;
    for (const speed of [SPEED.INITIAL, 8, SPEED.MAX]) {
      vi.spyOn(Math, "random").mockImplementation(seeded(speed * 101));
      begin([]);
      useEndlessRunnerStore.setState({ currentSpeed: speed, nextObstacleX: 850 });
      // A runner far above the course, with no physics, never hits anything,
      // so the course can be watched for a long time.
      const seen = new Map<number, { front: number; width: number }>();
      const perStep = Math.min(speed + SPEED.INCREASE_RATE, SPEED.MAX);
      let scrolled = 0;
      for (let i = 0; i < 4000; i++) {
        useEndlessRunnerStore.setState({
          currentSpeed: speed,
          player: { y: -10_000, velocity: 0, isJumping: false, isDucking: false },
        });
        step();
        expect(store().gameState).toBe("playing");
        // Every obstacle moves by the same scroll, so screen x + the scroll
        // so far is a fixed world x.
        scrolled += perStep;
        for (const o of store().obstacles) {
          if (!seen.has(o.id)) seen.set(o.id, { front: o.x + scrolled, width: o.width });
        }
      }
      const ids = [...seen.keys()].sort((a, b) => a - b);
      expect(ids.length, `obstacles seen at speed ${speed}`).toBeGreaterThan(10);
      for (let k = 1; k < ids.length; k++) {
        const prev = seen.get(ids[k - 1])!;
        const road = seen.get(ids[k])!.front - (prev.front + prev.width);
        expect(road / perStep, `clear road after obstacle ${ids[k - 1]} at speed ${speed}`).toBeGreaterThanOrEqual(leastSteps);
      }
      vi.restoreAllMocks();
    }
  });

  it("a kid who jumps the crates and ducks the bars runs on to top speed", () => {
    for (const seed of [1, 2, 3]) {
      vi.spyOn(Math, "random").mockImplementation(seeded(seed));
      store().reset();
      store().startGame();
      for (let i = 0; i < 8000 && store().gameState === "playing"; i++) {
        const s = store();
        const speed = s.currentSpeed;
        const ahead = s.obstacles.filter((o) => o.x + o.width >= HIT_LEFT).sort((a, b) => a.x - b.x)[0];
        if (!ahead) {
          if (s.player.isDucking) s.stopDuck();
        } else if (ahead.type === "ground") {
          if (s.player.isDucking) s.stopDuck();
          const overSteps = (ahead.width + (HIT_RIGHT - HIT_LEFT)) / speed;
          const lead = (FIRST_CLEAR + LAST_CLEAR) / 2 - overSteps / 2;
          if (!s.player.isJumping && ahead.x - HIT_RIGHT <= speed * lead) store().jump();
        } else if (ahead.x - HIT_RIGHT <= speed * 6 && !s.player.isJumping) {
          s.startDuck();
        }
        step();
      }
      expect(store().gameState, `seed ${seed}`).toBe("playing");
      expect(store().currentSpeed, `seed ${seed}`).toBe(SPEED.MAX);
      vi.restoreAllMocks();
    }
  });
});
