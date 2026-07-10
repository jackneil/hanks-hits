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

// Numeric fields that only ever grow with play. Balances that can be SPENT
// (cookies, money, coins) deliberately do NOT match — max() would mint refunds.
// FOOTGUN: this matches by suffix (Count/Score/...). If a future game names a
// SPENDABLE balance with a matching suffix (e.g. coinCount), merges would
// refund spending. Name spendable balances without these suffixes.
const MONOTONIC_KEY =
  /^(total|high|best|max|longest|games)[A-Z0-9_]|(Score|Played|Baked|Clicks|Streak|Count|Distance|Wins|Deaths|Jumps|Pipes|Landings)$/;

// Collections a player unlocks/earns — safe to union across sessions.
const UNLOCKABLE_KEY = /(unlocked|purchased|achievement|badge|upgrade|trophies)/i;

const isPrimitiveArray = (v: unknown): v is (string | number)[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string" || typeof x === "number");

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

    if (typeof w === "number" && typeof l === "number" && MONOTONIC_KEY.test(key)) {
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
