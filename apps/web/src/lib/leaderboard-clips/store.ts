/**
 * The database side of leaderboard clips: the clip rows, the upload ledger
 * (the database rate limit) and the sweeper queries.
 *
 * ClipStore is an interface so that the route handlers can be tested with
 * an in-memory store; createDbClipStore() is the Postgres one (drizzle).
 * The integration test (leaderboard-clips.integration.test.ts) runs the
 * Postgres store on a real server.
 */
import {
  and,
  db as defaultDb,
  eq,
  desc,
  gt,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type Database,
} from "@hank-neil/db";
import { gamingProfiles, leaderboardClipUploads, leaderboardClips, leaderboardEntries } from "@hank-neil/db/schema";

import { generateHandle } from "@/lib/handle-generator";

import { getGameScoreType } from "@/lib/leaderboard-extractors";

import { LEADERBOARD_CLIP_LIMITS } from "./contract";
import type { RetentionCutoffs } from "./retention";

export type ClipRow = typeof leaderboardClips.$inferSelect;
export type NewClipRow = typeof leaderboardClips.$inferInsert & { createdAt: Date };

/** A clip and the facts about its owner that decide who can see it. */
export interface ClipWithOwner {
  clip: ClipRow;
  ownerUserId: string;
  showOnLeaderboards: boolean;
}

/** The generated profile receiving an upload and its existing privacy setting. */
export interface PublicationSlot {
  profileId: string;
  /** The player's clip for the game now (the upload replaces it), or null. */
  currentClipId: string | null;
  publicListing: boolean;
}

export type UploadSlot =
  | { ok: true; slotId: string }
  | { ok: false; code: "daily_limit" | "busy"; retryAfterSec: number };

/** An upload slot that stays open longer than this no longer counts as running (a crash left it). */
export const UPLOAD_STALE_MS = 10 * 60 * 1000;
/** The window of the daily limit. */
export const UPLOAD_WINDOW_MS = 24 * 60 * 60 * 1000;
/** How long a player waits after "busy" before trying again. */
export const BUSY_RETRY_SEC = 30;

export interface ClipStore {
  /** Create a generated public identity on first publish, without inventing a score. */
  publicationSlot(userId: string, appId: string): Promise<PublicationSlot>;
  publicRuns(appId: string, limit: number): Promise<{ handle: string; clip: ClipRow }[]>;
  ownClip(userId: string, appId: string): Promise<ClipRow | null>;
  /** Take an upload slot for the account: 10 in 24 hours, 1 at a time. */
  claimUploadSlot(userId: string, now: Date): Promise<UploadSlot>;
  /** The upload ended (stored, or rejected by a check): it counts toward the daily limit. */
  finishUploadSlot(slotId: string, now: Date): Promise<void>;
  /** The upload failed on our side (bucket or database): it does not count. */
  releaseUploadSlot(slotId: string): Promise<void>;
  /** Replace the player's clip for the game in one transaction. Returns the id of the old clip. */
  replaceClip(row: NewClipRow): Promise<{ replacedId: string | null }>;
  findClip(id: string): Promise<ClipWithOwner | null>;
  /** public -> hidden. "missing" when there is no such clip. */
  hideClip(id: string, now: Date): Promise<{ result: "hidden" | "already_hidden" | "missing"; appId: string | null }>;
  /** Delete the row. False when there was no row. */
  deleteClip(id: string): Promise<boolean>;
  /**
   * The public clips of these profiles for the game, of profiles that have
   * a row on the game's board (the caller passes only profiles that show).
   */
  publicClipsFor(appId: string, profileIds: readonly string[]): Promise<ClipRow[]>;
  /** The player's own clip for the game, public or hidden. */
  clipOf(profileId: string, appId: string): Promise<ClipRow | null>;
  /** Delete the rows past their retention time. Returns their ids. */
  deleteExpiredClips(cutoffs: RetentionCutoffs): Promise<string[]>;
  /** Which of these ids have a row. */
  existingClipIds(ids: readonly string[]): Promise<Set<string>>;
  /** Delete old upload ledger rows. Returns how many. */
  pruneUploadLedger(before: Date): Promise<number>;
}

/** The Postgres store. */
export function createDbClipStore(database: Database = defaultDb): ClipStore {
  return {
    async publicationSlot(userId, appId) {
      // ON CONFLICT handles both same-user creation races and handle collisions.
      // Each statement is autocommitted, so a conflict never aborts a retry.
      for (let attempt = 0; attempt < 8; attempt++) {
        const [profile] = await database.select({ id: gamingProfiles.id, publicListing: gamingProfiles.showOnLeaderboards }).from(gamingProfiles)
          .where(eq(gamingProfiles.userId, userId)).limit(1);
        if (profile) {
          const [clip] = await database.select({ id: leaderboardClips.id }).from(leaderboardClips)
            .where(and(eq(leaderboardClips.gamingProfileId, profile.id), eq(leaderboardClips.appId, appId))).limit(1);
          return { profileId: profile.id, currentClipId: clip?.id ?? null, publicListing: profile.publicListing };
        }
        const [inserted] = await database.insert(gamingProfiles).values({ userId, handle: generateHandle() }).onConflictDoNothing().returning({ id: gamingProfiles.id });
        if (inserted) return { profileId: inserted.id, currentClipId: null, publicListing: true };
      }
      throw new Error("Could not allocate a gaming profile");
    },

    async publicRuns(appId, limit) {
      return database.select({ handle: gamingProfiles.handle, clip: leaderboardClips })
        .from(leaderboardClips)
        .innerJoin(gamingProfiles, eq(leaderboardClips.gamingProfileId, gamingProfiles.id))
        .where(and(eq(leaderboardClips.appId, appId), eq(leaderboardClips.status, "public"), eq(gamingProfiles.showOnLeaderboards, true)))
        .orderBy(desc(leaderboardClips.createdAt), desc(leaderboardClips.id))
        .limit(Math.min(50, Math.max(1, limit)));
    },

    async ownClip(userId, appId) {
      const [row] = await database.select({ clip: leaderboardClips }).from(leaderboardClips)
        .innerJoin(gamingProfiles, eq(leaderboardClips.gamingProfileId, gamingProfiles.id))
        .where(and(eq(gamingProfiles.userId, userId), eq(leaderboardClips.appId, appId))).limit(1);
      return row?.clip ?? null;
    },

    async claimUploadSlot(userId, now) {
      return database.transaction(async (tx) => {
        // One claim at a time for each account, so two requests cannot both
        // see a free slot. The lock ends with the transaction.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`leaderboard-clip-upload:${userId}`}, 0))`);
        const windowStart = new Date(now.getTime() - UPLOAD_WINDOW_MS);
        const rows = await tx
          .select({ startedAt: leaderboardClipUploads.startedAt, finishedAt: leaderboardClipUploads.finishedAt })
          .from(leaderboardClipUploads)
          .where(and(eq(leaderboardClipUploads.userId, userId), gt(leaderboardClipUploads.startedAt, windowStart)));
        const staleBefore = now.getTime() - UPLOAD_STALE_MS;
        const running = rows.filter((row) => !row.finishedAt && row.startedAt.getTime() > staleBefore);
        if (running.length >= LEADERBOARD_CLIP_LIMITS.uploadsAtOnce) {
          return { ok: false as const, code: "busy" as const, retryAfterSec: BUSY_RETRY_SEC };
        }
        if (rows.length >= LEADERBOARD_CLIP_LIMITS.uploadsPerDay) {
          const oldest = Math.min(...rows.map((row) => row.startedAt.getTime()));
          const retryAfterSec = Math.max(1, Math.ceil((oldest + UPLOAD_WINDOW_MS - now.getTime()) / 1000));
          return { ok: false as const, code: "daily_limit" as const, retryAfterSec };
        }
        const [slot] = await tx
          .insert(leaderboardClipUploads)
          .values({ userId, startedAt: now })
          .returning({ id: leaderboardClipUploads.id });
        return { ok: true as const, slotId: slot.id };
      });
    },

    async finishUploadSlot(slotId, now) {
      await database
        .update(leaderboardClipUploads)
        .set({ finishedAt: now })
        .where(and(eq(leaderboardClipUploads.id, slotId), isNull(leaderboardClipUploads.finishedAt)));
    },

    async releaseUploadSlot(slotId) {
      await database.delete(leaderboardClipUploads).where(eq(leaderboardClipUploads.id, slotId));
    },

    async replaceClip(row) {
      return database.transaction(async (tx) => {
        const [old] = await tx
          .select({ id: leaderboardClips.id })
          .from(leaderboardClips)
          .where(and(eq(leaderboardClips.gamingProfileId, row.gamingProfileId), eq(leaderboardClips.appId, row.appId)))
          .for("update");
        if (old) await tx.delete(leaderboardClips).where(eq(leaderboardClips.id, old.id));
        await tx.insert(leaderboardClips).values(row);
        return { replacedId: old?.id ?? null };
      });
    },

    async findClip(id) {
      const [found] = await database
        .select({
          clip: leaderboardClips,
          ownerUserId: gamingProfiles.userId,
          showOnLeaderboards: gamingProfiles.showOnLeaderboards,
        })
        .from(leaderboardClips)
        .innerJoin(gamingProfiles, eq(leaderboardClips.gamingProfileId, gamingProfiles.id))
        .where(eq(leaderboardClips.id, id))
        .limit(1);
      return found ?? null;
    },

    async hideClip(id, now) {
      const updated = await database
        .update(leaderboardClips)
        .set({ status: "hidden", hiddenAt: now })
        .where(and(eq(leaderboardClips.id, id), eq(leaderboardClips.status, "public")))
        .returning({ appId: leaderboardClips.appId });
      if (updated.length > 0) return { result: "hidden", appId: updated[0].appId };
      const [row] = await database
        .select({ appId: leaderboardClips.appId })
        .from(leaderboardClips)
        .where(eq(leaderboardClips.id, id))
        .limit(1);
      return row ? { result: "already_hidden", appId: row.appId } : { result: "missing", appId: null };
    },

    async deleteClip(id) {
      const deleted = await database
        .delete(leaderboardClips)
        .where(eq(leaderboardClips.id, id))
        .returning({ id: leaderboardClips.id });
      return deleted.length > 0;
    },

    async publicClipsFor(appId, profileIds) {
      if (profileIds.length === 0) return [];
      return database
        .select()
        .from(leaderboardClips)
        .where(
          and(
            eq(leaderboardClips.appId, appId),
            eq(leaderboardClips.status, "public"),
            inArray(leaderboardClips.gamingProfileId, [...profileIds]),
            sql`exists (select 1 from ${leaderboardEntries} where ${leaderboardEntries.gamingProfileId} = ${leaderboardClips.gamingProfileId} and ${leaderboardEntries.appId} = ${appId} and ${leaderboardEntries.scoreType} = ${getGameScoreType(appId)})`
          )
        );
    },

    async clipOf(profileId, appId) {
      const [row] = await database
        .select()
        .from(leaderboardClips)
        .where(and(eq(leaderboardClips.gamingProfileId, profileId), eq(leaderboardClips.appId, appId)))
        .limit(1);
      return row ?? null;
    },

    async deleteExpiredClips(cutoffs) {
      const deleted = await database
        .delete(leaderboardClips)
        .where(
          or(
            and(eq(leaderboardClips.status, "hidden"), lt(leaderboardClips.hiddenAt, cutoffs.hiddenBefore)),
            lt(leaderboardClips.createdAt, cutoffs.createdBefore)
          )
        )
        .returning({ id: leaderboardClips.id });
      return deleted.map((row) => row.id);
    },

    async existingClipIds(ids) {
      if (ids.length === 0) return new Set();
      const rows = await database
        .select({ id: leaderboardClips.id })
        .from(leaderboardClips)
        .where(inArray(leaderboardClips.id, [...ids]));
      return new Set(rows.map((row) => row.id));
    },

    async pruneUploadLedger(before) {
      const deleted = await database
        .delete(leaderboardClipUploads)
        .where(lt(leaderboardClipUploads.startedAt, before))
        .returning({ id: leaderboardClipUploads.id });
      return deleted.length;
    },
  };
}
