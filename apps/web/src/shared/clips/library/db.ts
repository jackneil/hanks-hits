/**
 * IndexedDB for the clip library (plan 8.1).
 *
 * Database "hh-clips", version 1:
 * - "clips": one ClipRecord row per clip, key "id", index "ownerKey_createdAt" on
 *   [ownerKey, createdAt] for the per-player list.
 * - "chunks": clip bytes, only for clips on the IndexedDB fallback tier (when OPFS
 *   fails in a normal window). Key [id, n], one ArrayBuffer per chunk.
 *
 * The io worker is the only writer of rows. The UI changes rows with the "update"
 * command (protocol IoCmd), so every write holds the library lock.
 *
 * Lost connections: WebKit closes the IndexedDB connection of a tab in the
 * background, and every later call on that connection fails with "UnknownError:
 * Connection to Indexed Database server lost" (WebKit bug 273827; seen on iOS 26.4
 * and Safari 26). A retry on the same connection always fails. So when a call fails
 * that way (or the browser fires "close"), ClipsDb opens a new connection and runs
 * the call one more time. A transaction is atomic, so a second run is safe.
 *
 * Works in a window and in a worker. Nothing touches indexedDB at import time.
 */

import type { ClipRecord, ClipRecordPatch } from "../protocol";

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

/**
 * True for the errors of a connection that is gone: WebKit's "UnknownError" after it
 * drops a background tab's connection, and "InvalidStateError" from transaction() on
 * a connection that is closed.
 */
export function isLostConnectionError(error: unknown): boolean {
  const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
  return name === "UnknownError" || name === "InvalidStateError";
}

export class ClipsDb {
  private connection: IDBDatabase | null = null;
  private opening: Promise<IDBDatabase> | null = null;
  private closed = false;

  constructor(
    db: IDBDatabase,
    private readonly keyRange: typeof IDBKeyRange,
    /** Opens a new connection after the old one is lost. Null: no reconnect. */
    private readonly reopen: (() => Promise<IDBDatabase>) | null = null,
  ) {
    this.adopt(db);
  }

  private adopt(db: IDBDatabase): void {
    this.connection = db;
    // Let a future version upgrade in another tab go ahead. A later call then tries
    // to open version 1 again, which fails with VersionError: old code must reload.
    db.onversionchange = () => {
      db.close();
      this.forget(db);
    };
    // The browser closed the connection (for example WebKit in a background tab).
    db.onclose = () => this.forget(db);
  }

  private forget(db: IDBDatabase): void {
    if (this.connection === db) this.connection = null;
  }

  private current(): Promise<IDBDatabase> {
    if (this.closed) return Promise.reject(new DOMException("The clip database is closed.", "InvalidStateError"));
    if (this.connection) return Promise.resolve(this.connection);
    if (!this.reopen) return Promise.reject(new DOMException("The clip database connection is lost.", "InvalidStateError"));
    // One open at a time, so two calls never make two connections.
    this.opening ??= this.reopen()
      .then((db) => {
        if (this.closed) {
          db.close();
          throw new DOMException("The clip database is closed.", "InvalidStateError");
        }
        this.adopt(db);
        return db;
      })
      .finally(() => {
        this.opening = null;
      });
    return this.opening;
  }

  private async runOn<T>(
    db: IDBDatabase,
    stores: string | string[],
    mode: IDBTransactionMode,
    body: (tx: IDBTransaction) => Promise<T> | T,
  ): Promise<T> {
    const tx = db.transaction(stores, mode);
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

  private async run<T>(
    stores: string | string[],
    mode: IDBTransactionMode,
    body: (tx: IDBTransaction) => Promise<T> | T,
  ): Promise<T> {
    const first = await this.current();
    try {
      return await this.runOn(first, stores, mode, body);
    } catch (error) {
      if (!this.reopen || this.closed || !isLostConnectionError(error)) throw error;
      // The connection is gone. A retry on it always fails, so drop it and open a new one.
      try {
        first.close();
      } catch {
        // Already closed.
      }
      this.forget(first);
      return this.runOn(await this.current(), stores, mode, body);
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

  /**
   * Deletes a row only if it still passes `test`, in one transaction. Returns the
   * deleted row, or undefined when the row is gone or no longer passes. Eviction uses
   * it, so a clip that the kid kept a moment ago is never removed from an old list.
   */
  deleteIf(id: string, test: (record: ClipRecord) => boolean): Promise<ClipRecord | undefined> {
    return this.run(CLIPS_STORE, "readwrite", async (tx) => {
      const store = tx.objectStore(CLIPS_STORE);
      const current = (await request(store.get(id))) as ClipRecord | undefined;
      if (!current || !test(current)) return undefined;
      store.delete(id);
      return current;
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
        // A copy of each chunk: IndexedDB clones the whole buffer of a view.
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

  /** Closes the connection for good. No call opens it again. */
  close(): void {
    this.closed = true;
    this.connection?.close();
    this.connection = null;
  }

  private chunkRange(id: string): IDBKeyRange {
    return this.keyRange.bound([id, -Infinity], [id, Infinity]);
  }
}

function openConnection(factory: IDBFactory): Promise<IDBDatabase> {
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
    req.onsuccess = () => resolve(req.result);
  });
}

/**
 * Opens (and on first use, creates) the clip database. The ClipsDb opens a new
 * connection by itself when the browser drops this one.
 * Rejects when IndexedDB is missing or refuses to open (some private windows).
 */
export async function openClipsDb(
  factory: IDBFactory | null | undefined = globalThis.indexedDB,
  keyRange: typeof IDBKeyRange | null | undefined = globalThis.IDBKeyRange,
): Promise<ClipsDb> {
  if (!factory || !keyRange) throw new Error("IndexedDB is not available");
  const db = await openConnection(factory);
  return new ClipsDb(db, keyRange, () => openConnection(factory));
}
