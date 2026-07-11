// Platformer Game - Constants and Configuration
// "Hank's Hopper" - Kid-friendly 2D platformer (ages 6-14)

// Canvas dimensions (16:9 aspect ratio, good for side-scrolling)
export const CANVAS_WIDTH = 800;
export const CANVAS_HEIGHT = 450;

// Player character settings
export const PLAYER = {
  WIDTH: 32,
  HEIGHT: 48,
  START_X: 100,
  START_Y: 300,
  // Hitbox slightly smaller than visual for forgiving collisions
  HITBOX_WIDTH: 24,
  HITBOX_HEIGHT: 44,
  COLOR_BODY: "#4CAF50", // Green body
  COLOR_HEAD: "#FFE4C4", // Skin tone
  COLOR_EYES: "#000000",
} as const;

// Physics - tuned for kid-friendly platforming
export const PHYSICS = {
  GRAVITY: 0.6,                    // Gravity strength
  JUMP_VELOCITY: -14,              // Jump power (negative = up)
  MOVE_SPEED: 5,                   // Horizontal movement speed
  MAX_FALL_SPEED: 12,              // Terminal velocity
  COYOTE_TIME: 100,                // ms to still jump after leaving platform (forgiving!)
  JUMP_BUFFER_TIME: 100,           // ms to buffer jump before landing
  FRICTION: 0.85,                  // Ground friction
  AIR_RESISTANCE: 0.95,            // Air movement damping
} as const;

// Platform settings
export const PLATFORM = {
  MIN_WIDTH: 80,
  MAX_WIDTH: 200,
  HEIGHT: 20,
  COLOR: "#8B4513",               // Brown
  COLOR_TOP: "#A0522D",           // Lighter brown for top
  MOVING_SPEED: 1.5,              // Speed of moving platforms
} as const;

// Collectibles
export const COIN = {
  SIZE: 24,
  COLOR: "#FFD700",               // Gold
  OUTLINE_COLOR: "#DAA520",       // Darker gold
  VALUE: 10,                       // Points per coin
} as const;

export const STAR = {
  SIZE: 30,
  COLOR: "#FFFF00",               // Yellow
  OUTLINE_COLOR: "#FFA500",       // Orange
  VALUE: 100,                      // Points per star
} as const;

// Ground settings
export const GROUND = {
  HEIGHT: 50,
  COLOR: "#8B4513",               // Brown
  GRASS_COLOR: "#228B22",         // Forest green
  GRASS_HEIGHT: 15,
} as const;

// Level settings
export const LEVEL = {
  WIDTH: 3000,                     // Level width in pixels
  SPAWN_INTERVAL: 200,             // Pixels between platform checks
} as const;

// Camera settings
export const CAMERA = {
  LOOK_AHEAD: 150,                 // Camera leads player horizontally
  SMOOTHING: 0.08,                 // Camera follow smoothness
  MIN_X: CANVAS_WIDTH / 2,         // Don't scroll past level start
} as const;

// Colors - bright and kid-friendly
export const COLORS = {
  SKY_TOP: "#87CEEB",             // Light sky blue
  SKY_BOTTOM: "#E0F6FF",          // Pale blue
  CLOUD: "rgba(255, 255, 255, 0.9)",
  SUN: "#FFD93D",
  SUN_GLOW: "rgba(255, 217, 61, 0.3)",
  SCORE_TEXT: "#FFFFFF",
  SCORE_SHADOW: "#000000",
  GAME_OVER_BG: "rgba(0, 0, 0, 0.7)",
  PARTICLE_COIN: "#FFD700",
  PARTICLE_STAR: "#FFFF00",
} as const;

// UI settings
export const UI = {
  SCORE_FONT: "bold 32px Arial, sans-serif",
  TITLE_FONT: "bold 48px Arial, sans-serif",
  SMALL_FONT: "24px Arial, sans-serif",
  BUTTON_MIN_SIZE: 64,            // Big touch targets for kids
} as const;

// Game states
// "paused" is a transient state owned by the GameShell (ESC / pause button /
// pause-on-blur); it is never persisted.
export type GameState = "ready" | "playing" | "paused" | "gameOver" | "levelComplete";

// Level definitions - MVP has 3 demo levels
export interface PlatformDef {
  x: number;
  y: number;
  width: number;
  type: "static" | "moving";
  moveRange?: number;              // For moving platforms
}

export interface CoinDef {
  x: number;
  y: number;
}

export interface StarDef {
  x: number;
  y: number;
}

export interface LevelDef {
  id: string;
  name: string;
  width: number;
  platforms: PlatformDef[];
  coins: CoinDef[];
  stars: StarDef[];
  goalX: number;                   // X position of finish flag
}

// Level 1 - Tutorial level (easy jumps)
export const LEVEL_1: LevelDef = {
  id: "1-1",
  name: "Grassland Start",
  width: 2000,
  platforms: [
    // Starting area - flat ground extension
    { x: 0, y: CANVAS_HEIGHT - GROUND.HEIGHT - 5, width: 300, type: "static" },
    // First jump - very easy
    { x: 400, y: CANVAS_HEIGHT - GROUND.HEIGHT - 30, width: 150, type: "static" },
    // Second jump
    { x: 620, y: CANVAS_HEIGHT - GROUND.HEIGHT - 50, width: 120, type: "static" },
    // Third platform
    { x: 820, y: CANVAS_HEIGHT - GROUND.HEIGHT - 80, width: 100, type: "static" },
    // Back down
    { x: 1000, y: CANVAS_HEIGHT - GROUND.HEIGHT - 40, width: 150, type: "static" },
    // Moving platform intro
    { x: 1200, y: CANVAS_HEIGHT - GROUND.HEIGHT - 60, width: 100, type: "moving", moveRange: 80 },
    // Final stretch
    { x: 1450, y: CANVAS_HEIGHT - GROUND.HEIGHT - 30, width: 200, type: "static" },
    // Goal platform
    { x: 1700, y: CANVAS_HEIGHT - GROUND.HEIGHT - 10, width: 200, type: "static" },
  ],
  coins: [
    // Easy coins on main path
    { x: 450, y: CANVAS_HEIGHT - GROUND.HEIGHT - 80 },
    { x: 480, y: CANVAS_HEIGHT - GROUND.HEIGHT - 80 },
    { x: 670, y: CANVAS_HEIGHT - GROUND.HEIGHT - 100 },
    { x: 700, y: CANVAS_HEIGHT - GROUND.HEIGHT - 100 },
    { x: 850, y: CANVAS_HEIGHT - GROUND.HEIGHT - 130 },
    { x: 1050, y: CANVAS_HEIGHT - GROUND.HEIGHT - 90 },
    { x: 1080, y: CANVAS_HEIGHT - GROUND.HEIGHT - 90 },
    { x: 1250, y: CANVAS_HEIGHT - GROUND.HEIGHT - 110 },
    { x: 1500, y: CANVAS_HEIGHT - GROUND.HEIGHT - 80 },
    { x: 1530, y: CANVAS_HEIGHT - GROUND.HEIGHT - 80 },
    { x: 1560, y: CANVAS_HEIGHT - GROUND.HEIGHT - 80 },
  ],
  stars: [
    // Star 1 - main path (impossible to miss)
    { x: 500, y: CANVAS_HEIGHT - GROUND.HEIGHT - 110 },
    // Star 2 - slightly off path
    { x: 870, y: CANVAS_HEIGHT - GROUND.HEIGHT - 160 },
    // Star 3 - requires good jump timing
    { x: 1280, y: CANVAS_HEIGHT - GROUND.HEIGHT - 150 },
  ],
  goalX: 1850,
};

// Level 2 - Introduce more challenges
export const LEVEL_2: LevelDef = {
  id: "1-2",
  name: "Forest Jumps",
  width: 2500,
  platforms: [
    { x: 0, y: CANVAS_HEIGHT - GROUND.HEIGHT - 5, width: 250, type: "static" },
    { x: 350, y: CANVAS_HEIGHT - GROUND.HEIGHT - 50, width: 100, type: "static" },
    { x: 520, y: CANVAS_HEIGHT - GROUND.HEIGHT - 100, width: 80, type: "static" },
    { x: 680, y: CANVAS_HEIGHT - GROUND.HEIGHT - 80, width: 100, type: "moving", moveRange: 60 },
    { x: 880, y: CANVAS_HEIGHT - GROUND.HEIGHT - 120, width: 80, type: "static" },
    { x: 1050, y: CANVAS_HEIGHT - GROUND.HEIGHT - 80, width: 120, type: "static" },
    { x: 1250, y: CANVAS_HEIGHT - GROUND.HEIGHT - 140, width: 80, type: "moving", moveRange: 100 },
    { x: 1500, y: CANVAS_HEIGHT - GROUND.HEIGHT - 100, width: 100, type: "static" },
    { x: 1700, y: CANVAS_HEIGHT - GROUND.HEIGHT - 60, width: 150, type: "static" },
    { x: 1950, y: CANVAS_HEIGHT - GROUND.HEIGHT - 30, width: 200, type: "static" },
  ],
  coins: [
    { x: 380, y: CANVAS_HEIGHT - GROUND.HEIGHT - 100 },
    { x: 550, y: CANVAS_HEIGHT - GROUND.HEIGHT - 150 },
    { x: 720, y: CANVAS_HEIGHT - GROUND.HEIGHT - 130 },
    { x: 910, y: CANVAS_HEIGHT - GROUND.HEIGHT - 170 },
    { x: 1100, y: CANVAS_HEIGHT - GROUND.HEIGHT - 130 },
    { x: 1300, y: CANVAS_HEIGHT - GROUND.HEIGHT - 190 },
    { x: 1530, y: CANVAS_HEIGHT - GROUND.HEIGHT - 150 },
    { x: 1560, y: CANVAS_HEIGHT - GROUND.HEIGHT - 150 },
    { x: 1750, y: CANVAS_HEIGHT - GROUND.HEIGHT - 110 },
    { x: 1780, y: CANVAS_HEIGHT - GROUND.HEIGHT - 110 },
    { x: 2000, y: CANVAS_HEIGHT - GROUND.HEIGHT - 80 },
    { x: 2030, y: CANVAS_HEIGHT - GROUND.HEIGHT - 80 },
  ],
  stars: [
    { x: 560, y: CANVAS_HEIGHT - GROUND.HEIGHT - 180 },
    { x: 920, y: CANVAS_HEIGHT - GROUND.HEIGHT - 200 },
    { x: 1540, y: CANVAS_HEIGHT - GROUND.HEIGHT - 180 },
  ],
  goalX: 2200,
};

// Level 3 - More challenging
export const LEVEL_3: LevelDef = {
  id: "1-3",
  name: "Sky Climb",
  width: 3000,
  platforms: [
    { x: 0, y: CANVAS_HEIGHT - GROUND.HEIGHT - 5, width: 200, type: "static" },
    { x: 300, y: CANVAS_HEIGHT - GROUND.HEIGHT - 60, width: 80, type: "static" },
    { x: 480, y: CANVAS_HEIGHT - GROUND.HEIGHT - 120, width: 80, type: "moving", moveRange: 50 },
    { x: 680, y: CANVAS_HEIGHT - GROUND.HEIGHT - 180, width: 100, type: "static" },
    { x: 880, y: CANVAS_HEIGHT - GROUND.HEIGHT - 140, width: 80, type: "static" },
    { x: 1050, y: CANVAS_HEIGHT - GROUND.HEIGHT - 100, width: 100, type: "moving", moveRange: 80 },
    { x: 1280, y: CANVAS_HEIGHT - GROUND.HEIGHT - 150, width: 80, type: "static" },
    { x: 1480, y: CANVAS_HEIGHT - GROUND.HEIGHT - 200, width: 100, type: "static" },
    { x: 1700, y: CANVAS_HEIGHT - GROUND.HEIGHT - 160, width: 80, type: "moving", moveRange: 70 },
    { x: 1920, y: CANVAS_HEIGHT - GROUND.HEIGHT - 120, width: 100, type: "static" },
    { x: 2150, y: CANVAS_HEIGHT - GROUND.HEIGHT - 80, width: 120, type: "static" },
    { x: 2400, y: CANVAS_HEIGHT - GROUND.HEIGHT - 40, width: 200, type: "static" },
  ],
  coins: [
    { x: 330, y: CANVAS_HEIGHT - GROUND.HEIGHT - 110 },
    { x: 520, y: CANVAS_HEIGHT - GROUND.HEIGHT - 170 },
    { x: 710, y: CANVAS_HEIGHT - GROUND.HEIGHT - 230 },
    { x: 740, y: CANVAS_HEIGHT - GROUND.HEIGHT - 230 },
    { x: 910, y: CANVAS_HEIGHT - GROUND.HEIGHT - 190 },
    { x: 1100, y: CANVAS_HEIGHT - GROUND.HEIGHT - 150 },
    { x: 1310, y: CANVAS_HEIGHT - GROUND.HEIGHT - 200 },
    { x: 1510, y: CANVAS_HEIGHT - GROUND.HEIGHT - 250 },
    { x: 1540, y: CANVAS_HEIGHT - GROUND.HEIGHT - 250 },
    { x: 1740, y: CANVAS_HEIGHT - GROUND.HEIGHT - 210 },
    { x: 1950, y: CANVAS_HEIGHT - GROUND.HEIGHT - 170 },
    { x: 1980, y: CANVAS_HEIGHT - GROUND.HEIGHT - 170 },
    { x: 2200, y: CANVAS_HEIGHT - GROUND.HEIGHT - 130 },
    { x: 2450, y: CANVAS_HEIGHT - GROUND.HEIGHT - 90 },
    { x: 2480, y: CANVAS_HEIGHT - GROUND.HEIGHT - 90 },
    { x: 2510, y: CANVAS_HEIGHT - GROUND.HEIGHT - 90 },
  ],
  stars: [
    { x: 730, y: CANVAS_HEIGHT - GROUND.HEIGHT - 260 },
    { x: 1520, y: CANVAS_HEIGHT - GROUND.HEIGHT - 280 },
    { x: 2180, y: CANVAS_HEIGHT - GROUND.HEIGHT - 160 },
  ],
  goalX: 2700,
};

// All levels
export const LEVELS: LevelDef[] = [LEVEL_1, LEVEL_2, LEVEL_3];

// Types for game objects
export type Player = {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  isJumping: boolean;
  isGrounded: boolean;
  facingRight: boolean;
  coyoteTimer: number;           // Time since left ground (for coyote jump)
  jumpBufferTimer: number;       // Time since jump was pressed (for jump buffer)
};

export type Platform = {
  x: number;
  y: number;
  width: number;
  type: "static" | "moving";
  moveRange: number;
  startX: number;                 // Original X for moving platforms
  direction: number;              // 1 or -1 for moving platforms
};

export type Collectible = {
  x: number;
  y: number;
  type: "coin" | "star";
  collected: boolean;
  id: number;
};

export type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
};

export type Cloud = {
  x: number;
  y: number;
  scale: number;
  speed: number;
};
