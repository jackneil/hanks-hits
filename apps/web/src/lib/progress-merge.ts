/**
 * Progress merge utilities for handling localStorage → DB sync
 *
 * Strategy: "last write wins" on the progress blob's own lastModified,
 * with field-aware reconciliation so divergent sessions can't destroy
 * monotonic progress (high scores, totals, unlockables).
 *
 * The fields of a known app follow its reviewed direction table
 * (progress-field-rules.ts). The name rules below are for a merge with no
 * app id only.
 */

import type { AppProgressData } from "@hank-neil/db";
import { PROGRESS_FIELD_RULES, type FieldRule } from "./progress-field-rules";

/**
 * Merge strategy result
 */
export type MergeResult = {
  data: AppProgressData;
  source: "local" | "server" | "merged";
  /** The side whose blob is the base of `data`: the newer one. */
  base: "local" | "server";
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
const UNLOCKABLE_KEY =
  /(unlocked|purchased|achievement|badge|upgrade|trophies)/i;

const isPrimitiveArray = (v: unknown): v is (string | number)[] =>
  Array.isArray(v) &&
  v.every((x) => typeof x === "string" || typeof x === "number");

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

// ---------------------------------------------------------------------------
// Reconcile by the reviewed direction table of an app
// ---------------------------------------------------------------------------

type FieldAction = { segments: readonly string[]; rule: Exclude<FieldRule, "neither"> };

const actionsByApp = new Map<string, readonly FieldAction[]>();

/** The fields of an app that keep a value of the older save, or null for an unknown app. */
function fieldActions(appId: string): readonly FieldAction[] | null {
  if (!Object.prototype.hasOwnProperty.call(PROGRESS_FIELD_RULES, appId)) return null;
  const cached = actionsByApp.get(appId);
  if (cached) return cached;
  const table = PROGRESS_FIELD_RULES[appId as keyof typeof PROGRESS_FIELD_RULES];
  const actions: FieldAction[] = [];
  for (const [path, direction] of Object.entries(table)) {
    if (direction.rule === "neither") continue;
    actions.push({ segments: path.split("."), rule: direction.rule });
  }
  actionsByApp.set(appId, actions);
  return actions;
}

const hasOwn = (obj: object, key: string) =>
  Object.prototype.hasOwnProperty.call(obj, key);

const isPlainRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const isNumberArray = (v: unknown): v is number[] =>
  Array.isArray(v) && v.every(isFiniteNumber);

/**
 * A shallow copy of obj with key set to value. defineProperty, never an
 * assignment, so a hostile "__proto__" key stays a plain data key.
 */
function withKey<T extends Record<string, unknown>>(obj: T, key: string, value: unknown): T {
  const copy = { ...obj };
  Object.defineProperty(copy, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return copy;
}

/** The value to keep at one field. Returns w itself when w stays. */
function foldValue(w: unknown, l: unknown, rule: FieldAction["rule"]): unknown {
  switch (rule) {
    case "max": {
      if (isFiniteNumber(w) && isFiniteNumber(l)) return l > w ? l : w;
      // A flag that only turns on (a level completed): true wins.
      if (typeof w === "boolean" && typeof l === "boolean") return l && !w ? l : w;
      // A count at each place (wordle's wins per number of guesses).
      if (isNumberArray(w) && isNumberArray(l)) {
        let changed = l.length > w.length;
        const out = Array.from({ length: Math.max(w.length, l.length) }, (_, i) => {
          if (i >= w.length) return l[i];
          if (i < l.length && l[i] > w[i]) {
            changed = true;
            return l[i];
          }
          return w[i];
        });
        return changed ? out : w;
      }
      return w;
    }
    case "minPositive":
      // 0 and null mean "no record yet".
      if (isFiniteNumber(l) && l > 0 && !(isFiniteNumber(w) && w > 0 && w <= l)) return l;
      return w;
    case "earliest":
      return isFiniteNumber(w) && isFiniteNumber(l) && l < w ? l : w;
    case "union":
      if (isPrimitiveArray(w) && isPrimitiveArray(l)) {
        const extras = l.filter((x) => !w.includes(x));
        return extras.length > 0 ? [...w, ...extras] : w;
      }
      return w;
  }
}

/**
 * Fold the loser's value at one path into w. "*" walks every key of a
 * record: a key that only the loser has (a level, a stage, a trophy) is
 * copied whole. A fixed key that the winner does not have stays out.
 * Returns w itself when nothing changes.
 */
function foldPath(
  w: unknown,
  l: unknown,
  segments: readonly string[],
  rule: FieldAction["rule"],
): unknown {
  if (segments.length === 0) return foldValue(w, l, rule);
  if (!isPlainRecord(w) || !isPlainRecord(l)) return w;
  const [segment, ...rest] = segments;
  const keys = segment === "*" ? Object.keys(l) : [segment];
  let out = w;
  for (const key of keys) {
    if (!hasOwn(l, key)) continue;
    let next: unknown;
    if (hasOwn(out, key)) {
      next = foldPath(out[key], l[key], rest, rule);
      if (next === out[key]) continue;
    } else if (segment === "*") {
      next = JSON.parse(JSON.stringify(l[key]));
    } else {
      continue;
    }
    out = withKey(out, key, next);
  }
  return out;
}

function reconcileByTable(
  winner: AppProgressData,
  loser: AppProgressData,
  actions: readonly FieldAction[],
): [AppProgressData, boolean] {
  let out: unknown = winner;
  for (const { segments, rule } of actions) {
    out = foldPath(out, loser, segments, rule);
  }
  return [out as AppProgressData, out !== winner];
}

/**
 * Field-aware reconcile: the LWW winner's blob is the base. With an app id,
 * each field follows the app's reviewed direction table; with no app id,
 * the name rules below apply to fields present in BOTH blobs (monotonic
 * counters take max and unlockable collections union).
 * Returns [data, changed].
 */
function reconcileFields(
  winner: AppProgressData,
  loser: AppProgressData,
  appId?: string,
): [AppProgressData, boolean] {
  const actions = appId === undefined ? null : fieldActions(appId);
  const [reconciled, changedByFields] = actions
    ? reconcileByTable(winner, loser, actions)
    : reconcileByName(winner, loser);
  const out: AppProgressData = { ...reconciled };

  // Keep lastModified honest: the reconciled blob represents both sessions.
  const wTs = winner.lastModified;
  const lTs = loser.lastModified;
  if (typeof wTs === "number" && typeof lTs === "number" && lTs > wTs) {
    out.lastModified = lTs;
  }

  return [out, changedByFields];
}

/** The name rules: for a merge with no app id (no reviewed table). */
function reconcileByName(
  winner: AppProgressData,
  loser: AppProgressData,
): [AppProgressData, boolean] {
  const out: AppProgressData = { ...winner };
  let changed = false;

  for (const key of Object.keys(winner)) {
    if (!(key in loser)) continue;
    const w = winner[key];
    const l = loser[key];

    if (
      key === "bestRaceTimeMs" &&
      typeof w === "number" &&
      typeof l === "number"
    ) {
      // Lower positive race times are records; zero means no completed race.
      if (l > 0 && (w <= 0 || l < w)) {
        out[key] = l;
        changed = true;
      }
    } else if (
      typeof w === "number" &&
      typeof l === "number" &&
      isMonotonicKey(key)
    ) {
      if (l > w) {
        out[key] = l;
        changed = true;
      }
    } else if (
      isPrimitiveArray(w) &&
      isPrimitiveArray(l) &&
      UNLOCKABLE_KEY.test(key)
    ) {
      const extras = l.filter((x) => !w.includes(x));
      if (extras.length > 0) {
        out[key] = [...w, ...extras];
        changed = true;
      }
    } else if (
      isTimestampRecord(w) &&
      isTimestampRecord(l) &&
      UNLOCKABLE_RECORD_KEY.test(key)
    ) {
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
  serverTimestamp: number | null,
  appId?: string,
): MergeResult {
  // No local data - use server
  if (!localData) {
    return {
      data: serverData || {},
      source: "server",
      base: "server",
      conflicts: [],
    };
  }

  // No server data - use local (first login scenario)
  if (!serverData) {
    return {
      data: localData,
      source: "local",
      base: "local",
      conflicts: [],
    };
  }

  // Both exist - compare timestamps
  const localTime = localTimestamp || 0;
  const serverTime = serverTimestamp || 0;

  const serverWins = serverTime >= localTime;
  const winner = serverWins ? serverData : localData;
  const loser = serverWins ? localData : serverData;

  const [data, reconciled] = reconcileFields(winner, loser, appId);

  const conflicts: string[] = [];
  if (serverWins && localTime > 0) {
    conflicts.push("Local progress was merged into newer server data");
  } else if (!serverWins && serverTime > 0) {
    conflicts.push("Server progress was merged into newer local data");
  }

  return {
    data,
    source: reconciled ? "merged" : serverWins ? "server" : "local",
    base: serverWins ? "server" : "local",
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
  receivedAtMs: number,
): number | null {
  if (ts === null) return null;
  return Math.min(ts, receivedAtMs + MAX_ORDERING_CLOCK_SKEW_MS);
}

export function mergeForSave(
  incomingData: AppProgressData,
  existing: { data: AppProgressData; updatedAt: Date } | null,
  appId?: string,
): MergeResult {
  if (!existing) {
    return { data: incomingData, source: "local", base: "local", conflicts: [] };
  }
  const incomingTs = clampOrderingTimestamp(
    extractTimestamp(incomingData),
    Date.now(),
  );
  const existingTs = clampOrderingTimestamp(
    extractTimestamp(existing.data) ?? existing.updatedAt.getTime(),
    existing.updatedAt.getTime(),
  );
  return mergeProgress(incomingData, existing.data, incomingTs, existingTs, appId);
}

/** A schema check: the parsed data, or the reason (field paths and rules). */
export type ProgressValidator = (
  data: unknown,
) => { success: true; data: unknown } | { success: false; error: string };

/** What the route stores for a merge save. */
export type MergedSave =
  | {
      kind: "write";
      /** The validated blob to store. */
      data: AppProgressData;
      base: "local" | "server";
      conflicts: string[];
      /** Top-level fields of the merge that broke the schema and were left out. */
      leftOut: string[];
      /** Why the full merge broke the schema (empty when it did not). */
      mergeError: string;
    }
  | {
      kind: "keepExisting";
      /** Why the stored row fails the schema today. */
      error: string;
    };

/**
 * The blob to store for a merge save (POST with merge=true), checked by the
 * schema. The incoming blob must already pass `validate`.
 *
 * - The merge passes: store it.
 * - The merge breaks the schema (a union longer than the schema allows, or a
 *   stored row that the schema of today refuses): start again from the
 *   NEWER side alone (merge.base) and add the merged fields one at a time,
 *   each only when the blob still passes. An older save can never replace a
 *   newer row this way, and every record that fits is kept.
 * - The newer side is the stored row and the row itself fails the schema of
 *   today: store nothing ("keepExisting"). The route answers 409; the
 *   client keeps its save on the device and sends it again with its next
 *   change, which is newer than the row.
 */
export function resolveMergedSave(
  incoming: AppProgressData,
  existing: { data: AppProgressData; updatedAt: Date },
  appId: string,
  validate: ProgressValidator,
): MergedSave {
  const merged = mergeForSave(incoming, existing, appId);
  const full = validate(merged.data);
  if (full.success) {
    return {
      kind: "write",
      data: full.data as AppProgressData,
      base: merged.base,
      conflicts: merged.conflicts,
      leftOut: [],
      mergeError: "",
    };
  }

  const baseBlob = merged.base === "local" ? incoming : existing.data;
  if (merged.base === "server") {
    const row = validate(existing.data);
    if (!row.success) return { kind: "keepExisting", error: row.error };
  }

  let current: Record<string, unknown> = { ...baseBlob };
  const leftOut: string[] = [];
  for (const key of Object.keys(merged.data)) {
    const value = merged.data[key];
    if (hasOwn(baseBlob, key) && baseBlob[key] === value) continue;
    const candidate = withKey(current, key, value);
    if (validate(candidate).success) current = candidate;
    else leftOut.push(key);
  }

  // The base passed and each added field kept the blob passing, so this
  // check passes. If it ever does not: keep the newer side as it is.
  let salvaged = validate(current);
  if (!salvaged.success) {
    if (merged.base === "server") return { kind: "keepExisting", error: salvaged.error };
    salvaged = validate(incoming);
    if (!salvaged.success) salvaged = { success: true, data: incoming };
    leftOut.splice(
      0,
      leftOut.length,
      ...Object.keys(merged.data).filter((key) => merged.data[key] !== incoming[key]),
    );
  }
  return {
    kind: "write",
    data: salvaged.data as AppProgressData,
    base: merged.base,
    conflicts: merged.conflicts,
    leftOut,
    mergeError: full.error,
  };
}

/**
 * Extract timestamp from progress data blob
 *
 * Games should store updatedAt in their state for merge resolution
 */
export function extractTimestamp(data: AppProgressData | null): number | null {
  if (!data) return null;

  // Check common timestamp field names
  const timestampFields = [
    "updatedAt",
    "lastModified",
    "timestamp",
    "_timestamp",
  ];

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

/** The name rules, for the test that the reviewed table keeps every merge they made. */
export const __legacyNameRulesForTests = {
  isMonotonicKey,
  UNLOCKABLE_KEY,
  UNLOCKABLE_RECORD_KEY,
};
