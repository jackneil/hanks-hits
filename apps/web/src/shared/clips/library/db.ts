/**
 * IndexedDB for the clip library (plan 8.1).
 *
 * Database "hh-clips", version 1:
 * - "clips": one ClipRecord row per clip, key "id", index "ownerKey_createdAt" on
 *   [ownerKey, createdAt] for the per-player list.
 * - "chunks": clip bytes, only for clips on the IndexedDB fallback tier (when OPFS
 *   fails in a normal window). Key [id, n], one ArrayBuffer per chunk.
 *
 * Works in a window and in a worker. Nothing touches indexedDB at import time.
 */

import type { ClipRecord } from "../protocol";

export const CLIPS_DB_NAME = "hh-clips";
export const CLIPS_DB_VERSION = 1;
export const CLIPS_STORE = "clips";
export const CHUNKS_STORE = "chunks";
export const OWNER_CREATED_INDEX = "ownerKey_createdAt";
/** Chunk size for the IndexedDB tier. Smaller values keep each IndexedDB write small. */
export const DEFAULT_CHUNK_BYTES = 4 * 1024 * 1024;

interface ChunkRow {
  id: string;
  n: number;
  data: ArrayBuffer;
}

/** Fields that code outside the io worker may change on a row. */
export type ClipRecordPatch = Partial<Pick<ClipRecord, "kept" | "watched" | "moments" | "challengeScore" | "ownerKey">>;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export class ClipsDb {
  constructor(
    private readonly db: IDBDatabase,
    private readonly keyRange: typeof IDBKeyRange,
  ) {}

  private async run<T>(
    stores: string | string[],
    mode: IDBTransactionMode,
    body: (tx: IDBTransaction) => Promise<T> | T,
  ): Promise<T> {
    const tx = this.db.transaction(stores, mode);
    const done = transactionDone(tx);
    // The caller awaits `done` below. This handler only stops an early abort from
    // being reported as an unhandled rejection before that await.
    done.catch(() => undefined);
    try {
      const result = await body(tx);
      await done;
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // The transaction is already finished.
      }
      await done.catch(() => undefined);
      throw error;
    }
  }

  put(record: ClipRecord): Promise<void> {
    return this.run(CLIPS_STORE, "readwrite", (tx) => {
      tx.objectStore(CLIPS_STORE).put(record);
    });
  }

  get(id: string): Promise<ClipRecord | undefined> {
    return this.run(CLIPS_STORE, "readonly", (tx) => request(tx.objectStore(CLIPS_STORE).get(id)));
  }

  delete(id: string): Promise<void> {
    return this.run(CLIPS_STORE, "readwrite", (tx) => {
      tx.objectStore(CLIPS_STORE).delete(id);
    });
  }

  /** Changes some fields of one row in one transaction. Returns the new row, or undefined. */
  update(id: string, patch: ClipRecordPatch): Promise<ClipRecord | undefined> {
    return this.run(CLIPS_STORE, "readwrite", async (tx) => {
      const store = tx.objectStore(CLIPS_STORE);
      const current = (await request(store.get(id))) as ClipRecord | undefined;
      if (!current) return undefined;
      const next = { ...current, ...patch };
      store.put(next);
      return next;
    });
  }

  /** One player's rows, newest first. */
  listByOwner(ownerKey: string): Promise<ClipRecord[]> {
    return this.run(CLIPS_STORE, "readonly", async (tx) => {
      const range = this.keyRange.bound([ownerKey, -Infinity], [ownerKey, Infinity]);
      const rows = (await request(tx.objectStore(CLIPS_STORE).index(OWNER_CREATED_INDEX).getAll(range))) as ClipRecord[];
      return rows.reverse();
    });
  }

  listAll(): Promise<ClipRecord[]> {
    return this.run(CLIPS_STORE, "readonly", async (tx) => (await request(tx.objectStore(CLIPS_STORE).getAll())) as ClipRecord[]);
  }

  /** Stores clip bytes as chunks. Replaces chunks that the id had before. */
  putChunks(id: string, bytes: Uint8Array, chunkBytes = DEFAULT_CHUNK_BYTES): Promise<number> {
    if (!(chunkBytes > 0)) return Promise.reject(new RangeError(`chunk size ${chunkBytes} must be positive`));
    return this.run(CHUNKS_STORE, "readwrite", (tx) => {
      const store = tx.objectStore(CHUNKS_STORE);
      store.delete(this.chunkRange(id));
      let n = 0;
      for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
        const data = bytes.slice(offset, Math.min(bytes.length, offset + chunkBytes)).buffer;
        store.put({ id, n, data } satisfies ChunkRow);
        n++;
      }
      return n;
    });
  }

  /** The chunks of one clip in order, or null when the clip has no chunks. */
  getChunks(id: string): Promise<ArrayBuffer[] | null> {
    return this.run(CHUNKS_STORE, "readonly", async (tx) => {
      const rows = (await request(tx.objectStore(CHUNKS_STORE).getAll(this.chunkRange(id)))) as ChunkRow[];
      if (rows.length === 0) return null;
      rows.sort((a, b) => a.n - b.n);
      // A missing chunk number means the bytes are not complete.
      if (rows.some((row, i) => row.n !== i)) return null;
      return rows.map((row) => row.data);
    });
  }

  async hasChunks(id: string): Promise<boolean> {
    return this.run(CHUNKS_STORE, "readonly", async (tx) => (await request(tx.objectStore(CHUNKS_STORE).count(this.chunkRange(id)))) > 0);
  }

  deleteChunks(id: string): Promise<void> {
    return this.run(CHUNKS_STORE, "readwrite", (tx) => {
      tx.objectStore(CHUNKS_STORE).delete(this.chunkRange(id));
    });
  }

  /** Every clip id that has chunks. */
  chunkIds(): Promise<string[]> {
    return this.run(CHUNKS_STORE, "readonly", async (tx) => {
      const keys = (await request(tx.objectStore(CHUNKS_STORE).getAllKeys())) as unknown as Array<[string, number]>;
      return [...new Set(keys.map((key) => key[0]))];
    });
  }

  close(): void {
    this.db.close();
  }

  private chunkRange(id: string): IDBKeyRange {
    return this.keyRange.bound([id, -Infinity], [id, Infinity]);
  }
}

/**
 * Opens (and on first use, creates) the clip database.
 * Rejects when IndexedDB is missing or refuses to open (some private windows).
 */
export function openClipsDb(
  factory: IDBFactory | null | undefined = globalThis.indexedDB,
  keyRange: typeof IDBKeyRange | null | undefined = globalThis.IDBKeyRange,
): Promise<ClipsDb> {
  if (!factory || !keyRange) return Promise.reject(new Error("IndexedDB is not available"));
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = factory.open(CLIPS_DB_NAME, CLIPS_DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CLIPS_STORE)) {
        const clips = db.createObjectStore(CLIPS_STORE, { keyPath: "id" });
        clips.createIndex(OWNER_CREATED_INDEX, ["ownerKey", "createdAt"]);
      }
      if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
        db.createObjectStore(CHUNKS_STORE, { keyPath: ["id", "n"] });
      }
    };
    req.onblocked = () => reject(new Error("IndexedDB upgrade is blocked by another tab"));
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onsuccess = () => {
      const db = req.result;
      // Let a future version upgrade in another tab go ahead.
      db.onversionchange = () => db.close();
      resolve(new ClipsDb(db, keyRange));
    };
  });
}
