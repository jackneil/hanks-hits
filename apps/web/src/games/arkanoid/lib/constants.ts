// Arkanoid Game - Constants

import type { BallType } from "./store";

// Ball configuration
export const BALL_CONFIG: Record<
  BallType,
  {
    color: string;
    spawnChance: number; // Chance to spawn new ball on wall hit
    points: number; // Points awarded when spawned
    radius: number;
  }
> = {
  blue: {
    color: "#3b82f6",
    spawnChance: 0.15, // 15% chance
    points: 10,
    radius: 0.03,
  },
  orange: {
    color: "#f97316",
    spawnChance: 0.3, // 30% chance (power ball)
    points: 25,
    radius: 0.036,
  },
  "yellow-dot": {
    color: "#fbbf24",
    spawnChance: 0, // Only spawned as bonus
    points: 50,
    radius: 0.024,
  },
};

export function getSpawnedBallType(
  parentType: BallType,
  bonusRoll = Math.random()
): BallType {
  if (parentType !== "blue") {
    return parentType;
  }

  if (bonusRoll < 0.03) {
    return "yellow-dot";
  }

  if (bonusRoll < 0.18) {
    return "orange";
  }

  return "blue";
}

// Physics (seconds-based dt). stepBall cuts each frame into sub-steps of at
// most maxSubStep seconds, so no step carries a ball past a 0.05 wall.
export const PHYSICS = {
  gravity: 0.3, // Gentle downward pull (per second)
  restitution: 0.95, // Bounciness
  friction: 0.001, // Very low friction
  wallRestitution: 0.98, // Wall bounciness
  paddleRestitution: 1.05, // Slight boost on paddle hit
  maxVelocity: 2.5, // Speed cap
  minVelocity: 0.3, // Minimum speed to prevent stuck balls
  // At the cap a sub-step moves 2.5 / 120 = 0.021: less than a wall is
  // thick. (A whole 50 ms frame moved 0.125, through a wall and the ball.)
  maxSubStep: 1 / 120,
  // The least sideways speed a paddle bounce gives. A ball that hit the
  // middle of a still paddle went straight up and came straight back down
  // on it for ever: a run that never ended with no one playing.
  minBounceVx: 0.4,
  // The speed of a new ball when a ball splits.
  spawnSpeed: 1.5,
};

/**
 * The splits a ball may cause after the paddle touches it (a launch or a
 * bounce). Each split uses one, and the new ball gets what its parent has
 * left, so one touch can grow into 2^4 = 16 balls at most. Why: new balls
 * used to split with no end, so once about 20 were loose the count stayed
 * at the cap with no one playing, the run never ended, and the score
 * climbed on its own (phone check 2026-09-30: 1,353,815 in 150 s). Now the
 * growth comes from the paddle. A simulation of the real physics: a still
 * or wall-to-wall paddle ends a run in 13 to 50 s; a paddle that follows
 * the balls keeps 75 to 85 of them in play (the 10x multiplier).
 */
export const SPARKS_PER_TOUCH = 4;

// Paddle
// On a phone the old ball was 3.8 px and the paddle 38 x 6.5 px (phone UX
// audit 2026-09-29): both are half again as big now, in a square field.
export const PADDLE = {
  width: 0.3, // 15% of the field's width on each side of its middle
  height: 0.045,
  y: -0.9, // Near bottom of screen
  color: "#eab308", // Yellow
  borderColor: "#dc2626", // Red border
};

// Walls (normalized coordinates -1 to 1)
export const WALLS = [
  // Left wall
  { x: -0.95, y: 0, width: 0.05, height: 2 },
  // Right wall
  { x: 0.95, y: 0, width: 0.05, height: 2 },
  // Top wall
  { x: 0, y: 0.95, width: 2, height: 0.05 },

  // Maze structure (like in the screenshot)
  // Vertical middle barrier
  { x: 0, y: 0.4, width: 0.05, height: 0.6 },
  // L-shaped left barrier
  { x: -0.5, y: 0.4, width: 0.05, height: 0.4 },
  { x: -0.5, y: 0.1, width: 0.3, height: 0.05 },
];

/**
 * The inside of the frame: the inner faces of the side walls and the top
 * wall (the first three WALLS). Every ball stays inside it.
 */
export const ARENA = {
  left: WALLS[0].x + WALLS[0].width / 2,
  right: WALLS[1].x - WALLS[1].width / 2,
  top: WALLS[2].y - WALLS[2].height / 2,
} as const;

/** Balls in play at the start of a run and after each lost life. */
export const START_BALLS = 3;
/** Tries per run: one miss used to end the game in 2 to 5 s. */
export const LIVES = 3;
/** The paddle stays between the side walls. */
export const PADDLE_LIMIT = ARENA.right - PADDLE.width / 2;

// Game settings
export const GAME = {
  maxBalls: 150, // Performance cap
  canvasColor: "#1e293b", // Dark blue background
  gridColor: "#22c55e", // Green grid
  wallColor: "#64748b", // Gray walls

  // Scoring multipliers
  multipliers: {
    2: 10, // 10+ balls = 2x
    5: 20, // 20+ balls = 5x
    10: 50, // 50+ balls = 10x
  },
};

// Grid background pattern
export const GRID = {
  spacing: 0.025, // Grid cell size
  color: "#16a34a", // Green
  alternateColor: "#22c55e", // Lighter green (checkerboard)
};
