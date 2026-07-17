import type { ValidAppId } from "@hank-neil/db/schema";
import { getGameMetadata } from "@/shared/lib/gameMetadata.generated";
import { plural } from "@/shared/lib/pluralize";

/**
 * Extracted game display info for profile cards.
 */
export interface GameDisplayInfo {
  appId: ValidAppId;
  displayName: string;
  icon: string;
  color: string;
  lastPlayed: Date;
  primaryStat: { label: string; value: string } | null;
  secondaryStats: { label: string; value: string }[];
  progress?: number; // 0-100 if applicable
  fullData: Record<string, unknown>; // Raw data for detail view
  hasDetailView: boolean; // Whether this game has expandable details
  isApp: boolean; // True if this is an "app" (lives at /apps/) vs "game" (lives at /games/)
}

/**
 * Extract display-friendly stats from a game's raw progress data.
 * Each game stores data differently, so we handle them individually.
 */
// Games that have enough interesting data to warrant an expandable detail view
const GAMES_WITH_DETAIL_VIEW = [
  "monster-truck",
  "hill-climb",
  "oregon-trail",
  "cookie-clicker",
];

export function extractGameStats(
  appId: string,
  data: Record<string, unknown>,
  updatedAt: string
): GameDisplayInfo {
  const metadata = getGameMetadata(appId);
  const lastPlayed = new Date(updatedAt);

  const baseInfo: GameDisplayInfo = {
    appId: appId as ValidAppId,
    displayName: metadata.name,
    icon: metadata.icon,
    color: metadata.color,
    lastPlayed,
    primaryStat: null,
    secondaryStats: [],
    fullData: data,
    hasDetailView: GAMES_WITH_DETAIL_VIEW.includes(appId),
    isApp: metadata.category === "apps",
  };

  // Extract stats based on game type
  switch (appId) {
    case "monster-truck":
      return {
        ...baseInfo,
        primaryStat: data.totalCoinsEarned
          ? { label: "Total Coins", value: formatNumber(data.totalCoinsEarned as number) }
          : null,
        secondaryStats: [
          data.starsCollected && { label: "Stars", value: String(data.starsCollected) },
          data.trucks && { label: "Trucks", value: String((data.trucks as unknown[]).length) },
        ].filter(Boolean) as { label: string; value: string }[],
      };

    case "2048":
      return {
        ...baseInfo,
        primaryStat: data.highScore
          ? { label: "High Score", value: formatNumber(data.highScore as number) }
          : null,
        secondaryStats: [
          data.highestTile && { label: "Best Tile", value: String(data.highestTile) },
          data.gamesWon && { label: "Wins", value: String(data.gamesWon) },
          data.gamesPlayed && { label: "Games", value: String(data.gamesPlayed) },
        ].filter(Boolean) as { label: string; value: string }[],
      };

    case "cookie-clicker":
      return {
        ...baseInfo,
        primaryStat: data.totalCookiesBaked
          ? { label: "Cookies Baked", value: formatLargeNumber(data.totalCookiesBaked as number) }
          : null,
        secondaryStats: [
          data.totalClicks && { label: "Clicks", value: formatNumber(data.totalClicks as number) },
          data.unlockedAchievements && {
            label: plural((data.unlockedAchievements as unknown[]).length, "Achievement"),
            value: String((data.unlockedAchievements as unknown[]).length),
          },
        ].filter(Boolean) as { label: string; value: string }[],
      };

    case "oregon-trail":
      return {
        ...baseInfo,
        primaryStat: data.milesTraveled
          ? { label: "Miles Traveled", value: formatNumber(data.milesTraveled as number) }
          : null,
        secondaryStats: [
          data.riversCrossed && { label: "Rivers Crossed", value: String(data.riversCrossed) },
          data.foodHunted && { label: "Food Hunted", value: formatNumber(data.foodHunted as number) },
        ].filter(Boolean) as { label: string; value: string }[],
        progress: data.milesTraveled
          ? Math.min(100, Math.round(((data.milesTraveled as number) / 2000) * 100))
          : undefined,
      };

    case "snake":
      return {
        ...baseInfo,
        primaryStat: data.highScore
          ? { label: "High Score", value: String(data.highScore) }
          : null,
        secondaryStats: [
          data.gamesPlayed && { label: "Games", value: String(data.gamesPlayed) },
        ].filter(Boolean) as { label: string; value: string }[],
      };

    case "flappy-bird":
      return {
        ...baseInfo,
        primaryStat: data.highScore
          ? { label: "High Score", value: String(data.highScore) }
          : null,
        secondaryStats: [
          data.gamesPlayed && { label: "Games", value: String(data.gamesPlayed) },
        ].filter(Boolean) as { label: string; value: string }[],
      };

    case "memory-match": {
      const bestTimes = data.bestTimes as Record<string, number> | undefined;
      const validTimes = bestTimes ? Object.values(bestTimes).filter((t) => t > 0) : [];
      const bestTime = validTimes.length > 0 ? Math.min(...validTimes) : null;
      return {
        ...baseInfo,
        primaryStat: bestTime
          ? { label: "Best Time", value: formatTime(bestTime) }
          : null,
        secondaryStats: [
          data.gamesPlayed && { label: "Games", value: String(data.gamesPlayed) },
          data.gamesWon && { label: "Wins", value: String(data.gamesWon) },
        ].filter(Boolean) as { label: string; value: string }[],
      };
    }

    case "hill-climb":
      return {
        ...baseInfo,
        primaryStat: data.totalCoinsEarned
          ? { label: "Total Coins", value: formatNumber(data.totalCoinsEarned as number) }
          : null,
        secondaryStats: [
          data.bestDistance && { label: "Best Distance", value: `${formatNumber(data.bestDistance as number)}m` },
        ].filter(Boolean) as { label: string; value: string }[],
      };

    case "endless-runner":
      return {
        ...baseInfo,
        primaryStat: data.highScore
          ? { label: "High Score", value: formatNumber(data.highScore as number) }
          : null,
        secondaryStats: [],
      };

    case "retro-arcade":
      return {
        ...baseInfo,
        primaryStat: data.recentlyPlayed
          ? { label: "Games Played", value: String((data.recentlyPlayed as unknown[]).length) }
          : null,
        secondaryStats: [],
      };

    case "chess":
      return {
        ...baseInfo,
        primaryStat: data.gamesWon
          ? { label: "Wins", value: String(data.gamesWon) }
          : data.gamesPlayed
            ? { label: "Games", value: String(data.gamesPlayed) }
            : null,
        secondaryStats: [
          data.gamesLost !== undefined && {
            label: "Record",
            value: `${data.gamesWon || 0}W-${data.gamesLost || 0}L-${data.gamesDrawn || 0}D`,
          },
          data.totalCheckmates && { label: "Checkmates", value: String(data.totalCheckmates) },
          data.bestWinStreak && { label: "Best Streak", value: String(data.bestWinStreak) },
        ].filter(Boolean) as { label: string; value: string }[],
      };

    case "checkers":
      return {
        ...baseInfo,
        primaryStat: data.gamesWon
          ? { label: "Wins", value: String(data.gamesWon) }
          : data.gamesPlayed
            ? { label: "Games", value: String(data.gamesPlayed) }
            : null,
        secondaryStats: [
          data.gamesLost !== undefined && {
            label: "Record",
            value: `${data.gamesWon || 0}W-${data.gamesLost || 0}L`,
          },
          data.totalPiecesCaptured && { label: "Captured", value: String(data.totalPiecesCaptured) },
          data.totalKingsEarned && { label: "Kings", value: String(data.totalKingsEarned) },
        ].filter(Boolean) as { label: string; value: string }[],
      };

    case "quoridor":
      return {
        ...baseInfo,
        primaryStat: data.gamesWon
          ? { label: "Wins", value: String(data.gamesWon) }
          : data.gamesPlayed
            ? { label: "Games", value: String(data.gamesPlayed) }
            : null,
        secondaryStats: [
          data.gamesLost !== undefined && {
            label: "Record",
            value: `${data.gamesWon || 0}W-${data.gamesLost || 0}L`,
          },
          data.totalWallsPlaced && { label: "Walls", value: String(data.totalWallsPlaced) },
          data.fastestWin && { label: "Fastest", value: `${data.fastestWin} moves` },
        ].filter(Boolean) as { label: string; value: string }[],
      };

    case "platformer": {
      const levels = data.levels as Record<string, { completed: boolean }> | undefined;
      const completedCount = levels
        ? Object.values(levels).filter((l) => l.completed).length
        : 0;
      return {
        ...baseInfo,
        primaryStat: completedCount > 0
          ? { label: "Levels", value: String(completedCount) }
          : null,
        secondaryStats: [
          data.totalCoins && { label: "Coins", value: formatNumber(data.totalCoins as number) },
          data.totalStars && { label: "Stars", value: String(data.totalStars) },
        ].filter(Boolean) as { label: string; value: string }[],
      };
    }

    // --- Missing games added below ---

    case "wordle": {
      const winPct = data.gamesPlayed && data.gamesWon !== undefined
        ? Math.round((Number(data.gamesWon) / Number(data.gamesPlayed)) * 100)
        : 0;
      return {
        ...baseInfo,
        primaryStat: data.gamesWon
          ? { label: "Wins", value: String(data.gamesWon) }
          : null,
        secondaryStats: [
          data.gamesPlayed && { label: "Win %", value: `${winPct}%` },
          data.maxStreak && { label: "Max Streak", value: String(data.maxStreak) },
          data.currentStreak && { label: "Current", value: String(data.currentStreak) },
        ].filter(Boolean) as { label: string; value: string }[],
      };
    }

    case "space-invaders":
      return {
        ...baseInfo,
        primaryStat: data.highScore
          ? { label: "High Score", value: formatNumber(data.highScore as number) }
          : null,
        secondaryStats: [
          data.highestWave && { label: "Best Wave", value: String(data.highestWave) },
          data.totalAliensKilled && { label: "Aliens", value: formatNumber(data.totalAliensKilled as number) },
        ].filter(Boolean) as { label: string; value: string }[],
      };

    case "asteroids":
      return {
        ...baseInfo,
        primaryStat: data.highScore
          ? { label: "High Score", value: formatNumber(data.highScore as number) }
          : null,
        secondaryStats: [
          data.highestWave && { label: "Best Wave", value: String(data.highestWave) },
          data.totalAsteroidsDestroyed && { label: "Asteroids", value: formatNumber(data.totalAsteroidsDestroyed as number) },
        ].filter(Boolean) as { label: string; value: string }[],
      };

    case "breakout":
      return {
        ...baseInfo,
        primaryStat: data.highScore
          ? { label: "High Score", value: formatNumber(data.highScore as number) }
          : null,
        secondaryStats: [
          data.highestLevel && { label: "Best Level", value: String(data.highestLevel) },
          data.totalBricksDestroyed && { label: "Bricks", value: formatNumber(data.totalBricksDestroyed as number) },
        ].filter(Boolean) as { label: string; value: string }[],
      };

    case "hextris":
      return {
        ...baseInfo,
        primaryStat: data.highScore
          ? { label: "High Score", value: formatNumber(data.highScore as number) }
          : null,
        secondaryStats: [
          data.gamesPlayed && { label: "Games", value: String(data.gamesPlayed) },
          data.longestChain && { label: "Best Chain", value: String(data.longestChain) },
        ].filter(Boolean) as { label: string; value: string }[],
      };

    case "dino-runner":
      return {
        ...baseInfo,
        primaryStat: data.highScore
          ? { label: "High Score", value: formatNumber(data.highScore as number) }
          : null,
        secondaryStats: [
          data.gamesPlayed && { label: "Games", value: String(data.gamesPlayed) },
          data.totalDistance && { label: "Distance", value: formatNumber(data.totalDistance as number) },
        ].filter(Boolean) as { label: string; value: string }[],
      };

    case "math-attack": {
      const accuracy = data.totalAnswered && data.totalCorrect !== undefined
        ? Math.round((Number(data.totalCorrect) / Number(data.totalAnswered)) * 100)
        : 0;
      return {
        ...baseInfo,
        primaryStat: data.highScore
          ? { label: "High Score", value: formatNumber(data.highScore as number) }
          : null,
        secondaryStats: [
          data.totalAnswered && { label: "Accuracy", value: `${accuracy}%` },
          data.longestCombo && { label: "Best Combo", value: String(data.longestCombo) },
        ].filter(Boolean) as { label: string; value: string }[],
      };
    }

    case "trivia": {
      const triviaAccuracy = data.totalAnswered && data.totalCorrect !== undefined
        ? Math.round((Number(data.totalCorrect) / Number(data.totalAnswered)) * 100)
        : 0;
      return {
        ...baseInfo,
        primaryStat: data.highScore
          ? { label: "High Score", value: formatNumber(data.highScore as number) }
          : null,
        secondaryStats: [
          data.gamesPlayed && { label: "Games", value: String(data.gamesPlayed) },
          data.totalAnswered && { label: "Accuracy", value: `${triviaAccuracy}%` },
          data.longestStreak && { label: "Best Streak", value: String(data.longestStreak) },
        ].filter(Boolean) as { label: string; value: string }[],
      };
    }

    case "blitz-bomber":
      return {
        ...baseInfo,
        primaryStat: data.highScore
          ? { label: "High Score", value: formatNumber(data.highScore as number) }
          : null,
        secondaryStats: [
          data.highestLevel && { label: "Best Level", value: String(data.highestLevel) },
          data.successfulLandings && { label: "Landings", value: String(data.successfulLandings) },
        ].filter(Boolean) as { label: string; value: string }[],
      };

    case "bomberman":
      return {
        ...baseInfo,
        primaryStat: data.highScore
          ? { label: "High Score", value: formatNumber(data.highScore as number) }
          : null,
        secondaryStats: [
          data.highestLevel && { label: "Best Level", value: String(data.highestLevel) },
          data.totalEnemiesDefeated && { label: "Enemies", value: formatNumber(data.totalEnemiesDefeated as number) },
        ].filter(Boolean) as { label: string; value: string }[],
      };

    case "arkanoid":
      return {
        ...baseInfo,
        primaryStat: data.highScore
          ? { label: "High Score", value: formatNumber(data.highScore as number) }
          : null,
        secondaryStats: [
          data.totalGamesPlayed && { label: "Games", value: String(data.totalGamesPlayed) },
          data.totalBallsSpawned && { label: "Balls Spawned", value: formatNumber(data.totalBallsSpawned as number) },
          data.highestMultiplier && { label: "Best Multiplier", value: `${data.highestMultiplier}x` },
        ].filter(Boolean) as { label: string; value: string }[],
      };

    case "virtual-pet": {
      const pet = data.pet as { name?: string; happiness?: number } | undefined;
      const stats = data.stats as { daysCaredFor?: number } | undefined;
      return {
        ...baseInfo,
        primaryStat: stats?.daysCaredFor !== undefined
          ? { label: "Days Cared For", value: String(stats.daysCaredFor) }
          : null,
        secondaryStats: [
          pet?.name && { label: "Pet", value: String(pet.name) },
          pet?.happiness !== undefined && { label: "Happiness", value: `${pet.happiness}%` },
          data.coins !== undefined && { label: "Coins", value: formatNumber(data.coins as number) },
        ].filter(Boolean) as { label: string; value: string }[],
      };
    }

    case "drawing-app":
      return {
        ...baseInfo,
        primaryStat: null,
        secondaryStats: [],
      };

    case "drum-machine":
      return {
        ...baseInfo,
        primaryStat: null,
        secondaryStats: [],
      };

    // Apps (not games, but might have progress)
    case "joke-generator":
    case "weather":
    case "toy-finder":
      return {
        ...baseInfo,
        primaryStat: null,
        secondaryStats: [],
      };

    case "four-wheeler-adventure": {
      // My Land save (device-owned alias key fwa_myland_v1): an array of
      // land plots that localProgress wraps as { items }. Owned plots and
      // their buildings are the kid's visible progress; nothing owned yet
      // reads as no stat, which the shelf renders as its invite copy.
      const plots = Array.isArray(data.items)
        ? (data.items as Record<string, unknown>[])
        : [];
      // Mirror the game's own legacy backfill (index.html loadMyLand):
      // saves from before the "buy the land first" mechanic have no owned
      // flag, but a plot with buildings on it is obviously owned. The
      // shelf must agree with what the game shows for the same blob.
      const owned = plots.filter(
        (plot) =>
          plot.owned === true ||
          (Array.isArray(plot.buildings) && plot.buildings.length > 0)
      );
      const buildings = owned.reduce(
        (total, plot) =>
          total + (Array.isArray(plot.buildings) ? plot.buildings.length : 0),
        0
      );
      return {
        ...baseInfo,
        primaryStat: owned.length
          ? {
              label: "My Land",
              value: `${owned.length} ${plural(owned.length, "plot")}`,
            }
          : null,
        secondaryStats: buildings
          ? [{ label: "Buildings", value: String(buildings) }]
          : [],
      };
    }

    default:
      // Unknown game - try generic extraction
      return {
        ...baseInfo,
        primaryStat: data.highScore
          ? { label: "High Score", value: String(data.highScore) }
          : data.score
            ? { label: "Score", value: String(data.score) }
            : null,
        secondaryStats: [],
      };
  }
}

/**
 * Format a number with commas (e.g., 1234567 -> "1,234,567")
 */
function formatNumber(n: number): string {
  return n.toLocaleString();
}

/**
 * Format large numbers with K/M suffix (e.g., 1500000 -> "1.5M")
 */
function formatLargeNumber(n: number): string {
  if (n >= 1_000_000_000) {
    return `${(n / 1_000_000_000).toFixed(1)}B`;
  }
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`;
  }
  return String(n);
}

/**
 * Format seconds to MM:SS or HH:MM:SS
 */
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}:${String(remainingMins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
