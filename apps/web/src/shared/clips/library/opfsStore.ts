/**
 * The on-device clip library (plan 8.1). It runs in the io worker.
 *
 * Tiers:
 * - "opfs": bytes in the origin private file system at lib/<ownerKey>/<id>.mp4,
 *   rows in IndexedDB. This is the normal tier.
 * - "idb": bytes as ArrayBuffer chunks in IndexedDB. Used when an OPFS write fails
 *   in a normal window, or when the browser has no OPFS.
 * - "memory": bytes and rows in this worker only. Used in private windows (where
 *   navigator.storage.getDirectory() rejects) and when IndexedDB does not open. The
 *   UI shows the "Share it or save it to your phone now!" sheet for these clips.
 *
 * Write protocol (OPFS):
 * 1. Check the muxed bytes (they parse, the duration is correct, a keyframe is first).
 * 2. Under the library lock, remove old watched "auto" clips if the budget needs it.
 * 3. Write tmp/<id>.mp4 with a SyncAccessHandle (write, flush, size check).
 * 4. Read the file back and check it again.
 * 5. Under the library lock ("hh-clips-lib"): move the file into lib/<ownerKey>/,
 *    then write the IndexedDB row.
 * 6. Tell other tabs on BroadcastChannel "hh-clips": { added: id }.
 *
 * QuotaExceededError is a normal result: it becomes LibraryError("quota") and no
 * other tier is tried, because every tier uses the same origin quota.
 */

import type { ClipRecord } from "../protocol";
import { makePosterFromMp4 } from "../engine/io/poster";
import { PROBE_FILE_NAME, probeFreeBytes } from "./budget";
import { type ClipsDb, DEFAULT_CHUNK_BYTES, openClipsDb } from "./db";
import { LibraryError, errorText, isNotFoundError, isQuotaError } from "./errors";
import { budgetFromQuota, planEviction } from "./eviction";
import type {
  BroadcastLike,
  DirectoryHandleLike,
  FileHandleLike,
  LocksLike,
  StorageLike,
} from "./fsTypes";
import { isClipId, isOwnerKey } from "./ownerKey";
import { type ClipInspection, inspectClip, verifyClip } from "./verify";

export const LIBRARY_LOCK = "hh-clips-lib";
export const LIBRARY_CHANNEL = "hh-clips";
export const LIB_DIR = "lib";
export const TMP_DIR = "tmp";
/**
 * Budget for clips held in memory (private windows). The real limit is the tab's
 * memory: iOS ends a Safari tab at about 1.5 GB on a 4 GB iPhone, and the export
 * budgets in plan 6.5 are 60-200 MB. 256 MiB is about 8 minutes of 720p clips.
 */
export const DEFAULT_MEMORY_BUDGET_BYTES = 256 * 1024 * 1024;
/** A temp file older than this is left from a write that stopped (a crash or a closed tab). */
export const STALE_TEMP_MS = 10 * 60 * 1000;
/** How long a free-space probe result stays valid. */
export const PROBE_CACHE_MS = 5 * 60 * 1000;

export type StorageTier = ClipRecord["storage"];

/** A row before the library adds where the bytes are and how many there are. */
export type SaveMeta = Omit<ClipRecord, "storage" | "bytes">;

export interface EvictionOutcome {
  kept: string[];
  removed: string[];
}

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

export interface ReconcileResult {
  /** Files with no row that got a new row. */
  reindexed: number;
  /** Rows with no bytes (for example after the browser removed site data). */
  missing: number;
  /** Files with no row that did not parse. They were removed. */
  unreadable: number;
  /** Files in the wrong owner folder, moved to their row's owner. */
  relocated: number;
  /** Chunk sets with no row. They were removed. */
  orphanChunks: number;
  /** Temp files left from stopped writes. They were removed. */
  staleTemp: number;
  /** Entries that could not be checked. They stay as they are. */
  errors: number;
}

/** Messages on the "hh-clips" BroadcastChannel. */
export type LibraryMessage = { added: string } | { removed: string } | { reconciled: ReconcileResult };

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
  memoryBudgetBytes?: number;
  chunkBytes?: number;
  staleTempMs?: number;
  verify?: (source: Blob | Uint8Array, expectedVideoSec: number) => Promise<ClipInspection>;
  inspect?: (source: Blob) => Promise<ClipInspection>;
  posterFromFile?: (file: Blob) => Promise<string>;
}

interface ResolvedEnv {
  storage: StorageLike | null;
  locks: LocksLike | null;
  channel: BroadcastLike | null;
  ownsChannel: boolean;
  now: () => number;
  memoryBudgetBytes: number;
  chunkBytes: number;
  staleTempMs: number;
  verify: (source: Blob | Uint8Array, expectedVideoSec: number) => Promise<ClipInspection>;
  inspect: (source: Blob) => Promise<ClipInspection>;
  posterFromFile: (file: Blob) => Promise<string>;
}

function pick<K extends keyof LibraryEnv>(env: LibraryEnv, key: K, fallback: () => LibraryEnv[K]): LibraryEnv[K] {
  return key in env ? env[key] : fallback();
}

function clipIdFromFileName(name: string): string | null {
  const match = /^(.+)\.mp4$/.exec(name);
  return match && isClipId(match[1]) ? match[1] : null;
}

function extensionFor(mime: ClipRecord["mime"]): string {
  return mime === "video/webm" ? "webm" : mime === "image/png" ? "png" : "mp4";
}

/** The name a shared or downloaded file gets, for example "snake-clip-2026-09-28.mp4". */
export function downloadName(record: ClipRecord): string {
  const game = record.gameId.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "game";
  const date = new Date(record.createdAt);
  const day = Number.isNaN(date.getTime())
    ? "clip"
    : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return `${game}-${record.kind}-${day}.${extensionFor(record.mime)}`;
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
      access.truncate(0);
      let written = 0;
      while (written < bytes.length) {
        const count = access.write(bytes.subarray(written), { at: written });
        if (!(count > 0)) throw new Error(`the write stopped at ${written} of ${bytes.length} bytes`);
        written += count;
      }
      access.flush();
      const size = access.getSize();
      if (size !== bytes.length) throw new Error(`the file has ${size} bytes, expected ${bytes.length}`);
    } finally {
      access.close();
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

export class ClipLibrary {
  private readonly memory = new Map<string, { record: ClipRecord; blob: Blob }>();
  private probe: { at: number; free: number | null } | null = null;

  private constructor(
    /** The first tier that a save tries. */
    readonly tier: StorageTier,
    private readonly db: ClipsDb | null,
    private readonly root: DirectoryHandleLike | null,
    private readonly env: ResolvedEnv,
  ) {}

  /** Opens the library and picks its first tier. Never rejects: memory always works. */
  static async open(env: LibraryEnv = {}): Promise<ClipLibrary> {
    const nav = globalThis.navigator as unknown as { storage?: StorageLike; locks?: LocksLike } | undefined;
    const storage = pick(env, "storage", () => nav?.storage ?? null) ?? null;
    const locks = pick(env, "locks", () => nav?.locks ?? null) ?? null;
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
    const resolved: ResolvedEnv = {
      storage,
      locks,
      channel,
      ownsChannel,
      now: env.now ?? (() => Date.now()),
      memoryBudgetBytes: env.memoryBudgetBytes ?? DEFAULT_MEMORY_BUDGET_BYTES,
      chunkBytes: env.chunkBytes ?? DEFAULT_CHUNK_BYTES,
      staleTempMs: env.staleTempMs ?? STALE_TEMP_MS,
      verify: env.verify ?? verifyClip,
      inspect: env.inspect ?? ((source) => inspectClip(source, { packetRate: true })),
      posterFromFile: env.posterFromFile ?? ((file) => makePosterFromMp4(file)),
    };

    const factory = pick(env, "indexedDB", () => globalThis.indexedDB ?? null);
    const keyRange = pick(env, "keyRange", () => globalThis.IDBKeyRange ?? null);
    const db = await openClipsDb(factory, keyRange).catch(() => null);

    let root: DirectoryHandleLike | null = null;
    let opfs: "ok" | "private" | "none" = "none";
    if (storage && typeof storage.getDirectory === "function") {
      try {
        root = await storage.getDirectory();
        opfs = "ok";
      } catch {
        // Private windows reject getDirectory().
        opfs = "private";
      }
    }
    const tier: StorageTier = !db || opfs === "private" ? "memory" : opfs === "ok" ? "opfs" : "idb";
    return new ClipLibrary(tier, db, tier === "opfs" ? root : null, resolved);
  }

  /** Stores a finished clip. Throws LibraryError("quota" | "verify-failed"). */
  async save(bytes: Uint8Array, meta: SaveMeta, expectedVideoSec: number): Promise<SaveResult> {
    if (!isClipId(meta.id)) throw new TypeError(`"${meta.id}" is not a valid clip id`);
    if (!isOwnerKey(meta.ownerKey)) throw new TypeError(`"${meta.ownerKey}" is not a valid owner key`);
    // Step 1: a bad mux stops here, before anything is written.
    const facts = await this.env.verify(bytes, expectedVideoSec);
    const base = {
      ...meta,
      bytes: bytes.length,
      durationMs: Math.round(facts.videoDurationSec * 1000),
      hasAudio: facts.hasAudio,
    };

    if (this.tier === "memory") return { ...this.saveMemory(bytes, base), problems: [] };

    let eviction: EvictionOutcome | null = null;
    const problems: string[] = [];
    try {
      eviction = await this.withLock(() => this.makeRoom(bytes.length));
    } catch (error) {
      if (isQuotaError(error)) throw this.quotaError(error);
      // The budget could not be read (for example IndexedDB failed). Keep going:
      // a write that really has no space still ends as a quota error.
      problems.push(`budget: ${errorText(error)}`);
    }
    if (this.tier === "opfs") {
      try {
        return { record: await this.saveOpfs(bytes, base, expectedVideoSec), eviction, problems };
      } catch (error) {
        if (isQuotaError(error)) throw this.quotaError(error);
        problems.push(`opfs: ${errorText(error)}`);
      }
    }
    try {
      return { record: await this.saveIdb(bytes, base, expectedVideoSec), eviction, problems };
    } catch (error) {
      if (isQuotaError(error)) throw this.quotaError(error);
      problems.push(`idb: ${errorText(error)}`);
    }
    const memory = this.saveMemory(bytes, base);
    return { record: memory.record, eviction: eviction ?? memory.eviction, problems };
  }

  /** The clip bytes as a File named for sharing. Throws LibraryError("not-found"). */
  async read(id: string): Promise<{ record: ClipRecord; file: File }> {
    const held = this.memory.get(id);
    if (held) return { record: held.record, file: toFile(held.blob, held.record) };
    const record = isClipId(id) && this.db ? await this.db.get(id) : undefined;
    if (!record) throw new LibraryError("not-found", `there is no clip "${id}"`);
    if (record.storage === "opfs") {
      if (!this.root) throw new LibraryError("opfs-unavailable", "OPFS is not available in this window");
      try {
        const dir = await this.ownerDir(record.ownerKey, false);
        const handle = await dir.getFileHandle(`${id}.mp4`);
        return { record, file: toFile(await handle.getFile(), record) };
      } catch (error) {
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
    if (this.memory.delete(id)) return true;
    const db = this.db;
    if (!db || !isClipId(id)) return false;
    return this.withLock(async () => {
      const record = await db.get(id);
      if (!record) return false;
      await this.deleteStored(record);
      this.post({ removed: id });
      return true;
    });
  }

  /** One player's clips, newest first. */
  async list(ownerKey: string): Promise<ClipRecord[]> {
    const rows = this.db ? await this.db.listByOwner(ownerKey) : [];
    const held = [...this.memory.values()].map((entry) => entry.record).filter((record) => record.ownerKey === ownerKey);
    return [...rows, ...held].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  }

  /** The budget in bytes (null when unknown) and the bytes the stored clips use. */
  async budget(): Promise<{ budgetBytes: number | null; usedBytes: number }> {
    if (this.tier === "memory") {
      return {
        budgetBytes: this.env.memoryBudgetBytes,
        usedBytes: sumBytes([...this.memory.values()].map((entry) => entry.record)),
      };
    }
    const rows = await this.storedRows();
    return { budgetBytes: await this.persistentBudget(rows), usedBytes: sumBytes(rows) };
  }

  /**
   * Startup check (plan 8.1):
   * - a file without a row gets a new row (kind "clip", so it is never auto-removed);
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
  // Tiers
  // -------------------------------------------------------------------------

  private async saveOpfs(bytes: Uint8Array, base: Omit<ClipRecord, "storage">, expectedVideoSec: number): Promise<ClipRecord> {
    const root = this.root!;
    const db = this.db!;
    const name = `${base.id}.mp4`;
    const tmpDir = await root.getDirectoryHandle(TMP_DIR, { create: true });
    const tmp = await tmpDir.getFileHandle(name, { create: true });
    try {
      await writeWholeFile(tmp, bytes);
      const written = await tmp.getFile();
      if (written.size !== bytes.length) {
        throw new LibraryError("verify-failed", `the temp file has ${written.size} bytes, expected ${bytes.length}`);
      }
      await this.env.verify(written, expectedVideoSec);
      const record: ClipRecord = { ...base, storage: "opfs" };
      await this.withLock(async () => {
        const dir = await this.ownerDir(record.ownerKey, true);
        await moveFile(tmp, tmpDir, name, dir, name, bytes);
        try {
          await db.put(record);
        } catch (error) {
          await dir.removeEntry(name).catch(() => undefined);
          throw error;
        }
      });
      this.post({ added: record.id });
      return record;
    } catch (error) {
      await tmpDir.removeEntry(name).catch(() => undefined);
      throw error;
    }
  }

  private async saveIdb(bytes: Uint8Array, base: Omit<ClipRecord, "storage">, expectedVideoSec: number): Promise<ClipRecord> {
    const db = this.db!;
    const record: ClipRecord = { ...base, storage: "idb" };
    await this.withLock(async () => {
      try {
        await db.putChunks(record.id, bytes, this.env.chunkBytes);
        const chunks = await db.getChunks(record.id);
        if (!chunks) throw new LibraryError("verify-failed", "the stored chunks are not complete");
        await this.env.verify(new Blob(chunks), expectedVideoSec);
        await db.put(record);
      } catch (error) {
        await db.deleteChunks(record.id).catch(() => undefined);
        throw error;
      }
    });
    this.post({ added: record.id });
    return record;
  }

  private saveMemory(bytes: Uint8Array, base: Omit<ClipRecord, "storage">): { record: ClipRecord; eviction: EvictionOutcome | null } {
    const held = [...this.memory.values()].map((entry) => entry.record);
    const plan = planEviction(held, this.env.memoryBudgetBytes, bytes.length);
    if (!plan.fits) {
      throw new LibraryError(
        "quota",
        `the clip needs ${bytes.length} bytes; clips in memory use ${plan.usedBytes} of ${plan.budgetBytes}`,
      );
    }
    for (const record of plan.remove) this.memory.delete(record.id);
    const record: ClipRecord = { ...base, storage: "memory" };
    this.memory.set(record.id, { record, blob: new Blob([asArrayBufferBytes(bytes)], { type: record.mime }) });
    // Memory clips live in this worker only, so other tabs get no message.
    const eviction = plan.remove.length
      ? { kept: plan.keep.map((kept) => kept.id), removed: plan.remove.map((removed) => removed.id) }
      : null;
    return { record, eviction };
  }

  // -------------------------------------------------------------------------
  // Budget and eviction
  // -------------------------------------------------------------------------

  private async storedRows(): Promise<ClipRecord[]> {
    if (!this.db) return [];
    return (await this.db.listAll()).filter((row) => row.storage === "opfs" || row.storage === "idb");
  }

  private async persistentBudget(rows: ClipRecord[]): Promise<number | null> {
    const storage = this.env.storage;
    const estimate = typeof storage?.estimate === "function" ? await storage.estimate().catch(() => null) : null;
    if (estimate && typeof estimate.quota === "number" && estimate.quota > 0) return budgetFromQuota(estimate.quota);
    if (!this.root) return null;
    const now = this.env.now();
    if (!this.probe || now - this.probe.at > PROBE_CACHE_MS) {
      const tmpDir = await this.root.getDirectoryHandle(TMP_DIR, { create: true });
      this.probe = { at: now, free: await probeFreeBytes(tmpDir) };
    }
    if (this.probe.free === null) return null;
    // The quota is about the space in use plus the free space. Only the library's
    // own bytes are known, so this estimate is low, which is the safe side.
    return budgetFromQuota(sumBytes(rows) + this.probe.free);
  }

  /** Runs under the library lock. Removes clips only when the new clip does not fit. */
  private async makeRoom(neededBytes: number): Promise<EvictionOutcome | null> {
    const rows = await this.storedRows();
    const budget = await this.persistentBudget(rows);
    if (budget === null) return null;
    const plan = planEviction(rows, budget, neededBytes);
    if (!plan.fits) {
      throw new LibraryError(
        "quota",
        `the clip needs ${neededBytes} bytes; the library uses ${plan.usedBytes} of its ${budget} byte budget`,
      );
    }
    if (plan.remove.length === 0) return null;
    for (const record of plan.remove) {
      await this.deleteStored(record);
      this.post({ removed: record.id });
    }
    return { kept: plan.keep.map((record) => record.id), removed: plan.remove.map((record) => record.id) };
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

  private async ownerDir(ownerKey: string, create: boolean): Promise<DirectoryHandleLike> {
    if (!isOwnerKey(ownerKey)) throw new TypeError(`"${ownerKey}" is not a valid owner key`);
    const lib = await this.root!.getDirectoryHandle(LIB_DIR, { create });
    return lib.getDirectoryHandle(ownerKey, { create });
  }

  /** Removes a stored clip's bytes and row. The caller holds the library lock. */
  private async deleteStored(record: ClipRecord): Promise<void> {
    const db = this.db!;
    if (record.storage === "opfs") {
      if (!this.root) throw new LibraryError("opfs-unavailable", "OPFS is not available, so the file cannot be removed");
      try {
        const dir = await this.ownerDir(record.ownerKey, false);
        await dir.removeEntry(`${record.id}.mp4`);
      } catch (error) {
        if (!isNotFoundError(error)) throw new LibraryError("opfs-unavailable", errorText(error));
      }
    } else if (record.storage === "idb") {
      await db.deleteChunks(record.id);
    }
    await db.delete(record.id);
  }

  private async reconcileFiles(
    db: ClipsDb,
    byId: Map<string, ClipRecord>,
    filesSeen: Set<string>,
    result: ReconcileResult,
  ): Promise<void> {
    const lib = await this.root!.getDirectoryHandle(LIB_DIR, { create: true });
    // Collect first: changing a folder while it is iterated is not defined.
    for (const [ownerName, ownerHandle] of await collect(lib.entries())) {
      if (ownerHandle.kind !== "directory" || !isOwnerKey(ownerName)) continue;
      for (const [name, handle] of await collect(ownerHandle.entries())) {
        if (handle.kind !== "file") continue;
        const id = clipIdFromFileName(name);
        if (!id) continue;
        try {
          const row = byId.get(id);
          if (row && row.storage === "opfs") {
            filesSeen.add(id);
            if (row.ownerKey !== ownerName) {
              await moveFile(handle, ownerHandle, name, await this.ownerDir(row.ownerKey, true), name);
              result.relocated++;
            }
            continue;
          }
          if (row) {
            // The row keeps its bytes in another tier. This file is a stray copy.
            await ownerHandle.removeEntry(name);
            continue;
          }
          const file = await handle.getFile();
          const record = await this.reindex(id, ownerName, file);
          if (record) {
            await db.put(record);
            byId.set(id, record);
            filesSeen.add(id);
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

  private async reindex(id: string, ownerKey: string, file: File): Promise<ClipRecord | null> {
    let facts: ClipInspection;
    try {
      facts = await this.env.inspect(file);
    } catch {
      return null;
    }
    if (!facts.firstVideoIsKey || !(facts.videoDurationSec > 0)) return null;
    return {
      id,
      ownerKey,
      gameId: "unknown",
      // "clip" is never removed automatically, which is the safe choice for a clip
      // whose kind is not known.
      kind: "clip",
      createdAt: file.lastModified || this.env.now(),
      durationMs: Math.round(facts.videoDurationSec * 1000),
      width: facts.width,
      height: facts.height,
      fps: Math.round(facts.fps),
      hasAudio: facts.hasAudio,
      mime: "video/mp4",
      bytes: file.size,
      kept: false,
      // Not watched, so it shows as NEW and the kid sees that it came back.
      watched: false,
      storage: "opfs",
      posterDataUrl: await this.env.posterFromFile(file),
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
        if (name !== PROBE_FILE_NAME) result.staleTemp++;
      } catch {
        // A live write holds the file. It is not stale.
      }
    }
  }
}
