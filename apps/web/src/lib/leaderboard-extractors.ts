/**
 * Leaderboard score extractors for each game.
 *
 * Each extractor takes progress data and returns the leaderboard score
 * for that game. Returns null if no valid score can be extracted.
 */

import type { ScoreType } from "./leaderboard-schemas";
import { VALID_APP_IDS, type ValidAppId } from "@hank-neil/db/schema";

export interface LeaderboardScore {
  score: number;
  scoreType: ScoreType;
  stats?: Record<string, number | string>;
}

type ProgressData = Record<string, unknown>;

type LeaderboardExtractor = (data: ProgressData) => LeaderboardScore | null;

/**
 * Leaderboard extractors for all games
 *
 * Each game has a specific metric that defines its leaderboard:
 * - high_score: Higher is better (most games)
 * - wins: Number of wins (board games)
 * - fastest_time: Lower is better (time-based games)
 */
export const LEADERBOARD_EXTRACTORS: Partial<
  Record<ValidAppId, LeaderboardExtractor>
> = {
  // ============================================================================
  // HIGH SCORE GAMES (higher is better)
  // ============================================================================

  "2048": (d) => {
    const score = d.highScore as number;
    if (!score || score <= 0) return null;
    return {
      score,
      scoreType: "high_score",
      stats: {
        highestTile: (d.highestTile as number) || 0,
        gamesWon: (d.gamesWon as number) || 0,
      },
    };
  },

  arkanoid: (d) => {
    const score = d.highScore as number;
    if (!score || score <= 0) return null;
    return {
      score,
      scoreType: "high_score",
      stats: {
        totalGamesPlayed: (d.totalGamesPlayed as number) || 0,
        highestMultiplier: (d.highestMultiplier as number) || 0,
        totalBallsSpawned: (d.totalBallsSpawned as number) || 0,
      },
    };
  },

  snake: (d) => {
    const score = d.highScore as number;
    if (!score || score <= 0) return null;
    return {
      score,
      scoreType: "high_score",
      stats: {
        longestSnake: (d.longestSnake as number) || 0,
        gamesPlayed: (d.gamesPlayed as number) || 0,
      },
    };
  },

  "flappy-bird": (d) => {
    const score = d.highScore as number;
    if (!score || score <= 0) return null;
    return {
      score,
      scoreType: "high_score",
      stats: {
        gamesPlayed: (d.gamesPlayed as number) || 0,
      },
    };
  },

  "cookie-clicker": (d) => {
    const score = d.totalCookiesBaked as number;
    if (!score || score <= 0) return null;
    return {
      score,
      scoreType: "high_score",
      stats: {
        totalClicks: (d.totalClicks as number) || 0,
      },
    };
  },

  "space-invaders": (d) => {
    const score = d.highScore as number;
    if (!score || score <= 0) return null;
    return {
      score,
      scoreType: "high_score",
      stats: {
        highestWave: (d.highestWave as number) || 0,
        totalAliensKilled: (d.totalAliensKilled as number) || 0,
      },
    };
  },

  asteroids: (d) => {
    const score = d.highScore as number;
    if (!score || score <= 0) return null;
    return {
      score,
      scoreType: "high_score",
      stats: {
        highestWave: (d.highestWave as number) || 0,
        totalAsteroidsDestroyed: (d.totalAsteroidsDestroyed as number) || 0,
      },
    };
  },

  breakout: (d) => {
    const score = d.highScore as number;
    if (!score || score <= 0) return null;
    return {
      score,
      scoreType: "high_score",
      stats: {
        highestLevel: (d.highestLevel as number) || 0,
        totalBricksDestroyed: (d.totalBricksDestroyed as number) || 0,
      },
    };
  },

  hextris: (d) => {
    const score = d.highScore as number;
    if (!score || score <= 0) return null;
    return {
      score,
      scoreType: "high_score",
      stats: {
        longestChain: (d.longestChain as number) || 0,
      },
    };
  },

  bomberman: (d) => {
    const score = d.highScore as number;
    if (!score || score <= 0) return null;
    return {
      score,
      scoreType: "high_score",
      stats: {
        highestLevel: (d.highestLevel as number) || 0,
        totalEnemiesDefeated: (d.totalEnemiesDefeated as number) || 0,
      },
    };
  },

  "blitz-bomber": (d) => {
    const score = d.highScore as number;
    if (!score || score <= 0) return null;
    return {
      score,
      scoreType: "high_score",
      stats: {
        highestLevel: (d.highestLevel as number) || 0,
        successfulLandings: (d.successfulLandings as number) || 0,
      },
    };
  },

  "dino-runner": (d) => {
    const score = d.highScore as number;
    if (!score || score <= 0) return null;
    return {
      score,
      scoreType: "high_score",
      stats: {
        longestRun: (d.longestRun as number) || 0,
      },
    };
  },

  "endless-runner": (d) => {
    const score = d.highScore as number;
    if (!score || score <= 0) return null;
    return {
      score,
      scoreType: "high_score",
      stats: {
        totalDistance: (d.totalDistance as number) || 0,
      },
    };
  },

  "math-attack": (d) => {
    const score = d.highScore as number;
    if (!score || score <= 0) return null;

    const totalCorrect = (d.totalCorrect as number) || 0;
    const totalAnswered = (d.totalAnswered as number) || 0;
    const accuracy =
      totalAnswered > 0
        ? Math.round((totalCorrect / totalAnswered) * 100)
        : 0;

    return {
      score,
      scoreType: "high_score",
      stats: {
        accuracy: `${accuracy}%`,
        longestCombo: (d.longestCombo as number) || 0,
      },
    };
  },

  trivia: (d) => {
    const score = d.highScore as number;
    if (!score || score <= 0) return null;

    const totalCorrect = (d.totalCorrect as number) || 0;
    const totalAnswered = (d.totalAnswered as number) || 0;
    const accuracy =
      totalAnswered > 0
        ? Math.round((totalCorrect / totalAnswered) * 100)
        : 0;

    return {
      score,
      scoreType: "high_score",
      stats: {
        accuracy: `${accuracy}%`,
        longestStreak: (d.longestStreak as number) || 0,
      },
    };
  },

  // Distance-based games (still higher is better)
  "hill-climb": (d) => {
    const score = d.bestDistance as number;
    if (!score || score <= 0) return null;
    return {
      score,
      scoreType: "high_score",
      stats: {
        totalCoinsEarned: (d.totalCoinsEarned as number) || 0,
      },
    };
  },

  "monster-truck": (d) => {
    const score = d.starsCollected as number;
    if (!score || score <= 0) return null;
    return {
      score,
      scoreType: "high_score",
      stats: {
        totalCoinsEarned: (d.totalCoinsEarned as number) || 0,
      },
    };
  },

  "four-wheeler-3d": (d) => {
    // Lower is better here: the leaderboard ranks the best lap on the track.
    const score = d.bestRaceTimeMs as number;
    if (!score || score <= 0) return null;
    return {
      score,
      scoreType: "fastest_time",
      stats: {
        money: (d.money as number) || 0,
        trophies: (d.trophies as number) || 0,
      },
    };
  },

  platformer: (d) => {
    const score = d.totalStars as number;
    if (!score || score <= 0) return null;
    return {
      score,
      scoreType: "high_score",
      stats: {
        totalCoins: (d.totalCoins as number) || 0,
      },
    };
  },

  "oregon-trail": (d) => {
    const score = d.milesTraveled as number;
    if (!score || score <= 0) return null;
    return {
      score,
      scoreType: "high_score",
      stats: {
        riversCrossed: (d.riversCrossed as number) || 0,
      },
    };
  },

  // ============================================================================
  // WIN-BASED GAMES (number of wins)
  // ============================================================================

  chess: (d) => {
    const score = d.gamesWon as number;
    if (!score || score <= 0) return null;
    return {
      score,
      scoreType: "wins",
      stats: {
        bestWinStreak: (d.bestWinStreak as number) || 0,
        gamesPlayed: (d.gamesPlayed as number) || 0,
        totalCheckmates: (d.totalCheckmates as number) || 0,
      },
    };
  },

  checkers: (d) => {
    const score = d.gamesWon as number;
    if (!score || score <= 0) return null;
    return {
      score,
      scoreType: "wins",
      stats: {
        bestWinStreak: (d.bestWinStreak as number) || 0,
        gamesPlayed: (d.gamesPlayed as number) || 0,
        totalPiecesCaptured: (d.totalPiecesCaptured as number) || 0,
      },
    };
  },

  quoridor: (d) => {
    const score = d.gamesWon as number;
    if (!score || score <= 0) return null;
    return {
      score,
      scoreType: "wins",
      stats: {
        bestWinStreak: (d.bestWinStreak as number) || 0,
        fastestWin: (d.fastestWin as number) || 0,
      },
    };
  },

  wordle: (d) => {
    const score = d.gamesWon as number;
    if (!score || score <= 0) return null;
    return {
      score,
      scoreType: "wins",
      stats: {
        maxStreak: (d.maxStreak as number) || 0,
        gamesPlayed: (d.gamesPlayed as number) || 0,
      },
    };
  },

  // ============================================================================
  // TIME-BASED GAMES (lower is better)
  // ============================================================================

  "memory-match": (d) => {
    const bestTimes = d.bestTimes as Record<string, number | null> | undefined;
    if (!bestTimes) return null;

    // Get the best time across all difficulties (excluding nulls and 0s)
    const validTimes = Object.values(bestTimes).filter(
      (t): t is number => typeof t === "number" && t > 0
    );

    if (validTimes.length === 0) return null;

    const bestTime = Math.min(...validTimes);

    return {
      score: bestTime,
      scoreType: "fastest_time",
      stats: {
        gamesWon: (d.gamesWon as number) || 0,
        perfectGames: (d.perfectGames as number) || 0,
      },
    };
  },
};

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate that all extractors have corresponding progress schemas
 * This runs at module load time to catch mismatches early
 */
const extractorKeys = Object.keys(LEADERBOARD_EXTRACTORS) as ValidAppId[];

for (const key of extractorKeys) {
  if (!VALID_APP_IDS.includes(key)) {
    console.error(
      `[LEADERBOARD] FATAL: Extractor '${key}' is not a valid app ID`
    );
  }
}

/**
 * Games that have leaderboard support
 */
export const LEADERBOARD_ENABLED_GAMES = extractorKeys;

/**
 * Check if a game has leaderboard support
 */
export function hasLeaderboardSupport(appId: string): appId is ValidAppId {
  return appId in LEADERBOARD_EXTRACTORS;
}

/**
 * Get the score type for a game (used for sorting direction)
 * Returns 'high_score' as default for unknown games
 */
export function getGameScoreType(appId: string): ScoreType {
  // Games that use fastest_time (lower is better)
  const FASTEST_TIME_GAMES: string[] = ["memory-match", "four-wheeler-3d"];

  // Games that use wins
  const WINS_GAMES: string[] = ["chess", "checkers", "quoridor", "wordle"];

  if (FASTEST_TIME_GAMES.includes(appId)) return "fastest_time";
  if (WINS_GAMES.includes(appId)) return "wins";
  return "high_score";
}

/**
 * Extract leaderboard score from progress data
 * Returns null if extraction fails or no valid score
 */
export function extractLeaderboardScore(
  appId: ValidAppId,
  data: ProgressData
): LeaderboardScore | null {
  const extractor = LEADERBOARD_EXTRACTORS[appId];
  if (!extractor) return null;

  try {
    return extractor(data);
  } catch (error) {
    console.warn(`[LEADERBOARD] Failed to extract score for ${appId}:`, error);
    return null;
  }
}
