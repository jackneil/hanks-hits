/**
 * One physics step for one ball, pure so a test can drive it.
 *
 * Why the swept paddle check: a ball at the speed cap moves 2.5 / 60 =
 * 0.042 of the field per frame, more than the paddle is thick, so the old
 * "is the ball inside the paddle now?" test missed fast balls and a hit
 * felt random (phone UX audit 2026-09-29). The step now asks "did the
 * ball's bottom cross the paddle's top edge during this frame, over the
 * paddle?", so no speed passes through.
 *
 * Why the arena: a ball that got outside the frame (a new ball placed past
 * the top wall when it split, or a long frame that carried a fast ball
 * through a wall) bounced on the outside of the top wall for ever, so the
 * run could never end and the score climbed with no play (phone check
 * 2026-09-30: 150 balls, most of them above the frame). Each frame is now
 * cut into short sub-steps, and every sub-step ends with the ball inside
 * the arena.
 */

import { ARENA, BALL_CONFIG, getSpawnedBallType, PADDLE, PHYSICS, SPARKS_PER_TOUCH, WALLS } from "./constants";
import type { Ball } from "./store";

export interface StepResult {
  ball: Ball;
  /** The ball hit a wall this step (a chance to split). */
  hitWall: boolean;
  /** The ball bounced off the paddle this step. */
  hitPaddle: boolean;
}

export function stepBall(ball: Ball, paddleX: number, dt: number): StepResult {
  const steps = Math.max(1, Math.ceil(dt / PHYSICS.maxSubStep));
  let current = ball;
  let hitWall = false;
  let hitPaddle = false;
  for (let i = 0; i < steps; i++) {
    const step = subStep(current, paddleX, dt / steps);
    current = step.ball;
    hitWall ||= step.hitWall;
    hitPaddle ||= step.hitPaddle;
  }
  return { ball: current, hitWall, hitPaddle };
}

/**
 * Puts a ball that is outside the arena back on its inside edge, moving
 * inwards. Returns the same ball when it is already inside.
 */
export function containBall(ball: Ball): { ball: Ball; moved: boolean } {
  const radius = BALL_CONFIG[ball.type].radius;
  let { x, y, vx, vy } = ball;
  let moved = false;
  if (x < ARENA.left + radius) {
    x = ARENA.left + radius;
    vx = Math.abs(vx);
    moved = true;
  } else if (x > ARENA.right - radius) {
    x = ARENA.right - radius;
    vx = -Math.abs(vx);
    moved = true;
  }
  if (y > ARENA.top - radius) {
    y = ARENA.top - radius;
    vy = -Math.abs(vy);
    moved = true;
  }
  return moved ? { ball: { ...ball, x, y, vx, vy }, moved } : { ball, moved };
}

function subStep(ball: Ball, paddleX: number, dt: number): StepResult {
  let { x, y, vx, vy } = ball;
  const radius = BALL_CONFIG[ball.type].radius;
  const prevBottom = y - radius;

  vy -= PHYSICS.gravity * dt;
  x += vx * dt;
  y += vy * dt;

  // Walls (axis-aligned boxes)
  let hitWall = false;
  for (const wall of WALLS) {
    const halfWidth = wall.width / 2;
    const halfHeight = wall.height / 2;
    if (
      x + radius > wall.x - halfWidth &&
      x - radius < wall.x + halfWidth &&
      y + radius > wall.y - halfHeight &&
      y - radius < wall.y + halfHeight
    ) {
      const dx = x - wall.x;
      const dy = y - wall.y;
      if (Math.abs(dx) / halfWidth > Math.abs(dy) / halfHeight) {
        vx = -vx * PHYSICS.wallRestitution;
        x = dx > 0 ? wall.x + halfWidth + radius : wall.x - halfWidth - radius;
      } else {
        vy = -vy * PHYSICS.wallRestitution;
        y = dy > 0 ? wall.y + halfHeight + radius : wall.y - halfHeight - radius;
      }
      hitWall = true;
      break;
    }
  }

  // Paddle: swept on the top edge, so a fast ball never tunnels through.
  const paddleTop = PADDLE.y + PADDLE.height / 2;
  const paddleLeft = paddleX - PADDLE.width / 2;
  const paddleRight = paddleX + PADDLE.width / 2;
  const bottom = y - radius;
  let hitPaddle = false;
  if (vy < 0 && prevBottom >= paddleTop && bottom < paddleTop) {
    // Where the ball was when its bottom reached the paddle's top edge.
    const t = (prevBottom - paddleTop) / Math.max(1e-9, prevBottom - bottom);
    const crossX = ball.x + (x - ball.x) * t;
    if (crossX + radius > paddleLeft && crossX - radius < paddleRight) {
      vy = -vy * PHYSICS.paddleRestitution;
      y = paddleTop + radius;
      x = crossX;
      // The edge of the paddle sends the ball sideways, the middle nearly
      // straight up (never exactly: see PHYSICS.minBounceVx).
      const hitOffset = (crossX - paddleX) / (PADDLE.width / 2);
      vx += hitOffset;
      if (Math.abs(vx) < PHYSICS.minBounceVx) vx = (vx >= 0 ? 1 : -1) * PHYSICS.minBounceVx;
      hitPaddle = true;
    }
  }

  // Speed limits
  const speed = Math.hypot(vx, vy);
  if (speed > PHYSICS.maxVelocity) {
    vx = (vx / speed) * PHYSICS.maxVelocity;
    vy = (vy / speed) * PHYSICS.maxVelocity;
  } else if (speed < PHYSICS.minVelocity && speed > 0) {
    vx = (vx / speed) * PHYSICS.minVelocity;
    vy = (vy / speed) * PHYSICS.minVelocity;
  }

  // A paddle touch gives the ball its splits again.
  const sparks = hitPaddle ? SPARKS_PER_TOUCH : ball.sparks;
  const kept = containBall({ ...ball, x, y, vx, vy, ...(sparks === undefined ? {} : { sparks }) });
  return { ball: kept.ball, hitWall: hitWall || kept.moved, hitPaddle };
}

/**
 * A wall hit: the ball splits when it has a spark left and `roll` is under
 * its type's chance. The new ball starts three radii away at `angle` (put
 * back inside the arena if that is past a wall), and both keep the sparks
 * the parent has left. Returns null when there is no split. Pure: the
 * caller gives the random numbers.
 */
export function splitOnWall(
  ball: Ball,
  roll: number,
  angle: number,
  bonusRoll: number
): { parent: Ball; child: Omit<Ball, "id"> } | null {
  const sparks = ball.sparks ?? 0;
  if (sparks <= 0 || roll >= BALL_CONFIG[ball.type].spawnChance) return null;
  const left = sparks - 1;
  const radius = BALL_CONFIG[ball.type].radius;
  const { ball: born } = containBall({
    id: "",
    type: getSpawnedBallType(ball.type, bonusRoll),
    x: ball.x + Math.cos(angle) * radius * 3,
    y: ball.y + Math.sin(angle) * radius * 3,
    vx: Math.cos(angle) * PHYSICS.spawnSpeed,
    vy: Math.sin(angle) * PHYSICS.spawnSpeed,
  });
  return {
    parent: { ...ball, sparks: left },
    child: { type: born.type, x: born.x, y: born.y, vx: born.vx, vy: born.vy, sparks: left },
  };
}

/** Below this, a ball has left the field. */
export const FALL_OUT_Y = -1.1;

export interface WorldStep {
  /** The balls still in play after the step (the new ones are in `born`). */
  balls: Ball[];
  /** The balls that splits made this step. */
  born: Omit<Ball, "id">[];
  /** A ball bounced off the paddle. */
  hitPaddle: boolean;
}

/**
 * One step of the whole field: moves every ball, splits the ones that hit
 * a wall (while the field has fewer than `maxBalls`), and drops the ones
 * that fell out. The game and the tests run this same function; `random`
 * gives the rolls (Math.random in the game, a seeded one in a test).
 */
export function stepWorld(balls: Ball[], paddleX: number, dt: number, random: () => number, maxBalls: number): WorldStep {
  const kept: Ball[] = [];
  const born: Omit<Ball, "id">[] = [];
  let hitPaddle = false;
  for (const ball of balls) {
    const step = stepBall(ball, paddleX, dt);
    let moved = step.ball;
    hitPaddle ||= step.hitPaddle;
    if (step.hitWall && balls.length + born.length < maxBalls) {
      const split = splitOnWall(moved, random(), random() * Math.PI * 2, random());
      if (split) {
        moved = split.parent;
        born.push(split.child);
      }
    }
    if (moved.y >= FALL_OUT_Y) kept.push(moved);
  }
  return { balls: kept, born, hitPaddle };
}
