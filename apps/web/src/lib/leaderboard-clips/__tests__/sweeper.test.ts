// @vitest-environment node
/**
 * The leaderboard clip sweeper (design/LEADERBOARD_CLIPS.html, section 8):
 * rows past their time and their objects, objects with no row (page by
 * page), the upload ledger, and never the legal hold.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { legalHoldKey, posterKey, videoKey } from "../bucket";
import { resolveLeaderboardClipsConfig, type LeaderboardClipsEnv } from "../config";
import { ORPHAN_GRACE_MS } from "../retention";
import {
  SWEEP_FIRST_RUN_DELAY_MS,
  SWEEP_INTERVAL_MS,
  runLeaderboardClipSweep,
  startLeaderboardClipSweepSchedule,
  sweepLeaderboardClips,
  type SweepDeps,
} from "../sweeper";
import { MemoryBucket, MemoryClipStore } from "./fakes";
import { clipRow, testClipId } from "./storeContract";

const ENV: LeaderboardClipsEnv = {
  LEADERBOARD_CLIPS_S3_ENDPOINT: "https://t3.storageapi.dev",
  LEADERBOARD_CLIPS_S3_BUCKET: "hanks-hits-clips-abc123",
  LEADERBOARD_CLIPS_S3_ACCESS_KEY_ID: "key-id",
  LEADERBOARD_CLIPS_S3_SECRET_ACCESS_KEY: "secret-value",
};

const NOW = new Date("2026-10-02T03:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

async function setup(env: LeaderboardClipsEnv = ENV) {
  const store = new MemoryClipStore();
  const bucket = new MemoryBucket();
  store.addUser("kid-a");
  store.addUser("kid-b");
  const a = store.ensureProfile("kid-a");
  const b = store.ensureProfile("kid-b");
  const deps: SweepDeps = { config: () => resolveLeaderboardClipsConfig(env), store, bucket: () => bucket, now: () => NOW };
  /** Put the objects of a clip, last changed at `when`. */
  const putObjects = async (id: string, when: Date) => {
    bucket.clock = () => when;
    await bucket.put(videoKey(id), new Uint8Array([1]), "video/mp4");
    await bucket.put(posterKey(id), new Uint8Array([2]), "image/jpeg");
  };
  return { store, bucket, deps, a, b, putObjects };
}

let logs: string[];
beforeEach(() => {
  logs = [];
  const capture = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("sweepLeaderboardClips", () => {
  it("deletes hidden clips after 30 days, public clips after 12 months, and their objects", async () => {
    const { store, bucket, deps, a, b, putObjects } = await setup();
    const keepPublic = clipRow(a, "asteroids", { createdAt: ago(300 * DAY) });
    const oldPublic = clipRow(b, "asteroids", { createdAt: ago(366 * DAY) });
    const keepHidden = clipRow(a, "breakout", { status: "hidden", hiddenAt: ago(29 * DAY), createdAt: ago(40 * DAY) });
    const oldHidden = clipRow(b, "breakout", { status: "hidden", hiddenAt: ago(31 * DAY), createdAt: ago(40 * DAY) });
    for (const row of [keepPublic, oldPublic, keepHidden, oldHidden]) {
      await store.replaceClip(row);
      await putObjects(row.id, row.createdAt);
    }
    const result = await sweepLeaderboardClips(deps);
    expect(result).toEqual({
      skipped: false,
      expiredRows: 2,
      orphanObjects: 0,
      deletedObjects: 4,
      failedDeletes: 0,
      ledgerRows: 0,
    });
    expect([...store.clips.keys()].sort()).toEqual([keepPublic.id, keepHidden.id].sort());
    expect([...bucket.objects.keys()].sort()).toEqual(
      [videoKey(keepPublic.id), posterKey(keepPublic.id), videoKey(keepHidden.id), posterKey(keepHidden.id)].sort()
    );
  });

  it("deletes objects with no row (an account delete, a failed delete) once they are past the grace time", async () => {
    const { store, bucket, deps, a, putObjects } = await setup();
    const live = clipRow(a, "asteroids");
    await store.replaceClip(live);
    await putObjects(live.id, ago(10 * DAY));
    const orphan = testClipId();
    await putObjects(orphan, ago(2 * ORPHAN_GRACE_MS));
    const running = testClipId(); // an upload that stored its objects and has not written its row yet
    await putObjects(running, ago(ORPHAN_GRACE_MS / 2));
    const result = await sweepLeaderboardClips(deps);
    expect(result.orphanObjects).toBe(2);
    expect(bucket.objects.has(videoKey(orphan))).toBe(false);
    expect(bucket.objects.has(posterKey(orphan))).toBe(false);
    expect(bucket.objects.has(videoKey(running))).toBe(true);
    expect(bucket.objects.has(videoKey(live.id))).toBe(true);
  });

  it("removes the objects of a deleted account (the cascade removed the rows)", async () => {
    const { store, bucket, deps, a, putObjects } = await setup();
    const row = clipRow(a, "asteroids");
    await store.replaceClip(row);
    await putObjects(row.id, ago(DAY));
    store.deleteUser("kid-a");
    await sweepLeaderboardClips(deps);
    expect(bucket.objects.size).toBe(0);
  });

  it("pages through the whole listing (more objects than one page)", async () => {
    const { bucket, deps, putObjects } = await setup();
    bucket.pageSize = 7;
    for (let i = 0; i < 40; i++) await putObjects(testClipId(), ago(DAY));
    const result = await sweepLeaderboardClips(deps);
    expect(result.orphanObjects).toBe(80);
    expect(bucket.objects.size).toBe(0);
    expect(bucket.listCalls).toBe(Math.ceil(80 / 7));
  });

  it("never touches the legal hold or another prefix; a stray object under lb/ goes", async () => {
    const { bucket, deps } = await setup();
    bucket.clock = () => ago(400 * DAY);
    const held = testClipId();
    for (const ext of ["mp4", "jpg", "json"] as const) await bucket.put(legalHoldKey(held, ext), new Uint8Array([1]), "x");
    await bucket.put("other/file.txt", new Uint8Array([1]), "text/plain");
    await bucket.put("lb/readme.txt", new Uint8Array([1]), "text/plain");
    const result = await sweepLeaderboardClips(deps);
    expect(bucket.objects.size).toBe(4);
    expect(bucket.objects.has("lb/readme.txt")).toBe(false);
    expect(result.orphanObjects).toBe(1);
  });

  it("prunes upload ledger rows older than 2 days", async () => {
    const { store, deps } = await setup();
    const old = await store.claimUploadSlot("kid-a", ago(3 * DAY));
    if (old.ok) await store.finishUploadSlot(old.slotId, ago(3 * DAY));
    await store.claimUploadSlot("kid-b", ago(DAY));
    expect((await sweepLeaderboardClips(deps)).ledgerRows).toBe(1);
    expect(store.uploads).toHaveLength(1);
  });

  it("runs while the kill switch is on (deleting old data is a duty), and skips with no bucket", async () => {
    const killed = await setup({ ...ENV, LEADERBOARD_CLIPS: "off" });
    await killed.putObjects(testClipId(), ago(DAY));
    expect((await sweepLeaderboardClips(killed.deps)).orphanObjects).toBe(2);
    const clone = await setup({});
    expect((await sweepLeaderboardClips(clone.deps)).skipped).toBe(true);
  });

  it("counts failed deletes, and the next run deletes them", async () => {
    const { bucket, deps, putObjects } = await setup();
    await putObjects(testClipId(), ago(DAY));
    bucket.failOn.add("delete");
    expect(await sweepLeaderboardClips(deps)).toMatchObject({ orphanObjects: 2, deletedObjects: 0, failedDeletes: 2 });
    bucket.failOn.delete("delete");
    expect(await sweepLeaderboardClips(deps)).toMatchObject({ orphanObjects: 2, deletedObjects: 2, failedDeletes: 0 });
    expect(bucket.objects.size).toBe(0);
  });
});

describe("runLeaderboardClipSweep", () => {
  it("logs counts only", async () => {
    const { store, deps, a, putObjects } = await setup();
    const row = clipRow(a, "asteroids", { createdAt: ago(400 * DAY) });
    await store.replaceClip(row);
    await putObjects(row.id, row.createdAt);
    await runLeaderboardClipSweep(deps);
    expect(logs).toEqual([
      "[leaderboard-clips] sweep: 1 expired clip(s), 0 orphan object(s), 2 object(s) deleted, 0 delete(s) failed, 0 ledger row(s) pruned",
    ]);
  });

  it("logs a failure without values and does not throw", async () => {
    const { bucket, deps } = await setup();
    bucket.failOn.add("list");
    await expect(runLeaderboardClipSweep(deps)).resolves.toBeUndefined();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("[leaderboard-clips] sweep failed:");
    expect(logs[0]).not.toContain("hanks-hits-clips");
  });

  it("says nothing when the feature is not set up", async () => {
    const { deps } = await setup({});
    await runLeaderboardClipSweep(deps);
    expect(logs).toEqual([]);
  });
});

describe("startLeaderboardClipSweepSchedule", () => {
  it("runs 2 minutes after the start, then once a day, and only one schedule", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => {});
    const stop = startLeaderboardClipSweepSchedule(run);
    expect(startLeaderboardClipSweepSchedule(run)).toBe(stop);
    await vi.advanceTimersByTimeAsync(SWEEP_FIRST_RUN_DELAY_MS - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS * 3);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
