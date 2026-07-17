/**
 * Progress merge utilities for handling localStorage → DB sync
 *
 * Strategy: "last write wins" on the progress blob's own lastModified,
 * with field-aware reconciliation so divergent sessions can't destroy
 * monotonic progress (high scores, totals, unlockables).
 */

import type { AppProgressData } from "@hank-neil/db";

/**
 * Merge strategy result
 */
export type MergeResult = {
  data: AppProgressData;
  source: "local" | "server" | "merged";
  conflicts: string[];
};

// Numeric fields that only ever grow with play, safe to max() across sessions.
//
// Two rules, both deliberately conservative (a missed field just falls back
// to last-write-wins — safe; a wrong match corrupts data):
// 1. Prefix rule: "high/best/max/longest/games" + capital = records and
//    tallies, monotonic by construction (highScore, bestDistance, maxStreak,
//    gamesPlayed, gamesWon...).
// 2. Exact allowlist: every other monotonic counter, verified against its
//    store's code. NOT listed on purpose: spendable wallets (totalCoins is
//    DECREMENTED on character unlock), transient per-round values
//    (currentStreak/currentScore/miniGameScore reset to 0), and timestamps.
//    When adding a game, only list a field here after checking it never
//    decreases in the store.
const MONOTONIC_PREFIX = /^(high|best|max|longest|games)[A-Z0-9_]/;
const MONOTONIC_ALLOWLIST = new Set([
  "totalCookiesBaked",
  "totalClicks",
  "totalDistance",
  "totalDeaths",
  "totalJumps",
  "totalPipes",
  "totalFood",
  "totalWins",
  "totalGamesPlayed",
  "totalBallsSpawned",
  // "highestMultiplier" misses MONOTONIC_PREFIX: the prefix requires an
  // uppercase char right after "high" ("highScore" matches, "highest…" not)
  "highestMultiplier",
  "successfulLandings",
  "easyWins",
  "mediumWins",
  "hardWins",
  "twoPlayerRedWins",
  "twoPlayerBlackWins",
]);
const isMonotonicKey = (key: string) =>
  MONOTONIC_PREFIX.test(key) || MONOTONIC_ALLOWLIST.has(key);

// Collections a player unlocks/earns — safe to union across sessions.
const UNLOCKABLE_KEY = /(unlocked|purchased|achievement|badge|upgrade|trophies)/i;

const isPrimitiveArray = (v: unknown): v is (string | number)[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string" || typeof x === "number");

// Unlockable OBJECT maps (id -> unlockedAt epoch ms), e.g. the Trophy Case's
// `unlocked` record. These must UNION like unlockable arrays do — pure
// last-write-wins would let a stale device's whole map replace the server's
// and silently drop trophies earned elsewhere (found by DCR: explorer and
// record-breaker never re-derive, so the loss was permanent).
//
// The record variant deliberately uses a NARROWER name set than the array
// variant: union takes the MINIMUM per key (earliest unlock time), which is
// right for timestamp maps but would corrupt a future count/level map like
// `upgradeLevels: Record<id, number>` to the cross-device minimum. Fields
// named purchased/upgrade are the likely shape of such maps, so they are
// excluded here and stay last-write-wins unless someone consciously adds
// them.
const UNLOCKABLE_RECORD_KEY = /(unlocked|achievement|badge|trophies)/i;

const isTimestampRecord = (v: unknown): v is Record<string, number> =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  Object.values(v).every((x) => typeof x === "number");

/**
 * Field-aware reconcile: the LWW winner's blob is the base; for fields present
 * in BOTH blobs, monotonic counters take max and unlockable collections union.
 * Returns [data, changed].
 */
function reconcileFields(
  winner: AppProgressData,
  loser: AppProgressData
): [AppProgressData, boolean] {
  const out: AppProgressData = { ...winner };
  let changed = false;

  for (const key of Object.keys(winner)) {
    if (!(key in loser)) continue;
    const w = winner[key];
    const l = loser[key];

    if (typeof w === "number" && typeof l === "number" && isMonotonicKey(key)) {
      if (l > w) {
        out[key] = l;
        changed = true;
      }
    } else if (isPrimitiveArray(w) && isPrimitiveArray(l) && UNLOCKABLE_KEY.test(key)) {
      const extras = l.filter((x) => !w.includes(x));
      if (extras.length > 0) {
        out[key] = [...w, ...extras];
        changed = true;
      }
    } else if (isTimestampRecord(w) && isTimestampRecord(l) && UNLOCKABLE_RECORD_KEY.test(key)) {
      // Union ids across sessions; a trophy both sides know keeps its
      // EARLIEST unlock time. Built via Map + fromEntries (define-own-property
      // semantics) so a hostile "__proto__" id can never reach a [[Set]] path.
      const entries = new Map(Object.entries(w));
      let unionChanged = false;
      for (const [id, ts] of Object.entries(l)) {
        const existing = entries.get(id);
        if (existing === undefined || ts < existing) {
          entries.set(id, ts);
          unionChanged = true;
        }
      }
      if (unionChanged) {
        out[key] = Object.fromEntries(entries);
        changed = true;
      }
    }
  }

  // Keep lastModified honest: the reconciled blob represents both sessions.
  const wTs = winner.lastModified;
  const lTs = loser.lastModified;
  if (typeof wTs === "number" && typeof lTs === "number" && lTs > wTs) {
    out.lastModified = lTs;
  }

  return [out, changed];
}

/**
 * Timestamp-based merge with field-aware reconciliation.
 *
 * - If only one side has data, it wins outright.
 * - Otherwise the side with the newer timestamp is the base, and monotonic
 *   counters / unlockables from the older side are folded in so a stale blob
 *   can never erase earned progress.
 */
export function mergeProgress(
  localData: AppProgressData | null,
  serverData: AppProgressData | null,
  localTimestamp: number | null,
  serverTimestamp: number | null
): MergeResult {
  // No local data - use server
  if (!localData) {
    return {
      data: serverData || {},
      source: "server",
      conflicts: [],
    };
  }

  // No server data - use local (first login scenario)
  if (!serverData) {
    return {
      data: localData,
      source: "local",
      conflicts: [],
    };
  }

  // Both exist - compare timestamps
  const localTime = localTimestamp || 0;
  const serverTime = serverTimestamp || 0;

  const serverWins = serverTime >= localTime;
  const winner = serverWins ? serverData : localData;
  const loser = serverWins ? localData : serverData;

  const [data, reconciled] = reconcileFields(winner, loser);

  const conflicts: string[] = [];
  if (serverWins && localTime > 0) {
    conflicts.push("Local progress was merged into newer server data");
  } else if (!serverWins && serverTime > 0) {
    conflicts.push("Server progress was merged into newer local data");
  }

  return {
    data,
    source: reconciled ? "merged" : serverWins ? "server" : "local",
    conflicts,
  };
}

/**
 * Server-side merge entry point for POST /api/progress with merge=true.
 *
 * Timestamps come from the progress blobs' OWN lastModified — the row's
 * updatedAt only breaks ties when a blob carries no timestamp, because
 * updatedAt gets refreshed by every write (including no-op merges) and
 * therefore cannot order client sessions.
 */
// A blob's ORDERING timestamp can never exceed the time the server actually
// received it, plus a small skew allowance. The schema accepts generously-
// future lastModified values (kids' devices have wrong clocks), but a forged
// far-future timestamp must not make a row win last-write-wins forever:
// the stored side is bounded by the row's server-recorded updatedAt, the
// incoming side by the server's current clock.
const MAX_ORDERING_CLOCK_SKEW_MS = 5 * 60_000;

function clampOrderingTimestamp(
  ts: number | null,
  receivedAtMs: number
): number | null {
  if (ts === null) return null;
  return Math.min(ts, receivedAtMs + MAX_ORDERING_CLOCK_SKEW_MS);
}

export function mergeForSave(
  incomingData: AppProgressData,
  existing: { data: AppProgressData; updatedAt: Date } | null
): MergeResult {
  if (!existing) {
    return { data: incomingData, source: "local", conflicts: [] };
  }
  const incomingTs = clampOrderingTimestamp(
    extractTimestamp(incomingData),
    Date.now()
  );
  const existingTs = clampOrderingTimestamp(
    extractTimestamp(existing.data) ?? existing.updatedAt.getTime(),
    existing.updatedAt.getTime()
  );
  return mergeProgress(incomingData, existing.data, incomingTs, existingTs);
}

/**
 * Extract timestamp from progress data blob
 *
 * Games should store updatedAt in their state for merge resolution
 */
export function extractTimestamp(data: AppProgressData | null): number | null {
  if (!data) return null;

  // Check common timestamp field names
  const timestampFields = ["updatedAt", "lastModified", "timestamp", "_timestamp"];

  for (const field of timestampFields) {
    const val = data[field];
    if (typeof val === "number") return val;
    if (typeof val === "string") {
      const parsed = Date.parse(val);
      if (!isNaN(parsed)) return parsed;
    }
  }

  return null;
}
