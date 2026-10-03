/**
 * One set of checks for a ClipStore. store.test.ts runs it on the in-memory
 * store (every run); leaderboard-clips.integration.test.ts runs it on the
 * Postgres store (when a local Postgres is up). So the stand-in that the
 * handler tests use cannot drift from Postgres unseen.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { LEADERBOARD_CLIP_LIMITS } from "../contract";
import { retentionCutoffs } from "../retention";
import { UPLOAD_STALE_MS, UPLOAD_WINDOW_MS, type ClipStore, type NewClipRow } from "../store";

export interface StoreHarness {
  store: ClipStore;
  addUser(userId: string): Promise<void>;
  /**
   * A row on the game's board for the account, as the progress route writes
   * it (the gaming profile is made on first use). The score type is the
   * game's own unless given. Returns the gaming profile id.
   */
  addBoardEntry(userId: string, appId: string, scoreType?: string): Promise<string>;
  /** Delete the account's rows of the game's board. */
  removeBoardEntry(userId: string, appId: string): Promise<void>;
  setShowOnLeaderboards(userId: string, show: boolean): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  uploadCount(userId: string): Promise<number>;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

let counter = 0;
/** A clip id: 24 URL-safe characters. */
export function testClipId(): string {
  counter++;
  return `T${String(counter).padStart(6, "0")}${"x".repeat(17)}`.slice(0, 24);
}

export function clipRow(gamingProfileId: string, appId: string, extra: Partial<NewClipRow> = {}): NewClipRow {
  return {
    id: testClipId(),
    gamingProfileId,
    appId,
    runScore: 1790,
    durationMs: 28_564,
    width: 1280,
    height: 720,
    bytes: 4_076_803,
    hasAudio: true,
    status: "public",
    createdAt: new Date("2026-10-01T12:00:00.000Z"),
    hiddenAt: null,
    ...extra,
  };
}

export function runStoreContract(name: string, setup: () => Promise<StoreHarness>): void {
  describe(`ClipStore contract: ${name}`, () => {
    let h: StoreHarness;
    const now = new Date("2026-10-02T10:00:00.000Z");
    const at = (ms: number) => new Date(now.getTime() + ms);

    beforeEach(async () => {
      h = await setup();
      await h.addUser("kid-a");
      await h.addUser("kid-b");
    });

    it("allows 10 uploads in 24 hours, then says daily_limit with the wait", async () => {
      for (let i = 0; i < LEADERBOARD_CLIP_LIMITS.uploadsPerDay; i++) {
        const slot = await h.store.claimUploadSlot("kid-a", at(i * MINUTE));
        expect(slot.ok).toBe(true);
        if (slot.ok) await h.store.finishUploadSlot(slot.slotId, at(i * MINUTE + 1000));
      }
      const refused = await h.store.claimUploadSlot("kid-a", at(20 * MINUTE));
      expect(refused).toEqual({ ok: false, code: "daily_limit", retryAfterSec: (UPLOAD_WINDOW_MS - 20 * MINUTE) / 1000 });
      // Another account is not limited by kid-a.
      expect((await h.store.claimUploadSlot("kid-b", at(20 * MINUTE))).ok).toBe(true);
      // 24 hours after the first upload, one slot is free again.
      expect((await h.store.claimUploadSlot("kid-a", at(UPLOAD_WINDOW_MS + 1))).ok).toBe(true);
    });

    it("allows 1 upload at a time; a crashed one stops blocking after UPLOAD_STALE_MS", async () => {
      const first = await h.store.claimUploadSlot("kid-a", now);
      expect(first.ok).toBe(true);
      expect(await h.store.claimUploadSlot("kid-a", at(MINUTE))).toEqual({ ok: false, code: "busy", retryAfterSec: 30 });
      expect((await h.store.claimUploadSlot("kid-a", at(UPLOAD_STALE_MS + 1))).ok).toBe(true);
    });

    it("frees the slot at once when the upload finishes", async () => {
      const first = await h.store.claimUploadSlot("kid-a", now);
      if (!first.ok) throw new Error("no slot");
      await h.store.finishUploadSlot(first.slotId, at(1000));
      expect((await h.store.claimUploadSlot("kid-a", at(2000))).ok).toBe(true);
    });

    it("does not count a released upload (it failed on our side)", async () => {
      for (let i = 0; i < 15; i++) {
        const slot = await h.store.claimUploadSlot("kid-a", at(i * 1000));
        expect(slot.ok, `upload ${i}`).toBe(true);
        if (slot.ok) await h.store.releaseUploadSlot(slot.slotId);
      }
      expect(await h.uploadCount("kid-a")).toBe(0);
    });

    it("throws a foreign key error (23503) for an account that is gone", async () => {
      const error = await h.store.claimUploadSlot("ghost", now).catch((e: unknown) => e);
      let code: unknown;
      for (let e: unknown = error; e && typeof e === "object" && code === undefined; e = (e as { cause?: unknown }).cause) {
        code = (e as { code?: unknown }).code;
      }
      expect(code).toBe("23503");
    });

    it("finds the board slot only for a player with a row on the game's board, with the current clip", async () => {
      // No profile at all.
      expect(await h.store.boardSlot("kid-a", "asteroids")).toBeNull();
      // A profile, but a row on another game only, or in another score type.
      await h.addBoardEntry("kid-b", "breakout");
      await h.addBoardEntry("kid-b", "asteroids", "wins");
      expect(await h.store.boardSlot("kid-b", "asteroids")).toBeNull();
      // On the board: the profile, and no clip yet.
      const a = await h.addBoardEntry("kid-a", "asteroids");
      expect(await h.store.boardSlot("kid-a", "asteroids")).toEqual({ profileId: a, currentClipId: null });
      // With a clip: its id (the clip of another game is not this game's).
      const row = clipRow(a, "asteroids");
      await h.store.replaceClip(row);
      await h.store.replaceClip(clipRow(a, "breakout"));
      expect(await h.store.boardSlot("kid-a", "asteroids")).toEqual({ profileId: a, currentClipId: row.id });
      // The row is gone: no slot.
      await h.removeBoardEntry("kid-a", "asteroids");
      expect(await h.store.boardSlot("kid-a", "asteroids")).toBeNull();
    });

    it("keeps one clip for each player and game; the newest replaces the old", async () => {
      const profile = await h.addBoardEntry("kid-a", "asteroids");
      const one = clipRow(profile, "asteroids");
      const two = clipRow(profile, "asteroids", { runScore: 12 });
      const other = clipRow(profile, "breakout");
      expect(await h.store.replaceClip(one)).toEqual({ replacedId: null });
      expect(await h.store.replaceClip(other)).toEqual({ replacedId: null });
      expect(await h.store.replaceClip(two)).toEqual({ replacedId: one.id });
      expect(await h.store.findClip(one.id)).toBeNull();
      expect((await h.store.clipOf(profile, "asteroids"))?.id).toBe(two.id);
      expect((await h.store.clipOf(profile, "breakout"))?.id).toBe(other.id);
    });

    it("finds a clip with its owner, the leaderboard setting and the board row", async () => {
      const profile = await h.addBoardEntry("kid-a", "asteroids");
      const row = clipRow(profile, "asteroids");
      await h.store.replaceClip(row);
      const found = await h.store.findClip(row.id);
      expect(found).toMatchObject({ ownerUserId: "kid-a", showOnLeaderboards: true, onBoard: true });
      expect(found!.clip).toMatchObject({ id: row.id, runScore: 1790, status: "public", hiddenAt: null });
      expect(found!.clip.createdAt.toISOString()).toBe(row.createdAt.toISOString());
      await h.setShowOnLeaderboards("kid-a", false);
      expect((await h.store.findClip(row.id))?.showOnLeaderboards).toBe(false);
      expect(await h.store.findClip(testClipId())).toBeNull();
      // A row in another score type is not the game's board.
      await h.removeBoardEntry("kid-a", "asteroids");
      await h.addBoardEntry("kid-a", "asteroids", "wins");
      expect((await h.store.findClip(row.id))?.onBoard).toBe(false);
    });

    it("hides a clip at a report, once; a second report says already hidden", async () => {
      const profile = await h.addBoardEntry("kid-a", "asteroids");
      const row = clipRow(profile, "asteroids");
      await h.store.replaceClip(row);
      expect(await h.store.hideClip(row.id, now)).toEqual({ result: "hidden", appId: "asteroids" });
      expect(await h.store.hideClip(row.id, at(MINUTE))).toEqual({ result: "already_hidden", appId: "asteroids" });
      expect(await h.store.hideClip(testClipId(), now)).toEqual({ result: "missing", appId: null });
      const found = await h.store.findClip(row.id);
      expect(found!.clip.status).toBe("hidden");
      expect(found!.clip.hiddenAt?.toISOString()).toBe(now.toISOString());
    });

    it("deletes a clip row", async () => {
      const profile = await h.addBoardEntry("kid-a", "asteroids");
      const row = clipRow(profile, "asteroids");
      await h.store.replaceClip(row);
      expect(await h.store.deleteClip(row.id)).toBe(true);
      expect(await h.store.deleteClip(row.id)).toBe(false);
    });

    it("lists only the public clips of the given profiles for the game, of profiles on its board", async () => {
      const a = await h.addBoardEntry("kid-a", "asteroids");
      const b = await h.addBoardEntry("kid-b", "asteroids");
      await h.addBoardEntry("kid-a", "breakout");
      const aClip = clipRow(a, "asteroids");
      const bClip = clipRow(b, "asteroids");
      await h.store.replaceClip(aClip);
      await h.store.replaceClip(bClip);
      await h.store.replaceClip(clipRow(a, "breakout"));
      await h.store.hideClip(bClip.id, now);
      const listed = await h.store.publicClipsFor("asteroids", [a, b]);
      expect(listed.map((row) => row.id)).toEqual([aClip.id]);
      expect(await h.store.publicClipsFor("asteroids", [])).toEqual([]);
      expect(await h.store.publicClipsFor("asteroids", [b])).toEqual([]);
      // A public clip whose owner has no row on the game's board is not listed.
      await h.removeBoardEntry("kid-a", "asteroids");
      expect(await h.store.publicClipsFor("asteroids", [a, b])).toEqual([]);
    });

    it("deletes rows past their time: hidden 30 days, uploaded 12 months ago", async () => {
      const a = await h.addBoardEntry("kid-a", "asteroids");
      const b = await h.addBoardEntry("kid-b", "asteroids");
      const oldHidden = clipRow(a, "asteroids", { status: "hidden", hiddenAt: new Date(now.getTime() - 31 * DAY), createdAt: new Date(now.getTime() - 40 * DAY) });
      const newHidden = clipRow(a, "breakout", { status: "hidden", hiddenAt: new Date(now.getTime() - 29 * DAY), createdAt: new Date(now.getTime() - 40 * DAY) });
      const oldPublic = clipRow(b, "asteroids", { createdAt: new Date("2025-10-01T09:59:59.000Z") });
      const newPublic = clipRow(b, "breakout", { createdAt: new Date("2025-10-02T10:00:01.000Z") });
      for (const row of [oldHidden, newHidden, oldPublic, newPublic]) await h.store.replaceClip(row);
      const expired = await h.store.deleteExpiredClips(retentionCutoffs(now));
      expect([...expired].sort()).toEqual([oldHidden.id, oldPublic.id].sort());
      expect(await h.store.existingClipIds([oldHidden.id, newHidden.id, oldPublic.id, newPublic.id])).toEqual(
        new Set([newHidden.id, newPublic.id])
      );
      expect(await h.store.existingClipIds([])).toEqual(new Set());
    });

    it("prunes old ledger rows", async () => {
      const old = await h.store.claimUploadSlot("kid-a", new Date(now.getTime() - 3 * DAY));
      if (old.ok) await h.store.finishUploadSlot(old.slotId, new Date(now.getTime() - 3 * DAY));
      await h.store.claimUploadSlot("kid-b", now);
      expect(await h.store.pruneUploadLedger(retentionCutoffs(now).ledgerBefore)).toBe(1);
      expect(await h.uploadCount("kid-a")).toBe(0);
      expect(await h.uploadCount("kid-b")).toBe(1);
    });

    it("removes the clip rows and ledger rows of a deleted account (cascade)", async () => {
      const a = await h.addBoardEntry("kid-a", "asteroids");
      const row = clipRow(a, "asteroids");
      await h.store.replaceClip(row);
      await h.store.claimUploadSlot("kid-a", now);
      await h.deleteUser("kid-a");
      expect(await h.store.findClip(row.id)).toBeNull();
      expect(await h.uploadCount("kid-a")).toBe(0);
    });
  });
}
