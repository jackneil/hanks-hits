// Endless Runner - where things are, and how the jump moves.
//
// The single source of truth for the shapes in the world. The store tests
// collisions with these boxes and Game.tsx draws from the same numbers, so
// the picture and the rules can never disagree again (they did: the crate
// was drawn and tested 40 px above the runner's feet, so ducking passed
// under every crate; and coins passed through the drawn head uncollected).

import {
  CANVAS_WIDTH,
  COIN,
  FLOOR_Y,
  MAX_STEPS_PER_UPDATE,
  OBSTACLE,
  PHYSICS,
  PLAYER,
  RUNNER_ART,
  SPEED,
  type CoinType,
  type Obstacle,
  type Player,
} from "./constants";

/** An axis-aligned box in canvas pixels (y grows down). */
export type Rect = { left: number; right: number; top: number; bottom: number };

/** True when two boxes share some area (touching edges do not count). */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
}

/**
 * An obstacle's box, with its exact size. The picture draws `width` and
 * `height` (the obstacle's own whole numbers: right - left can be off by a
 * float rounding, which once drew a fifth stripe past a purple bar).
 */
export type ObstacleBox = Rect & { width: number; height: number };

/**
 * The box of an obstacle, drawn and collided alike. A ground crate stands on
 * the floor (jump over it); an air bar hangs at OBSTACLE.AIR_Y (duck under it).
 */
export function obstacleRect(obs: Pick<Obstacle, "x" | "type" | "width" | "height">): ObstacleBox {
  const top = obs.type === "ground" ? FLOOR_Y - obs.height : OBSTACLE.AIR_Y;
  return { left: obs.x, right: obs.x + obs.width, top, bottom: top + obs.height, width: obs.width, height: obs.height };
}

/** The runner's height for the pose (shorter while ducking). */
export function runnerHeight(player: Pick<Player, "isDucking">): number {
  return player.isDucking ? PHYSICS.DUCK_HEIGHT : PLAYER.HEIGHT;
}

/**
 * Everything the runner's drawing covers, for the pose (RUNNER_ART): the
 * hair to the feet and arm to arm, or the low slide with the head in front.
 * Game.tsx draws inside exactly this box (drawing.test.tsx checks it).
 */
export function runnerSilhouette(player: Pick<Player, "y" | "isDucking">): Rect {
  const a = RUNNER_ART;
  if (player.isDucking) {
    return {
      left: PLAYER.X - PLAYER.WIDTH / 2,
      right: PLAYER.X + Math.max(PLAYER.WIDTH / 2, a.DUCK_HEAD_X + a.DUCK_HEAD_R),
      top: player.y + Math.min(-a.DUCK_BODY_HEIGHT, a.DUCK_HEAD_Y - a.DUCK_HEAD_R),
      bottom: player.y,
    };
  }
  return {
    left: PLAYER.X - a.ARM_REACH,
    right: PLAYER.X + a.ARM_REACH,
    top: player.y + Math.min(a.HAIR_Y - a.HAIR_R, a.HEAD_Y - a.HEAD_R),
    bottom: player.y,
  };
}

/**
 * The box that collects coins: the whole drawn runner, so any coin a kid
 * sees touch the runner counts (generous, like the hitbox is forgiving).
 */
export function runnerCoinBox(player: Pick<Player, "y" | "isDucking">): Rect {
  return runnerSilhouette(player);
}

/**
 * The forgiving box that obstacles hit: the PLAYER box for the pose
 * (PLAYER.WIDTH by runnerHeight, feet on player.y), HITBOX_PADDING off
 * every side. It is smaller than the drawing on purpose.
 */
export function runnerHitbox(player: Pick<Player, "y" | "isDucking">): Rect {
  const pad = PLAYER.HITBOX_PADDING;
  return {
    left: PLAYER.X - PLAYER.WIDTH / 2 + pad,
    right: PLAYER.X + PLAYER.WIDTH / 2 - pad,
    top: player.y - runnerHeight(player) + pad,
    bottom: player.y - pad,
  };
}

/** The box of a coin. */
export function coinRect(coin: Pick<CoinType, "x" | "y">): Rect {
  const half = COIN.SIZE / 2;
  return { left: coin.x - half, right: coin.x + half, top: coin.y - half, bottom: coin.y + half };
}

/**
 * One update step of a jump (the store's integrator). `step` is the
 * normalized delta: 1 is one STEP_MS of game time.
 */
export function stepJump(y: number, velocity: number, step: number): { y: number; velocity: number; landed: boolean } {
  let v = Math.min(velocity + PHYSICS.GRAVITY * step, PHYSICS.MAX_FALL_SPEED);
  let newY = y + v * step;
  if (newY >= PLAYER.GROUND_Y) {
    newY = PLAYER.GROUND_Y;
    v = 0;
    return { y: newY, velocity: v, landed: true };
  }
  return { y: newY, velocity: v, landed: false };
}

/**
 * The height of the runner's feet above the floor after each step of one
 * jump, until it lands (the last entry is 0, the landing step).
 */
export function jumpArc(): number[] {
  const heights: number[] = [];
  let y: number = PLAYER.GROUND_Y;
  let velocity: number = PHYSICS.JUMP_VELOCITY;
  for (let i = 0; i < 1000; i++) {
    const next = stepJump(y, velocity, 1);
    y = next.y;
    velocity = next.velocity;
    heights.push(PLAYER.GROUND_Y - y);
    if (next.landed) break;
  }
  return heights;
}

/** Steps from the jump to the landing (37 with today's PHYSICS). */
export const JUMP_AIRTIME_STEPS = jumpArc().length;

/** The least clear road between two obstacles, in steps: one jump plus time to react. */
export const MIN_GAP_STEPS = JUMP_AIRTIME_STEPS + OBSTACLE.REACTION_STEPS;

/**
 * New obstacles enter here, past the right edge of the world by their
 * coins' lead, a coin's half width and the most one update can scroll: the
 * coins that come with an obstacle slide in from the edge and never appear
 * in the middle of the picture (at CANVAS_WIDTH + 50 they did).
 */
export const SPAWN_X = CANVAS_WIDTH + COIN.LEAD + COIN.SIZE / 2 + SPEED.MAX * MAX_STEPS_PER_UPDATE;

/**
 * The clear road, in pixels, to leave behind an obstacle spawned at `speed`.
 * `roll` is a random number in [0, 1). The speed still rises while that road
 * scrolls past, so the pixels are counted at the fastest speed it can reach
 * in that time: the road never passes in fewer steps than planned.
 */
export function gapAfter(speed: number, roll: number): number {
  const steps = MIN_GAP_STEPS + roll * OBSTACLE.EXTRA_GAP_STEPS;
  const fastest = Math.min(SPEED.MAX, speed + SPEED.INCREASE_RATE * steps);
  return steps * fastest;
}
