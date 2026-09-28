/**
 * Library budget and eviction rules (plan 8.1). Pure functions.
 *
 * - The library uses at most 25% of the storage quota.
 * - There is no time-based deletion.
 * - Only when a new clip does not fit, "auto" clips that the kid did not keep and
 *   already watched are removed, oldest first.
 * - A clip that was not watched (NEW) is never removed. Clips the kid made ("clip"),
 *   Record videos ("record") and pictures are never removed automatically.
 * - If the new clip still does not fit after every allowed removal, nothing is
 *   removed: removing clips that cannot make enough space only loses data.
 */

import type { ClipRecord } from "../protocol";

/** The share of the storage quota that the library can use. */
export const LIBRARY_QUOTA_SHARE = 0.25;

/** What an eviction did: the clips that stay and the clips it removed. */
export interface EvictionOutcome {
  kept: string[];
  removed: string[];
}

export function budgetFromQuota(quotaBytes: number): number {
  if (!Number.isFinite(quotaBytes) || quotaBytes <= 0) return 0;
  return Math.floor(quotaBytes * LIBRARY_QUOTA_SHARE);
}

/** True when the rules allow the library to remove this clip to make space. */
export function isEvictable(record: ClipRecord): boolean {
  return record.kind === "auto" && !record.kept && record.watched;
}

export interface EvictionPlan {
  /** True when the new clip fits after the removals in `remove`. */
  fits: boolean;
  usedBytes: number;
  budgetBytes: number;
  neededBytes: number;
  /** Clips to remove, in removal order. Empty when the clip fits already or cannot fit. */
  remove: ClipRecord[];
  /** Every clip that stays, in the input order. */
  keep: ClipRecord[];
}

function sumBytes(records: ClipRecord[]): number {
  return records.reduce((sum, record) => sum + Math.max(0, record.bytes || 0), 0);
}

function byAge(a: ClipRecord, b: ClipRecord): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Plans the removals that make `neededBytes` fit in `budgetBytes`.
 *
 * `deferred` holds ids that the UI opened a short time ago (for example a clip on
 * the share sheet). These clips are removed last: first the other candidates, oldest
 * first, then the deferred ones, oldest first. The order changes only which clips go,
 * never whether the new clip fits.
 */
export function planEviction(
  records: ClipRecord[],
  budgetBytes: number,
  neededBytes: number,
  deferred: ReadonlySet<string> = new Set(),
): EvictionPlan {
  const usedBytes = sumBytes(records);
  const base = { usedBytes, budgetBytes, neededBytes };
  if (usedBytes + neededBytes <= budgetBytes) {
    return { ...base, fits: true, remove: [], keep: records.slice() };
  }
  const evictable = records.filter(isEvictable);
  const candidates = [
    ...evictable.filter((record) => !deferred.has(record.id)).sort(byAge),
    ...evictable.filter((record) => deferred.has(record.id)).sort(byAge),
  ];
  const remove: ClipRecord[] = [];
  let freed = 0;
  for (const candidate of candidates) {
    if (usedBytes - freed + neededBytes <= budgetBytes) break;
    remove.push(candidate);
    freed += Math.max(0, candidate.bytes || 0);
  }
  if (usedBytes - freed + neededBytes > budgetBytes) {
    return { ...base, fits: false, remove: [], keep: records.slice() };
  }
  const removed = new Set(remove.map((record) => record.id));
  return { ...base, fits: true, remove, keep: records.filter((record) => !removed.has(record.id)) };
}
