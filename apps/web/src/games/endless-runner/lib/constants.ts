// Endless Runner - Game constants and configuration
// Tuned for kid-friendly gameplay (ages 6-14)

// Canvas dimensions
export const CANVAS_WIDTH = 800;
export const CANVAS_HEIGHT = 400;

// Ground settings
export const GROUND = {
  HEIGHT: 60,
  COLOR: "#8B5A2B",
  GRASS_COLOR: "#228B22",
  GRASS_HEIGHT: 10,
} as const;

/**
 * The top of the grass. The single floor line of the world: the runner's
 * feet, the bottom of every crate and the drawn grass all sit on it, and
 * every other height (air bars, coins) is measured up from it. Before this
 * the runner's floor was 20 px above the grass and the crates floated 40 px
 * above the runner's feet, so ducking passed under every crate.
 */
export const FLOOR_Y = CANVAS_HEIGHT - GROUND.HEIGHT;

// Player settings
export const PLAYER = {
  WIDTH: 40,
  HEIGHT: 50,
  X: 100, // Fixed X position (player runs in place, world scrolls)
  GROUND_Y: FLOOR_Y, // The runner's feet when on the ground
  // Hitbox is smaller than visual for forgiving collisions (20% smaller)
  HITBOX_PADDING: 8,
  // Colors
  COLOR_BODY: "#FF6B35",
  COLOR_HEAD: "#FFE4C4",
  COLOR_HAIR: "#8B4513",
} as const;

/**
 * The runner's drawing, in its own frame: x from PLAYER.X, y from the feet
 * (negative is up). Game.tsx draws the runner from these numbers and
 * lib/geometry.ts makes the coin box from them (runnerSilhouette), so a
 * coin that touches the drawn runner is a coin collected. The obstacle
 * hitbox stays the smaller, forgiving PLAYER box.
 */
export const RUNNER_ART = {
  // Standing, running and jumping: the hair is the top, the arms reach out.
  HEAD_Y: -(PLAYER.HEIGHT + 17),
  HEAD_R: 14,
  HAIR_Y: -(PLAYER.HEIGHT + 22),
  HAIR_R: 12,
  ARM_REACH: PLAYER.WIDTH / 2 + 5,
  ARM_WIDTH: 8,
  LEG_LENGTH: 22,
  // Ducking: a low slide with the head tucked in front.
  DUCK_BODY_HEIGHT: 20,
  DUCK_HEAD_X: 14,
  DUCK_HEAD_Y: -17,
  DUCK_HEAD_R: 10,
} as const;

/**
 * One game step in real time. The speeds, the jump and the gaps are all
 * counted in steps. The game has always played at 30 steps a second: its
 * loop used to start again after every update, so every other screen frame
 * only drew. The loop now updates on every frame (smooth at any refresh
 * rate) and keeps the pace kids know. 1000 / 60 would double the speed.
 */
export const STEP_MS = 1000 / 30;

/** The most game time one update covers, in steps: a slow frame never jumps the world far. */
export const MAX_STEPS_PER_UPDATE = 2;

// Physics - tuned for responsive, fun jumping
export const PHYSICS = {
  GRAVITY: 0.8, // pixels/step^2
  JUMP_VELOCITY: -15, // pixels/step - upward impulse
  MAX_FALL_SPEED: 12, // terminal velocity
  DUCK_HEIGHT: 25, // Player height when ducking
} as const;

// Obstacle settings
export const OBSTACLE = {
  GROUND_WIDTH: 40, // Ground obstacles (jump over)
  GROUND_HEIGHT: 40,
  GROUND_COLOR: "#DC2626", // Red boxes
  AIR_WIDTH: 60, // Air obstacles (duck under)
  AIR_HEIGHT: 30,
  AIR_COLOR: "#7C3AED", // Purple bars
  // Top of an air bar: its bottom is 30 px above the floor, so a standing
  // runner hits it and a ducking runner passes under it.
  AIR_Y: FLOOR_Y - 60,
  // Clear road between the back of one obstacle and the front of the next,
  // counted in update steps (STEP_MS each, 1/30 s), so it holds
  // at every speed. The least is one whole jump (lib/geometry.ts measures
  // it from PHYSICS) plus REACTION_STEPS: a kid who jumps a crate lands with
  // time to see the next one and react. At the starting speed this is the
  // old 300 to 500 px; a fixed pixel gap was shorter than one jump at top
  // speed.
  REACTION_STEPS: 24,
  // A random extra on top of the least, so the rhythm is not a metronome.
  EXTRA_GAP_STEPS: 40,
} as const;

// Coin settings
export const COIN = {
  SIZE: 20,
  COLOR: "#FFD700",
  OUTLINE_COLOR: "#DAA520",
  VALUE: 10,
  // Coins start this far in front of the obstacle they come with.
  LEAD: 150,
  // Spawn height variations (the coin's centre). The standing runner's
  // drawing reaches 84 px up (RUNNER_ART), and the coin box is that drawing.
  LOW_Y: FLOOR_Y - 30, // Ground level coins: running or ducking collects them
  MID_Y: FLOOR_Y - 100, // Mid-jump coins: just over the head, any hop collects them
  HIGH_Y: FLOOR_Y - 140, // High jump coins: a real jump
  // Coin patterns spawn rate
  SPAWN_CHANCE: 0.6, // 60% chance per obstacle gap
} as const;

// Speed settings - gradual increase for kids
export const SPEED = {
  INITIAL: 5, // Starting speed (pixels/step)
  MAX: 12, // Maximum speed
  INCREASE_RATE: 0.001, // Speed increase per step
} as const;

// Scoring
export const SCORING = {
  DISTANCE_MULTIPLIER: 0.1, // Distance in meters = pixels * this
  COIN_VALUE: 10,
  // Milestones for celebrations
  MILESTONES: [100, 250, 500, 1000, 2000, 5000],
} as const;

// Colors - bright and kid-friendly
export const COLORS = {
  SKY_TOP: "#87CEEB",
  SKY_BOTTOM: "#E0F4FF",
  CLOUD: "#FFFFFF",
  SUN: "#FFD700",
  SUN_GLOW: "rgba(255, 215, 0, 0.3)",
  MOUNTAIN_FAR: "#9CA3AF",
  MOUNTAIN_NEAR: "#6B7280",
  SCORE_TEXT: "#FFFFFF",
  SCORE_SHADOW: "#000000",
  GAME_OVER_BG: "rgba(0, 0, 0, 0.7)",
} as const;

// UI settings
export const UI = {
  SCORE_FONT: "bold 32px Arial, sans-serif",
  SMALL_FONT: "24px Arial, sans-serif",
  TITLE_FONT: "bold 48px Arial, sans-serif",
  BUTTON_MIN_SIZE: 60,
} as const;

// Game states
export type GameState = "ready" | "playing" | "gameOver";

// Types
export type Player = {
  y: number;
  velocity: number;
  isDucking: boolean;
  isJumping: boolean;
};

export type Obstacle = {
  x: number;
  type: "ground" | "air";
  width: number;
  height: number;
  id: number;
};

export type CoinType = {
  x: number;
  y: number;
  collected: boolean;
  id: number;
};

export type Cloud = {
  x: number;
  y: number;
  scale: number;
  speed: number;
};

// Characters available for unlock
export type CharacterId = "speedy-sam" | "rocket-rita" | "bouncy-bob" | "ninja-nancy" | "robo-randy" | "golden-gary";

export const CHARACTERS: Record<CharacterId, { name: string; cost: number; color: string }> = {
  "speedy-sam": { name: "Speedy Sam", cost: 0, color: "#FF6B35" },
  "rocket-rita": { name: "Rocket Rita", cost: 500, color: "#EF4444" },
  "bouncy-bob": { name: "Bouncy Bob", cost: 1000, color: "#22C55E" },
  "ninja-nancy": { name: "Ninja Nancy", cost: 2000, color: "#1F2937" },
  "robo-randy": { name: "Robo Randy", cost: 5000, color: "#6366F1" },
  "golden-gary": { name: "Golden Gary", cost: 10000, color: "#F59E0B" },
};
