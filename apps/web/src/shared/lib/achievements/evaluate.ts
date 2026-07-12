import {
  BEST_ALIASES,
  EXPLORER_TIERS,
  PLAYS_ALIASES,
  PLAYS_TIERS,
  RECORD_TIERS,
  STREAK_ALIASES,
  STREAK_TIERS,
} from "./definitions";

/** Last-seen normalized stats per app. `seeded` marks that we've observed the
 * app at least once, so a pre-existing high score never fires record-breaker
 * on first sight — only an increase we actually WATCHED counts. */
export interface AppWatermark {
  plays: number;
  best: number;
  streak: number;
  seeded: boolean;
}

export interface Watermarks {
  apps: Record<string, AppWatermark>;
  /** appIds with observed evidence of play (drives explorer tiers) */
  playedApps: string[];
  /** count of observed personal-best increases across all apps */
  bestIncreases: number;
}

export function emptyWatermarks(): Watermarks {
  return { apps: {}, playedApps: [], bestIncreases: 0 };
}

/** Max finite non-negative value across aliases, scanning one level deep. */
function readMax(blob: Record<string, unknown>, aliases: readonly string[]): number {
  let max = 0;
  const scan = (obj: Record<string, unknown>) => {
    for (const alias of aliases) {
      const v = obj[alias];
      if (typeof v === "number" && Number.isFinite(v) && v > max) max = v;
    }
  };
  scan(blob);
  for (const value of Object.values(blob)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      scan(value as Record<string, unknown>);
    }
  }
  return max;
}

export interface EvaluateResult {
  newUnlocks: string[];
  watermarks: Watermarks;
}

/**
 * Pure evaluator: given one app's current progress blob, the set of already
 * unlocked ids, and the watermarks, return the newly earned ids and the next
 * watermarks. Never throws on junk input; never re-awards an unlocked id.
 */
export function evaluate(
  appId: string,
  blob: Record<string, unknown>,
  unlockedIds: ReadonlySet<string>,
  wm: Watermarks
): EvaluateResult {
  const plays = readMax(blob, PLAYS_ALIASES);
  const best = readMax(blob, BEST_ALIASES);
  const streak = readMax(blob, STREAK_ALIASES);
  const evidence = plays > 0 || best > 0 || streak > 0;

  const earned: string[] = [];
  const award = (id: string) => {
    if (!unlockedIds.has(id) && !earned.includes(id)) earned.push(id);
  };

  const prev = wm.apps[appId];
  const playedApps = wm.playedApps.includes(appId)
    ? wm.playedApps
    : evidence
      ? [...wm.playedApps, appId]
      : wm.playedApps;
  let bestIncreases = wm.bestIncreases;

  if (evidence) {
    award(`first-play:${appId}`);
    for (const tier of PLAYS_TIERS) {
      if (plays >= tier) award(`plays:${appId}:${tier}`);
    }
    for (const tier of STREAK_TIERS) {
      if (streak >= tier) award(`streak:${appId}:${tier}`);
    }
    for (const tier of EXPLORER_TIERS) {
      if (playedApps.length >= tier) award(`explorer:${tier}`);
    }
    // A record only "breaks" when a REAL previous best (>0) was beaten while
    // we were watching — seeding and first-ever scores stay silent.
    if (prev?.seeded && prev.best > 0 && best > prev.best) {
      bestIncreases += 1;
      for (const tier of RECORD_TIERS) {
        if (bestIncreases >= tier) award(`record-breaker:${tier}`);
      }
    }
  }

  return {
    newUnlocks: earned,
    watermarks: {
      apps: { ...wm.apps, [appId]: { plays, best, streak, seeded: true } },
      playedApps,
      bestIncreases,
    },
  };
}
