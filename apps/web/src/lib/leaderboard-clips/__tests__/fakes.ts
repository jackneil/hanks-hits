/**
 * In-memory stand-ins for the handler and sweeper tests:
 * - MemoryClipStore follows the same rules as the Postgres store
 *   (store-contract.ts runs one set of checks on both);
 * - MemoryBucket keeps objects in a Map, can fail on purpose, and lists
 *   in pages like S3.
 */
import { getGameScoreType } from "@/lib/leaderboard-extractors";

import { BucketError, type ClipBucket, type ListedObject } from "../bucket";
import { LEADERBOARD_CLIP_LIMITS } from "../contract";
import type { RetentionCutoffs } from "../retention";
import {
  BUSY_RETRY_SEC,
  UPLOAD_STALE_MS,
  UPLOAD_WINDOW_MS,
  type ClipRow,
  type ClipStore,
  type BoardSlot,
  type ClipWithOwner,
  type NewClipRow,
  type UploadSlot,
} from "../store";

interface Profile {
  id: string;
  userId: string;
  showOnLeaderboards: boolean;
}

interface Upload {
  id: string;
  userId: string;
  startedAt: Date;
  finishedAt: Date | null;
}

/** A driver-like error, as drizzle wraps it. */
function pgError(code: string): Error {
  const cause = Object.assign(new Error("driver error"), { code });
  return Object.assign(new Error("Failed query"), { cause });
}

export class MemoryClipStore implements ClipStore {
  users = new Set<string>();
  profiles = new Map<string, Profile>();
  clips = new Map<string, ClipRow>();
  uploads: Upload[] = [];
  /** Board rows: "profileId|appId|scoreType" (the progress route writes them). */
  boardEntries = new Set<string>();
  private nextId = 1;
  /** Make the next replaceClip throw before it writes (a database failure). */
  failReplace = false;
  /** Make the next replaceClip write the row, then throw (the answer to COMMIT was lost). */
  failReplaceAfterCommit = false;
  /** Make the next existingClipIds throw (the database is still down). */
  failExistingCheck = false;

  addUser(userId: string): void {
    this.users.add(userId);
  }

  profileOf(userId: string): Profile | undefined {
    return [...this.profiles.values()].find((profile) => profile.userId === userId);
  }

  /** The account's gaming profile, made on first use (as the progress route makes it). */
  ensureProfile(userId: string): string {
    if (!this.users.has(userId)) throw pgError("23503");
    let profile = this.profileOf(userId);
    if (!profile) {
      profile = { id: `profile-${this.nextId++}`, userId, showOnLeaderboards: true };
      this.profiles.set(profile.id, profile);
    }
    return profile.id;
  }

  /** A row on the game's board (as the progress route writes it), with the profile. Returns the profile id. */
  addBoardEntry(userId: string, appId: string, scoreType: string = getGameScoreType(appId)): string {
    const profileId = this.ensureProfile(userId);
    this.boardEntries.add(`${profileId}|${appId}|${scoreType}`);
    return profileId;
  }

  /** Remove the player's rows of the game's board (every score type). */
  removeBoardEntry(userId: string, appId: string): void {
    const profile = this.profileOf(userId);
    if (!profile) return;
    for (const key of this.boardEntries) if (key.startsWith(`${profile.id}|${appId}|`)) this.boardEntries.delete(key);
  }

  private onBoard(profileId: string, appId: string): boolean {
    return this.boardEntries.has(`${profileId}|${appId}|${getGameScoreType(appId)}`);
  }

  /** Delete an account: the profile, its clips, its board rows and its ledger rows go by cascade. */
  deleteUser(userId: string): void {
    this.users.delete(userId);
    const profile = this.profileOf(userId);
    if (profile) {
      this.profiles.delete(profile.id);
      for (const [id, clip] of this.clips) if (clip.gamingProfileId === profile.id) this.clips.delete(id);
      for (const key of this.boardEntries) if (key.startsWith(`${profile.id}|`)) this.boardEntries.delete(key);
    }
    this.uploads = this.uploads.filter((upload) => upload.userId !== userId);
  }

  async claimUploadSlot(userId: string, now: Date): Promise<UploadSlot> {
    if (!this.users.has(userId)) throw pgError("23503");
    const rows = this.uploads.filter(
      (upload) => upload.userId === userId && upload.startedAt.getTime() > now.getTime() - UPLOAD_WINDOW_MS
    );
    const running = rows.filter(
      (upload) => !upload.finishedAt && upload.startedAt.getTime() > now.getTime() - UPLOAD_STALE_MS
    );
    if (running.length >= LEADERBOARD_CLIP_LIMITS.uploadsAtOnce) return { ok: false, code: "busy", retryAfterSec: BUSY_RETRY_SEC };
    if (rows.length >= LEADERBOARD_CLIP_LIMITS.uploadsPerDay) {
      const oldest = Math.min(...rows.map((row) => row.startedAt.getTime()));
      return {
        ok: false,
        code: "daily_limit",
        retryAfterSec: Math.max(1, Math.ceil((oldest + UPLOAD_WINDOW_MS - now.getTime()) / 1000)),
      };
    }
    const slot = { id: `slot-${this.nextId++}`, userId, startedAt: now, finishedAt: null };
    this.uploads.push(slot);
    return { ok: true, slotId: slot.id };
  }

  async finishUploadSlot(slotId: string, now: Date): Promise<void> {
    const slot = this.uploads.find((upload) => upload.id === slotId);
    if (slot && !slot.finishedAt) slot.finishedAt = now;
  }

  async releaseUploadSlot(slotId: string): Promise<void> {
    this.uploads = this.uploads.filter((upload) => upload.id !== slotId);
  }

  async boardSlot(userId: string, appId: string): Promise<BoardSlot | null> {
    const profile = this.profileOf(userId);
    if (!profile || !this.onBoard(profile.id, appId)) return null;
    const current = [...this.clips.values()].find((clip) => clip.gamingProfileId === profile.id && clip.appId === appId);
    return { profileId: profile.id, currentClipId: current?.id ?? null };
  }

  async replaceClip(row: NewClipRow): Promise<{ replacedId: string | null }> {
    if (this.failReplace) {
      this.failReplace = false;
      throw pgError("57P01");
    }
    if (this.failReplaceAfterCommit) {
      this.failReplaceAfterCommit = false;
      await this.replaceClip(row);
      throw new Error("Connection terminated unexpectedly");
    }
    const old = [...this.clips.values()].find(
      (clip) => clip.gamingProfileId === row.gamingProfileId && clip.appId === row.appId
    );
    if (old) this.clips.delete(old.id);
    this.clips.set(row.id, {
      id: row.id,
      gamingProfileId: row.gamingProfileId,
      appId: row.appId,
      runScore: row.runScore,
      durationMs: row.durationMs,
      width: row.width,
      height: row.height,
      bytes: row.bytes,
      hasAudio: row.hasAudio,
      status: row.status ?? "public",
      createdAt: row.createdAt,
      hiddenAt: row.hiddenAt ?? null,
    });
    return { replacedId: old?.id ?? null };
  }

  async findClip(id: string): Promise<ClipWithOwner | null> {
    const clip = this.clips.get(id);
    if (!clip) return null;
    const profile = this.profiles.get(clip.gamingProfileId)!;
    return {
      clip: { ...clip },
      ownerUserId: profile.userId,
      showOnLeaderboards: profile.showOnLeaderboards,
      onBoard: this.onBoard(clip.gamingProfileId, clip.appId),
    };
  }

  async hideClip(id: string, now: Date) {
    const clip = this.clips.get(id);
    if (!clip) return { result: "missing" as const, appId: null };
    if (clip.status === "hidden") return { result: "already_hidden" as const, appId: clip.appId };
    clip.status = "hidden";
    clip.hiddenAt = now;
    return { result: "hidden" as const, appId: clip.appId };
  }

  async deleteClip(id: string): Promise<boolean> {
    return this.clips.delete(id);
  }

  async publicClipsFor(appId: string, profileIds: readonly string[]): Promise<ClipRow[]> {
    return [...this.clips.values()].filter(
      (clip) =>
        clip.appId === appId &&
        clip.status === "public" &&
        profileIds.includes(clip.gamingProfileId) &&
        this.onBoard(clip.gamingProfileId, appId)
    );
  }

  async clipOf(profileId: string, appId: string): Promise<ClipRow | null> {
    return [...this.clips.values()].find((clip) => clip.gamingProfileId === profileId && clip.appId === appId) ?? null;
  }

  async deleteExpiredClips(cutoffs: RetentionCutoffs): Promise<string[]> {
    const expired = [...this.clips.values()].filter(
      (clip) =>
        (clip.status === "hidden" && clip.hiddenAt !== null && clip.hiddenAt < cutoffs.hiddenBefore) ||
        clip.createdAt < cutoffs.createdBefore
    );
    for (const clip of expired) this.clips.delete(clip.id);
    return expired.map((clip) => clip.id);
  }

  async existingClipIds(ids: readonly string[]): Promise<Set<string>> {
    if (this.failExistingCheck) {
      this.failExistingCheck = false;
      throw pgError("57P01");
    }
    return new Set(ids.filter((id) => this.clips.has(id)));
  }

  async pruneUploadLedger(before: Date): Promise<number> {
    const kept = this.uploads.filter((upload) => upload.startedAt >= before);
    const pruned = this.uploads.length - kept.length;
    this.uploads = kept;
    return pruned;
  }
}

export interface StoredObject {
  body: Uint8Array;
  contentType: string;
  lastModified: Date;
}

export class MemoryBucket implements ClipBucket {
  objects = new Map<string, StoredObject>();
  /** Operations that fail with a BucketError (put, delete, copy, sign, list). */
  failOn = new Set<string>();
  /** Keys whose put fails. */
  failPutKeys = new Set<string>();
  /** Keys per listing page. */
  pageSize = 1000;
  listCalls = 0;
  clock: () => Date = () => new Date();

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    if (this.failOn.has("put") || this.failPutKeys.has(key)) throw new BucketError("put", 503);
    this.objects.set(key, { body: body.slice(), contentType, lastModified: this.clock() });
  }

  async delete(key: string): Promise<void> {
    if (this.failOn.has("delete")) throw new BucketError("delete", 503);
    this.objects.delete(key);
  }

  async copy(fromKey: string, toKey: string): Promise<void> {
    if (this.failOn.has("copy")) throw new BucketError("copy", 503);
    const object = this.objects.get(fromKey);
    if (!object) throw new BucketError("copy", 404);
    this.objects.set(toKey, { ...object, lastModified: this.clock() });
  }

  async signedGetUrl(key: string, expiresSec: number): Promise<string> {
    if (this.failOn.has("sign")) throw new BucketError("sign", null, "signing");
    return `https://bucket.test/${key}?X-Amz-Expires=${expiresSec}&X-Amz-Signature=fake`;
  }

  async *list(prefix: string): AsyncGenerator<ListedObject> {
    if (this.failOn.has("list")) throw new BucketError("list", 503);
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
    for (let start = 0; start < keys.length; start += this.pageSize) {
      this.listCalls++;
      for (const key of keys.slice(start, start + this.pageSize)) {
        const object = this.objects.get(key);
        if (object) yield { key, lastModified: object.lastModified };
      }
    }
  }
}
