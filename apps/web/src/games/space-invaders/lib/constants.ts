// Space Invaders - Game constants and configuration
// Tuned for kid-friendly gameplay (ages 6-14)

// ============================================
// Canvas Dimensions
// ============================================
export const CANVAS_WIDTH = 480;
export const CANVAS_HEIGHT = 640;

// ============================================
// Player (Cannon) Settings
// ============================================
export const PLAYER = {
  WIDTH: 50,
  HEIGHT: 30,
  Y: CANVAS_HEIGHT - 60, // Fixed Y position near bottom
  SPEED: 5, // pixels per frame
  COLOR: "#22c55e", // Green
  HITBOX_PADDING: 5, // Smaller hitbox than visual
} as const;

// ============================================
// Bullet Settings
// ============================================
export const BULLET = {
  WIDTH: 4,
  HEIGHT: 15,
  SPEED: 8,
  MAX_PLAYER_BULLETS: 3, // Kid-friendly: allow multiple bullets
  MAX_ALIEN_BULLETS: 3,
  PLAYER_COLOR: "#22c55e", // Green
  ALIEN_COLOR: "#ef4444", // Red
} as const;

// ============================================
// Alien Settings
// ============================================
export const ALIEN = {
  WIDTH: 35,
  HEIGHT: 25,
  ROWS: 5,
  COLS: 11,
  SPACING_X: 40,
  SPACING_Y: 35,
  START_X: 30,
  START_Y: 80,
  BASE_MOVE_SPEED: 1, // pixels per step
  DROP_AMOUNT: 20, // pixels to drop when hitting wall
  SHOOT_CHANCE: 0.002, // Base chance per alien per frame
  ANIMATION_INTERVAL: 500, // ms between animation frames
} as const;

// Alien types with their point values and colors
export type AlienType = "squid" | "crab" | "octopus";

export const ALIEN_TYPES: Record<
  AlienType,
  { points: number; color: string; colorAlt: string }
> = {
  squid: { points: 30, color: "#a855f7", colorAlt: "#9333ea" }, // Purple
  crab: { points: 20, color: "#3b82f6", colorAlt: "#2563eb" }, // Blue
  octopus: { points: 10, color: "#22c55e", colorAlt: "#16a34a" }, // Green
};

// Map row to alien type (top row = squid, next 2 = crab, bottom 2 = octopus)
export function getAlienTypeForRow(row: number): AlienType {
  if (row === 0) return "squid";
  if (row <= 2) return "crab";
  return "octopus";
}

// ============================================
// Mystery Ship Settings
// ============================================
export const MYSTERY_SHIP = {
  WIDTH: 50,
  HEIGHT: 20,
  Y: 40,
  SPEED: 2,
  SPAWN_INTERVAL_MIN: 20000, // 20-30 seconds
  SPAWN_INTERVAL_MAX: 30000,
  POINTS: [50, 100, 150, 300], // Random point values
  COLOR: "#ef4444", // Red
} as const;

// ============================================
// Shield Settings
// ============================================
export const SHIELD = {
  COUNT: 4,
  WIDTH: 60,
  HEIGHT: 45,
  BLOCK_SIZE: 5, // Size of each destructible block
  Y: CANVAS_HEIGHT - 140,
  COLOR: "#22c55e", // Green
} as const;

// Shield positions (evenly spaced)
export function getShieldPositions(): number[] {
  const totalWidth = CANVAS_WIDTH - 60; // Padding on sides
  const spacing = totalWidth / (SHIELD.COUNT + 1);
  const positions: number[] = [];
  for (let i = 1; i <= SHIELD.COUNT; i++) {
    positions.push(30 + spacing * i - SHIELD.WIDTH / 2);
  }
  return positions;
}

// Create shield block pattern (classic inverted U shape)
export function createShieldBlocks(
  shieldX: number
): Array<{ x: number; y: number; active: boolean }> {
  const blocks: Array<{ x: number; y: number; active: boolean }> = [];
  const cols = Math.floor(SHIELD.WIDTH / SHIELD.BLOCK_SIZE);
  const rows = Math.floor(SHIELD.HEIGHT / SHIELD.BLOCK_SIZE);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Create the classic shield shape with notch at bottom
      const isBottomNotch =
        row >= rows - 3 && col >= cols / 2 - 2 && col <= cols / 2 + 1;
      // Rounded top corners
      const isTopCorner =
        row <= 1 && (col <= 1 - row || col >= cols - 2 + row);

      if (!isBottomNotch && !isTopCorner) {
        blocks.push({
          x: shieldX + col * SHIELD.BLOCK_SIZE,
          y: SHIELD.Y + row * SHIELD.BLOCK_SIZE,
          active: true,
        });
      }
    }
  }
  return blocks;
}

// ============================================
// Game States
// ============================================
export type GameState = "ready" | "playing" | "paused" | "gameOver" | "waveComplete";

// ============================================
// Scoring
// ============================================
export const INITIAL_LIVES = 3;

// ============================================
// Colors
// ============================================
export const COLORS = {
  BACKGROUND: "#000000",
  TEXT: "#ffffff",
  HUD: "#22c55e",
  GAME_OVER: "#ef4444",
  EXPLOSION: "#fbbf24", // Yellow/orange
} as const;

// ============================================
// Sound Effects (placeholder URLs - will use Web Audio)
// ============================================
export const SOUNDS = {
  SHOOT: "shoot",
  EXPLOSION: "explosion",
  PLAYER_DEATH: "player_death",
  MYSTERY: "mystery",
  MARCH_1: "march1",
  MARCH_2: "march2",
  MARCH_3: "march3",
  MARCH_4: "march4",
  WAVE_CLEAR: "wave_clear",
} as const;

// ============================================
// Types
// ============================================
export type Position = {
  x: number;
  y: number;
};

export type Alien = {
  id: number;
  type: AlienType;
  x: number;
  y: number;
  width?: number;
  height?: number;
  sizeMultiplier?: number;
  alive: boolean;
  animationFrame: number; // 0 or 1 for two-frame animation
};

export type Bullet = {
  id: number;
  x: number;
  y: number;
  isPlayerBullet: boolean;
};

export type MysteryShip = {
  x: number;
  direction: 1 | -1; // 1 = right, -1 = left
  points: number;
  active: boolean;
};

export type ShieldBlock = {
  x: number;
  y: number;
  active: boolean;
};

export type Explosion = {
  id: number;
  x: number;
  y: number;
  frame: number;
  maxFrames: number;
};

// ============================================
// Age-Based Difficulty Settings
// ============================================
export const DIFFICULTY_SETTINGS = {
  "4yo": {
    alienRows: 2,                       // Only 2 rows for toddlers
    enemySpeedMultiplier: 0.3,          // Very slow
    bulletSpeedMultiplier: 2.0,         // Super fast bullets
    enemyDescentMultiplier: 0.3,        // Barely descend
    enemyShootChanceMultiplier: 0.1,    // Almost no shooting
    waveScalingMultiplier: 0.3,         // Waves barely get harder
    sizeMultiplier: 1.0,
    label: "4 years old",
    emoji: "👶",
    color: "bg-blue-400",
  },
  "8yo": {
    alienRows: 3,                       // 3 rows for Hank's age
    enemySpeedMultiplier: 0.6,          // Slow
    bulletSpeedMultiplier: 1.5,         // Fast bullets
    enemyDescentMultiplier: 0.5,        // Slow descent
    enemyShootChanceMultiplier: 0.4,    // Light shooting
    waveScalingMultiplier: 0.6,         // Gentle wave progression
    sizeMultiplier: 1.0,
    label: "8 years old",
    emoji: "🧒",
    color: "bg-green-500",
  },
  "12yo": {
    alienRows: 5,                       // Full 5 rows
    enemySpeedMultiplier: 1.0,          // Normal speed
    bulletSpeedMultiplier: 1.0,         // Normal bullets
    enemyDescentMultiplier: 1.0,        // Normal descent
    enemyShootChanceMultiplier: 1.0,    // Normal shooting
    waveScalingMultiplier: 1.0,         // Normal progression
    sizeMultiplier: 1.0,
    label: "12 years old",
    emoji: "👦",
    color: "bg-yellow-500",
  },
  "24yo": {
    alienRows: 5,                       // Full 5 rows
    enemySpeedMultiplier: 1.3,          // Fast enemies
    bulletSpeedMultiplier: 0.9,         // Slightly slower bullets
    enemyDescentMultiplier: 1.25,       // Aggressive descent
    enemyShootChanceMultiplier: 1.5,    // Heavy shooting
    waveScalingMultiplier: 1.3,         // Hard wave progression
    sizeMultiplier: 1.0,
    label: "24 years old",
    emoji: "🧑",
    color: "bg-orange-500",
  },
  "99yo": {
    alienRows: 2,                       // Only 2 rows for grandpa
    enemySpeedMultiplier: 0.25,         // Super slow (old people are slow)
    bulletSpeedMultiplier: 2.0,         // Fast bullets (help the elderly)
    enemyDescentMultiplier: 0.2,        // Almost no descent
    enemyShootChanceMultiplier: 0.05,   // 5% shooting (practically none)
    waveScalingMultiplier: 0.2,         // Waves barely change
    sizeMultiplier: 1.5,                // 50% BIGGER everything (bad eyesight!)
    label: "99 years old",
    emoji: "👴",
    color: "bg-purple-500",
  },
} as const;

export type Difficulty = keyof typeof DIFFICULTY_SETTINGS;

export function getDifficultySettings(difficulty: Difficulty) {
  return DIFFICULTY_SETTINGS[difficulty];
}

// ============================================
// Wave Difficulty Scaling
// ============================================
export function getWaveDifficulty(wave: number, waveScalingMultiplier: number = 1) {
  return {
    alienSpeedMultiplier: 1 + (wave - 1) * 0.15 * waveScalingMultiplier,
    alienShootMultiplier: 1 + (wave - 1) * 0.1 * waveScalingMultiplier,
    startingRow: Math.min(Math.floor((wave - 1) * waveScalingMultiplier), 3),
  };
}

// Calculate alien speed based on how many are remaining
export function getAlienSpeedForCount(
  aliensRemaining: number,
  totalAliens: number,
  baseSpeed: number
): number {
  // Speed increases as aliens die
  // At 100% aliens: 1x speed
  // At 50% aliens: ~1.5x speed
  // At 10% aliens: ~3x speed
  // At 1 alien: ~5x speed
  const ratio = aliensRemaining / totalAliens;
  const speedMultiplier = 1 + (1 - ratio) * 4; // Ranges from 1x to 5x
  return baseSpeed * speedMultiplier;
}

// ============================================
// UI Settings
// ============================================
export const UI = {
  SCORE_FONT: "bold 24px 'Press Start 2P', monospace, Arial",
  TITLE_FONT: "bold 48px 'Press Start 2P', monospace, Arial",
  SMALL_FONT: "16px 'Press Start 2P', monospace, Arial",
  HUD_HEIGHT: 40,
  BUTTON_MIN_SIZE: 60, // Minimum button size for kid-friendly tapping
} as const;
