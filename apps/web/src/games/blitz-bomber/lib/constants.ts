// Blitz Bomber - Game constants and configuration
// Classic arcade game where you bomb buildings to land safely
// Tuned for kid-friendly gameplay (ages 6-14)

// Canvas dimensions
export const CANVAS_WIDTH = 800;
export const CANVAS_HEIGHT = 600;

// Plane settings
export const PLANE = {
  WIDTH: 60,
  HEIGHT: 30,
  SPEED: 3, // Pixels per frame
  DROP_AMOUNT: 35, // Pixels lower each pass
  STARTING_Y: 50, // Y position at start
  // Hitbox is slightly smaller for forgiving collisions
  HITBOX_WIDTH: 50,
  HITBOX_HEIGHT: 20,
} as const;

// Bomb settings
export const BOMB = {
  WIDTH: 10,
  HEIGHT: 16,
  FALL_SPEED: 8, // Pixels per frame
  MAX_ON_SCREEN: 3, // Can drop multiple bombs
} as const;

// Building settings
export const BUILDING = {
  COUNT: 12, // Number of buildings
  MIN_HEIGHT: 80,
  MAX_HEIGHT: 350,
  MIN_WIDTH: 45,
  MAX_WIDTH: 75,
  GAP: 5, // Gap between buildings
  SEGMENT_HEIGHT: 35, // Height removed per bomb hit
  // Colorful building palette (kid-friendly)
  COLORS: [
    "#FF6B6B", // Coral red
    "#4ECDC4", // Teal
    "#45B7D1", // Sky blue
    "#96CEB4", // Sage green
    "#FFEAA7", // Soft yellow
    "#DDA0DD", // Plum
    "#98D8C8", // Mint
    "#F7DC6F", // Mustard
    "#BB8FCE", // Lavender
    "#85C1E9", // Light blue
  ],
  WINDOW_COLOR: "#FFE082", // Warm yellow windows
  WINDOW_SIZE: 8,
  WINDOW_GAP: 14,
} as const;

// Ground settings
export const GROUND = {
  HEIGHT: 40,
  COLOR: "#8B4513", // Brown
  GRASS_COLOR: "#228B22", // Forest green
  GRASS_HEIGHT: 10,
} as const;

// Explosion settings
export const EXPLOSION = {
  DURATION: 300, // ms
  MAX_RADIUS: 40,
  COLORS: ["#FF6B6B", "#FFD93D", "#FF8C00", "#FFFFFF"],
} as const;

// Scoring
export const SCORING = {
  SEGMENT_DESTROYED: 10,
  BUILDING_DESTROYED_BONUS: 50,
  LANDING_BONUS: 500,
  TIME_BONUS_MULTIPLIER: 5,
} as const;

// Difficulty settings
export const DIFFICULTY = {
  EASY: {
    planeSpeed: 2,
    dropAmount: 30,
    buildingCount: 10,
    maxBuildingHeight: 280,
    bombsAllowed: 5,
  },
  NORMAL: {
    planeSpeed: 3,
    dropAmount: 35,
    buildingCount: 12,
    maxBuildingHeight: 350,
    bombsAllowed: 3,
  },
  HARD: {
    planeSpeed: 4,
    dropAmount: 40,
    buildingCount: 15,
    maxBuildingHeight: 400,
    bombsAllowed: 2,
  },
} as const;

// Colors - bright and kid-friendly
export const COLORS = {
  SKY_TOP: "#87CEEB", // Light sky blue
  SKY_BOTTOM: "#E0F6FF", // Very light blue
  CLOUD: "rgba(255, 255, 255, 0.8)",
  PLANE_BODY: "#3498db", // Nice blue
  PLANE_WING: "#2980b9", // Darker blue
  PLANE_COCKPIT: "#ecf0f1", // Light gray
  PLANE_STRIPE: "#e74c3c", // Red stripe
  BOMB: "#2c3e50", // Dark gray
  BOMB_FIN: "#e74c3c", // Red fins
  SCORE_TEXT: "#2c3e50",
  SCORE_SHADOW: "#ffffff",
  CRASH_OVERLAY: "rgba(255, 0, 0, 0.3)",
  WIN_OVERLAY: "rgba(0, 255, 0, 0.2)",
} as const;

// UI settings
export const UI = {
  SCORE_FONT: "bold 32px Arial, sans-serif",
  TITLE_FONT: "bold 48px Arial, sans-serif",
  SMALL_FONT: "20px Arial, sans-serif",
  BUTTON_MIN_SIZE: 60,
} as const;

// Game states. "paused" is a transient state owned by the GameShell (ESC /
// pause button / pause-on-blur); it is never persisted.
export type GameState = "ready" | "playing" | "paused" | "crashed" | "landed";

// Difficulty type
export type DifficultyLevel = "easy" | "normal" | "hard";

// Types
export type Position = {
  x: number;
  y: number;
};

export type Plane = {
  x: number;
  y: number;
  direction: 1 | -1; // 1 = right, -1 = left
};

export type Bomb = {
  id: number;
  x: number;
  y: number;
  destroyed: boolean;
};

export type Building = {
  id: number;
  x: number;
  width: number;
  height: number;
  originalHeight: number;
  color: string;
};

export type Explosion = {
  id: number;
  x: number;
  y: number;
  startTime: number;
};

// Helper functions
export function generateBuildings(
  count: number = BUILDING.COUNT,
  maxHeight: number = BUILDING.MAX_HEIGHT
): Building[] {
  const buildings: Building[] = [];
  let currentX = 0;

  for (let i = 0; i < count; i++) {
    const width =
      Math.floor(Math.random() * (BUILDING.MAX_WIDTH - BUILDING.MIN_WIDTH)) +
      BUILDING.MIN_WIDTH;
    const height =
      Math.floor(Math.random() * (maxHeight - BUILDING.MIN_HEIGHT)) +
      BUILDING.MIN_HEIGHT;
    const color =
      BUILDING.COLORS[Math.floor(Math.random() * BUILDING.COLORS.length)];

    buildings.push({
      id: i,
      x: currentX,
      width,
      height,
      originalHeight: height,
      color,
    });

    currentX += width + BUILDING.GAP;
  }

  // Scale buildings to fit canvas width
  const totalWidth = currentX - BUILDING.GAP;
  const scale = CANVAS_WIDTH / totalWidth;

  return buildings.map((b) => ({
    ...b,
    x: Math.floor(b.x * scale),
    width: Math.floor(b.width * scale),
  }));
}

export function getDifficultySettings(level: DifficultyLevel) {
  return DIFFICULTY[level.toUpperCase() as keyof typeof DIFFICULTY];
}
