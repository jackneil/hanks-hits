/**
 * Dino Runner - Game Constants
 * Chrome dinosaur clone with Canvas API
 */

// ============================================
// CANVAS DIMENSIONS
// ============================================
export const CANVAS_WIDTH = 800;
export const CANVAS_HEIGHT = 300;

// ============================================
// PHYSICS CONSTANTS
// ============================================
export const GRAVITY = 0.6;
export const JUMP_VELOCITY = -12;
/**
 * How much less gravity a held jump feels while the dino rises. A tap gives
 * an apex of JUMP_VELOCITY^2 / (2 * GRAVITY) = 120 px; a held jump gives
 * JUMP_VELOCITY^2 / (2 * (GRAVITY - cut)) = 180 px, so "hold = higher" is
 * true and the dino stays inside the canvas (its head at 33 px from the top).
 */
export const JUMP_HOLD_GRAVITY_CUT = 0.2;
export const GROUND_Y = CANVAS_HEIGHT - 40; // Ground level

// Speed ramping
export const INITIAL_SPEED = 6;
export const MAX_SPEED = 14;
export const SPEED_INCREMENT = 0.001; // Per frame

// ============================================
// DINO CONSTANTS
// ============================================
export const DINO = {
  WIDTH: 44,
  HEIGHT: 47,
  DUCK_HEIGHT: 26,
  X: 50, // Fixed X position
  // Collision box is slightly smaller than visual (forgiving hitboxes)
  HITBOX_PADDING: 6,
};

// ============================================
// OBSTACLE TYPES
// ============================================
export type ObstacleType =
  | "cactus-small"
  | "cactus-large"
  | "cactus-group"
  | "pterodactyl-low"
  | "pterodactyl-high";

export interface Obstacle {
  type: ObstacleType;
  x: number;
  y: number;
  width: number;
  height: number;
  passed: boolean;
}

export const OBSTACLES = {
  CACTUS_SMALL: {
    type: "cactus-small" as ObstacleType,
    width: 17,
    height: 35,
    y: GROUND_Y - 35,
  },
  CACTUS_LARGE: {
    type: "cactus-large" as ObstacleType,
    width: 25,
    height: 50,
    y: GROUND_Y - 50,
  },
  CACTUS_GROUP: {
    type: "cactus-group" as ObstacleType,
    width: 73,
    height: 50,
    y: GROUND_Y - 50,
  },
  PTERODACTYL_LOW: {
    type: "pterodactyl-low" as ObstacleType,
    width: 46,
    height: 40,
    y: GROUND_Y - 60, // At jump height - duck under
  },
  PTERODACTYL_HIGH: {
    type: "pterodactyl-high" as ObstacleType,
    width: 46,
    height: 40,
    y: GROUND_Y - 100, // High - jump or ignore
  },
};

// Spawn config
export const MIN_OBSTACLE_GAP = 300;
export const MAX_OBSTACLE_GAP = 600;
export const PTERODACTYL_SCORE_THRESHOLD = 400; // Pterodactyls appear after this score

// ============================================
// SCORING
// ============================================
export const SCORE_INCREMENT = 0.1; // Score per frame
export const MILESTONE_INTERVAL = 100; // Flash every 100 points
export const DAY_NIGHT_INTERVAL = 700; // Toggle day/night every 700 points

// ============================================
// GROUND TEXTURE
// ============================================
export const GROUND = {
  HEIGHT: 40,
  TEXTURE_WIDTH: 2400,
};

// ============================================
// COLORS - DAY THEME
// ============================================
export const COLORS_DAY = {
  SKY: "#f7f7f7",
  GROUND: "#535353",
  GROUND_TEXTURE: "#4a4a4a",
  DINO: "#535353",
  OBSTACLE: "#535353",
  SCORE: "#535353",
  GAME_OVER: "#535353",
  CLOUD: "#f0f0f0",
};

// ============================================
// COLORS - NIGHT THEME
// ============================================
export const COLORS_NIGHT = {
  SKY: "#1a1a2e",
  GROUND: "#a0a0a0",
  GROUND_TEXTURE: "#909090",
  DINO: "#c0c0c0",
  OBSTACLE: "#c0c0c0",
  SCORE: "#c0c0c0",
  GAME_OVER: "#c0c0c0",
  CLOUD: "#3a3a5e",
};

// ============================================
// UI CONSTANTS
// ============================================
export const UI = {
  SCORE_FONT: "bold 24px 'Courier New', monospace",
  GAME_OVER_FONT: "bold 24px Arial, sans-serif",
  INSTRUCTION_FONT: "18px Arial, sans-serif",
};

// ============================================
// CLOUD CONFIG
// ============================================
export const CLOUD = {
  MIN_Y: 30,
  MAX_Y: 100,
  MIN_WIDTH: 46,
  MAX_WIDTH: 92,
  HEIGHT: 14,
  SPEED_RATIO: 0.3, // Move slower than ground
  MIN_GAP: 200,
  MAX_GAP: 500,
};

export interface CloudData {
  x: number;
  y: number;
  width: number;
}

// ============================================
// GAME STATES
// ============================================
export type GameState = "idle" | "playing" | "game-over";

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Check collision between two rectangles with padding
 */
export function checkCollision(
  dinoX: number,
  dinoY: number,
  dinoWidth: number,
  dinoHeight: number,
  obstacle: Obstacle
): boolean {
  // Apply hitbox padding (forgiving collisions)
  const padding = DINO.HITBOX_PADDING;

  const dinoLeft = dinoX + padding;
  const dinoRight = dinoX + dinoWidth - padding;
  const dinoTop = dinoY + padding;
  const dinoBottom = dinoY + dinoHeight - padding;

  const obsLeft = obstacle.x + 4; // Small padding on obstacles too
  const obsRight = obstacle.x + obstacle.width - 4;
  const obsTop = obstacle.y + 4;
  const obsBottom = obstacle.y + obstacle.height - 4;

  return (
    dinoRight > obsLeft &&
    dinoLeft < obsRight &&
    dinoBottom > obsTop &&
    dinoTop < obsBottom
  );
}

/**
 * Get random obstacle type based on current score
 */
export function getRandomObstacleType(score: number): ObstacleType {
  const types: ObstacleType[] = ["cactus-small", "cactus-large", "cactus-group"];

  // Add pterodactyls after threshold
  if (score >= PTERODACTYL_SCORE_THRESHOLD) {
    types.push("pterodactyl-low", "pterodactyl-high");
  }

  return types[Math.floor(Math.random() * types.length)];
}

/**
 * Create obstacle from type
 */
export function createObstacle(type: ObstacleType, x: number): Obstacle {
  const config = {
    "cactus-small": OBSTACLES.CACTUS_SMALL,
    "cactus-large": OBSTACLES.CACTUS_LARGE,
    "cactus-group": OBSTACLES.CACTUS_GROUP,
    "pterodactyl-low": OBSTACLES.PTERODACTYL_LOW,
    "pterodactyl-high": OBSTACLES.PTERODACTYL_HIGH,
  }[type];

  return {
    type,
    x,
    y: config.y,
    width: config.width,
    height: config.height,
    passed: false,
  };
}

/**
 * Get random spawn gap based on current speed
 */
export function getRandomSpawnGap(speed: number): number {
  // Smaller gap at higher speeds (more challenging)
  const speedFactor = Math.max(0.6, 1 - (speed - INITIAL_SPEED) / (MAX_SPEED - INITIAL_SPEED) * 0.4);
  const minGap = MIN_OBSTACLE_GAP * speedFactor;
  const maxGap = MAX_OBSTACLE_GAP * speedFactor;
  return minGap + Math.random() * (maxGap - minGap);
}

/**
 * Create a new cloud
 */
export function createCloud(x: number): CloudData {
  return {
    x,
    y: CLOUD.MIN_Y + Math.random() * (CLOUD.MAX_Y - CLOUD.MIN_Y),
    width: CLOUD.MIN_WIDTH + Math.random() * (CLOUD.MAX_WIDTH - CLOUD.MIN_WIDTH),
  };
}

/**
 * Get colors based on day/night mode
 */
export function getColors(isNight: boolean) {
  return isNight ? COLORS_NIGHT : COLORS_DAY;
}
