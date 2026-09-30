// constants.ts - Cookie Clicker game configuration
// All buildings, upgrades, and achievements defined here

// ============================================================================
// TYPES
// ============================================================================

export type BuildingId =
  | "cursor"
  | "grandma"
  | "bakery"
  | "factory"
  | "mine"
  | "bank"
  | "temple"
  | "wizardTower"
  | "spaceship"
  | "alchemyLab";

export type UpgradeId = string;
export type AchievementId = string;

export interface Building {
  id: BuildingId;
  name: string;
  description: string;
  baseCost: number;
  baseCps: number; // Cookies per second per building
  emoji: string;
}

export interface Upgrade {
  id: UpgradeId;
  name: string;
  description: string;
  cost: number;
  type: "click" | "building" | "global";
  targetBuilding?: BuildingId;
  multiplier?: number; // For building upgrades
  clickBonus?: number; // For click upgrades
  globalMultiplier?: number; // For global upgrades
  requiredBuildings?: Partial<Record<BuildingId, number>>; // Buildings needed to unlock
}

export interface Achievement {
  id: AchievementId;
  name: string;
  description: string;
  condition: "cookies" | "clicks" | "cps" | "building" | "upgrades" | "speed";
  threshold: number;
  targetBuilding?: BuildingId;
  cpsBonus?: number; // Percentage bonus to CPS
}

// ============================================================================
// BUILDINGS - The core progression
// ============================================================================

export const BUILDINGS: Building[] = [
  {
    id: "cursor",
    name: "Cursor",
    description: "Autoclicks once every 10 seconds",
    baseCost: 15,
    baseCps: 0.1,
    emoji: "👆",
  },
  {
    id: "grandma",
    name: "Grandma",
    description: "A nice grandma to bake more cookies",
    baseCost: 100,
    baseCps: 1,
    emoji: "👵",
  },
  {
    id: "bakery",
    name: "Bakery",
    description: "Produces delicious cookies",
    baseCost: 1100,
    baseCps: 8,
    emoji: "🏪",
  },
  {
    id: "factory",
    name: "Factory",
    description: "Industrial cookie production",
    baseCost: 12000,
    baseCps: 47,
    emoji: "🏭",
  },
  {
    id: "mine",
    name: "Mine",
    description: "Mines out cookie dough",
    baseCost: 130000,
    baseCps: 260,
    emoji: "⛏️",
  },
  {
    id: "bank",
    name: "Bank",
    description: "Generates cookies from interest",
    baseCost: 1400000,
    baseCps: 1400,
    emoji: "🏦",
  },
  {
    id: "temple",
    name: "Temple",
    description: "Ancient cookie rituals",
    baseCost: 20000000,
    baseCps: 7800,
    emoji: "🛕",
  },
  {
    id: "wizardTower",
    name: "Wizard Tower",
    description: "Magical cookie conjuring",
    baseCost: 330000000,
    baseCps: 44000,
    emoji: "🧙",
  },
  {
    id: "spaceship",
    name: "Spaceship",
    description: "Cookies from outer space",
    baseCost: 5100000000,
    baseCps: 260000,
    emoji: "🚀",
  },
  {
    id: "alchemyLab",
    name: "Alchemy Lab",
    description: "Transmutes gold into cookies",
    baseCost: 75000000000,
    baseCps: 1600000,
    emoji: "⚗️",
  },
];

// Building cost scales by 15% per purchase
export const BUILDING_COST_MULTIPLIER = 1.15;

// ============================================================================
// UPGRADES - Multipliers for buildings and clicks
// ============================================================================

export const UPGRADES: Upgrade[] = [
  // Click upgrades
  {
    id: "plastic-mouse",
    name: "Plastic Mouse",
    description: "+1 cookie per click",
    cost: 100,
    type: "click",
    clickBonus: 1,
  },
  {
    id: "iron-mouse",
    name: "Iron Mouse",
    description: "+1 cookie per click",
    cost: 500,
    type: "click",
    clickBonus: 1,
  },
  {
    id: "titanium-mouse",
    name: "Titanium Mouse",
    description: "+2 cookies per click",
    cost: 5000,
    type: "click",
    clickBonus: 2,
  },
  {
    id: "adamantium-mouse",
    name: "Adamantium Mouse",
    description: "+5 cookies per click",
    cost: 50000,
    type: "click",
    clickBonus: 5,
  },
  {
    id: "quantum-mouse",
    name: "Quantum Mouse",
    description: "+10 cookies per click",
    cost: 500000,
    type: "click",
    clickBonus: 10,
  },

  // Cursor upgrades
  {
    id: "reinforced-finger",
    name: "Reinforced Finger",
    description: "Cursors are twice as efficient",
    cost: 100,
    type: "building",
    targetBuilding: "cursor",
    multiplier: 2,
    requiredBuildings: { cursor: 1 },
  },
  {
    id: "carpal-tunnel",
    name: "Carpal Tunnel Prevention",
    description: "Cursors are twice as efficient",
    cost: 500,
    type: "building",
    targetBuilding: "cursor",
    multiplier: 2,
    requiredBuildings: { cursor: 1 },
  },

  // Grandma upgrades
  {
    id: "rolling-pins",
    name: "Rolling Pins",
    description: "Grandmas are twice as efficient",
    cost: 1000,
    type: "building",
    targetBuilding: "grandma",
    multiplier: 2,
    requiredBuildings: { grandma: 1 },
  },
  {
    id: "baking-powder",
    name: "Baking Powder",
    description: "Grandmas are twice as efficient",
    cost: 5000,
    type: "building",
    targetBuilding: "grandma",
    multiplier: 2,
    requiredBuildings: { grandma: 5 },
  },
  {
    id: "grandma-secret-recipe",
    name: "Secret Recipe",
    description: "Grandmas are twice as efficient",
    cost: 50000,
    type: "building",
    targetBuilding: "grandma",
    multiplier: 2,
    requiredBuildings: { grandma: 25 },
  },

  // Bakery upgrades
  {
    id: "bigger-ovens",
    name: "Bigger Ovens",
    description: "Bakeries are twice as efficient",
    cost: 11000,
    type: "building",
    targetBuilding: "bakery",
    multiplier: 2,
    requiredBuildings: { bakery: 1 },
  },
  {
    id: "conveyor-belts",
    name: "Conveyor Belts",
    description: "Bakeries are twice as efficient",
    cost: 55000,
    type: "building",
    targetBuilding: "bakery",
    multiplier: 2,
    requiredBuildings: { bakery: 5 },
  },

  // Factory upgrades
  {
    id: "sturdier-machines",
    name: "Sturdier Machines",
    description: "Factories are twice as efficient",
    cost: 120000,
    type: "building",
    targetBuilding: "factory",
    multiplier: 2,
    requiredBuildings: { factory: 1 },
  },
  {
    id: "child-labor",
    name: "Cookie Robots",
    description: "Factories are twice as efficient",
    cost: 600000,
    type: "building",
    targetBuilding: "factory",
    multiplier: 2,
    requiredBuildings: { factory: 5 },
  },

  // Mine upgrades
  {
    id: "sugar-gas",
    name: "Sugar Gas",
    description: "Mines are twice as efficient",
    cost: 1300000,
    type: "building",
    targetBuilding: "mine",
    multiplier: 2,
    requiredBuildings: { mine: 1 },
  },
  {
    id: "megadrill",
    name: "Megadrill",
    description: "Mines are twice as efficient",
    cost: 6500000,
    type: "building",
    targetBuilding: "mine",
    multiplier: 2,
    requiredBuildings: { mine: 5 },
  },

  // Global upgrades
  {
    id: "lucky-day",
    name: "Lucky Day",
    description: "+10% CPS globally",
    cost: 100000,
    type: "global",
    globalMultiplier: 1.1,
  },
  {
    id: "serendipity",
    name: "Serendipity",
    description: "+10% CPS globally",
    cost: 1000000,
    type: "global",
    globalMultiplier: 1.1,
  },
  {
    id: "get-lucky",
    name: "Get Lucky",
    description: "+10% CPS globally",
    cost: 10000000,
    type: "global",
    globalMultiplier: 1.1,
  },
];

// ============================================================================
// ACHIEVEMENTS - Dopamine hits!
// ============================================================================

export const ACHIEVEMENTS: Achievement[] = [
  // Cookie milestones
  {
    id: "first-cookie",
    name: "First Cookie",
    description: "Bake your first cookie",
    condition: "cookies",
    threshold: 1,
    cpsBonus: 1,
  },
  {
    id: "cookie-novice",
    name: "Cookie Novice",
    description: "Bake 100 cookies",
    condition: "cookies",
    threshold: 100,
    cpsBonus: 1,
  },
  {
    id: "cookie-apprentice",
    name: "Cookie Apprentice",
    description: "Bake 1,000 cookies",
    condition: "cookies",
    threshold: 1000,
    cpsBonus: 1,
  },
  {
    id: "cookie-baker",
    name: "Cookie Baker",
    description: "Bake 10,000 cookies",
    condition: "cookies",
    threshold: 10000,
    cpsBonus: 1,
  },
  {
    id: "cookie-master",
    name: "Cookie Master",
    description: "Bake 100,000 cookies",
    condition: "cookies",
    threshold: 100000,
    cpsBonus: 1,
  },
  {
    id: "cookie-champion",
    name: "Cookie Champion",
    description: "Bake 1 million cookies",
    condition: "cookies",
    threshold: 1000000,
    cpsBonus: 2,
  },
  {
    id: "cookie-legend",
    name: "Cookie Legend",
    description: "Bake 100 million cookies",
    condition: "cookies",
    threshold: 100000000,
    cpsBonus: 2,
  },
  {
    id: "cookie-god",
    name: "Cookie God",
    description: "Bake 1 billion cookies",
    condition: "cookies",
    threshold: 1000000000,
    cpsBonus: 5,
  },

  // Click milestones
  {
    id: "clicker",
    name: "Clicker",
    description: "Tap the cookie 100 times",
    condition: "clicks",
    threshold: 100,
  },
  {
    id: "double-click",
    name: "Double Click",
    description: "Tap the cookie 500 times",
    condition: "clicks",
    threshold: 500,
  },
  {
    id: "mouse-destroyer",
    name: "Mouse Destroyer",
    description: "Tap the cookie 1,000 times",
    condition: "clicks",
    threshold: 1000,
    cpsBonus: 1,
  },
  {
    id: "carpal-tunnel-syndrome",
    name: "Carpal Tunnel Pro",
    description: "Tap the cookie 5,000 times",
    condition: "clicks",
    threshold: 5000,
    cpsBonus: 1,
  },
  {
    id: "finger-of-steel",
    name: "Finger of Steel",
    description: "Tap the cookie 10,000 times",
    condition: "clicks",
    threshold: 10000,
    cpsBonus: 2,
  },

  // CPS milestones
  {
    id: "cps-1",
    name: "Starting Out",
    description: "Reach 1 cookie per second",
    condition: "cps",
    threshold: 1,
  },
  {
    id: "cps-10",
    name: "Getting Somewhere",
    description: "Reach 10 cookies per second",
    condition: "cps",
    threshold: 10,
    cpsBonus: 1,
  },
  {
    id: "cps-100",
    name: "Cookie Factory",
    description: "Reach 100 cookies per second",
    condition: "cps",
    threshold: 100,
    cpsBonus: 1,
  },
  {
    id: "cps-1000",
    name: "Cookie Empire",
    description: "Reach 1,000 cookies per second",
    condition: "cps",
    threshold: 1000,
    cpsBonus: 2,
  },
  {
    id: "cps-10000",
    name: "Cookie Universe",
    description: "Reach 10,000 cookies per second",
    condition: "cps",
    threshold: 10000,
    cpsBonus: 2,
  },

  // Building milestones
  {
    id: "first-cursor",
    name: "Auto Clicker",
    description: "Own 1 cursor",
    condition: "building",
    targetBuilding: "cursor",
    threshold: 1,
  },
  {
    id: "first-grandma",
    name: "Grandma's Boy",
    description: "Own 1 grandma",
    condition: "building",
    targetBuilding: "grandma",
    threshold: 1,
  },
  {
    id: "grandma-army",
    name: "Grandma Army",
    description: "Own 10 grandmas",
    condition: "building",
    targetBuilding: "grandma",
    threshold: 10,
    cpsBonus: 1,
  },
  {
    id: "first-bakery",
    name: "Baker's Dozen",
    description: "Own 1 bakery",
    condition: "building",
    targetBuilding: "bakery",
    threshold: 1,
  },
  {
    id: "first-factory",
    name: "Industrialist",
    description: "Own 1 factory",
    condition: "building",
    targetBuilding: "factory",
    threshold: 1,
  },
  {
    id: "first-mine",
    name: "Miner Forty-Niner",
    description: "Own 1 mine",
    condition: "building",
    targetBuilding: "mine",
    threshold: 1,
  },
  {
    id: "first-bank",
    name: "Banker",
    description: "Own 1 bank",
    condition: "building",
    targetBuilding: "bank",
    threshold: 1,
  },
  {
    id: "first-temple",
    name: "Temple Runner",
    description: "Own 1 temple",
    condition: "building",
    targetBuilding: "temple",
    threshold: 1,
  },
  {
    id: "first-wizard-tower",
    name: "Wizard",
    description: "Own 1 wizard tower",
    condition: "building",
    targetBuilding: "wizardTower",
    threshold: 1,
  },
  {
    id: "first-spaceship",
    name: "Space Cadet",
    description: "Own 1 spaceship",
    condition: "building",
    targetBuilding: "spaceship",
    threshold: 1,
  },
  {
    id: "first-alchemy-lab",
    name: "Alchemist",
    description: "Own 1 alchemy lab",
    condition: "building",
    targetBuilding: "alchemyLab",
    threshold: 1,
  },

  // Upgrade milestones
  {
    id: "upgrade-5",
    name: "Enhancer",
    description: "Purchase 5 upgrades",
    condition: "upgrades",
    threshold: 5,
    cpsBonus: 1,
  },
  {
    id: "upgrade-10",
    name: "Augmenter",
    description: "Purchase 10 upgrades",
    condition: "upgrades",
    threshold: 10,
    cpsBonus: 2,
  },
  {
    id: "upgrade-20",
    name: "Upgrader",
    description: "Purchase 20 upgrades",
    condition: "upgrades",
    threshold: 20,
    cpsBonus: 3,
  },
];

// ============================================================================
// GAME CONFIGURATION
// ============================================================================

export const GAME_CONFIG = {
  // Base click value
  BASE_CLICK_VALUE: 1,

  // Tick rate for CPS calculations (in milliseconds)
  TICK_RATE: 50, // 20 ticks per second

  // Auto-save interval
  AUTOSAVE_INTERVAL: 5000, // 5 seconds

  // Offline progress
  MAX_OFFLINE_HOURS: 8,

  // Golden cookie spawn rate (in milliseconds)
  GOLDEN_COOKIE_MIN_SPAWN: 60000, // 1 minute
  GOLDEN_COOKIE_MAX_SPAWN: 300000, // 5 minutes
  GOLDEN_COOKIE_DURATION: 10000, // 10 seconds to click

  // Frenzy durations
  FRENZY_DURATION: 30000, // 30 seconds
  CLICK_FRENZY_DURATION: 13000, // 13 seconds

  // Frenzy multipliers
  FRENZY_MULTIPLIER: 7,
  CLICK_FRENZY_MULTIPLIER: 777,
} as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

export function getBuildingById(id: BuildingId): Building {
  const building = BUILDINGS.find((b) => b.id === id);
  if (!building) throw new Error(`Building not found: ${id}`);
  return building;
}

export function getUpgradeById(id: UpgradeId): Upgrade | undefined {
  return UPGRADES.find((u) => u.id === id);
}

export function getAchievementById(id: AchievementId): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

// Calculate the cost of the next building purchase
export function calculateBuildingCost(
  buildingId: BuildingId,
  owned: number
): number {
  const building = getBuildingById(buildingId);
  return Math.floor(
    building.baseCost * Math.pow(BUILDING_COST_MULTIPLIER, owned)
  );
}

// Format large numbers for display
export function formatNumber(num: number): string {
  if (num < 1000) {
    return Math.floor(num).toLocaleString();
  }
  if (num < 1000000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  if (num < 1000000000) {
    return `${(num / 1000000).toFixed(2)} million`;
  }
  if (num < 1000000000000) {
    return `${(num / 1000000000).toFixed(2)} billion`;
  }
  return `${(num / 1000000000000).toFixed(2)} trillion`;
}

// Format CPS with more precision for small values
export function formatCps(cps: number): string {
  if (cps < 1) {
    return cps.toFixed(1);
  }
  return formatNumber(cps);
}
