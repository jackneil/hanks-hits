// @vitest-environment node
/**
 * The clip fields of GET /api/leaderboards/[appId]: entry.clip for a public
 * clip of a shown profile on the game's board, and the player's own clip
 * (myEntry.clipStatus / myEntry.clip, and myClip). A clip lookup never
 * breaks the leaderboard. (leaderboard-clips.integration.test.ts runs the
 * whole route on a real Postgres.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveLeaderboardClipsConfig, type LeaderboardClipsEnv } from "../config";
import { clipsForEntries, myClipFields, type LeaderboardClipDeps } from "../leaderboard";
import { MemoryClipStore } from "./fakes";
import { clipRow } from "./storeContract";

const ENV: LeaderboardClipsEnv = {
  LEADERBOARD_CLIPS_S3_ENDPOINT: "https://t3.storageapi.dev",
  LEADERBOARD_CLIPS_S3_BUCKET: "hanks-hits-clips-abc123",
  LEADERBOARD_CLIPS_S3_ACCESS_KEY_ID: "key-id",
  LEADERBOARD_CLIPS_S3_SECRET_ACCESS_KEY: "secret-value",
};

async function setup(env: LeaderboardClipsEnv = ENV) {
  const store = new MemoryClipStore();
  store.addUser("kid-a");
  store.addUser("kid-b");
  // Both players are on the asteroids board (the progress route wrote their rows).
  const a = store.addBoardEntry("kid-a", "asteroids");
  const b = store.addBoardEntry("kid-b", "asteroids");
  const deps: LeaderboardClipDeps = { config: () => resolveLeaderboardClipsConfig(env), store };
  return { store, deps, a, b };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("clipsForEntries", () => {
  it("gives each listed profile its public clip of the game, and nothing else", async () => {
    const { store, deps, a, b } = await setup();
    const aClip = clipRow(a, "asteroids", { runScore: 1790 });
    const bHidden = clipRow(b, "asteroids", { status: "hidden", hiddenAt: new Date() });
    await store.replaceClip(aClip);
    await store.replaceClip(bHidden);
    await store.replaceClip(clipRow(b, "breakout"));
    const clips = await clipsForEntries(deps, "asteroids", [a, b]);
    expect([...clips.byProfile.entries()]).toEqual([
      [a, { id: aClip.id, runScore: 1790, durationMs: 28_564, width: 1280, height: 720 }],
    ]);
    // The summary has no owner, no size in bytes and no audio flag.
    expect(Object.keys(clips.byProfile.get(a)!).sort()).toEqual(["durationMs", "height", "id", "runScore", "width"]);
  });

  it("is empty when clips are off, for a game with no clips, and for no profiles", async () => {
    const off = await setup({ ...ENV, LEADERBOARD_CLIPS: "off" });
    await off.store.replaceClip(clipRow(off.a, "asteroids"));
    expect((await clipsForEntries(off.deps, "asteroids", [off.a])).byProfile.size).toBe(0);
    const clone = await setup({});
    await clone.store.replaceClip(clipRow(clone.a, "asteroids"));
    expect((await clipsForEntries(clone.deps, "asteroids", [clone.a])).byProfile.size).toBe(0);
    const { store, deps, a } = await setup();
    await store.replaceClip(clipRow(a, "snake"));
    expect((await clipsForEntries(deps, "snake", [a])).byProfile.size).toBe(0);
    expect((await clipsForEntries(deps, "asteroids", [])).byProfile.size).toBe(0);
  });

  it("gives no clip to a profile that has no row on the game's board", async () => {
    const { store, deps, a } = await setup();
    await store.replaceClip(clipRow(a, "asteroids"));
    store.removeBoardEntry("kid-a", "asteroids");
    expect((await clipsForEntries(deps, "asteroids", [a])).byProfile.size).toBe(0);
  });

  it("never breaks the board: a failed lookup (for example before the migration) gives no clips", async () => {
    const { store, deps, a } = await setup();
    store.publicClipsFor = async () => {
      throw Object.assign(new Error("Failed query"), { cause: { code: "42P01" } });
    };
    expect((await clipsForEntries(deps, "asteroids", [a])).byProfile.size).toBe(0);
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});

describe("myClipFields", () => {
  it("says none, public or hidden, with the player's own clip", async () => {
    const { store, deps, a } = await setup();
    expect(await myClipFields(deps, "asteroids", a)).toEqual({ clipStatus: "none", clip: null });
    const row = clipRow(a, "asteroids");
    await store.replaceClip(row);
    expect(await myClipFields(deps, "asteroids", a)).toEqual({
      clipStatus: "public",
      clip: {
        id: row.id,
        runScore: 1790,
        durationMs: 28_564,
        width: 1280,
        height: 720,
        status: "public",
        hasAudio: true,
        createdAt: row.createdAt.toISOString(),
        hiddenAt: null,
      },
    });
    const hiddenAt = new Date("2026-10-02T09:00:00.000Z");
    await store.hideClip(row.id, hiddenAt);
    expect(await myClipFields(deps, "asteroids", a)).toMatchObject({
      clipStatus: "hidden",
      clip: { status: "hidden", hiddenAt: hiddenAt.toISOString() },
    });
  });

  it("still gives the owner their own clip while the kill switch is on (so they can take it off: DELETE works then)", async () => {
    const off = await setup({ ...ENV, LEADERBOARD_CLIPS: "off" });
    const row = clipRow(off.a, "asteroids");
    await off.store.replaceClip(row);
    expect(await myClipFields(off.deps, "asteroids", off.a)).toMatchObject({ clipStatus: "public", clip: { id: row.id } });
    // The public list stays empty while the switch is on.
    expect((await clipsForEntries(off.deps, "asteroids", [off.a])).byProfile.size).toBe(0);
  });

  it("says none when the bucket is not set up (or not valid), for a game with no clips, and when the lookup fails", async () => {
    const clone = await setup({});
    await clone.store.replaceClip(clipRow(clone.a, "asteroids"));
    expect(await myClipFields(clone.deps, "asteroids", clone.a)).toEqual({ clipStatus: "none", clip: null });
    const incomplete = await setup({ ...ENV, LEADERBOARD_CLIPS_S3_BUCKET: "" });
    await incomplete.store.replaceClip(clipRow(incomplete.a, "asteroids"));
    expect(await myClipFields(incomplete.deps, "asteroids", incomplete.a)).toEqual({ clipStatus: "none", clip: null });
    const { store, deps, a } = await setup();
    await store.replaceClip(clipRow(a, "snake"));
    expect(await myClipFields(deps, "snake", a)).toEqual({ clipStatus: "none", clip: null });
    store.clipOf = async () => {
      throw new Error("down");
    };
    expect(await myClipFields(deps, "asteroids", a)).toEqual({ clipStatus: "none", clip: null });
  });
});
