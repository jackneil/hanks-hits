// ==============================================
// VIRTUAL PET - CONSTANTS
// ==============================================

// Stats decay rates (per hour)
export const DECAY_RATES = {
  hunger: 5,
  happiness: 3,
  energy: 10, // Only when awake
  cleanliness: 2,
};

// Stat refill amounts
export const REFILL_AMOUNTS = {
  feed: {
    apple: 20,
    steak: 50,
    cookie: 10,
  },
  play: 30,
  sleep: 100, // Full restore
  clean: 40,
};

// Pet moods
export const MOOD_THRESHOLDS = {
  ecstatic: 80,   // All stats > 80
  happy: 50,       // All stats > 50
  content: 40,     // Average 40-60
  sad: 30,         // Any stat < 30
  miserable: 20,   // Multiple stats < 20
};

// Evolution (days of care)
export const EVOLUTION_DAYS = {
  child: 3,
  teen: 7,
  adult: 14,
};

// Mini-game settings
export const MINIGAME_REWARD = 15; // Coins per game
export const PLAY_HAPPINESS_GAIN = 25;
export const PLAY_ENERGY_COST = 10;

// Shop items
export interface ShopItem {
  id: string;
  name: string;
  emoji: string;
  price: number;
  type: "food" | "toy" | "cosmetic";
  effect?: {
    stat: "hunger" | "happiness";
    amount: number;
  };
}

export const SHOP_ITEMS: ShopItem[] = [
  { id: "apple", name: "Apple", emoji: "🍎", price: 10, type: "food", effect: { stat: "hunger", amount: 20 } },
  { id: "steak", name: "Steak", emoji: "🥩", price: 30, type: "food", effect: { stat: "hunger", amount: 50 } },
  { id: "cookie", name: "Cookie", emoji: "🍪", price: 15, type: "food", effect: { stat: "hunger", amount: 15 } },
  { id: "ball", name: "Ball", emoji: "⚽", price: 20, type: "toy", effect: { stat: "happiness", amount: 30 } },
  { id: "hat", name: "Hat", emoji: "🎩", price: 100, type: "cosmetic" },
  { id: "bow", name: "Bow", emoji: "🎀", price: 80, type: "cosmetic" },
  { id: "glasses", name: "Glasses", emoji: "🕶️", price: 120, type: "cosmetic" },
];

// Pet species
export interface PetSpecies {
  id: string;
  name: string;
  emoji: string;
  unlockCondition: string;
  personality: string;
  evolutions: {
    baby: string;
    child: string;
    teen: string;
    adult: string;
  };
}

export const PET_SPECIES: PetSpecies[] = [
  {
    id: "blobby",
    name: "Blobby",
    emoji: "🟢",
    unlockCondition: "Default",
    personality: "Easy to care for",
    evolutions: { baby: "🟢", child: "🟡", teen: "🟠", adult: "🔴" },
  },
  {
    id: "pupper",
    name: "Pupper",
    emoji: "🐕",
    unlockCondition: "Reach Day 7",
    personality: "Needs lots of play",
    evolutions: { baby: "🐶", child: "🐕", teen: "🐕‍🦺", adult: "🦮" },
  },
  {
    id: "kitcat",
    name: "Kitcat",
    emoji: "🐱",
    unlockCondition: "Get 3-day streak",
    personality: "Independent",
    evolutions: { baby: "🐱", child: "😺", teen: "😸", adult: "🐈" },
  },
  {
    id: "draggo",
    name: "Draggo",
    emoji: "🐉",
    unlockCondition: "Perfect care for 5 days",
    personality: "Hungry boy",
    evolutions: { baby: "🥚", child: "🐲", teen: "🐉", adult: "🔥" },
  },
];

// Pet stage
export type PetStage = "baby" | "child" | "teen" | "adult";

// Pet mood
export type PetMood = "ecstatic" | "happy" | "content" | "sad" | "miserable" | "sleeping";

// Colors
export const COLORS = {
  BACKGROUND: "#fef3c7", // Warm yellow
  PRIMARY: "#f59e0b",    // Amber
  SECONDARY: "#10b981",  // Emerald
  DANGER: "#ef4444",     // Red
  TEXT: "#1f2937",       // Gray 800
};

// Calculate mood based on stats
export function calculateMood(
  hunger: number,
  happiness: number,
  energy: number,
  cleanliness: number,
  sleeping: boolean
): PetMood {
  if (sleeping) return "sleeping";

  const stats = [hunger, happiness, energy, cleanliness];
  const min = Math.min(...stats);
  const belowThreshold = stats.filter(s => s < MOOD_THRESHOLDS.miserable).length;

  if (belowThreshold >= 2) return "miserable";
  if (min < MOOD_THRESHOLDS.sad) return "sad";
  if (stats.every(s => s > MOOD_THRESHOLDS.ecstatic)) return "ecstatic";
  if (stats.every(s => s > MOOD_THRESHOLDS.happy)) return "happy";
  return "content";
}

// Get mood emoji
export function getMoodEmoji(mood: PetMood): string {
  switch (mood) {
    case "ecstatic": return "🤩";
    case "happy": return "😊";
    case "content": return "😐";
    case "sad": return "😢";
    case "miserable": return "😭";
    case "sleeping": return "😴";
  }
}

// Get stage from days
export function getStage(daysCaredFor: number): PetStage {
  if (daysCaredFor >= EVOLUTION_DAYS.adult) return "adult";
  if (daysCaredFor >= EVOLUTION_DAYS.teen) return "teen";
  if (daysCaredFor >= EVOLUTION_DAYS.child) return "child";
  return "baby";
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
