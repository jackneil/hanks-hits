import type { ValidAppId } from "@hank-neil/db/schema";

export type EntityListPolicy = {
  /** Omit for a removable set of primitive values. */
  id?: string;
  max: number;
  /** Actual edit time, never a creation timestamp. */
  editedAt?: string;
  /** Match the store's insertion/eviction order; creation time is valid here. */
  orderBy?: string;
  newestFirst?: boolean;
};
export type ProgressConflictPolicy = {
  /** Paths in a group describe one coherent state, including its purchases. */
  atomicGroups?: readonly (readonly string[])[];
  entities?: Readonly<Record<string, EntityListPolicy>>;
};

/**
 * Exceptions to independent fields and PROGRESS_FIELD_RULES. Empty policies
 * are deliberate: those apps persist only records, settings and scalar choices.
 * A newly registered app must make that decision here before conflict sync.
 * These policies do not authorize replay of an ambiguously delivered request.
 */
export const PROGRESS_CONFLICT_POLICIES: Record<ValidAppId, ProgressConflictPolicy> = {
  "2048": {}, snake: {}, "flappy-bird": {}, "memory-match": {},
  checkers: {}, chess: {}, quoridor: {}, platformer: {},
  "space-invaders": {}, breakout: {}, hextris: {}, asteroids: {},
  bomberman: {}, "dino-runner": {}, "blitz-bomber": {}, trivia: {},
  wordle: {}, "math-attack": {}, arkanoid: {}, achievements: {},
  // Cookie keeps its existing explicit-choice continuation. This policy makes
  // accidental use of the generic merger conservative rather than additive.
  "cookie-clicker": {
    atomicGroups: [["cookies", "buildings", "purchasedUpgrades", "lastTick"]],
  },
  // Unlocks and upgrades spend the balance in the same store action.
  "hill-climb": {
    atomicGroups: [["coins", "unlockedVehicles", "unlockedStages", "vehicleUpgrades", "currentVehicleId", "currentStageId"]],
  },
  "monster-truck": {
    atomicGroups: [["coins", "trucks", "upgrades", "currentTruckId", "challenges"]],
  },
  "endless-runner": {
    atomicGroups: [["totalCoins", "unlockedCharacters", "selectedCharacter"]],
  },
  // The adventure world owns these projections; never mix two worlds.
  "four-wheeler-3d": {
    atomicGroups: [["adventure", "money", "ownedVehicles", "currentVehicle", "paint", "trophies", "fishCaught", "biggestFish", "land", "hunger", "day", "timeOfDay", "weather"]],
  },
  // A new journey resets all of these fields together (store.startGame/resetGame).
  "oregon-trail": {
    atomicGroups: [["gamePhase", "gameStarted", "leaderName", "occupation", "party", "departureMonth", "currentDay", "milesTraveled", "currentLandmarkIndex", "pace", "supplies", "weather", "currentEvent", "currentRiver", "huntingFood", "huntingAmmoUsed", "daysRested", "foodHunted", "riversCrossed", "eventsEncountered"]],
  },
  // Feeding, buying, equipping and adoption couple inventory, wallet and pet.
  "virtual-pet": {
    atomicGroups: [
      ["pet", "coins", "inventory", "equippedCosmetics", "stats.daysCaredFor", "settings.petName"],
      ["stats.currentStreak", "stats.lastPlayDate"],
    ],
  },
  weather: {
    atomicGroups: [["lastLocation"]],
    entities: { savedLocations: { id: "name", max: 50 } },
  },
  "drawing-app": {
    entities: { savedArtworks: { id: "id", editedAt: "editedAt", orderBy: "createdAt", newestFirst: true, max: 20 } },
  },
  "drum-machine": {
    entities: { savedBeats: { id: "id", orderBy: "createdAt", max: 100 } },
  },
  "joke-generator": {
    entities: {
      favorites: { id: "id", orderBy: "savedAt", max: 500 },
      ratings: { id: "jokeId", editedAt: "ratedAt", orderBy: "ratedAt", max: 2000 },
      seenJokeIds: { max: 5000 },
    },
  },
  "toy-finder": {
    entities: { wishlistItems: { id: "toyId", orderBy: "addedAt", max: 500 } },
  },
  "retro-arcade": {
    entities: { favorites: { max: 500 }, customRoms: { id: "id", orderBy: "addedAt", newestFirst: true, max: 500 } },
  },
};
