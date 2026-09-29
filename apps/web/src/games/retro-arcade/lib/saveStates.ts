/**
 * Save states of the Retro Arcade, kept on this device only.
 *
 * A save state is a snapshot of the whole console (a Game Boy state is about
 * 200 KB, a Nintendo 64 state is about 16 MB). The states are binary Blobs in
 * IndexedDB. They never go into localStorage and never go into the cloud
 * progress: they are too large for the 1 MB progress limit, and each upload
 * would cost the server money.
 *
 * Each record belongs to one owner (see ownerKey.ts): "guest", or "u_" + a
 * hash of the signed-in user id. A read always names the owner, so a kid on a
 * shared iPad never loads the save of another account.
 *
 * Each game keeps two slots: "auto" (the moment the kid left the game) and
 * "manual" (the Save State button). A new save replaces the old one in the
 * same slot.
 *
 * Battery saves (the in-game save of a cartridge) are a different thing.
 * EmulatorJS keeps them in its own IndexedDB and this file does not touch
 * them.
 */

import { isOwnerKey } from "./ownerKey";

export type SaveSlot = "auto" | "manual";
export const SAVE_SLOTS: readonly SaveSlot[] = ["auto", "manual"];

export const SAVE_DB_NAME = "hh-retro-arcade-saves";
export const SAVE_DB_VERSION = 1;
const STORE = "states";
const OWNER_INDEX = "owner";

/** What a save names about its game. */
export interface SaveMeta {
  gameId: string;
  name: string;
  system: string;
}

/** One stored record. `data` is a Blob, or an ArrayBuffer after the WebKit fallback. */
interface SaveRecord {
  owner: string;
  gameId: string;
  slot: SaveSlot;
  name: string;
  system: string;
  data: Blob | ArrayBuffer;
  bytes: number;
  savedAt: number;
}

/** One game in the list of saves of an owner. */
export interface SavedGame {
  gameId: string;
  name: string;
  system: string;
  /** The size of all the slots of the game, in bytes. */
  bytes: number;
  /** The time of the newest slot. */
  savedAt: number;
  slots: SaveSlot[];
}

/**
 * Why a save operation failed:
 * - quota: the device has no more space for this site.
 * - write: IndexedDB did not keep the save for another reason.
 * - read: IndexedDB did not give back a save.
 * - unavailable: this browser has no IndexedDB.
 */
export type SaveStateErrorKind = "quota" | "write" | "read" | "unavailable";

export class SaveStateError extends Error {
  readonly kind: SaveStateErrorKind;
  readonly cause?: unknown;

  constructor(kind: SaveStateErrorKind, cause?: unknown) {
    super(`Retro Arcade save state ${kind} error`);
    this.name = "SaveStateError";
    this.kind = kind;
    this.cause = cause;
  }
}

/** True when an error from IndexedDB means "no more space". */
export function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  // 22 is the legacy DOMException code of QuotaExceededError; Firefox uses
  // NS_ERROR_DOM_QUOTA_REACHED (code 1014) in some versions.
  return (
    name === "QuotaExceededError" ||
    name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    code === 22 ||
    code === 1014
  );
}

function isBlobLike(value: unknown): value is Blob {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Blob).arrayBuffer === "function" &&
    typeof (value as Blob).size === "number"
  );
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

function checkKey(owner: string, gameId: string) {
  if (!isOwnerKey(owner)) throw new TypeError("not an owner key");
  if (typeof gameId !== "string" || gameId.length === 0) throw new TypeError("no game id");
}

function checkSlot(slot: SaveSlot) {
  if (!SAVE_SLOTS.includes(slot)) throw new TypeError("not a save slot");
}

export interface SaveStateStore {
  /** Keeps a state in a slot. Rejects with a SaveStateError. */
  put(owner: string, meta: SaveMeta, slot: SaveSlot, data: ArrayBuffer | Blob): Promise<void>;
  /** The bytes of a slot, or null when the slot is empty. Rejects with a SaveStateError. */
  get(owner: string, gameId: string, slot: SaveSlot): Promise<ArrayBuffer | null>;
  /** The games that have a save for this owner, newest first. Rejects with a SaveStateError. */
  list(owner: string): Promise<SavedGame[]>;
  /** Deletes both slots of a game for this owner. Rejects with a SaveStateError. */
  remove(owner: string, gameId: string): Promise<void>;
  /** Closes the connection. The next call opens a new one. */
  close(): void;
}

/**
 * Makes a save-state store on an IndexedDB factory. The app uses the default
 * store below; tests give a fake factory.
 */
export function createSaveStateStore(
  getFactory: () => IDBFactory | undefined = () => globalThis.indexedDB
): SaveStateStore {
  let dbPromise: Promise<IDBDatabase> | null = null;

  function forget(promise: Promise<IDBDatabase>) {
    if (dbPromise === promise) dbPromise = null;
  }

  function open(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    const factory = getFactory();
    if (!factory) return Promise.reject(new SaveStateError("unavailable"));
    const promise = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = factory.open(SAVE_DB_NAME, SAVE_DB_VERSION);
      } catch (error) {
        reject(error);
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: ["owner", "gameId", "slot"] });
          store.createIndex(OWNER_INDEX, "owner", { unique: false });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        // Another tab opened a newer version, or the browser closed the
        // connection (WebKit does this to a background tab). Forget the
        // connection, so the next call opens a new one.
        db.onversionchange = () => {
          db.close();
          forget(promise);
        };
        db.onclose = () => forget(promise);
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    });
    dbPromise = promise;
    promise.catch(() => forget(promise));
    return promise;
  }

  function reset() {
    const current = dbPromise;
    dbPromise = null;
    current?.then((db) => db.close()).catch(() => {});
  }

  /** Runs one transaction. Resolves when the transaction completes. */
  async function transact<T>(
    mode: IDBTransactionMode,
    body: (store: IDBObjectStore, done: (value: T) => void) => void
  ): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      let result: T | undefined;
      let tx: IDBTransaction;
      try {
        tx = db.transaction(STORE, mode);
        tx.oncomplete = () => resolve(result as T);
        tx.onabort = () => reject(tx.error ?? new DOMException("The transaction stopped", "AbortError"));
        body(tx.objectStore(STORE), (value) => {
          result = value;
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Runs an operation, and once more on a new connection when it fails. A
   * quota error is final. WebKit drops the connection of a background tab
   * (bug 273827), and sometimes cannot store a Blob ("Error preparing
   * Blob/File data to be stored in object store"), so the second attempt
   * gets the attempt number and can store the bytes another way.
   */
  async function withRetry<T>(operation: (attempt: number) => Promise<T>): Promise<T> {
    try {
      return await operation(0);
    } catch (error) {
      if (isQuotaError(error) || error instanceof SaveStateError) throw error;
      reset();
      return operation(1);
    }
  }

  return {
    async put(owner, meta, slot, data) {
      checkKey(owner, meta.gameId);
      checkSlot(slot);
      const bytes = isBlobLike(data) ? data.size : data.byteLength;
      // An empty state would load as a crash. It is never kept.
      if (!bytes) throw new SaveStateError("write", new Error("empty save state"));
      const blob = isBlobLike(data) ? data : new Blob([data], { type: "application/octet-stream" });
      const record = (payload: Blob | ArrayBuffer): SaveRecord => ({
        owner,
        gameId: meta.gameId,
        slot,
        name: meta.name,
        system: meta.system,
        data: payload,
        bytes,
        savedAt: Date.now(),
      });
      try {
        await withRetry(async (attempt) => {
          // The second attempt keeps the bytes as an ArrayBuffer, which
          // every IndexedDB can store.
          const payload = attempt === 0 ? blob : await blob.arrayBuffer();
          await transact<void>("readwrite", (store) => {
            store.put(record(payload));
          });
        });
      } catch (error) {
        if (error instanceof SaveStateError) throw error;
        throw new SaveStateError(isQuotaError(error) ? "quota" : "write", error);
      }
    },

    async get(owner, gameId, slot) {
      checkKey(owner, gameId);
      checkSlot(slot);
      try {
        const record = await withRetry(() =>
          transact<SaveRecord | undefined>("readonly", (store, done) => {
            const request = store.get([owner, gameId, slot]);
            request.onsuccess = () => done(request.result as SaveRecord | undefined);
          })
        );
        if (!record || record.owner !== owner) return null;
        if (isBlobLike(record.data)) return await record.data.arrayBuffer();
        if (isArrayBuffer(record.data)) return record.data;
        return null;
      } catch (error) {
        if (error instanceof SaveStateError) throw error;
        throw new SaveStateError("read", error);
      }
    },

    async list(owner) {
      if (!isOwnerKey(owner)) throw new TypeError("not an owner key");
      let records: SaveRecord[];
      try {
        records = await withRetry(() =>
          transact<SaveRecord[]>("readonly", (store, done) => {
            const request = store.index(OWNER_INDEX).getAll(owner);
            request.onsuccess = () => done(request.result as SaveRecord[]);
          })
        );
      } catch (error) {
        if (error instanceof SaveStateError) throw error;
        throw new SaveStateError("read", error);
      }
      const games = new Map<string, SavedGame>();
      for (const record of records) {
        if (record.owner !== owner) continue;
        const game = games.get(record.gameId);
        if (!game) {
          games.set(record.gameId, {
            gameId: record.gameId,
            name: record.name,
            system: record.system,
            bytes: record.bytes,
            savedAt: record.savedAt,
            slots: [record.slot],
          });
          continue;
        }
        game.bytes += record.bytes;
        game.slots.push(record.slot);
        if (record.savedAt > game.savedAt) {
          game.savedAt = record.savedAt;
          game.name = record.name;
          game.system = record.system;
        }
      }
      return [...games.values()].sort((a, b) => b.savedAt - a.savedAt);
    },

    async remove(owner, gameId) {
      checkKey(owner, gameId);
      try {
        await withRetry(() =>
          transact<void>("readwrite", (store) => {
            for (const slot of SAVE_SLOTS) store.delete([owner, gameId, slot]);
          })
        );
      } catch (error) {
        if (error instanceof SaveStateError) throw error;
        throw new SaveStateError("write", error);
      }
    },

    close() {
      reset();
    },
  };
}

/** The store that the Retro Arcade uses. It opens IndexedDB on first use. */
export const saveStateStore: SaveStateStore = createSaveStateStore();
