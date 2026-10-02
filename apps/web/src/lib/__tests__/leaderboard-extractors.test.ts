import { describe, expect, it } from "vitest";
import type { ValidAppId } from "@hank-neil/db/schema";
import {
  LEADERBOARD_ENABLED_GAMES,
  extractLeaderboardScore,
  getGameScoreType,
  toBoardEntry,
  toBoardScore,
} from "../leaderboard-extractors";
import {
  MAX_BOARD_SCORE,
  leaderboardEntrySchema,
  type ScoreType,
} from "../leaderboard-schemas";

const extractorSamples = {
  "2048": {
    expectedType: "high_score",
    data: { highScore: 2048, highestTile: 2048, gamesWon: 1 },
  },
  arkanoid: {
    expectedType: "high_score",
    data: {
      highScore: 1000,
      totalGamesPlayed: 2,
      highestMultiplier: 3,
      totalBallsSpawned: 4,
    },
  },
  snake: {
    expectedType: "high_score",
    data: { highScore: 20, longestSnake: 12, gamesPlayed: 2 },
  },
  "flappy-bird": {
    expectedType: "high_score",
    data: { highScore: 9, gamesPlayed: 2 },
  },
  "cookie-clicker": {
    expectedType: "high_score",
    data: { totalCookiesBaked: 500, totalClicks: 25 },
  },
  "space-invaders": {
    expectedType: "high_score",
    data: { highScore: 1200, highestWave: 3, totalAliensKilled: 45 },
  },
  asteroids: {
    expectedType: "high_score",
    data: { highScore: 900, highestWave: 4, totalAsteroidsDestroyed: 30 },
  },
  breakout: {
    expectedType: "high_score",
    data: { highScore: 800, highestLevel: 3, totalBricksDestroyed: 60 },
  },
  hextris: {
    expectedType: "high_score",
    data: { highScore: 700, longestChain: 5 },
  },
  bomberman: {
    expectedType: "high_score",
    data: { highScore: 600, highestLevel: 4, totalEnemiesDefeated: 12 },
  },
  "blitz-bomber": {
    expectedType: "high_score",
    data: { highScore: 500, highestLevel: 4, successfulLandings: 2 },
  },
  "dino-runner": {
    expectedType: "high_score",
    data: { highScore: 400, longestRun: 300 },
  },
  "endless-runner": {
    expectedType: "high_score",
    data: { highScore: 300, totalDistance: 2500 },
  },
  "math-attack": {
    expectedType: "high_score",
    data: {
      highScore: 200,
      totalCorrect: 18,
      totalAnswered: 20,
      longestCombo: 7,
    },
  },
  trivia: {
    expectedType: "high_score",
    data: {
      highScore: 100,
      totalCorrect: 8,
      totalAnswered: 10,
      longestStreak: 4,
    },
  },
  "hill-climb": {
    expectedType: "high_score",
    data: { bestDistance: 1200, totalCoinsEarned: 55 },
  },
  "monster-truck": {
    expectedType: "high_score",
    data: { starsCollected: 12, totalCoinsEarned: 100 },
  },
  platformer: {
    expectedType: "high_score",
    data: { totalStars: 15, totalCoins: 180 },
  },
  "oregon-trail": {
    expectedType: "high_score",
    data: { milesTraveled: 500, riversCrossed: 2 },
  },
  chess: {
    expectedType: "wins",
    data: {
      gamesWon: 3,
      bestWinStreak: 2,
      gamesPlayed: 5,
      totalCheckmates: 1,
    },
  },
  checkers: {
    expectedType: "wins",
    data: {
      gamesWon: 4,
      bestWinStreak: 3,
      gamesPlayed: 6,
      totalPiecesCaptured: 20,
    },
  },
  quoridor: {
    expectedType: "wins",
    data: { gamesWon: 2, bestWinStreak: 2, fastestWin: 15 },
  },
  wordle: {
    expectedType: "wins",
    data: { gamesWon: 5, maxStreak: 4, gamesPlayed: 7 },
  },
  "four-wheeler-3d": {
    expectedType: "fastest_time",
    data: { bestRaceTimeMs: 92500, money: 51000, trophies: 4 },
  },
  "memory-match": {
    expectedType: "fastest_time",
    data: {
      bestTimes: { easy: 12500, medium: null, hard: 24000 },
      gamesWon: 2,
      perfectGames: 1,
    },
  },
} as const satisfies Partial<Record<
  ValidAppId,
  { expectedType: ScoreType; data: Record<string, unknown> }
>>;

const samplesByApp: Partial<
  Record<ValidAppId, { expectedType: ScoreType; data: Record<string, unknown> }>
> = extractorSamples;

describe("leaderboard extractors", () => {
  it("has schema-valid samples for every enabled game", () => {
    expect(new Set(LEADERBOARD_ENABLED_GAMES)).toEqual(
      new Set(Object.keys(extractorSamples))
    );

    for (const appId of LEADERBOARD_ENABLED_GAMES) {
      const sample = samplesByApp[appId];
      expect(sample, appId).toBeDefined();
      if (!sample) continue;

      const score = extractLeaderboardScore(appId, sample.data);

      expect(score, appId).not.toBeNull();
      expect(score?.scoreType, appId).toBe(sample.expectedType);
      expect(getGameScoreType(appId), appId).toBe(sample.expectedType);
      expect(leaderboardEntrySchema.safeParse(score).success, appId).toBe(true);
    }
  });

  it("returns null when no positive leaderboard score exists", () => {
    expect(extractLeaderboardScore("2048", { highScore: 0 })).toBeNull();
    expect(
      extractLeaderboardScore("memory-match", {
        bestTimes: { easy: null, medium: 0 },
      })
    ).toBeNull();
  });
});

/** Add a fraction to every positive number in a sample blob. */
function withFractions(value: unknown): unknown {
  if (typeof value === "number") return value > 0 ? value + 0.37 : value;
  if (Array.isArray(value)) return value.map(withFractions);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, withFractions(v)])
    );
  }
  return value;
}

describe("toBoardScore (leaderboard_entries.score is a Postgres bigint)", () => {
  it("rounds high_score DOWN: a board never shows more than was achieved", () => {
    expect(toBoardScore(4189.294008871742, "high_score")).toBe(4189); // Hill Climb, prod
    expect(toBoardScore(436.8441000000125, "high_score")).toBe(436); // Cookie Clicker, prod
    expect(toBoardScore(99.999, "high_score")).toBe(99);
    expect(toBoardScore(2048, "high_score")).toBe(2048);
    expect(toBoardScore(0.4, "high_score")).toBe(0);
  });

  it("rounds wins DOWN", () => {
    expect(toBoardScore(3.9, "wins")).toBe(3);
    expect(toBoardScore(5, "wins")).toBe(5);
  });

  it("rounds fastest_time UP: a board never shows a time faster than achieved", () => {
    expect(toBoardScore(12500.2, "fastest_time")).toBe(12501);
    expect(toBoardScore(92500.000001, "fastest_time")).toBe(92501);
    expect(toBoardScore(92500, "fastest_time")).toBe(92500);
    expect(toBoardScore(0.1, "fastest_time")).toBe(1);
  });

  it("gives no score for negatives, NaN, Infinity, or a non-number", () => {
    for (const type of ["high_score", "wins", "fastest_time"] as const) {
      expect(toBoardScore(-1, type), type).toBeNull();
      expect(toBoardScore(-0.5, type), type).toBeNull();
      expect(toBoardScore(Number.NaN, type), type).toBeNull();
      expect(toBoardScore(Number.POSITIVE_INFINITY, type), type).toBeNull();
      expect(toBoardScore(Number.NEGATIVE_INFINITY, type), type).toBeNull();
      expect(toBoardScore("4189", type), type).toBeNull();
      expect(toBoardScore(undefined, type), type).toBeNull();
    }
  });

  it("holds the 1e12 bound after rounding", () => {
    expect(MAX_BOARD_SCORE).toBe(1_000_000_000_000);
    expect(toBoardScore(MAX_BOARD_SCORE, "high_score")).toBe(MAX_BOARD_SCORE);
    expect(toBoardScore(MAX_BOARD_SCORE + 0.5, "high_score")).toBe(MAX_BOARD_SCORE);
    expect(toBoardScore(MAX_BOARD_SCORE + 1, "high_score")).toBeNull();
    expect(toBoardScore(MAX_BOARD_SCORE - 0.5, "fastest_time")).toBe(MAX_BOARD_SCORE);
    expect(toBoardScore(MAX_BOARD_SCORE + 0.5, "fastest_time")).toBeNull();
  });

  it("never returns negative zero", () => {
    expect(Object.is(toBoardScore(-0, "high_score"), 0)).toBe(true);
    expect(Object.is(toBoardScore(-0, "fastest_time"), 0)).toBe(true);
  });
});

describe("toBoardEntry", () => {
  it("returns null for no extraction or nothing to rank after rounding", () => {
    expect(toBoardEntry(null)).toBeNull();
    expect(toBoardEntry({ score: 0.4, scoreType: "high_score" })).toBeNull();
    expect(toBoardEntry({ score: Number.NaN, scoreType: "wins" })).toBeNull();
  });

  it("keeps the score type and stats and makes the score a whole number", () => {
    expect(
      toBoardEntry({
        score: 4189.294008871742,
        scoreType: "high_score",
        stats: { totalCoinsEarned: 312 },
      })
    ).toEqual({
      score: 4189,
      scoreType: "high_score",
      stats: { totalCoinsEarned: 312 },
    });
  });

  it("makes a schema-valid entry for EVERY enabled game when its blob holds fractions", () => {
    for (const appId of LEADERBOARD_ENABLED_GAMES) {
      const sample = samplesByApp[appId];
      if (!sample) continue;

      const raw = extractLeaderboardScore(
        appId,
        withFractions(sample.data) as Record<string, unknown>
      );
      // The fraction reached the score field, so the bigint risk is real here.
      expect(raw, appId).not.toBeNull();
      expect(Number.isInteger(raw!.score), appId).toBe(false);
      // The raw extraction is exactly what the bigint column rejects.
      expect(leaderboardEntrySchema.safeParse(raw).success, appId).toBe(false);

      const entry = toBoardEntry(raw);
      expect(entry, appId).not.toBeNull();
      expect(entry!.score, appId).toBe(
        raw!.scoreType === "fastest_time"
          ? Math.ceil(raw!.score)
          : Math.floor(raw!.score)
      );
      expect(leaderboardEntrySchema.safeParse(entry).success, appId).toBe(true);
    }
  });
});
