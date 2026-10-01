// Game constants - all tunable values in one place

// ============================================================================
// PHYSICS
// ============================================================================

export const PHYSICS = {
  // Truck dimensions (monster truck with big wheels)
  TRUCK: {
    CHASSIS_WIDTH: 2.4,
    CHASSIS_HEIGHT: 1.0,
    CHASSIS_LENGTH: 3.8,
    WHEEL_RADIUS: 0.9,  // Bigger monster truck wheels
    WHEEL_WIDTH: 0.7,
    GROUND_CLEARANCE: 1.0,
  },

  // Suspension
  SUSPENSION: {
    REST_LENGTH: 0.5,
    STIFFNESS: 30,
    DAMPING: 4,
    MAX_TRAVEL: 0.3,
  },

  /** The chassis mass, in kilograms (the ballast adds its own). */
  CHASSIS_MASS: 1500,

  /**
   * How hard the tires hold the truck against sliding sideways. Each frame
   * the grip takes back GRIP_FORCE x tires x dt / CHASSIS_MASS of the
   * sideways speed.
   */
  GRIP_FORCE: 8000,

  /**
   * The longest frame the truck's own forces integrate over, in seconds.
   * A slow frame (the first frames compile shaders; a phone hitches) would
   * otherwise multiply the grip and engine impulses. Past a share of 1 the
   * grip overshoots, grows, and flings the truck (a 207 MPH spike in the
   * phone check, 2026-09-30). At 1/20 s the best tires (2.8) take back
   * 0.75 of the sideways speed, so the grip always settles.
   */
  MAX_FRAME_DELTA: 1 / 20,

  // Engine/movement (forces scaled for delta-time based impulses)
  ENGINE: {
    BASE_FORCE: 20000,  // Strong acceleration
    MAX_SPEED: 45,
    REVERSE_FORCE: 10000,
    BRAKE_FORCE: 3000,
  },

  // Steering (arcade-style direct angular velocity control)
  STEERING: {
    MAX_ANGLE: Math.PI / 4, // 45 degrees for visual wheel turn
    SPEED: 3.0,             // Max angular velocity (rad/s)
    LERP: 0.15,             // Smoothing factor for steering response
    DECAY: 0.9,             // Angular velocity decay when not steering
  },

  // NOS boost
  NOS: {
    FORCE_MULTIPLIER: 2.5,
    DRAIN_RATE: 25, // per second
    RECHARGE_RATE: 10, // per second when not using
  },

  // Auto-recovery
  RECOVERY: {
    FLIP_TIME: 3, // seconds before auto-reset
    RESET_HEIGHT: 2, // meters above ground
  },
} as const;

// ============================================================================
// WORLD
// ============================================================================

export const WORLD = {
  // Size
  SIZE: 500, // meters square
  HALF_SIZE: 250,

  // Terrain
  TERRAIN: {
    SEGMENTS: 128,
    MAX_HEIGHT: 30,
    ROUGHNESS: 0.4,
  },

  // Spawn point
  SPAWN: {
    POSITION: [0, 5, 0] as [number, number, number],  // Center = guaranteed flat
    ROTATION: Math.PI,  // Face -Z (toward open area)
  },

  // Boundaries
  BOUNDARY: {
    WALL_HEIGHT: 50,
    WALL_THICKNESS: 5,
  },
} as const;

// ============================================================================
// COLLECTIBLES
// ============================================================================

export const COLLECTIBLES = {
  // Coins
  COIN: {
    VALUE: 10,
    COUNT: 50,  // Reduced for performance
    SPIN_SPEED: 2,
    HOVER_HEIGHT: 0.8,
    HOVER_AMPLITUDE: 0.3,
    SIZE: 0.5,
  },

  // Stars
  STAR: {
    VALUE: 50,
    COUNT: 10,  // Reduced for performance
    SPIN_SPEED: 1,
    HOVER_HEIGHT: 1.2,
    HOVER_AMPLITUDE: 0.5,
    SIZE: 0.8,
  },

  // Mystery boxes
  MYSTERY_BOX: {
    MIN_VALUE: 100,
    MAX_VALUE: 500,
    COUNT: 5,
    SIZE: 1.2,
  },

  // Pickup radius
  PICKUP_RADIUS: 2.5,
} as const;

// ============================================================================
// DESTRUCTIBLES
// ============================================================================

export const DESTRUCTIBLES = {
  CRATE: {
    SIZE: 1.5,
    COINS: 15,
    COUNT: 15,  // Reduced for performance
  },

  BARREL: {
    RADIUS: 0.6,
    HEIGHT: 1.2,
    COINS: 10,
    COUNT: 12,  // Reduced for performance
  },

  CAR: {
    SIZE: [2, 1, 4] as [number, number, number],
    COINS: 25,
    COUNT: 5,  // Reduced for performance
  },
} as const;

// ============================================================================
// RAMPS
// ============================================================================

export const RAMPS = {
  SMALL: {
    WIDTH: 8,
    LENGTH: 12,
    HEIGHT: 3,
  },

  MEDIUM: {
    WIDTH: 10,
    LENGTH: 18,
    HEIGHT: 6,
  },

  LARGE: {
    WIDTH: 12,
    LENGTH: 25,
    HEIGHT: 10,
  },

  MEGA: {
    WIDTH: 15,
    LENGTH: 35,
    HEIGHT: 15,
  },
} as const;

// ============================================================================
// BONUSES
// ============================================================================

export const BONUSES = {
  AIRTIME: {
    COINS_PER_SECOND: 5,
    MIN_HEIGHT: 1.5, // meters off ground to count
  },

  FLIP: {
    COINS: 50,
    ROTATION_THRESHOLD: Math.PI * 1.8, // almost full rotation
  },

  BARREL_ROLL: {
    COINS: 75,
  },

  COMBO_MULTIPLIER: {
    2: 1.5,
    3: 2.0,
    4: 2.5,
    5: 3.0,
  },
} as const;

// ============================================================================
// UI
// ============================================================================

export const UI = {
  // Touch controls
  TOUCH: {
    BUTTON_SIZE: 80, // pixels
    PEDAL_HEIGHT: 120,
    MARGIN: 20,
  },

  // HUD
  HUD: {
    COIN_ANIMATION_DURATION: 300, // ms
    POPUP_DURATION: 1500, // ms
  },

  // Colors
  COLORS: {
    COIN: '#ffd700',
    STAR: '#ffff00',
    NOS: '#00ffff',
    HEALTH: '#00ff00',
    DANGER: '#ff0000',
  },
} as const;

// ============================================================================
// CAMERA
// ============================================================================

export const CAMERA = {
  // Follow distance
  DISTANCE: 12,
  HEIGHT: 6,

  // Smoothing (higher = smoother, less jitter)
  LERP_POSITION: 0.15,
  LERP_LOOK: 0.2,

  // FOV
  FOV: 75,
  NEAR: 0.5,  // Increased to prevent z-fighting
  FAR: 1000,
} as const;

// ============================================================================
// ZONES (world areas)
// ============================================================================

export const ZONES = {
  MEADOW: {
    CENTER: [0, 0, 0] as [number, number, number],
    RADIUS: 100,
    GROUND_COLOR: '#4a7c3d',
  },

  MARSH: {
    CENTER: [150, 0, 0] as [number, number, number],
    RADIUS: 80,
    GROUND_COLOR: '#3d5a3d',
  },

  ROCKY: {
    CENTER: [-150, 0, 50] as [number, number, number],
    RADIUS: 90,
    GROUND_COLOR: '#6b6b6b',
  },

  CANYON: {
    CENTER: [0, 0, -150] as [number, number, number],
    RADIUS: 100,
    GROUND_COLOR: '#c4773b',
  },

  STUNT_PARK: {
    CENTER: [-100, 0, -100] as [number, number, number],
    RADIUS: 70,
    GROUND_COLOR: '#555555',
  },

  JUNKYARD: {
    CENTER: [100, 0, 100] as [number, number, number],
    RADIUS: 60,
    GROUND_COLOR: '#4a4a3a',
  },
} as const;

// ============================================================================
// LAKES (positions shared between terrain and environment)
// ============================================================================

export const LAKES = [
  { x: 50, z: -80, size: 30, depth: 3 },
  { x: -70, z: 60, size: 25, depth: 2.5 },
  { x: 90, z: 100, size: 20, depth: 2 },
  { x: -100, z: -120, size: 28, depth: 3 },
] as const;
