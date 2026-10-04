/**
 * The reviewed direction of every field in every progress schema.
 *
 * The server merges two saves of one game by last write wins: the save with
 * the newer `lastModified` is the base (progress-merge.ts). A field that only
 * grows, or a best that only gets better, must not go back when an older
 * save carries the better value. This table says, for each field, which
 * value of the two saves to keep:
 *
 * - max: the larger value. The store only adds to the field or keeps the
 *   larger value (outside a full reset of the game). For a true/false field,
 *   true wins (a level once completed stays completed). For a list of
 *   numbers, the larger number at each place.
 * - minPositive: the smaller value above zero. A best time or a fewest-moves
 *   win, where 0 or null means "no record yet".
 * - earliest: the smaller value. The time of a trophy unlock.
 * - union: every item of both lists. A list of things the kid unlocked.
 * - neither: the base's value stays. A wallet the kid spends, a value that
 *   goes down in play, a setting, a time, text, or a list the kid can edit.
 *
 * A path is the field names joined by ".". "*" stands for any key of a
 * record (a level id, a stage id). A list of objects is one entry: its items
 * merge by id in the conflict protocol (#69i), not here.
 *
 * Every entry for max, minPositive, earliest and union cites the store line
 * that proves the direction (file:line under apps/web/src, and a piece of
 * the code in backticks). An entry for neither on a field whose name looks
 * like a record (total..., best..., ...Won) cites the line that makes the
 * field go down. progress-field-rules.test.ts checks that this table names
 * every field of every schema, and that each cited file holds its code.
 *
 * When you add a game or a field: add its entry here, read the store, and
 * use max only when no code path makes the field smaller.
 */

import type { ProgressSchemasByApp } from "./progress-schemas";

export type FieldRule = "max" | "minPositive" | "earliest" | "union" | "neither";

export type FieldDirection = {
  rule: FieldRule;
  /** The proof (file:line and code) or the reason. */
  why: string;
  /** This entry covers every field under the path (a saved world). */
  subtree?: true;
};

const max = (why: string): FieldDirection => ({ rule: "max", why });
const minPositive = (why: string): FieldDirection => ({ rule: "minPositive", why });
const earliest = (why: string): FieldDirection => ({ rule: "earliest", why });
const union = (why: string): FieldDirection => ({ rule: "union", why });
const neither = (why: string): FieldDirection => ({ rule: "neither", why });
const snapshot = (why: string): FieldDirection => ({ rule: "neither", why, subtree: true });

// Reasons that many fields share.
const TIME = neither("A time, not a record. mergeProgress sets lastModified itself.");
const SETTING = neither("A setting. The kid changes it both ways.");
const TEXT = neither("Text or a choice. It has no order.");
const LIST = neither(
  "A list of items that the kid adds and removes. A merge by item id is the conflict protocol (#69i)."
);
const STATE = neither("The state of the current game. It goes up and down in play.");
// Oregon Trail saves one journey. A new journey starts every field again.
const JOURNEY = neither(
  "This journey only: a new journey starts it again. games/oregon-trail/lib/store.ts:221 `set(defaultState)`"
);

export const PROGRESS_FIELD_RULES: {
  [A in keyof ProgressSchemasByApp]: Record<string, FieldDirection>;
} = {
  "2048": {
    highScore: max("games/2048/lib/store.ts:127 `const newHighScore = Math.max(state.highScore, newScore)`"),
    highestTile: max("games/2048/lib/store.ts:162 `highestTile: Math.max(state.highestTile, currentHighest)`"),
    gamesPlayed: max("games/2048/lib/store.ts:172 `const newGamesPlayed = state.gamesPlayed + 1`"),
    gamesWon: max("games/2048/lib/store.ts:142 `newGamesWon = state.gamesWon + 1`"),
    lastModified: TIME,
  },
  snake: {
    highScore: max("games/snake/lib/store.ts:187 `highScore: Math.max(progress.highScore, state.score)`"),
    gamesPlayed: max("games/snake/lib/store.ts:186 `gamesPlayed: progress.gamesPlayed + 1`"),
    totalFoodEaten: max("games/snake/lib/store.ts:234 `totalFoodEaten: progress.totalFoodEaten + 1`"),
    longestSnake: max("games/snake/lib/store.ts:188 `longestSnake: Math.max(progress.longestSnake, state.snake.length)`"),
    soundEnabled: SETTING,
    wraparoundWalls: SETTING,
    controlMode: SETTING,
    speed: SETTING,
    lastModified: TIME,
  },
  "flappy-bird": {
    highScore: max("games/flappy-bird/lib/store.ts:235 `highScore: Math.max(state.progress.highScore, state.score)`"),
    gamesPlayed: max("games/flappy-bird/lib/store.ts:236 `gamesPlayed: state.progress.gamesPlayed + 1`"),
    totalPipes: max("games/flappy-bird/lib/store.ts:237 `totalPipes: state.progress.totalPipes + state.score`"),
    "medals.bronze": max("games/flappy-bird/lib/store.ts:239 `bronze: state.progress.medals.bronze + (medal`"),
    "medals.silver": max("games/flappy-bird/lib/store.ts:240 `silver: state.progress.medals.silver + (medal`"),
    "medals.gold": max("games/flappy-bird/lib/store.ts:241 `gold: state.progress.medals.gold + (medal`"),
    "medals.platinum": max("games/flappy-bird/lib/store.ts:242 `platinum: state.progress.medals.platinum + (medal`"),
    lastModified: TIME,
  },
  "cookie-clicker": {
    cookies: neither("A wallet. games/cookie-clicker/lib/store.ts:237 `cookies: s.cookies - cost`"),
    totalCookiesBaked: max("games/cookie-clicker/lib/store.ts:182 `totalCookiesBaked: s.totalCookiesBaked + earned`"),
    totalClicks: max("games/cookie-clicker/lib/store.ts:183 `totalClicks: s.totalClicks + 1`"),
    // Bought with cookies and never sold: a max keeps a building bought on
    // another device, as the union of purchasedUpgrades keeps an upgrade.
    "buildings.*": max("games/cookie-clicker/lib/store.ts:240 `[buildingId]: s.buildings[buildingId] + 1`"),
    purchasedUpgrades: union("games/cookie-clicker/lib/store.ts:265 `purchasedUpgrades: [...s.purchasedUpgrades, upgradeId]`"),
    unlockedAchievements: union("games/cookie-clicker/lib/store.ts:434 `unlockedAchievements: [`"),
    soundEnabled: SETTING,
    lastTick: TIME,
    lastModified: TIME,
  },
  "memory-match": {
    updatedAt: TIME,
    "bestTimes.easy": minPositive("games/memory-match/lib/store.ts:197 `if (currentBest === null || elapsedTime < currentBest)`"),
    "bestTimes.medium": minPositive("games/memory-match/lib/store.ts:197 `if (currentBest === null || elapsedTime < currentBest)`"),
    "bestTimes.hard": minPositive("games/memory-match/lib/store.ts:197 `if (currentBest === null || elapsedTime < currentBest)`"),
    "bestTimes.expert": minPositive("games/memory-match/lib/store.ts:197 `if (currentBest === null || elapsedTime < currentBest)`"),
    totalMatches: max("games/memory-match/lib/store.ts:190 `newProgress.totalMatches += newMatchedPairs`"),
    gamesPlayed: max("games/memory-match/lib/store.ts:188 `newProgress.gamesPlayed += 1`"),
    gamesWon: max("games/memory-match/lib/store.ts:189 `newProgress.gamesWon += 1`"),
    perfectGames: max("games/memory-match/lib/store.ts:191 `if (isPerfect) newProgress.perfectGames += 1`"),
    favoriteTheme: TEXT,
    soundEnabled: SETTING,
    unlockedThemes: union("games/memory-match/lib/store.ts:208 `newProgress.unlockedThemes.push(themeConfig.id)`"),
    difficulty: SETTING,
    theme: SETTING,
  },
  checkers: {
    gamesPlayed: max("games/checkers/lib/store.ts:272 `gamesPlayed: state.progress.gamesPlayed + 1`"),
    gamesWon: max("games/checkers/lib/store.ts:273 `gamesWon: state.progress.gamesWon + 1`"),
    gamesLost: max("games/checkers/lib/store.ts:291 `gamesLost: state.progress.gamesLost + 1`"),
    totalPiecesCaptured: max("games/checkers/lib/store.ts:274 `totalPiecesCaptured: state.progress.totalPiecesCaptured + state.piecesCapturedThisGame`"),
    totalKingsEarned: max("games/checkers/lib/store.ts:275 `totalKingsEarned: state.progress.totalKingsEarned + state.kingsEarnedThisGame`"),
    longestJumpChain: max("games/checkers/lib/store.ts:276 `longestJumpChain: Math.max(state.progress.longestJumpChain, state.longestChainThisGame)`"),
    currentWinStreak: neither("A streak that a loss ends. games/checkers/lib/store.ts:295 `currentWinStreak: 0,`"),
    bestWinStreak: max("games/checkers/lib/store.ts:278 `bestWinStreak: Math.max(state.progress.bestWinStreak, newStreak)`"),
    // diffKey is `${diff}Wins` or `${diff}Losses` (store.ts:267, 287).
    easyWins: max("games/checkers/lib/store.ts:279 `[diffKey]: (state.progress[diffKey] as number) + 1`"),
    easyLosses: max("games/checkers/lib/store.ts:296 `[diffKey]: (state.progress[diffKey] as number) + 1`"),
    mediumWins: max("games/checkers/lib/store.ts:279 `[diffKey]: (state.progress[diffKey] as number) + 1`"),
    mediumLosses: max("games/checkers/lib/store.ts:296 `[diffKey]: (state.progress[diffKey] as number) + 1`"),
    hardWins: max("games/checkers/lib/store.ts:279 `[diffKey]: (state.progress[diffKey] as number) + 1`"),
    hardLosses: max("games/checkers/lib/store.ts:296 `[diffKey]: (state.progress[diffKey] as number) + 1`"),
    twoPlayerGamesPlayed: max("games/checkers/lib/store.ts:306 `twoPlayerGamesPlayed: state.progress.twoPlayerGamesPlayed + 1`"),
    twoPlayerRedWins: max("games/checkers/lib/store.ts:307 `twoPlayerRedWins: state.progress.twoPlayerRedWins + (winner`"),
    twoPlayerBlackWins: max("games/checkers/lib/store.ts:308 `twoPlayerBlackWins: state.progress.twoPlayerBlackWins + (winner`"),
    variant: SETTING,
    gameMode: SETTING,
    difficulty: SETTING,
    lastModified: TIME,
  },
  chess: {
    gamesPlayed: max("games/chess/lib/store.ts:362 `gamesPlayed: state.progress.gamesPlayed + 1`"),
    gamesWon: max("games/chess/lib/store.ts:363 `gamesWon: state.progress.gamesWon + 1`"),
    gamesLost: max("games/chess/lib/store.ts:382 `gamesLost: state.progress.gamesLost + 1`"),
    gamesDrawn: max("games/chess/lib/store.ts:396 `gamesDrawn: state.progress.gamesDrawn + 1`"),
    totalPiecesCaptured: max("games/chess/lib/store.ts:213 `totalPiecesCaptured: s.progress.totalPiecesCaptured + 1`"),
    totalCheckmates: max("games/chess/lib/store.ts:364 `totalCheckmates: state.progress.totalCheckmates + 1`"),
    currentWinStreak: neither("A streak that a loss ends. games/chess/lib/store.ts:383 `currentWinStreak: 0,`"),
    bestWinStreak: max("games/chess/lib/store.ts:366 `bestWinStreak: Math.max(state.progress.bestWinStreak, newStreak)`"),
    // diffWinKey / diffLossKey are `${diff}Wins` / `${diff}Losses` (store.ts:358, 377).
    easyWins: max("games/chess/lib/store.ts:367 `[diffWinKey]: (state.progress[diffWinKey] as number) + 1`"),
    easyLosses: max("games/chess/lib/store.ts:384 `[diffLossKey]: (state.progress[diffLossKey] as number) + 1`"),
    mediumWins: max("games/chess/lib/store.ts:367 `[diffWinKey]: (state.progress[diffWinKey] as number) + 1`"),
    mediumLosses: max("games/chess/lib/store.ts:384 `[diffLossKey]: (state.progress[diffLossKey] as number) + 1`"),
    hardWins: max("games/chess/lib/store.ts:367 `[diffWinKey]: (state.progress[diffWinKey] as number) + 1`"),
    hardLosses: max("games/chess/lib/store.ts:384 `[diffLossKey]: (state.progress[diffLossKey] as number) + 1`"),
    difficulty: SETTING,
    gameMode: SETTING,
    playerColor: SETTING,
    lastModified: TIME,
  },
  quoridor: {
    gamesPlayed: max("games/quoridor/lib/store.ts:203 `gamesPlayed: state.progress.gamesPlayed + 1`"),
    gamesWon: max("games/quoridor/lib/store.ts:216 `gamesWon: state.progress.gamesWon + 1`"),
    gamesLost: max("games/quoridor/lib/store.ts:233 `gamesLost: state.progress.gamesLost + 1`"),
    currentWinStreak: neither("A streak that a loss ends. games/quoridor/lib/store.ts:234 `currentWinStreak: 0,`"),
    bestWinStreak: max("games/quoridor/lib/store.ts:218 `bestWinStreak: Math.max(state.progress.bestWinStreak, streak)`"),
    totalWallsPlaced: max("games/quoridor/lib/store.ts:195 `const wallsPlaced = state.progress.totalWallsPlaced + state.wallsPlacedThisGame`"),
    totalMovesToWin: max("games/quoridor/lib/store.ts:220 `totalMovesToWin: state.progress.totalMovesToWin + state.movesThisGame`"),
    // The fewest moves to a win; null until the first win.
    fastestWin: minPositive("games/quoridor/lib/store.ts:224 `Math.min(state.progress.fastestWin, state.movesThisGame)`"),
    difficulty: SETTING,
    gameMode: SETTING,
    lastModified: TIME,
  },
  // One journey, saved whole. A new journey starts every field again, so no
  // field of it is a record (games/oregon-trail/lib/store.ts:168
  // `resetGame: () => set(defaultState)`, and startGame at store.ts:74).
  "oregon-trail": {
    journeyId: JOURNEY,
    gamePhase: JOURNEY,
    gameStarted: JOURNEY,
    leaderName: TEXT,
    occupation: TEXT,
    party: LIST,
    departureMonth: TEXT,
    currentDay: JOURNEY,
    milesTraveled: JOURNEY,
    currentLandmarkIndex: JOURNEY,
    pace: SETTING,
    "supplies.food": JOURNEY,
    "supplies.oxen": JOURNEY,
    "supplies.clothing": JOURNEY,
    "supplies.ammunition": JOURNEY,
    "supplies.spareParts.wheels": JOURNEY,
    "supplies.spareParts.axles": JOURNEY,
    "supplies.spareParts.tongues": JOURNEY,
    "supplies.money": JOURNEY,
    weather: JOURNEY,
    currentEvent: snapshot(JOURNEY.why),
    "currentRiver.name": JOURNEY,
    "currentRiver.depth": JOURNEY,
    huntingFood: JOURNEY,
    huntingAmmoUsed: JOURNEY,
    daysRested: JOURNEY,
    foodHunted: JOURNEY,
    riversCrossed: JOURNEY,
    eventsEncountered: JOURNEY,
    lastModified: TIME,
  },
  "monster-truck": {
    coins: neither("A wallet. games/monster-truck/lib/store.ts:377 `coins: state.coins - cost`"),
    totalCoinsEarned: max("games/monster-truck/lib/store.ts:320 `totalCoinsEarned: state.totalCoinsEarned + amount`"),
    currentTruckId: SETTING,
    // The unlocked flag of each truck is inside this list (#69i).
    trucks: LIST,
    "upgrades.*.engine.level": max("games/monster-truck/lib/store.ts:382 `[stat]: { ...upgrade, level: upgrade.level + 1 }`"),
    "upgrades.*.engine.maxLevel": neither("A fixed limit of the game. games/monster-truck/lib/store.ts:224 `engine: { level: 0, maxLevel: 5, costs: [100, 250, 500, 1000, 2500] }`"),
    "upgrades.*.engine.costs": neither("Fixed prices of the game. games/monster-truck/lib/store.ts:224 `engine: { level: 0, maxLevel: 5, costs: [100, 250, 500, 1000, 2500] }`"),
    "upgrades.*.suspension.level": max("games/monster-truck/lib/store.ts:382 `[stat]: { ...upgrade, level: upgrade.level + 1 }`"),
    "upgrades.*.suspension.maxLevel": neither("A fixed limit of the game. games/monster-truck/lib/store.ts:225 `suspension: { level: 0, maxLevel: 5, costs: [100, 250, 500, 1000, 2500] }`"),
    "upgrades.*.suspension.costs": neither("Fixed prices of the game. games/monster-truck/lib/store.ts:225 `suspension: { level: 0, maxLevel: 5, costs: [100, 250, 500, 1000, 2500] }`"),
    "upgrades.*.tires.level": max("games/monster-truck/lib/store.ts:382 `[stat]: { ...upgrade, level: upgrade.level + 1 }`"),
    "upgrades.*.tires.maxLevel": neither("A fixed limit of the game. games/monster-truck/lib/store.ts:226 `tires: { level: 0, maxLevel: 5, costs: [100, 250, 500, 1000, 2500] }`"),
    "upgrades.*.tires.costs": neither("Fixed prices of the game. games/monster-truck/lib/store.ts:226 `tires: { level: 0, maxLevel: 5, costs: [100, 250, 500, 1000, 2500] }`"),
    "upgrades.*.nos.level": max("games/monster-truck/lib/store.ts:382 `[stat]: { ...upgrade, level: upgrade.level + 1 }`"),
    "upgrades.*.nos.maxLevel": neither("A fixed limit of the game. games/monster-truck/lib/store.ts:227 `nos: { level: 0, maxLevel: 5, costs: [150, 300, 600, 1200, 3000] }`"),
    "upgrades.*.nos.costs": neither("Fixed prices of the game. games/monster-truck/lib/store.ts:227 `nos: { level: 0, maxLevel: 5, costs: [150, 300, 600, 1200, 3000] }`"),
    "customization.*.paintColor": SETTING,
    "customization.*.decal": SETTING,
    starsCollected: max("games/monster-truck/lib/store.ts:452 `starsCollected: state.starsCollected + 1`"),
    challenges: neither("A list whose completed flags go back to false. games/monster-truck/lib/store.ts:495 `resetChallenges: () => set({`"),
    soundEnabled: SETTING,
    musicEnabled: SETTING,
    lastModified: TIME,
  },
  "four-wheeler-3d": {
    // One versioned world (lib/adventureSchema.ts). Its fields refer to each
    // other (nextId gives the fleet ids, heldKills become trophyCounts), so a
    // field-by-field max could make a world that the game cannot load.
    adventure: snapshot("One saved world with fields that refer to each other: games/four-wheeler-3d/lib/adventureSchema.ts:48 `export const adventureSchema`"),
    money: neither("A wallet. games/four-wheeler-3d/lib/life.ts:10 `money: p.money - 100`"),
    totalEarned: max("games/four-wheeler-3d/lib/store.ts:235 `? state.progress.totalEarned + delta`"),
    ownedVehicles: neither("Starvation takes vehicles back. games/four-wheeler-3d/lib/life.ts:31 `ownedVehicles: [\"atv\"]`"),
    currentVehicle: SETTING,
    paint: SETTING,
    trophies: neither("Starvation empties the trophy wall. games/four-wheeler-3d/lib/life.ts:32 `trophies: 0`"),
    "fishCaught.*": neither("Selling the fish empties the bag. games/four-wheeler-3d/components/Fishing.tsx:198 `fishCaught: Object.fromEntries`"),
    biggestFish: neither("A fish name, with no order of its own. games/four-wheeler-3d/components/Fishing.tsx:59 `let biggest = p.biggestFish`"),
    bestRaceTimeMs: minPositive("games/four-wheeler-3d/components/Race.tsx:142 `? Math.min(p.bestRaceTimeMs, elapsed)`"),
    racesWon: max("games/four-wheeler-3d/components/Race.tsx:139 `racesWon: p.racesWon + 1`"),
    airPoints: max("games/four-wheeler-3d/components/Activities.tsx:367 `airPoints: p.airPoints + points`"),
    "land.*.size": neither("Made from the world's plots. games/four-wheeler-3d/lib/economy.ts:81 `land: Object.fromEntries(`"),
    "land.*.slots": neither("Made from the world's plots. games/four-wheeler-3d/lib/economy.ts:81 `land: Object.fromEntries(`"),
    hunger: STATE,
    // The world clock goes with timeOfDay and weather of the same save.
    day: neither("The world clock of the save, kept with its timeOfDay and weather. games/four-wheeler-3d/lib/store.ts:264 `day: state.progress.day + 1`"),
    timeOfDay: STATE,
    weather: STATE,
    "settings.soundEnabled": SETTING,
    "settings.tiltEnabled": SETTING,
    "settings.helmetCam": SETTING,
    lastModified: TIME,
  },
  "hill-climb": {
    coins: neither("A wallet. games/hill-climb/lib/store.ts:396 `coins: state.coins - nextLevel.cost`"),
    totalCoinsEarned: max("games/hill-climb/lib/store.ts:323 `totalCoinsEarned: state.totalCoinsEarned + finalAmount`"),
    bestDistance: max("games/hill-climb/lib/store.ts:237 `const newBestDistance = Math.max(state.bestDistance, state.distance)`"),
    currentVehicleId: SETTING,
    currentStageId: SETTING,
    unlockedVehicles: union("games/hill-climb/lib/store.ts:364 `unlockedVehicles: [...state.unlockedVehicles, vehicleId]`"),
    unlockedStages: union("games/hill-climb/lib/store.ts:185 `const unlocked = new Set(existingStages)`"),
    "vehicleUpgrades.*.engine": max("games/hill-climb/lib/store.ts:401 `[upgradeType]: currentLevel + 1`"),
    "vehicleUpgrades.*.suspension": max("games/hill-climb/lib/store.ts:401 `[upgradeType]: currentLevel + 1`"),
    "vehicleUpgrades.*.tires": max("games/hill-climb/lib/store.ts:401 `[upgradeType]: currentLevel + 1`"),
    "vehicleUpgrades.*.fuelTank": max("games/hill-climb/lib/store.ts:401 `[upgradeType]: currentLevel + 1`"),
    "vehicleUpgrades.*.nitro": max("games/hill-climb/lib/store.ts:401 `[upgradeType]: currentLevel + 1`"),
    "bestDistancePerStage.*": max("games/hill-climb/lib/store.ts:240 `const newStageBest = Math.max(currentStageBest, state.distance)`"),
    soundEnabled: SETTING,
    musicEnabled: SETTING,
    leanSensitivity: SETTING,
    lastModified: TIME,
  },
  "endless-runner": {
    highScore: max("games/endless-runner/lib/store.ts:479 `highScore: Math.max(state.progress.highScore, finalScore)`"),
    totalDistance: max("games/endless-runner/lib/store.ts:480 `totalDistance: state.progress.totalDistance + state.distance`"),
    // The name says total, but it is the wallet: unlocking a character spends it.
    totalCoins: neither("A wallet. games/endless-runner/lib/store.ts:523 `totalCoins: state.progress.totalCoins - character.cost`"),
    coinsCollected: max("games/endless-runner/lib/store.ts:482 `coinsCollected: state.progress.coinsCollected + state.coinsThisRun`"),
    gamesPlayed: max("games/endless-runner/lib/store.ts:483 `gamesPlayed: state.progress.gamesPlayed + 1`"),
    unlockedCharacters: union("games/endless-runner/lib/store.ts:524 `unlockedCharacters: [...state.progress.unlockedCharacters, id]`"),
    selectedCharacter: SETTING,
    lastModified: TIME,
  },
  platformer: {
    // A level entry that only one save has is copied whole.
    "levels.*.completed": max("games/platformer/lib/store.ts:598 `completed: true,`"),
    "levels.*.starsCollected": max("games/platformer/lib/store.ts:599 `starsCollected: Math.max(levelProgress.starsCollected, state.starsThisRun)`"),
    "levels.*.bestTime": minPositive("games/platformer/lib/store.ts:603 `: Math.min(levelProgress.bestTime, state.timeElapsed)`"),
    "levels.*.coinsCollected": max("games/platformer/lib/store.ts:604 `coinsCollected: levelProgress.coinsCollected + state.coinsThisRun`"),
    totalStars: max("games/platformer/lib/store.ts:607 `totalStars: state.progress.totalStars + state.starsThisRun`"),
    // Not spent anywhere in this game (only store.ts:608 writes it).
    totalCoins: max("games/platformer/lib/store.ts:608 `totalCoins: state.progress.totalCoins + state.coinsThisRun`"),
    gamesPlayed: max("games/platformer/lib/store.ts:609 `gamesPlayed: state.progress.gamesPlayed + 1`"),
    totalDeaths: max("games/platformer/lib/store.ts:620 `totalDeaths: state.progress.totalDeaths + 1`"),
    totalJumps: max("games/platformer/lib/store.ts:267 `totalJumps: state.progress.totalJumps + 1`"),
    lastPlayedLevel: TEXT,
    lastModified: TIME,
  },
  "retro-arcade": {
    favorites: neither("The kid removes a favorite. games/retro-arcade/lib/store.ts:268 `favorites: state.favorites.filter((id) => id !== gameId)`"),
    recentlyPlayed: neither("The last 20 games, oldest out first. games/retro-arcade/lib/store.ts:278 `...filtered].slice(0, 20)`"),
    customRoms: LIST,
    "stats.totalPlayTime": max("games/retro-arcade/lib/store.ts:334 `totalPlayTime: state.stats.totalPlayTime + seconds`"),
    "stats.gamesPlayed": max("games/retro-arcade/lib/store.ts:292 `gamesPlayed: state.stats.gamesPlayed + 1`"),
    "stats.favoriteSystem": TEXT,
    "stats.lastPlayedAt": TIME,
    "settings.volume": SETTING,
    "settings.autoSaveOnExit": SETTING,
    "settings.showTouchControls": SETTING,
    lastModified: TIME,
  },
  weather: {
    savedLocations: LIST,
    units: SETTING,
    "lastLocation.name": TEXT,
    "lastLocation.latitude": TEXT,
    "lastLocation.longitude": TEXT,
    "lastLocation.country": TEXT,
    "lastLocation.admin1": TEXT,
    lastModified: TIME,
  },
  "joke-generator": {
    favorites: LIST,
    ratings: LIST,
    seenJokeIds: neither("The kid starts the jokes again. apps/joke-generator/lib/store.ts:246 `set({ seenJokeIds: [], lastModified: Date.now() })`"),
    lastCategory: SETTING,
    jokesViewed: max("apps/joke-generator/lib/store.ts:179 `jokesViewed: state.jokesViewed + 1`"),
    jokesCopied: max("apps/joke-generator/lib/store.ts:186 `jokesCopied: state.jokesCopied + 1`"),
    jokesShared: max("apps/joke-generator/lib/store.ts:193 `jokesShared: state.jokesShared + 1`"),
    lastModified: TIME,
  },
  "toy-finder": {
    wishlistItems: LIST,
    recentlyViewed: neither("The last toys seen, oldest out first. apps/toy-finder/lib/store.ts:126 `const updated = [toyId, ...filtered].slice(0, MAX_RECENTLY_VIEWED)`"),
    lastModified: TIME,
  },
  "space-invaders": {
    highScore: max("games/space-invaders/lib/store.ts:646 `highScore: Math.max(state.progress.highScore, newScore)`"),
    wavesCompleted: max("games/space-invaders/lib/store.ts:363 `wavesCompleted: state.progress.wavesCompleted + 1`"),
    highestWave: max("games/space-invaders/lib/store.ts:364 `highestWave: Math.max(state.progress.highestWave, newWave)`"),
    totalAliensKilled: max("games/space-invaders/lib/store.ts:649 `state.progress.totalAliensKilled + aliensKilledThisFrame`"),
    mysteryShipsHit: max("games/space-invaders/lib/store.ts:651 `state.progress.mysteryShipsHit + mysteryHitThisFrame`"),
    gamesPlayed: max("games/space-invaders/lib/store.ts:647 `gamesPlayed: state.progress.gamesPlayed + 1`"),
    "settings.soundEnabled": SETTING,
    "settings.difficulty": SETTING,
    lastModified: TIME,
  },
  breakout: {
    highScore: max("games/breakout/lib/store.ts:333 `highScore: Math.max(state.progress.highScore, state.score)`"),
    levelsCompleted: max("games/breakout/lib/store.ts:334 `levelsCompleted: Math.max(state.progress.levelsCompleted, state.level - 1)`"),
    highestLevel: max("games/breakout/lib/store.ts:294 `highestLevel: Math.max(state.progress.highestLevel, nextLevelNum)`"),
    totalBricksDestroyed: max("games/breakout/lib/store.ts:557 `totalBricksDestroyed: progress.totalBricksDestroyed + 1`"),
    gamesPlayed: max("games/breakout/lib/store.ts:250 `gamesPlayed: state.progress.gamesPlayed + 1`"),
    powerUpsCollected: max("games/breakout/lib/store.ts:666 `powerUpsCollected: progress.powerUpsCollected + 1`"),
    soundEnabled: SETTING,
    lastModified: TIME,
  },
  hextris: {
    highScore: max("games/hextris/lib/store.ts:256 `highScore: Math.max(state.progress.highScore, state.score)`"),
    gamesPlayed: max("games/hextris/lib/store.ts:227 `gamesPlayed: state.progress.gamesPlayed + 1`"),
    totalBlocksMatched: max("games/hextris/lib/store.ts:446 `totalBlocksMatched: progress.totalBlocksMatched + blocksMatched`"),
    longestChain: max("games/hextris/lib/store.ts:447 `longestChain: Math.max(progress.longestChain, chainCount)`"),
    soundEnabled: SETTING,
    lastModified: TIME,
  },
  asteroids: {
    highScore: max("games/asteroids/lib/store.ts:252 `highScore: Math.max(state.progress.highScore, state.score)`"),
    highestWave: max("games/asteroids/lib/store.ts:235 `highestWave: Math.max(state.progress.highestWave, nextWaveNum)`"),
    totalAsteroidsDestroyed: max("games/asteroids/lib/store.ts:458 `totalAsteroidsDestroyed: progress.totalAsteroidsDestroyed + 1`"),
    totalUfosDestroyed: max("games/asteroids/lib/store.ts:518 `totalUfosDestroyed: progress.totalUfosDestroyed + 1`"),
    gamesPlayed: max("games/asteroids/lib/store.ts:200 `gamesPlayed: state.progress.gamesPlayed + 1`"),
    soundEnabled: SETTING,
    difficulty: SETTING,
    lastModified: TIME,
  },
  bomberman: {
    highScore: max("games/bomberman/lib/store.ts:277 `highScore: Math.max(progress.highScore, state.score)`"),
    highestLevel: max("games/bomberman/lib/store.ts:371 `highestLevel: Math.max(state.progress.highestLevel, nextLevel)`"),
    levelsCompleted: max("games/bomberman/lib/store.ts:372 `levelsCompleted: state.progress.levelsCompleted + 1`"),
    totalEnemiesDefeated: max("games/bomberman/lib/store.ts:626 `newProgress.totalEnemiesDefeated++`"),
    totalBlocksDestroyed: max("games/bomberman/lib/store.ts:564 `newProgress.totalBlocksDestroyed++`"),
    powerUpsCollected: max("games/bomberman/lib/store.ts:452 `powerUpsCollected: newProgress.powerUpsCollected + 1`"),
    gamesPlayed: max("games/bomberman/lib/store.ts:333 `gamesPlayed: progress.gamesPlayed + 1`"),
    "settings.soundEnabled": SETTING,
    "settings.difficulty": SETTING,
    lastModified: TIME,
  },
  "dino-runner": {
    highScore: max("games/dino-runner/lib/store.ts:204 `highScore: Math.max(s.progress.highScore, finalScore)`"),
    gamesPlayed: max("games/dino-runner/lib/store.ts:205 `gamesPlayed: s.progress.gamesPlayed + 1`"),
    totalDistance: max("games/dino-runner/lib/store.ts:206 `totalDistance: s.progress.totalDistance + state.currentRunDistance`"),
    longestRun: max("games/dino-runner/lib/store.ts:207 `longestRun: Math.max(s.progress.longestRun, runDuration)`"),
    milestonesReached: max("games/dino-runner/lib/store.ts:249 `milestonesReached++`"),
    soundEnabled: SETTING,
    lastModified: TIME,
  },
  "blitz-bomber": {
    highScore: max("games/blitz-bomber/lib/store.ts:351 `highScore: Math.max(state.progress.highScore, state.score)`"),
    highestLevel: max("games/blitz-bomber/lib/store.ts:374 `highestLevel: Math.max(state.progress.highestLevel, state.level + 1)`"),
    levelsCompleted: max("games/blitz-bomber/lib/store.ts:373 `levelsCompleted: state.progress.levelsCompleted + 1`"),
    totalBuildingsDestroyed: max("games/blitz-bomber/lib/store.ts:324 `state.progress.totalBuildingsDestroyed + buildingsDestroyedThisFrame`"),
    totalBombsDropped: max("games/blitz-bomber/lib/store.ts:174 `totalBombsDropped: state.progress.totalBombsDropped + 1`"),
    successfulLandings: max("games/blitz-bomber/lib/store.ts:372 `successfulLandings: state.progress.successfulLandings + 1`"),
    crashes: max("games/blitz-bomber/lib/store.ts:352 `crashes: state.progress.crashes + 1`"),
    gamesPlayed: max("games/blitz-bomber/lib/store.ts:353 `gamesPlayed: state.progress.gamesPlayed + 1`"),
    "settings.soundEnabled": SETTING,
    "settings.difficulty": SETTING,
    lastModified: TIME,
  },
  "drawing-app": {
    "settings.defaultColor": SETTING,
    "settings.defaultSize": SETTING,
    "settings.defaultTool": SETTING,
    "settings.soundEnabled": SETTING,
    "settings.showGrid": SETTING,
    "stats.artworksCreated": max("apps/drawing-app/lib/store.ts:235 `artworksCreated: state.stats.artworksCreated + 1`"),
    "stats.totalDrawTime": max("apps/drawing-app/lib/store.ts:305 `totalDrawTime: state.stats.totalDrawTime + seconds`"),
    savedArtworks: LIST,
    lastModified: TIME,
  },
  "drum-machine": {
    savedBeats: LIST,
    favoriteKitId: SETTING,
    "settings.defaultBpm": SETTING,
    "settings.defaultKitId": SETTING,
    "settings.soundEnabled": SETTING,
    "settings.volume": SETTING,
    "stats.beatsCreated": max("apps/drum-machine/lib/store.ts:412 `beatsCreated: state.progress.stats.beatsCreated + 1`"),
    // No code writes it after the default (store.ts:92), so nothing makes it smaller.
    "stats.totalPlayTime": max("apps/drum-machine/lib/store.ts:92 `totalPlayTime: 0,`"),
    "stats.padsHit": max("apps/drum-machine/lib/store.ts:273 `padsHit: state.progress.stats.padsHit + 1`"),
    lastModified: TIME,
  },
  "virtual-pet": {
    "pet.name": TEXT,
    "pet.speciesId": TEXT,
    "pet.hunger": STATE,
    "pet.happiness": STATE,
    "pet.energy": STATE,
    "pet.cleanliness": STATE,
    "pet.sleeping": STATE,
    "pet.bornAt": TIME,
    "pet.lastChecked": TIME,
    coins: neither("A wallet. apps/virtual-pet/lib/store.ts:496 `coins: state.progress.coins - item.price`"),
    inventory: LIST,
    unlockedSpecies: union("apps/virtual-pet/lib/store.ts:412 `unlockedSpecies.push(\"pupper\")`"),
    equippedCosmetics: neither("A new pet takes the cosmetics off. apps/virtual-pet/lib/store.ts:537 `equippedCosmetics: [],`"),
    // The days since the pet was born: a new pet starts again at 0.
    "stats.daysCaredFor": neither("Made from pet.bornAt, which a new pet resets. apps/virtual-pet/lib/store.ts:407 `const daysCaredFor =`"),
    "stats.totalFeedings": max("apps/virtual-pet/lib/store.ts:238 `totalFeedings: state.progress.stats.totalFeedings + 1`"),
    "stats.totalPlaySessions": max("apps/virtual-pet/lib/store.ts:273 `totalPlaySessions: state.progress.stats.totalPlaySessions + 1`"),
    "stats.longestStreak": max("apps/virtual-pet/lib/store.ts:402 `longestStreak = Math.max(longestStreak, currentStreak)`"),
    "stats.currentStreak": neither("A streak that a missed day ends. apps/virtual-pet/lib/store.ts:400 `currentStreak = 1;`"),
    "stats.lastPlayDate": TIME,
    "settings.soundEnabled": SETTING,
    "settings.petName": TEXT,
    lastModified: TIME,
  },
  trivia: {
    highScore: max("apps/trivia/lib/store.ts:94 `highScore: Math.max(state.highScore, state.currentScore)`"),
    totalCorrect: max("apps/trivia/lib/store.ts:79 `totalCorrect: state.totalCorrect + (correct ? 1 : 0)`"),
    totalAnswered: max("apps/trivia/lib/store.ts:80 `totalAnswered: state.totalAnswered + 1`"),
    longestStreak: max("apps/trivia/lib/store.ts:81 `longestStreak: Math.max(state.longestStreak, newStreak)`"),
    gamesPlayed: max("apps/trivia/lib/store.ts:95 `gamesPlayed: state.gamesPlayed + 1`"),
    "settings.soundEnabled": SETTING,
    "settings.difficulty": SETTING,
    lastModified: TIME,
  },
  wordle: {
    gamesPlayed: max("games/wordle/lib/store.ts:136 `gamesPlayed: get().gamesPlayed + 1`"),
    gamesWon: max("games/wordle/lib/store.ts:137 `gamesWon: get().gamesWon + 1`"),
    currentStreak: neither("A streak that a loss ends. games/wordle/lib/store.ts:155 `currentStreak: 0,`"),
    maxStreak: max("games/wordle/lib/store.ts:139 `maxStreak: Math.max(get().maxStreak, get().currentStreak + 1)`"),
    // The wins at each number of guesses: each place only counts up.
    guessDistribution: max("games/wordle/lib/store.ts:129 `newDistribution[currentRow + 1] = (newDistribution[currentRow + 1] || 0) + 1`"),
    "settings.soundEnabled": SETTING,
    "settings.difficulty": SETTING,
    lastModified: TIME,
  },
  "math-attack": {
    highScore: max("games/math-attack/lib/store.ts:152 `highScore: Math.max(state.highScore, state.score)`"),
    totalCorrect: max("games/math-attack/lib/store.ts:109 `totalCorrect: state.totalCorrect + 1`"),
    totalAnswered: max("games/math-attack/lib/store.ts:110 `totalAnswered: state.totalAnswered + 1`"),
    longestCombo: max("games/math-attack/lib/store.ts:129 `const longestCombo = Math.max(state.longestCombo, state.combo + 1)`"),
    "problemsSolved.+": max("games/math-attack/lib/store.ts:105 `newProblemsSolved[operation] = (newProblemsSolved[operation] || 0) + 1`"),
    "problemsSolved.-": max("games/math-attack/lib/store.ts:105 `newProblemsSolved[operation] = (newProblemsSolved[operation] || 0) + 1`"),
    "problemsSolved.×": max("games/math-attack/lib/store.ts:105 `newProblemsSolved[operation] = (newProblemsSolved[operation] || 0) + 1`"),
    "problemsSolved.÷": max("games/math-attack/lib/store.ts:105 `newProblemsSolved[operation] = (newProblemsSolved[operation] || 0) + 1`"),
    gamesPlayed: max("games/math-attack/lib/store.ts:153 `gamesPlayed: state.gamesPlayed + 1`"),
    "settings.soundEnabled": SETTING,
    "settings.difficulty": SETTING,
    lastModified: TIME,
  },
  arkanoid: {
    highScore: max("games/arkanoid/lib/store.ts:186 `newProgress.highScore = state.score`"),
    totalGamesPlayed: max("games/arkanoid/lib/store.ts:192 `newProgress.totalGamesPlayed += 1`"),
    totalBallsSpawned: max("games/arkanoid/lib/store.ts:217 `totalBallsSpawned: state.progress.totalBallsSpawned + 1`"),
    highestMultiplier: max("games/arkanoid/lib/store.ts:190 `newProgress.highestMultiplier = state.multiplier`"),
    lastModified: TIME,
  },
  achievements: {
    // id -> unlock time. A trophy that only one save has is copied.
    "unlocked.*": earliest("shared/lib/achievements/store.ts:85 `for (const id of result.newUnlocks) unlocked[id] = now`"),
    lastModified: TIME,
  },
};
