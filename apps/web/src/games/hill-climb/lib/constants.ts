/**
 * Hill Climb Racing - Game Constants
 *
 * ALL tunable values in one place. NO magic numbers in components.
 */

// =============================================================================
// PHYSICS
// =============================================================================

export const PHYSICS = {
  // Vehicle dimensions
  CHASSIS_WIDTH: 120,
  CHASSIS_HEIGHT: 40,
  WHEEL_RADIUS: 25,
  WHEEL_BASE: 80, // Distance between wheel centers
  HEAD_RADIUS: 15,
  HEAD_OFFSET_Y: -35, // Above chassis

  // Mass
  CHASSIS_MASS: 50,
  WHEEL_MASS: 10,
  HEAD_MASS: 5,

  // Wheel properties
  WHEEL_FRICTION: 0.9,
  WHEEL_FRICTION_STATIC: 1.0,
  WHEEL_RESTITUTION: 0.1,

  // Motor control
  WHEEL_TORQUE: 0.15,
  MAX_WHEEL_SPEED: 0.5,
  BRAKE_MULTIPLIER: 1.5,

  // Lean control (INCREASED for better recovery)
  LEAN_FORCE: 0.020, // Increased from 0.015 for snappier response
  MAX_LEAN_VELOCITY: 0.3,

  // Suspension
  SUSPENSION_STIFFNESS: 0.4,
  SUSPENSION_DAMPING: 0.3,

  // World
  GRAVITY: 1,
  GROUND_FRICTION: 0.8,
  GROUND_RESTITUTION: 0.1,
} as const;

// =============================================================================
// TERRAIN
// =============================================================================

export const TERRAIN = {
  // Generation
  CHUNK_WIDTH: 800, // Pixels per chunk
  POINTS_PER_CHUNK: 40, // Resolution
  BASE_Y: 400, // Base ground level

  // Spawn safety: the vehicle spawns at x=200 on a flat platform (top y=420).
  // Un-flattened noise terrain could rise ABOVE the spawn point, embedding the
  // truck inside a hill - Matter then ejects it violently and the driver's head
  // clips terrain within ~300ms of pressing Play (instant "CRASH at ~200m",
  // every run, all devices - found by the 2026-07-11 mobile audit). The spawn
  // zone is therefore held perfectly flat and blended smoothly into the noise.
  SPAWN_FLAT_UNTIL: 400, // x below which terrain is exactly SPAWN_Y
  SPAWN_BLEND_OVER: 400, // x-range over which flat blends into noise
  SPAWN_Y: 420, // flat spawn surface height (flush with the start platform top)

  // Noise parameters
  NOISE_SCALE: 0.003, // Lower = smoother hills
  NOISE_AMPLITUDE: 150, // Max hill height variation

  // Difficulty scaling
  DIFFICULTY_SCALE_DISTANCE: 5000, // Distance over which difficulty doubles
  MAX_AMPLITUDE_MULTIPLIER: 2.5, // Max hill steepness multiplier
  STEEPNESS_INCREASE: 0.0001, // Per-pixel steepness increase

  // Rendering
  GROUND_DEPTH: 200, // How far below surface to fill
  GRASS_COLOR: '#228B22',
  DIRT_COLOR: '#8B4513',
  GRASS_HEIGHT: 5,

  // Chunk management
  CHUNKS_AHEAD: 3, // How many chunks to generate ahead
  CHUNKS_BEHIND: 1, // How many chunks to keep behind
} as const;

// =============================================================================
// FUEL
// =============================================================================

export const FUEL = {
  MAX_FUEL: 100,
  INITIAL_FUEL: 100,
  DRAIN_RATE: 2, // Per second while gas is pressed
  IDLE_DRAIN_RATE: 0.2, // Per second while not moving
  CAN_REFILL: 30, // How much fuel a can restores
  CAN_SPAWN_INTERVAL: 300, // Pixels between fuel cans (avg)
  CAN_SPAWN_VARIANCE: 100, // Random variance
  LOW_FUEL_THRESHOLD: 20, // When to show warning
} as const;

// =============================================================================
// NITRO
// =============================================================================

export const NITRO = {
  MAX: 100,
  DRAIN_RATE: 40, // Per second when active (~2.5s base duration)
  BASE_REFILL_RATE: 12.5, // Per second when inactive (~8s base recharge)
  WHEEL_BOOST: 2.5, // 2.5x wheel torque when nitro active
  LEAN_BOOST: 1.3, // 1.3x lean force when nitro active
} as const;

// =============================================================================
// COINS & SCORING
// =============================================================================

export const SCORING = {
  // Coin values
  COIN_VALUE_MIN: 5,
  COIN_VALUE_MAX: 20,
  COIN_SPAWN_INTERVAL: 150, // Pixels between coins (avg)
  COIN_SPAWN_VARIANCE: 50,
  COIN_HEIGHT_ABOVE_GROUND: 50,

  // Distance scoring
  DISTANCE_COIN_INTERVAL: 100, // Coins per 100m
  DISTANCE_COINS: 10,

  // Flip scoring
  FLIP_ROTATION_THRESHOLD: Math.PI * 1.8, // ~324 degrees for a flip
  FRONT_FLIP_COINS: 50,
  BACK_FLIP_COINS: 50,
  DOUBLE_FLIP_COINS: 150,

  // Airtime scoring
  MIN_AIRTIME_FOR_BONUS: 0.5, // Seconds
  AIRTIME_COINS_PER_SECOND: 5,

  // Combo system
  COMBO_TIMEOUT: 2, // Seconds to maintain combo
  COMBO_MULTIPLIER_MAX: 5,
} as const;

// =============================================================================
// VEHICLES
// =============================================================================

export interface VehicleRenderConfig {
  scale: number;           // Size multiplier
  bodyColor: string;       // Main body color
  accentColor: string;     // Windshield/accent color
  wheelScale: number;      // Wheel size multiplier
  wheelColor: string;      // Wheel color
  bodyShape: 'standard' | 'narrow' | 'long' | 'wide' | 'tracked';
}

export interface VehicleStats {
  id: string;
  name: string;
  cost: number;
  torque: number; // Multiplier
  grip: number; // Friction multiplier
  weight: number; // Mass multiplier
  fuelEfficiency: number; // Drain rate multiplier (lower = better)
  airControl: number; // Lean force multiplier
  description: string;
  render: VehicleRenderConfig;
}

export const VEHICLES: VehicleStats[] = [
  {
    id: 'jeep',
    name: 'Jeep',
    cost: 0,
    torque: 1.0,
    grip: 1.0,
    weight: 1.0,
    fuelEfficiency: 1.0,
    airControl: 1.0,
    description: 'Balanced starter vehicle',
    render: { scale: 1.0, bodyColor: '#FF6B35', accentColor: '#87CEEB', wheelScale: 1.0, wheelColor: '#333333', bodyShape: 'standard' },
  },
  {
    id: 'motorbike',
    name: 'Motorbike',
    cost: 1500,
    torque: 1.3,
    grip: 0.8,
    weight: 0.5,
    fuelEfficiency: 0.7,
    airControl: 1.5,
    description: 'Fast but tippy',
    render: { scale: 0.6, bodyColor: '#DC2626', accentColor: '#FEF3C7', wheelScale: 0.8, wheelColor: '#1F2937', bodyShape: 'narrow' },
  },
  {
    id: 'monster-truck',
    name: 'Monster Truck',
    cost: 2500,
    torque: 0.8,
    grip: 1.4,
    weight: 1.5,
    fuelEfficiency: 1.3,
    airControl: 0.7,
    description: 'Great grip, slow acceleration',
    render: { scale: 1.3, bodyColor: '#1F2937', accentColor: '#60A5FA', wheelScale: 1.5, wheelColor: '#374151', bodyShape: 'wide' },
  },
  {
    id: 'quad-bike',
    name: 'Quad Bike',
    cost: 3500,
    torque: 1.1,
    grip: 1.1,
    weight: 0.9,
    fuelEfficiency: 0.9,
    airControl: 1.2,
    description: 'Good all-rounder',
    render: { scale: 0.85, bodyColor: '#FBBF24', accentColor: '#1F2937', wheelScale: 1.1, wheelColor: '#4B5563', bodyShape: 'wide' },
  },
  {
    id: 'dune-buggy',
    name: 'Dune Buggy',
    cost: 5000,
    torque: 1.2,
    grip: 0.9,
    weight: 0.7,
    fuelEfficiency: 0.8,
    airControl: 1.4,
    description: 'Light with good air control',
    render: { scale: 0.9, bodyColor: '#84CC16', accentColor: '#1F2937', wheelScale: 1.0, wheelColor: '#57534E', bodyShape: 'standard' },
  },
  {
    id: 'big-rig',
    name: 'Big Rig',
    cost: 10000,
    torque: 0.7,
    grip: 1.2,
    weight: 2.0,
    fuelEfficiency: 1.5,
    airControl: 0.5,
    description: 'Unstoppable momentum',
    render: { scale: 1.6, bodyColor: '#3B82F6', accentColor: '#F3F4F6', wheelScale: 1.2, wheelColor: '#1F2937', bodyShape: 'long' },
  },
  {
    id: 'tank',
    name: 'Tank',
    cost: 25000,
    torque: 0.6,
    grip: 1.8,
    weight: 2.5,
    fuelEfficiency: 2.0,
    airControl: 0.3,
    description: 'Can climb anything',
    render: { scale: 1.4, bodyColor: '#4D7C0F', accentColor: '#1F2937', wheelScale: 0.6, wheelColor: '#57534E', bodyShape: 'tracked' },
  },
  {
    id: 'rocket',
    name: 'Rocket',
    cost: 50000,
    torque: 2.0,
    grip: 0.7,
    weight: 0.6,
    fuelEfficiency: 1.8,
    airControl: 1.8,
    description: 'Ridiculous speed',
    render: { scale: 1.1, bodyColor: '#F5F5F5', accentColor: '#DC2626', wheelScale: 0.9, wheelColor: '#1F2937', bodyShape: 'narrow' },
  },
];

// =============================================================================
// UPGRADES
// =============================================================================

export interface UpgradeLevel {
  cost: number;
  multiplier: number;
}

export interface NitroUpgradeLevel {
  cost: number;
  durationMult: number;
  rechargeMult: number;
}

export const UPGRADES = {
  engine: {
    name: 'Engine',
    levels: [
      { cost: 100, multiplier: 1.15 },
      { cost: 250, multiplier: 1.30 },
      { cost: 500, multiplier: 1.50 },
      { cost: 1000, multiplier: 1.75 },
      { cost: 2500, multiplier: 2.00 },
    ],
  },
  suspension: {
    name: 'Suspension',
    levels: [
      { cost: 100, multiplier: 1.10 },
      { cost: 250, multiplier: 1.20 },
      { cost: 500, multiplier: 1.35 },
      { cost: 1000, multiplier: 1.50 },
      { cost: 2500, multiplier: 1.70 },
    ],
  },
  tires: {
    name: 'Tires',
    levels: [
      { cost: 100, multiplier: 1.15 },
      { cost: 250, multiplier: 1.30 },
      { cost: 500, multiplier: 1.50 },
      { cost: 1000, multiplier: 1.75 },
      { cost: 2500, multiplier: 2.00 },
    ],
  },
  fuelTank: {
    name: 'Fuel Tank',
    levels: [
      { cost: 150, multiplier: 1.20 },
      { cost: 300, multiplier: 1.40 },
      { cost: 600, multiplier: 1.65 },
      { cost: 1200, multiplier: 1.90 },
      { cost: 3000, multiplier: 2.20 },
    ],
  },
  nitro: {
    name: 'Nitro Tank',
    levels: [
      { cost: 800, durationMult: 1.12, rechargeMult: 1.0 },
      { cost: 2000, durationMult: 1.28, rechargeMult: 1.07 },
      { cost: 5000, durationMult: 1.48, rechargeMult: 1.14 },
      { cost: 12000, durationMult: 1.68, rechargeMult: 1.23 },
      { cost: 25000, durationMult: 2.0, rechargeMult: 1.33 },
    ],
  },
} as const;

export type UpgradeType = keyof typeof UPGRADES;

// =============================================================================
// STAGES
// =============================================================================

export interface StageRenderConfig {
  // Sky
  skyGradient: [string, string]; // Top to bottom gradient
  hasClouds: boolean;
  hasStars: boolean;
  hasAurora: boolean;
  hasSnowfall: boolean;
  hasEmbers: boolean; // Rising ember particles (volcano)
  // Celestial bodies
  showSun: boolean;
  showMoon: boolean;
  showEarth: boolean;
  // Terrain decorations
  decorations: ('rocks' | 'trees' | 'crystals' | 'craters' | 'snowdrifts' | 'cacti')[];
  decorationColors: string[];
  // Ground detail
  groundDetailColor: string; // Grass, snow patches, etc.
  hasGroundDetail: boolean;
}

export interface StageConfig {
  id: string;
  name: string;
  gravity: number;
  friction: number;
  groundColor: string;
  skyColor: string;
  unlockDistance: number; // Best distance required to unlock
  render: StageRenderConfig;
}

export const STAGES: StageConfig[] = [
  {
    id: 'countryside',
    name: 'Countryside',
    gravity: 1,
    friction: 0.8,
    groundColor: '#228B22',
    skyColor: '#87CEEB',
    unlockDistance: 0,
    render: {
      skyGradient: ['#4A90D9', '#87CEEB'],
      hasClouds: true,
      hasStars: false,
      hasAurora: false,
      hasSnowfall: false,
      hasEmbers: false,
      showSun: true,
      showMoon: false,
      showEarth: false,
      decorations: ['rocks', 'trees'],
      decorationColors: ['#6B7280', '#2D5016', '#1F4010', '#3D7A20'],
      groundDetailColor: '#1B5E20',
      hasGroundDetail: true,
    },
  },
  {
    id: 'arctic',
    name: 'Arctic',
    gravity: 1,
    friction: 0.4, // Slippery!
    groundColor: '#E8E8E8',
    skyColor: '#B0C4DE',
    unlockDistance: 1000,
    render: {
      skyGradient: ['#1A1A3E', '#4A6FA5'],
      hasClouds: false,
      hasStars: true,
      hasAurora: true,
      hasSnowfall: true,
      hasEmbers: false,
      showSun: false,
      showMoon: true,
      showEarth: false,
      decorations: ['crystals', 'snowdrifts', 'rocks'],
      decorationColors: ['#B0E0E6', '#87CEEB', '#E0FFFF', '#F0F8FF'],
      groundDetailColor: '#FFFFFF',
      hasGroundDetail: true,
    },
  },
  {
    id: 'moon',
    name: 'Moon',
    gravity: 0.16, // 1/6 Earth gravity
    friction: 0.6,
    groundColor: '#808080',
    skyColor: '#000020',
    unlockDistance: 2500,
    render: {
      skyGradient: ['#000000', '#0A0A1A'],
      hasClouds: false,
      hasStars: true,
      hasAurora: false,
      hasSnowfall: false,
      hasEmbers: false,
      showSun: false,
      showMoon: false,
      showEarth: true,
      decorations: ['craters', 'rocks'],
      decorationColors: ['#5A5A5A', '#4A4A4A', '#6A6A6A', '#3A3A3A'],
      groundDetailColor: '#606060',
      hasGroundDetail: false,
    },
  },
  {
    id: 'desert',
    name: 'Desert',
    gravity: 1,
    friction: 0.5, // Sandy, less grip
    groundColor: '#C2B280',
    skyColor: '#F0E68C',
    unlockDistance: 2000,
    render: {
      skyGradient: ['#FF8C00', '#FFD700'],
      hasClouds: false,
      hasStars: false,
      hasAurora: false,
      hasSnowfall: false,
      hasEmbers: false,
      showSun: true,
      showMoon: false,
      showEarth: false,
      decorations: ['cacti', 'rocks'],
      decorationColors: ['#228B22', '#8B4513', '#A0522D', '#6B4423'],
      groundDetailColor: '#D2B48C',
      hasGroundDetail: true,
    },
  },
  {
    id: 'volcano',
    name: 'Volcano',
    gravity: 1,
    friction: 0.7,
    groundColor: '#2F2F2F',
    skyColor: '#1A0A0A',
    unlockDistance: 3500,
    render: {
      skyGradient: ['#1A0505', '#4A1010'],
      hasClouds: false,
      hasStars: false,
      hasAurora: false,
      hasSnowfall: false,
      hasEmbers: true, // Rising embers for volcano
      showSun: false,
      showMoon: false,
      showEarth: false,
      decorations: ['rocks', 'craters'],
      decorationColors: ['#3D3D3D', '#FF4500', '#8B0000', '#4A4A4A'],
      groundDetailColor: '#FF4500',
      hasGroundDetail: true,
    },
  },
];

// =============================================================================
// UI
// =============================================================================

export const UI = {
  // HUD
  FUEL_BAR_WIDTH: 200,
  FUEL_BAR_HEIGHT: 20,

  // Popup animations
  COIN_POPUP_DURATION: 1.5,
  COIN_POPUP_RISE: 50,

  // Game over
  GAME_OVER_DELAY: 1, // Seconds before showing game over screen

  // Mobile controls
  TOUCH_ZONE_OPACITY: 0.3,
} as const;

// =============================================================================
// CAMERA
// =============================================================================

export const CAMERA = {
  // Follow settings
  LOOK_AHEAD: 200, // Pixels ahead of vehicle
  VERTICAL_OFFSET: -100, // Pixels above vehicle
  SMOOTHING: 0.1, // Lower = smoother camera

  // Bounds
  MIN_Y: 100, // Don't go above this
} as const;

// =============================================================================
// AUDIO
// =============================================================================

export const AUDIO = {
  MASTER_VOLUME: 0.7,
  ENGINE_VOLUME: 0.4,
  COIN_VOLUME: 0.6,
  FUEL_VOLUME: 0.5,
  CRASH_VOLUME: 0.8,
  FLIP_VOLUME: 0.7,
} as const;
