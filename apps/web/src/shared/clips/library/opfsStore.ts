/**
 * The on-device clip library (plan 8.1). It runs in the io worker.
 *
 * Tiers:
 * - "opfs": bytes in the origin private file system at lib/<ownerKey>/<id>.<ext>
 *   (mp4, webm or png), rows in IndexedDB. This is the normal tier.
 * - "idb": bytes as ArrayBuffer chunks in IndexedDB. Used when an OPFS write fails
 *   in a normal window, or when the browser has no OPFS.
 * - "memory": bytes and rows in this worker only. Used in private windows (where
 *   navigator.storage.getDirectory() rejects) and when IndexedDB does not open. The
 *   UI shows the "Share it or save it to your phone now!" sheet for these clips.
 *   A failure to open IndexedDB or OPFS is tried again at the next operation, so a
 *   short failure at startup does not keep a normal window on this tier. A private
 *   window rejects every time, so it stays here.
 *
 * Write protocol (OPFS):
 * 1. Check the bytes (they parse and fill the file, the duration is correct, a
 *    keyframe is first).
 * 2. Write tmp/<id>.<ext> with a SyncAccessHandle (write, flush, size check). A real
 *    QuotaExceededError shows here, before any old clip is removed.
 * 3. Read the file back and check it again.
 * 4. Under the library lock ("hh-clips-lib"): remove old watched "auto" clips if the
 *    budget needs it, move the file into lib/<ownerKey>/, then write the row.
 * 5. Tell other tabs on BroadcastChannel "hh-clips": { added: id }.
 *
 * Every clip that a save removes is reported, also when the save fails after the
 * removal (LibraryError.eviction). There is never a silent eviction (plan 8.1).
 *
 * The io worker is the only writer of rows. Every row write holds the library lock,
 * so an eviction never races a Keep, and an owner change moves the file and the row
 * together.
 *
 * QuotaExceededError is a normal result: it becomes LibraryError("quota") and no
 * other tier is tried, because every tier uses the same origin quota.
 */

import type { ClipRecord, ClipRecordPatch, MemoryClass } from "../protocol";
import { makePosterFromFile } from "../engine/io/poster";
import { memoryBudgetFor, persistentBudgetFor } from "./budget";
import { type ClipsDb, DEFAULT_CHUNK_BYTES, openClipsDb } from "./db";
import { InvalidInputError, LibraryError, errorText, isNotFoundError, isQuotaError } from "./errors";
import { type EvictionOutcome, isEvictable, planEviction } from "./eviction";
import type {
  BroadcastLike,
  DirectoryHandleLike,
  FileHandleLike,
  LocksLike,
  StorageLike,
} from "./fsTypes";
import { isClipId, isOwnerKey } from "./ownerKey";
import { checkOwnerChange, sanitizePatch } from "./patch";
import {
  LIBRARY_CHANNEL,
  LIBRARY_LOCK,
  type LibraryMessage,
  type ReconcileResult,
  type StoredMime,
  clipFileName,
  downloadName,
  isStoredMime,
  parseClipFileName,
} from "./shared";
import { type ClipInspection, type VerifyExpectation, inspectClip, isUsable, verifyClip } from "./verify";

export { LIBRARY_CHANNEL, LIBRARY_LOCK, downloadName } from "./shared";
export type { LibraryMessage, ReconcileResult } from "./shared";
export type { EvictionOutcome } from "./eviction";

export const LIB_DIR = "lib";
export const TMP_DIR = "tmp";
/** A temp file older than this is left from a write that stopped (a crash or a closed tab). */
export const STALE_TEMP_MS = 10 * 60 * 1000;
/**
 * A clip that the UI read (for the share sheet) this long ago or less is removed
 * last when the library makes space, because the UI can still hold its File.
 */
export const READ_DEFER_MS = 10 * 60 * 1000;

export type StorageTier = ClipRecord["storage"];

/** A row before the library adds where the bytes are and how many there are. */
export type SaveMeta = Omit<ClipRecord, "storage" | "bytes">;

export interface SaveResult {
  record: ClipRecord;
  /** Clips removed to make space, or null when nothing was removed. */
  eviction: EvictionOutcome | null;
  /**
   * What went wrong on the way, in order (for example "opfs: InvalidStateError: ..."
   * before an IndexedDB save). Empty when every step worked. record.storage tells
   * which tier holds the clip.
   */
  problems: string[];
}

export interface LibraryEnv {
  /** navigator.storage. Null means "no OPFS here". */
  storage?: StorageLike | null;
  indexedDB?: IDBFactory | null;
  keyRange?: typeof IDBKeyRange | null;
  /** navigator.locks. Null means "no Web Locks": the library then runs without them. */
  locks?: LocksLike | null;
  /** The BroadcastChannel "hh-clips". Null means "do not tell other tabs". */
  channel?: BroadcastLike | null;
  now?: () => number;
  /** The memory class that sizes the in-memory tier (plan 6.5). Default "low". */
  memoryClass?: MemoryClass;
  /** A fixed in-memory budget (tests). It overrides the memory class. */
  memoryBudgetBytes?: number;
  chunkBytes?: number;
  staleTempMs?: number;
  verify?: (source: Blob | Uint8Array, expected: VerifyExpectation) => Promise<ClipInspection>;
  inspect?: (source: Blob, mime: StoredMime) => Promise<ClipInspection>;
  posterFromFile?: (file: Blob, mime: StoredMime) => Promise<string>;
}

interface ResolvedEnv {
  storage: StorageLike | null;
  factory: IDBFactory | null;
  keyRange: typeof IDBKeyRange | null;
  locks: LocksLike | null;
  channel: BroadcastLike | null;
  ownsChannel: boolean;
  now: () => number;
  fixedMemoryBudget: number | null;
  chunkBytes: number;
  staleTempMs: number;
  verify: (source: Blob | Uint8Array, expected: VerifyExpectation) => Promise<ClipInspection>;
  inspect: (source: Blob, mime: StoredMime) => Promise<ClipInspection>;
  posterFromFile: (file: Blob, mime: StoredMime) => Promise<string>;
}

/** Removals made so far by one save. `kept` is correct at every step, also after a failure. */
interface EvictionLog {
  kept: string[];
  removed: string[];
}

function pick<K extends keyof LibraryEnv>(env: LibraryEnv, key: K, fallback: () => LibraryEnv[K]): LibraryEnv[K] {
  return key in env ? env[key] : fallback();
}

function toFile(blob: Blob, record: ClipRecord): File {
  return new File([blob], downloadName(record), { type: record.mime, lastModified: record.createdAt });
}

function asArrayBufferBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes.buffer instanceof ArrayBuffer ? (bytes as Uint8Array<ArrayBuffer>) : new Uint8Array(bytes);
}

/**
 * Writes all bytes to a file. Uses a SyncAccessHandle when the context has one (the
 * io worker), else a writable stream. Checks the final size.
 */
export async function writeWholeFile(handle: FileHandleLike, bytes: Uint8Array): Promise<void> {
  if (typeof handle.createSyncAccessHandle === "function") {
    const access = await handle.createSyncAccessHandle();
    try {
      // Every call is awaited: Safari 15.2 to 16.3 return a Promise from truncate,
      // flush, getSize and close (see fsTypes.ts).
      await access.truncate(0);
      let written = 0;
      while (written < bytes.length) {
        const count = await access.write(bytes.subarray(written), { at: written });
        if (!(count > 0)) throw new Error(`the write stopped at ${written} of ${bytes.length} bytes`);
        written += count;
      }
      await access.flush();
      const size = await access.getSize();
      if (size !== bytes.length) throw new Error(`the file has ${size} bytes, expected ${bytes.length}`);
    } finally {
      await access.close();
    }
    return;
  }
  if (typeof handle.createWritable === "function") {
    const writable = await handle.createWritable({ keepExistingData: false });
    try {
      await writable.write(asArrayBufferBytes(bytes));
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => undefined);
      throw error;
    }
    return;
  }
  throw new LibraryError("opfs-unavailable", "this browser has no way to write an OPFS file");
}

/**
 * Moves a file to another folder. Uses FileSystemHandle.move() when the browser has
 * it, else copies the bytes and removes the source.
 */
export async function moveFile(
  handle: FileHandleLike,
  fromDir: DirectoryHandleLike,
  fromName: string,
  toDir: DirectoryHandleLike,
  toName: string,
  bytes?: Uint8Array,
): Promise<void> {
  if (typeof handle.move === "function") {
    try {
      await handle.move(toDir, toName);
      return;
    } catch (error) {
      if (isQuotaError(error)) throw error;
      // Some browsers have move() but refuse it for this case. A copy does the same job.
    }
  }
  const data = bytes ?? new Uint8Array(await (await handle.getFile()).arrayBuffer());
  const target = await toDir.getFileHandle(toName, { create: true });
  await writeWholeFile(target, data);
  const copy = await target.getFile();
  if (copy.size !== data.length) throw new Error(`the copy has ${copy.size} bytes, expected ${data.length}`);
  await fromDir.removeEntry(fromName);
}

async function collect<T>(iterator: AsyncIterableIterator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterator) items.push(item);
  return items;
}

function sumBytes(records: ClipRecord[]): number {
  return records.reduce((sum, record) => sum + Math.max(0, record.bytes || 0), 0);
}

function outcome(log: EvictionLog): EvictionOutcome | null {
  return log.removed.length > 0 ? { kept: log.kept.slice(), removed: log.removed.slice() } : null;
}

/** Where a stored file is: its folder, its handle and the owner folder name. */
interface Located {
  dir: DirectoryHandleLike;
  handle: FileHandleLike;
  ownerKey: string;
}

export class ClipLibrary {
  private readonly memory = new Map<string, { record: ClipRecord; blob: Blob }>();
  /** When the UI last read each clip, for READ_DEFER_MS. */
  private readonly reads = new Map<string, number>();
  private db: ClipsDb | null = null;
  private root: DirectoryHandleLike | null = null;
  /** "rejected": getDirectory() failed (a private window, or a short failure). */
  private opfs: "ok" | "rejected" | "none" = "none";
  /** True when IndexedDB exists here but did not open. */
  private idbFailed = false;
  private refreshing: Promise<void> | null = null;
  private memoryBudget: number;

  private constructor(private readonly env: ResolvedEnv, memoryClass: MemoryClass | undefined) {
    this.memoryBudget = env.fixedMemoryBudget ?? memoryBudgetFor(memoryClass);
  }

  /** Opens the library and picks its first tier. Never rejects: memory always works. */
  static async open(env: LibraryEnv = {}): Promise<ClipLibrary> {
    const nav = globalThis.navigator as unknown as { storage?: StorageLike; locks?: LocksLike } | undefined;
    const ownsChannel = !("channel" in env);
    let channel: BroadcastLike | null = env.channel ?? null;
    if (ownsChannel) {
      try {
        channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(LIBRARY_CHANNEL) : null;
      } catch {
        // An opaque origin cannot open a channel. Other tabs then refresh on their own.
        channel = null;
      }
    }
    const library = new ClipLibrary(
      {
        storage: pick(env, "storage", () => nav?.storage ?? null) ?? null,
        factory: pick(env, "indexedDB", () => globalThis.indexedDB ?? null) ?? null,
        keyRange: pick(env, "keyRange", () => globalThis.IDBKeyRange ?? null) ?? null,
        locks: pick(env, "locks", () => nav?.locks ?? null) ?? null,
        channel,
        ownsChannel,
        now: env.now ?? (() => Date.now()),
        fixedMemoryBudget: env.memoryBudgetBytes ?? null,
        chunkBytes: env.chunkBytes ?? DEFAULT_CHUNK_BYTES,
        staleTempMs: env.staleTempMs ?? STALE_TEMP_MS,
        verify: env.verify ?? verifyClip,
        inspect: env.inspect ?? ((source, mime) => inspectClip(source, mime, { packetRate: true })),
        posterFromFile: env.posterFromFile ?? ((file, mime) => makePosterFromFile(file, mime)),
      },
      env.memoryClass,
    );
    await library.resolveStorage();
    return library;
  }

  /** The first tier that a save tries. */
  get tier(): StorageTier {
    if (!this.db || this.opfs === "rejected") return "memory";
    return this.opfs === "ok" ? "opfs" : "idb";
  }

  /** Sets the in-memory budget from the capability probe's memory class (plan 6.5). */
  setMemoryClass(memoryClass: MemoryClass): void {
    this.memoryBudget = this.env.fixedMemoryBudget ?? memoryBudgetFor(memoryClass);
  }

  /**
   * Stores a finished clip or picture. `expectedVideoSec` is the length that the
   * producer described (null for pictures). Throws LibraryError("quota" |
   * "verify-failed"), with `eviction` set when clips were removed before the failure.
   */
  async save(bytes: Uint8Array, meta: SaveMeta, expectedVideoSec: number | null): Promise<SaveResult> {
    if (!isClipId(meta.id)) throw new InvalidInputError(`"${meta.id}" is not a valid clip id`);
    if (!isOwnerKey(meta.ownerKey)) throw new InvalidInputError(`"${meta.ownerKey}" is not a valid owner key`);
    if (!isStoredMime(meta.mime)) throw new InvalidInputError(`"${String(meta.mime)}" is not a type the library stores`);
    const expected: VerifyExpectation = { mime: meta.mime, videoSec: meta.mime === "image/png" ? null : expectedVideoSec };
    // Step 1: a bad file stops here, before anything is written.
    const facts = await this.env.verify(bytes, expected);
    const base: Omit<ClipRecord, "storage"> = {
      ...meta,
      bytes: bytes.length,
      durationMs: Math.round(facts.videoDurationSec * 1000),
      hasAudio: facts.hasAudio,
    };
    await this.refresh();

    const log: EvictionLog = { kept: [], removed: [] };
    const problems: string[] = [];
    const done = (record: ClipRecord): SaveResult => ({ record, eviction: outcome(log), problems });
    try {
      if (this.tier === "opfs") {
        try {
          return done(await this.saveOpfs(bytes, base, expected, log, problems));
        } catch (error) {
          if (isQuotaError(error)) throw this.quotaError(error);
          problems.push(`opfs: ${errorText(error)}`);
        }
      }
      if (this.tier !== "memory") {
        try {
          return done(await this.saveIdb(bytes, base, expected, log, problems));
        } catch (error) {
          if (isQuotaError(error)) throw this.quotaError(error);
          problems.push(`idb: ${errorText(error)}`);
        }
      }
      return done(this.saveMemory(bytes, base, log));
    } catch (error) {
      throw this.withEviction(error, log);
    }
  }

  /** The clip bytes as a File named for sharing. Throws LibraryError("not-found"). */
  async read(id: string): Promise<{ record: ClipRecord; file: File }> {
    await this.refresh();
    const held = this.memory.get(id);
    if (held) {
      this.reads.set(id, this.env.now());
      return { record: held.record, file: toFile(held.blob, held.record) };
    }
    const record = isClipId(id) && this.db ? await this.db.get(id) : undefined;
    if (!record) throw new LibraryError("not-found", `there is no clip "${id}"`);
    this.reads.set(id, this.env.now());
    if (record.storage === "opfs") {
      if (!this.root) throw new LibraryError("opfs-unavailable", "OPFS is not available in this window");
      try {
        const located = await this.locate(record.id, record.mime, record.ownerKey);
        if (!located) throw new LibraryError("not-found", `the file of clip "${id}" is gone`);
        return { record, file: toFile(await located.handle.getFile(), record) };
      } catch (error) {
        if (error instanceof LibraryError) throw error;
        if (isNotFoundError(error)) throw new LibraryError("not-found", `the file of clip "${id}" is gone`);
        throw new LibraryError("opfs-unavailable", errorText(error));
      }
    }
    if (record.storage === "idb") {
      const chunks = this.db ? await this.db.getChunks(id) : null;
      if (!chunks) throw new LibraryError("not-found", `the bytes of clip "${id}" are gone`);
      return { record, file: toFile(new Blob(chunks), record) };
    }
    throw new LibraryError("not-found", `clip "${id}" was held in the memory of another window`);
  }

  /** Removes a clip and its bytes. Returns false when there was no such clip. */
  async remove(id: string): Promise<boolean> {
    await this.refresh();
    const held = this.memory.get(id);
    if (held) {
      this.memory.delete(id);
      this.reads.delete(id);
      // A save that fell back to memory can leave its file in lib/ (the row write
      // failed after the move). Remove it too, or the next startup brings the clip back.
      await this.removeStrayFile(held.record).catch(() => undefined);
      return true;
    }
    const db = this.db;
    if (!db || !isClipId(id)) return false;
    return this.withLock(async () => {
      const record = await db.get(id);
      if (!record) return false;
      await this.deleteBytes(record);
      await db.delete(id);
      this.reads.delete(id);
      this.post({ removed: id });
      return true;
    });
  }

  /**
   * Changes fields of one row (protocol IoCmd "update"). A new ownerKey also moves an
   * OPFS clip's file to the new owner's folder, in the same lock as the row. Throws
   * TypeError for a bad patch and LibraryError("not-found") for an unknown clip.
   */
  async update(id: string, patchInput: unknown): Promise<ClipRecord> {
    const patch = sanitizePatch(patchInput);
    await this.refresh();
    const held = this.memory.get(id);
    if (held) {
      if (patch.ownerKey !== undefined) checkOwnerChange(held.record.ownerKey, patch.ownerKey);
      held.record = { ...held.record, ...patch };
      return held.record;
    }
    const db = this.db;
    if (!db || !isClipId(id)) throw new LibraryError("not-found", `there is no clip "${id}"`);
    return this.withLock(async () => {
      const current = await db.get(id);
      if (!current) throw new LibraryError("not-found", `there is no clip "${id}"`);
      const next = await this.applyPatch(db, current, patch);
      this.post({ updated: id });
      return next;
    });
  }

  /** One player's clips, newest first. */
  async list(ownerKey: string): Promise<ClipRecord[]> {
    await this.refresh();
    const rows = this.db ? await this.db.listByOwner(ownerKey) : [];
    const held = [...this.memory.values()].map((entry) => entry.record).filter((record) => record.ownerKey === ownerKey);
    return [...rows, ...held].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  }

  /** The budget in bytes and the bytes the stored clips use. */
  async budget(): Promise<{ budgetBytes: number; usedBytes: number }> {
    await this.refresh();
    if (this.tier === "memory") {
      return { budgetBytes: this.memoryBudget, usedBytes: sumBytes([...this.memory.values()].map((entry) => entry.record)) };
    }
    const rows = await this.storedRows();
    return { budgetBytes: await this.persistentBudget(), usedBytes: sumBytes(rows) };
  }

  /**
   * Startup check (plan 8.1):
   * - a file without a row gets a new row (kind "clip", or "picture" for a PNG, so it
   *   is never auto-removed);
   * - a row without a file is removed and counted;
   * - a file in the wrong owner folder moves to its row's owner;
   * - chunks without a row and old temp files are removed.
   */
  async reconcile(): Promise<ReconcileResult> {
    const result: ReconcileResult = {
      reindexed: 0,
      missing: 0,
      unreadable: 0,
      relocated: 0,
      orphanChunks: 0,
      staleTemp: 0,
      errors: 0,
    };
    await this.refresh();
    const db = this.db;
    if (!db) return result;
    await this.withLock(async () => {
      const rows = await db.listAll();
      const byId = new Map(rows.map((row) => [row.id, row]));
      const filesSeen = new Set<string>();
      if (this.root) {
        await this.reconcileFiles(db, byId, filesSeen, result);
        await this.removeStaleTemp(result);
      }
      for (const row of rows) {
        try {
          if (row.storage === "opfs") {
            // Without OPFS in this window the files cannot be checked, so the rows stay.
            if (!this.root || filesSeen.has(row.id)) continue;
          } else if (row.storage === "idb") {
            if (await db.hasChunks(row.id)) continue;
          }
          // An "opfs" row with no file, an "idb" row with no chunks, or a "memory"
          // row (memory clips never belong in IndexedDB).
          await db.delete(row.id);
          result.missing++;
          this.post({ removed: row.id });
        } catch {
          result.errors++;
        }
      }
      const idbRows = new Set((await db.listAll()).filter((row) => row.storage === "idb").map((row) => row.id));
      for (const id of await db.chunkIds()) {
        if (idbRows.has(id)) continue;
        try {
          await db.deleteChunks(id);
          result.orphanChunks++;
        } catch {
          result.errors++;
        }
      }
    });
    const changed = result.reindexed + result.missing + result.unreadable + result.relocated;
    if (changed > 0) this.post({ reconciled: result });
    return result;
  }

  /** Closes the database and the channel that the library opened. */
  close(): void {
    this.db?.close();
    if (this.env.ownsChannel) this.env.channel?.close?.();
  }

  // -------------------------------------------------------------------------
  // Storage resolution
  // -------------------------------------------------------------------------

  /** Opens IndexedDB and OPFS where they are not open yet. */
  private async resolveStorage(): Promise<void> {
    const { factory, keyRange, storage } = this.env;
    if (!this.db && factory && keyRange) {
      this.db = await openClipsDb(factory, keyRange).catch(() => null);
      this.idbFailed = !this.db;
    }
    if (this.opfs !== "ok" && storage && typeof storage.getDirectory === "function") {
      try {
        this.root = await storage.getDirectory();
        this.opfs = "ok";
      } catch {
        // Private windows reject getDirectory(). So can a short failure in a normal
        // window (WebKit uses the same UnknownError for both), so it is tried again.
        this.root = null;
        this.opfs = "rejected";
      }
    }
  }

  /** Tries again to open what failed before. Does nothing when nothing failed. */
  private async refresh(): Promise<void> {
    if (!this.idbFailed && this.opfs !== "rejected") return;
    this.refreshing ??= this.resolveStorage().finally(() => {
      this.refreshing = null;
    });
    await this.refreshing;
  }

  // -------------------------------------------------------------------------
  // Tiers
  // -------------------------------------------------------------------------

  private async saveOpfs(
    bytes: Uint8Array,
    base: Omit<ClipRecord, "storage">,
    expected: VerifyExpectation,
    log: EvictionLog,
    problems: string[],
  ): Promise<ClipRecord> {
    const root = this.root!;
    const db = this.db!;
    const name = clipFileName(base.id, base.mime);
    const tmpDir = await root.getDirectoryHandle(TMP_DIR, { create: true });
    const tmp = await tmpDir.getFileHandle(name, { create: true });
    let placed = false;
    try {
      // Steps 2 and 3: write and check the temp file. No old clip is removed yet.
      await writeWholeFile(tmp, bytes);
      const written = await tmp.getFile();
      if (written.size !== bytes.length) {
        throw new LibraryError("verify-failed", `the temp file has ${written.size} bytes, expected ${bytes.length}`);
      }
      await this.env.verify(written, expected);
      const record: ClipRecord = { ...base, storage: "opfs" };
      // Step 4, in one lock: make room, move the file, write the row.
      await this.withLock(async () => {
        await this.makeRoomOrNote(bytes.length, log, problems);
        const dir = await this.ownerDir(record.ownerKey, true);
        await moveFile(tmp, tmpDir, name, dir, name, bytes);
        placed = true;
        // A failed row write leaves the verified file in place. The next startup
        // check gives it a row (kind "clip", NEW), so the clip is never lost.
        await db.put(record);
      });
      this.post({ added: record.id });
      return record;
    } catch (error) {
      if (!placed) await tmpDir.removeEntry(name).catch(() => undefined);
      throw error;
    }
  }

  private async saveIdb(
    bytes: Uint8Array,
    base: Omit<ClipRecord, "storage">,
    expected: VerifyExpectation,
    log: EvictionLog,
    problems: string[],
  ): Promise<ClipRecord> {
    const db = this.db!;
    const record: ClipRecord = { ...base, storage: "idb" };
    // All of it under the lock: the startup check of another tab removes chunks
    // that have no row, so the chunks must not exist without the lock.
    await this.withLock(async () => {
      try {
        await db.putChunks(record.id, bytes, this.env.chunkBytes);
        const chunks = await db.getChunks(record.id);
        if (!chunks) throw new LibraryError("verify-failed", "the stored chunks are not complete");
        await this.env.verify(new Blob(chunks, { type: record.mime }), expected);
        await this.makeRoomOrNote(bytes.length, log, problems);
        await db.put(record);
      } catch (error) {
        await db.deleteChunks(record.id).catch(() => undefined);
        throw error;
      }
    });
    this.post({ added: record.id });
    return record;
  }

  private saveMemory(bytes: Uint8Array, base: Omit<ClipRecord, "storage">, log: EvictionLog): ClipRecord {
    const held = [...this.memory.values()].map((entry) => entry.record);
    const plan = planEviction(held, this.memoryBudget, bytes.length, this.deferredIds());
    if (!plan.fits) {
      throw new LibraryError(
        "quota",
        `the clip needs ${bytes.length} bytes; clips in memory use ${plan.usedBytes} of ${plan.budgetBytes}`,
      );
    }
    for (const record of plan.remove) {
      this.memory.delete(record.id);
      this.reads.delete(record.id);
    }
    if (plan.remove.length > 0) {
      log.removed.push(...plan.remove.map((record) => record.id));
      log.kept = plan.keep.map((record) => record.id);
    }
    const record: ClipRecord = { ...base, storage: "memory" };
    this.memory.set(record.id, { record, blob: new Blob([asArrayBufferBytes(bytes)], { type: record.mime }) });
    // Memory clips live in this worker only, so other tabs get no message.
    return record;
  }

  // -------------------------------------------------------------------------
  // Budget and eviction
  // -------------------------------------------------------------------------

  private async storedRows(): Promise<ClipRecord[]> {
    if (!this.db) return [];
    return (await this.db.listAll()).filter((row) => row.storage === "opfs" || row.storage === "idb");
  }

  private async persistentBudget(): Promise<number> {
    const storage = this.env.storage;
    const estimate = typeof storage?.estimate === "function" ? await storage.estimate().catch(() => null) : null;
    return persistentBudgetFor(estimate);
  }

  private deferredIds(): Set<string> {
    const now = this.env.now();
    const ids = new Set<string>();
    for (const [id, at] of this.reads) {
      if (now - at <= READ_DEFER_MS) ids.add(id);
      else this.reads.delete(id);
    }
    return ids;
  }

  /**
   * Runs under the library lock. Removes clips only when the new clip does not fit.
   * Each removal goes into `log` as it happens, so a failure later in the save still
   * reports it. Throws LibraryError("quota") when the clip cannot fit.
   */
  private async makeRoom(neededBytes: number, log: EvictionLog): Promise<void> {
    const rows = await this.storedRows();
    const budget = await this.persistentBudget();
    const plan = planEviction(rows, budget, neededBytes, this.deferredIds());
    if (!plan.fits) {
      throw new LibraryError(
        "quota",
        `the clip needs ${neededBytes} bytes; the library uses ${plan.usedBytes} of its ${budget} byte budget`,
      );
    }
    if (plan.remove.length === 0) return;
    const stays = new Set(rows.map((row) => row.id));
    const keptNow = () => rows.filter((row) => stays.has(row.id)).map((row) => row.id);
    log.kept = keptNow();
    for (const record of plan.remove) {
      // A clip that is no longer removable stays. The new clip is then saved a little
      // over the budget: the budget is a soft limit, and the origin quota is the hard one.
      if (!(await this.evict(record))) continue;
      stays.delete(record.id);
      log.removed.push(record.id);
      log.kept = keptNow();
      this.post({ removed: record.id });
    }
  }

  /** makeRoom, where only a quota result stops the save. Other failures become a problem. */
  private async makeRoomOrNote(neededBytes: number, log: EvictionLog, problems: string[]): Promise<void> {
    try {
      await this.makeRoom(neededBytes, log);
    } catch (error) {
      if (isQuotaError(error)) throw error;
      // The budget could not be read or a removal failed. Keep going: a write that
      // really has no space still ends as a quota error.
      problems.push(`budget: ${errorText(error)}`);
    }
  }

  /**
   * Removes one clip to make space. The row goes first, in one transaction that
   * checks again that the clip may go (not kept, watched, "auto"). A clip that the
   * kid kept a moment ago is therefore never removed. If the bytes then cannot be
   * removed, the next startup check gives the file a new row (kind "clip"), so no
   * clip is lost. Returns false when the clip is not removed.
   */
  private async evict(record: ClipRecord): Promise<boolean> {
    const db = this.db!;
    const row = await db.deleteIf(record.id, isEvictable);
    if (!row) return false;
    this.reads.delete(row.id);
    await this.deleteBytes(row).catch(() => undefined);
    return true;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private withLock<T>(body: () => Promise<T>): Promise<T> {
    const locks = this.env.locks;
    return locks ? locks.request(LIBRARY_LOCK, () => body()) : body();
  }

  private post(message: LibraryMessage): void {
    try {
      this.env.channel?.postMessage(message);
    } catch {
      // A closed channel only means other tabs refresh later.
    }
  }

  private quotaError(error: unknown): LibraryError {
    return error instanceof LibraryError ? error : new LibraryError("quota", errorText(error));
  }

  /** Puts the removals of a failed save on the error, so the UI still hears about them. */
  private withEviction(error: unknown, log: EvictionLog): unknown {
    const eviction = outcome(log);
    if (!eviction) return error;
    const typed = error instanceof LibraryError ? error : new LibraryError("opfs-unavailable", errorText(error));
    typed.eviction = eviction;
    return typed;
  }

  private async ownerDir(ownerKey: string, create: boolean): Promise<DirectoryHandleLike> {
    if (!isOwnerKey(ownerKey)) throw new InvalidInputError(`"${ownerKey}" is not a valid owner key`);
    const lib = await this.root!.getDirectoryHandle(LIB_DIR, { create });
    return lib.getDirectoryHandle(ownerKey, { create });
  }

  /**
   * Finds a stored file: in the preferred owner's folder first, then in every other
   * owner folder (a crash in an owner change can leave a file in the old folder).
   * Returns null when no folder has it.
   */
  private async locate(id: string, mime: StoredMime, preferredOwner: string): Promise<Located | null> {
    const name = clipFileName(id, mime);
    let lib: DirectoryHandleLike;
    try {
      lib = await this.root!.getDirectoryHandle(LIB_DIR);
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
    const tryOwner = async (ownerKey: string, dir?: DirectoryHandleLike): Promise<Located | null> => {
      try {
        const folder = dir ?? (await lib.getDirectoryHandle(ownerKey));
        return { dir: folder, handle: await folder.getFileHandle(name), ownerKey };
      } catch (error) {
        if (isNotFoundError(error)) return null;
        throw error;
      }
    };
    const preferred = isOwnerKey(preferredOwner) ? await tryOwner(preferredOwner) : null;
    if (preferred) return preferred;
    for (const [ownerKey, handle] of await collect(lib.entries())) {
      if (handle.kind !== "directory" || !isOwnerKey(ownerKey) || ownerKey === preferredOwner) continue;
      const found = await tryOwner(ownerKey, handle);
      if (found) return found;
    }
    return null;
  }

  /** Removes the bytes of a stored clip, wherever they are. A file that is already gone is fine. */
  private async deleteBytes(record: ClipRecord): Promise<void> {
    if (record.storage === "opfs") {
      if (!this.root) throw new LibraryError("opfs-unavailable", "OPFS is not available, so the file cannot be removed");
      try {
        const located = await this.locate(record.id, record.mime, record.ownerKey);
        if (located) await located.dir.removeEntry(located.handle.name);
      } catch (error) {
        if (!isNotFoundError(error)) throw new LibraryError("opfs-unavailable", errorText(error));
      }
    } else if (record.storage === "idb") {
      await this.db!.deleteChunks(record.id);
    }
  }

  /** Removes a leftover OPFS file of a memory clip, when no row claims that id. */
  private async removeStrayFile(record: ClipRecord): Promise<void> {
    const db = this.db;
    if (!this.root || !db) return;
    await this.withLock(async () => {
      if (await db.get(record.id)) return;
      const located = await this.locate(record.id, record.mime, record.ownerKey);
      if (located) await located.dir.removeEntry(located.handle.name);
    });
  }

  /** Applies a checked patch to a row. Runs under the library lock. */
  private async applyPatch(db: ClipsDb, current: ClipRecord, patch: ClipRecordPatch): Promise<ClipRecord> {
    const newOwner = patch.ownerKey;
    const moving = newOwner !== undefined && newOwner !== current.ownerKey;
    if (moving) checkOwnerChange(current.ownerKey, newOwner);
    if (!moving || current.storage !== "opfs") {
      const next = await db.update(current.id, patch);
      if (!next) throw new LibraryError("not-found", `there is no clip "${current.id}"`);
      return next;
    }
    if (!this.root) throw new LibraryError("opfs-unavailable", "OPFS is not available, so the file cannot move");
    const located = await this.locate(current.id, current.mime, current.ownerKey);
    if (!located) throw new LibraryError("not-found", `the file of clip "${current.id}" is gone`);
    const name = located.handle.name;
    const target = await this.ownerDir(newOwner, true);
    if (located.ownerKey !== newOwner) await moveFile(located.handle, located.dir, name, target, name);
    try {
      const next = await db.update(current.id, patch);
      if (!next) throw new LibraryError("not-found", `there is no clip "${current.id}"`);
      return next;
    } catch (error) {
      // Put the file back, so the row and the file agree again. If that fails too,
      // read() and the startup check still find the file in any owner folder.
      if (located.ownerKey !== newOwner) {
        const moved = await target.getFileHandle(name).catch(() => null);
        if (moved) await moveFile(moved, target, name, await this.ownerDir(located.ownerKey, true), name).catch(() => undefined);
      }
      throw error;
    }
  }

  private async reconcileFiles(
    db: ClipsDb,
    byId: Map<string, ClipRecord>,
    filesSeen: Set<string>,
    result: ReconcileResult,
  ): Promise<void> {
    const lib = await this.root!.getDirectoryHandle(LIB_DIR, { create: true });
    // The owner folder where each row's file lives after this check. A file that was
    // moved into a folder that the loop visits later is seen again there: it is the
    // same file, not a copy.
    const placedIn = new Map<string, string>();
    // Collect first: changing a folder while it is iterated is not defined.
    for (const [ownerName, ownerHandle] of await collect(lib.entries())) {
      if (ownerHandle.kind !== "directory" || !isOwnerKey(ownerName)) continue;
      for (const [name, handle] of await collect(ownerHandle.entries())) {
        if (handle.kind !== "file") continue;
        const parsed = parseClipFileName(name);
        if (!parsed) continue;
        const { id, mime } = parsed;
        try {
          const row = byId.get(id);
          const isRowFile = !!row && row.storage === "opfs" && clipFileName(row.id, row.mime) === name;
          if (isRowFile && placedIn.get(id) === ownerName) continue;
          if (isRowFile && !placedIn.has(id)) {
            filesSeen.add(id);
            if (row.ownerKey !== ownerName) {
              await moveFile(handle, ownerHandle, name, await this.ownerDir(row.ownerKey, true), name);
              result.relocated++;
            }
            placedIn.set(id, row.ownerKey);
            continue;
          }
          if (row) {
            // The row keeps its bytes somewhere else (another tier, another name, or
            // a copy already kept in another owner folder). This file is a stray copy.
            await ownerHandle.removeEntry(name);
            continue;
          }
          const file = await handle.getFile();
          const record = await this.reindex(id, mime, ownerName, file);
          if (record) {
            await db.put(record);
            byId.set(id, record);
            filesSeen.add(id);
            placedIn.set(id, ownerName);
            result.reindexed++;
            this.post({ added: id });
          } else {
            await ownerHandle.removeEntry(name);
            result.unreadable++;
          }
        } catch {
          result.errors++;
        }
      }
    }
  }

  private async reindex(id: string, mime: StoredMime, ownerKey: string, file: File): Promise<ClipRecord | null> {
    let facts: ClipInspection;
    try {
      facts = await this.env.inspect(file, mime);
    } catch {
      return null;
    }
    if (!isUsable(facts)) return null;
    return {
      id,
      ownerKey,
      gameId: "unknown",
      // "clip" and "picture" are never removed automatically, which is the safe
      // choice for a file whose kind is not known.
      kind: mime === "image/png" ? "picture" : "clip",
      createdAt: file.lastModified || this.env.now(),
      durationMs: Math.round(facts.videoDurationSec * 1000),
      width: facts.width,
      height: facts.height,
      fps: Math.round(facts.fps),
      hasAudio: facts.hasAudio,
      mime,
      bytes: file.size,
      kept: false,
      // Not watched, so it shows as NEW and the kid sees that it came back.
      watched: false,
      storage: "opfs",
      posterDataUrl: await this.env.posterFromFile(file, mime),
      moments: [],
    };
  }

  private async removeStaleTemp(result: ReconcileResult): Promise<void> {
    let tmpDir: DirectoryHandleLike;
    try {
      tmpDir = await this.root!.getDirectoryHandle(TMP_DIR);
    } catch {
      return;
    }
    const now = this.env.now();
    for (const [name, handle] of await collect(tmpDir.entries())) {
      if (handle.kind !== "file") continue;
      try {
        const file = await handle.getFile();
        if (now - file.lastModified <= this.env.staleTempMs) continue;
        await tmpDir.removeEntry(name);
        result.staleTemp++;
      } catch {
        // A live write holds the file. It is not stale.
      }
    }
  }
}
