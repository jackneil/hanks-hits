import { describe, expect, it } from "vitest";
import type { ValidAppId } from "@hank-neil/db/schema";
import {
  LEADERBOARD_ENABLED_GAMES,
  extractLeaderboardScore,
  getGameScoreType,
} from "../leaderboard-extractors";
import { leaderboardEntrySchema, type ScoreType } from "../leaderboard-schemas";

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
