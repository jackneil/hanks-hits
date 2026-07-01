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
    radius: 0.02,
  },
  orange: {
    color: "#f97316",
    spawnChance: 0.3, // 30% chance (power ball)
    points: 25,
    radius: 0.025,
  },
  "yellow-dot": {
    color: "#fbbf24",
    spawnChance: 0, // Only spawned as bonus
    points: 50,
    radius: 0.015,
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

// Physics (tuned for seconds-based dt with no tunneling)
// Max velocity must be low enough that ball can't skip over walls (0.05 wide)
export const PHYSICS = {
  gravity: 0.3, // Gentle downward pull (per second)
  restitution: 0.95, // Bounciness
  friction: 0.001, // Very low friction
  wallRestitution: 0.98, // Wall bounciness
  paddleRestitution: 1.05, // Slight boost on paddle hit
  maxVelocity: 2.5, // Speed cap - prevents tunneling through walls
  minVelocity: 0.3, // Minimum speed to prevent stuck balls
};

// Paddle
export const PADDLE = {
  width: 0.2, // 20% of screen width
  height: 0.03,
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
