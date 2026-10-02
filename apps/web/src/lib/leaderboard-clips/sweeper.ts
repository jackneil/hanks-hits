/**
 * The leaderboard clip sweeper (design/LEADERBOARD_CLIPS.html, section 8).
 *
 * Railway buckets have no lifecycle rules, so the app deletes old clips
 * itself. Each run:
 * 1. deletes the rows past their time (hidden for 30 days, or uploaded 12
 *    months ago) and their objects;
 * 2. lists every object under lb/, page by page, and deletes each object
 *    that has no row and is older than ORPHAN_GRACE_MS (an account delete
 *    removes the rows by cascade; a failed delete can leave an object);
 * 3. deletes upload ledger rows older than 2 days.
 * It never lists or deletes legal-hold/ (section 7).
 *
 * The sweeper runs while the bucket settings are valid, also when the kill
 * switch is on: deleting old data is a legal duty (COPPA 312.10), not a
 * feature. The log line has counts only.
 */
import { describeError } from "@/lib/describe-error";

import { CLIP_PREFIX, clipIdOfKey, posterKey, videoKey, type ClipBucket, type ListedObject } from "./bucket";
import type { BucketSettings, LeaderboardClipsConfig } from "./config";
import { retentionCutoffs } from "./retention";
import type { ClipStore } from "./store";

export interface SweepDeps {
  config: () => LeaderboardClipsConfig;
  store: ClipStore;
  bucket: (settings: BucketSettings) => ClipBucket;
  now: () => Date;
}

export interface SweepResult {
  skipped: boolean;
  expiredRows: number;
  orphanObjects: number;
  deletedObjects: number;
  failedDeletes: number;
  ledgerRows: number;
}

/** Bucket deletes that run at the same time (the bucket does the work, not this server). */
const DELETE_CONCURRENCY = 8;
/** Keys checked against the database in one query. */
const LIST_BATCH = 500;

/** Run `work` on every item, at most `limit` at a time. Returns how many failed. */
async function forEachLimited<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<number> {
  let next = 0;
  let failed = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        await work(item);
      } catch {
        failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return failed;
}

/** Delete the keys. Returns [deleted, failed]. */
async function deleteKeys(bucket: ClipBucket, keys: readonly string[]): Promise<[number, number]> {
  const failed = await forEachLimited(keys, DELETE_CONCURRENCY, (key) => bucket.delete(key));
  return [keys.length - failed, failed];
}

/** The orphans in one batch of listed objects: no row, and older than the grace time. */
async function orphansIn(store: ClipStore, batch: readonly ListedObject[], before: Date): Promise<string[]> {
  const ids = [...new Set(batch.map((object) => clipIdOfKey(object.key)).filter((id): id is string => id !== null))];
  const existing = await store.existingClipIds(ids);
  return batch
    .filter((object) => {
      const id = clipIdOfKey(object.key);
      if (id !== null && existing.has(id)) return false;
      // An object with no time is left alone: it could be an upload that is running.
      return object.lastModified !== null && object.lastModified < before;
    })
    .map((object) => object.key);
}

/** One sweep. Throws only when the database or the listing fails; the caller logs it. */
export async function sweepLeaderboardClips(deps: SweepDeps): Promise<SweepResult> {
  const result: SweepResult = {
    skipped: false,
    expiredRows: 0,
    orphanObjects: 0,
    deletedObjects: 0,
    failedDeletes: 0,
    ledgerRows: 0,
  };
  const config = deps.config();
  if (!config.bucket) return { ...result, skipped: true };
  const bucket = deps.bucket(config.bucket);
  const cutoffs = retentionCutoffs(deps.now());

  // 1. Rows past their time, then their objects.
  const expired = await deps.store.deleteExpiredClips(cutoffs);
  result.expiredRows = expired.length;
  const [deleted, failed] = await deleteKeys(
    bucket,
    expired.flatMap((id) => [videoKey(id), posterKey(id)])
  );
  result.deletedObjects += deleted;
  result.failedDeletes += failed;

  // 2. Objects with no row, one listing page at a time.
  let batch: ListedObject[] = [];
  const flush = async () => {
    const orphans = await orphansIn(deps.store, batch, cutoffs.orphanBefore);
    batch = [];
    result.orphanObjects += orphans.length;
    const [ok, bad] = await deleteKeys(bucket, orphans);
    result.deletedObjects += ok;
    result.failedDeletes += bad;
  };
  for await (const object of bucket.list(CLIP_PREFIX)) {
    batch.push(object);
    if (batch.length >= LIST_BATCH) await flush();
  }
  if (batch.length > 0) await flush();

  // 3. Old ledger rows.
  result.ledgerRows = await deps.store.pruneUploadLedger(cutoffs.ledgerBefore);
  return result;
}

/** Run one sweep and log the counts. A failure is logged; the next run tries again. */
export async function runLeaderboardClipSweep(deps: SweepDeps): Promise<void> {
  try {
    const result = await sweepLeaderboardClips(deps);
    if (result.skipped) return;
    console.log(
      `[leaderboard-clips] sweep: ${result.expiredRows} expired clip(s), ${result.orphanObjects} orphan object(s), ` +
        `${result.deletedObjects} object(s) deleted, ${result.failedDeletes} delete(s) failed, ` +
        `${result.ledgerRows} ledger row(s) pruned`
    );
  } catch (error) {
    console.error("[leaderboard-clips] sweep failed:", describeError(error));
  }
}

/** The first run waits two minutes, so the server can start first (one minute after #42's account delete). */
export const SWEEP_FIRST_RUN_DELAY_MS = 2 * 60 * 1000;
/** After the first run, the sweep runs once each day. */
export const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

let stopSchedule: (() => void) | null = null;

function unref(timer: unknown): void {
  (timer as { unref?: () => void }).unref?.();
}

/**
 * Start the daily sweep in this server process. instrumentation.ts calls
 * this function one time when the production server starts. A second call
 * does not start a second schedule. The timers do not keep the process
 * alive.
 *
 * @returns A function that stops the schedule.
 */
export function startLeaderboardClipSweepSchedule(run: () => Promise<void>): () => void {
  if (stopSchedule) return stopSchedule;

  const first = setTimeout(() => void run(), SWEEP_FIRST_RUN_DELAY_MS);
  const daily = setInterval(() => void run(), SWEEP_INTERVAL_MS);
  unref(first);
  unref(daily);

  stopSchedule = () => {
    clearTimeout(first);
    clearInterval(daily);
    stopSchedule = null;
  };
  return stopSchedule;
}
