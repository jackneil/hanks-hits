import { getGameMetadata } from "@/shared/lib/gameMetadata.generated";

/**
 * Universal, auto-derived achievements ("Trophy Case").
 *
 * Every id is built from a kind + optional appId + optional tier, so the
 * whole catalog derives from a handful of templates and works for any game
 * or app — including ones that don't exist yet — without per-island edits.
 *
 * Id shapes:
 *   first-play:{appId}          tried a game for the first time
 *   plays:{appId}:{tier}        play-count tiers per game
 *   streak:{appId}:{tier}       streak tiers per game
 *   explorer:{tier}             distinct games/apps played (global)
 *   record-breaker:{tier}       personal bests beaten (global)
 */

export interface AchievementInfo {
  id: string;
  /** null for global (cross-game) achievements */
  appId: string | null;
  name: string;
  /** past-tense, for an EARNED trophy ("Played Snake 5 times!") */
  description: string;
  /** goal-phrased, for a LOCKED teaser ("Play Snake 5 times to unlock!") —
   * a locked row must state the goal, not claim the accomplishment */
  lockedDescription: string;
  emoji: string;
}

// Field aliases grounded in the real Progress types across src/games and
// src/apps (grep survey 2026-07-12). The evaluator takes the MAX across all
// matching aliases, scanning the blob one level deep (drum-machine keeps
// stats.padsHit nested).
export const PLAYS_ALIASES = [
  "gamesPlayed",
  "totalGamesPlayed",
  "totalAnswered",
  "jokesViewed",
  "totalFeedings",
  "padsHit",
  "beatsCreated",
] as const;

// bestTime is deliberately excluded: lower is better, so "increase = better"
// doesn't hold for it.
export const BEST_ALIASES = [
  "highScore",
  "bestScore",
  "bestDistance",
  "highestLevel",
  "highestTile",
] as const;

// Only monotonic "best ever" streak fields — currentStreak can shrink.
export const STREAK_ALIASES = [
  "longestStreak",
  "bestStreak",
  "maxStreak",
] as const;

export const PLAYS_TIERS = [5, 25, 100] as const;
export const STREAK_TIERS = [3, 7] as const;
export const EXPLORER_TIERS = [3, 10, 25] as const;
export const RECORD_TIERS = [1, 10] as const;

type Copy = { name: string; emoji: string; blurb: string; goal: string };

const PLAYS_COPY: Record<number, Copy> = {
  5: { name: "Regular!", emoji: "🎮", blurb: "Played {game} 5 times!", goal: "Play {game} 5 times to unlock!" },
  25: { name: "Super Fan!", emoji: "🌟", blurb: "Played {game} 25 times!", goal: "Play {game} 25 times to unlock!" },
  100: { name: "Legend!", emoji: "👑", blurb: "Played {game} 100 times! WOW!", goal: "Play {game} 100 times to unlock!" },
};

const STREAK_COPY: Record<number, Copy> = {
  3: { name: "On Fire!", emoji: "🔥", blurb: "A 3-in-a-row streak in {game}!", goal: "Get 3 in a row in {game} to unlock!" },
  7: { name: "Streak Master!", emoji: "⚡", blurb: "A 7-in-a-row streak in {game}!", goal: "Get 7 in a row in {game} to unlock!" },
};

const EXPLORER_COPY: Record<number, Copy> = {
  3: { name: "Explorer!", emoji: "🗺️", blurb: "You tried 3 different games!", goal: "Try 3 different games to unlock!" },
  10: { name: "Adventurer!", emoji: "🚀", blurb: "You tried 10 different games!", goal: "Try 10 different games to unlock!" },
  25: { name: "Completionist!", emoji: "🏆", blurb: "You tried 25 different games!", goal: "Try 25 different games to unlock!" },
};

const RECORD_COPY: Record<number, Copy> = {
  1: { name: "Record Breaker!", emoji: "🏅", blurb: "You beat your own best score!", goal: "Beat your own best score to unlock!" },
  10: { name: "Unstoppable!", emoji: "💪", blurb: "Beat your own records 10 times!", goal: "Beat your own records 10 times to unlock!" },
};

function gameName(appId: string): string {
  return getGameMetadata(appId).name;
}

/** Build display info for any achievement id. Unknown shapes get a safe generic. */
export function getAchievementInfo(id: string): AchievementInfo {
  const parts = id.split(":");
  const kind = parts[0];

  if (kind === "first-play" && parts[1]) {
    const appId = parts[1];
    return {
      id,
      appId,
      name: "First Play!",
      description: `You tried ${gameName(appId)}!`,
      lockedDescription: `Try ${gameName(appId)} to unlock!`,
      emoji: "🎉",
    };
  }

  if ((kind === "plays" || kind === "streak") && parts[1] && parts[2]) {
    const appId = parts[1];
    const tier = Number(parts[2]);
    const copy = (kind === "plays" ? PLAYS_COPY : STREAK_COPY)[tier];
    if (copy) {
      return {
        id,
        appId,
        name: copy.name,
        description: copy.blurb.replace("{game}", gameName(appId)),
        lockedDescription: copy.goal.replace("{game}", gameName(appId)),
        emoji: copy.emoji,
      };
    }
  }

  if ((kind === "explorer" || kind === "record-breaker") && parts[1]) {
    const tier = Number(parts[1]);
    const copy = (kind === "explorer" ? EXPLORER_COPY : RECORD_COPY)[tier];
    if (copy) {
      return {
        id,
        appId: null,
        name: copy.name,
        description: copy.blurb,
        lockedDescription: copy.goal,
        emoji: copy.emoji,
      };
    }
  }

  return {
    id,
    appId: null,
    name: "Trophy!",
    description: "You earned a trophy!",
    lockedDescription: "Keep playing to unlock!",
    emoji: "🏆",
  };
}

/**
 * Which trophy tiers an app can HONESTLY offer, per its observed capability
 * flags (from the achievements watermarks). Tiers an app cannot award are
 * never teased — a locked "streak" trophy in a game with no streak field
 * would be a goal a kid could grind at forever without unlocking.
 */
export function appCatalog(
  appId: string,
  caps?: { hasPlays?: boolean; hasStreak?: boolean }
): AchievementInfo[] {
  const ids: string[] = [`first-play:${appId}`];
  if (caps?.hasPlays) {
    for (const tier of PLAYS_TIERS) ids.push(`plays:${appId}:${tier}`);
  }
  if (caps?.hasStreak) {
    for (const tier of STREAK_TIERS) ids.push(`streak:${appId}:${tier}`);
  }
  return ids.map(getAchievementInfo);
}

/** The cross-game (global) trophy catalog: explorer + record-breaker tiers. */
export function globalCatalog(): AchievementInfo[] {
  const ids: string[] = [];
  for (const tier of EXPLORER_TIERS) ids.push(`explorer:${tier}`);
  for (const tier of RECORD_TIERS) ids.push(`record-breaker:${tier}`);
  return ids.map(getAchievementInfo);
}
