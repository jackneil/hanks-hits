// @vitest-environment node
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ClipRecord } from "../../protocol";
import {
  CHUNKS_STORE,
  CLIPS_DB_NAME,
  CLIPS_DB_VERSION,
  CLIPS_STORE,
  ClipsDb as ClipsDbClass,
  type ClipsDb,
  OWNER_CREATED_INDEX,
  isLostConnectionError,
  openClipsDb,
} from "../db";

function row(id: string, ownerKey: string, createdAt: number, overrides: Partial<ClipRecord> = {}): ClipRecord {
  return {
    id,
    ownerKey,
    gameId: "snake",
    kind: "clip",
    createdAt,
    durationMs: 1000,
    width: 720,
    height: 1280,
    fps: 30,
    hasAudio: true,
    mime: "video/mp4",
    bytes: 10,
    kept: false,
    watched: false,
    storage: "opfs",
    posterDataUrl: "data:image/jpeg;base64,AA==",
    moments: [],
    ...overrides,
  };
}

let factory: IDBFactory;
let db: ClipsDb;

beforeEach(async () => {
  factory = new IDBFactory();
  db = await openClipsDb(factory, IDBKeyRange);
});

afterEach(() => {
  db.close();
});

describe("openClipsDb", () => {
  it("creates version 1 with the clips store, its owner index, and the chunks store", async () => {
    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(CLIPS_DB_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    expect(CLIPS_DB_NAME).toBe("hh-clips");
    expect(raw.version).toBe(CLIPS_DB_VERSION);
    expect(CLIPS_DB_VERSION).toBe(1);
    expect([...raw.objectStoreNames].sort()).toEqual([CHUNKS_STORE, CLIPS_STORE].sort());
    const tx = raw.transaction([CLIPS_STORE, CHUNKS_STORE]);
    const clips = tx.objectStore(CLIPS_STORE);
    expect(clips.keyPath).toBe("id");
    expect(clips.index(OWNER_CREATED_INDEX).keyPath).toEqual(["ownerKey", "createdAt"]);
    expect(tx.objectStore(CHUNKS_STORE).keyPath).toEqual(["id", "n"]);
    raw.close();
  });

  it("opens an existing database without changing it", async () => {
    await db.put(row("a", "guest", 1));
    db.close();
    db = await openClipsDb(factory, IDBKeyRange);
    expect(await db.get("a")).toMatchObject({ id: "a" });
  });

  it("rejects when IndexedDB is missing", async () => {
    await expect(openClipsDb(null, IDBKeyRange)).rejects.toThrow(/not available/);
    await expect(openClipsDb(factory, null)).rejects.toThrow(/not available/);
  });

  it("rejects when open throws (a private window that blocks IndexedDB)", async () => {
    const blocked = { open: () => { throw new DOMException("blocked", "InvalidStateError"); } } as unknown as IDBFactory;
    await expect(openClipsDb(blocked, IDBKeyRange)).rejects.toThrow("blocked");
  });
});

describe("rows", () => {
  it("puts, gets, replaces and deletes a row", async () => {
    await db.put(row("a", "guest", 1));
    expect(await db.get("a")).toEqual(row("a", "guest", 1));
    await db.put(row("a", "guest", 1, { kept: true }));
    expect((await db.get("a"))?.kept).toBe(true);
    await db.delete("a");
    expect(await db.get("a")).toBeUndefined();
  });

  it("updates chosen fields in one transaction", async () => {
    await db.put(row("a", "guest", 1));
    const next = await db.update("a", { watched: true, kept: true });
    expect(next).toMatchObject({ watched: true, kept: true, gameId: "snake" });
    expect(await db.get("a")).toEqual(next);
    expect(await db.update("missing", { kept: true })).toBeUndefined();
  });

  it("deleteIf deletes a row only when it still passes the test, in one transaction", async () => {
    await db.put(row("a", "guest", 1, { kind: "auto", watched: true }));
    await db.put(row("b", "guest", 2, { kind: "auto", watched: true, kept: true }));
    const evictable = (record: ClipRecord) => record.kind === "auto" && !record.kept && record.watched;
    expect(await db.deleteIf("b", evictable)).toBeUndefined();
    expect(await db.get("b")).toBeTruthy();
    expect(await db.deleteIf("a", evictable)).toMatchObject({ id: "a" });
    expect(await db.get("a")).toBeUndefined();
    expect(await db.deleteIf("a", evictable)).toBeUndefined();
  });

  it("lists one owner's rows, newest first, and never another owner's", async () => {
    await db.put(row("old", "guest", 100));
    await db.put(row("new", "guest", 300));
    await db.put(row("mid", "guest", 200));
    await db.put(row("other", "u_0123456789abcdef0123", 250));
    expect((await db.listByOwner("guest")).map((r) => r.id)).toEqual(["new", "mid", "old"]);
    expect((await db.listByOwner("u_0123456789abcdef0123")).map((r) => r.id)).toEqual(["other"]);
    expect(await db.listByOwner("u_ffffffffffffffffffff")).toEqual([]);
    expect((await db.listAll()).length).toBe(4);
  });
});

describe("chunks", () => {
  const bytes = new Uint8Array(10_000).map((_, i) => (i * 7) & 0xff);

  it("stores bytes in chunks and reads them back in order", async () => {
    expect(await db.putChunks("a", bytes, 4096)).toBe(3);
    const chunks = (await db.getChunks("a"))!;
    expect(chunks.map((chunk) => chunk.byteLength)).toEqual([4096, 4096, 1808]);
    const joined = new Uint8Array(await new Blob(chunks).arrayBuffer());
    expect(joined).toEqual(bytes);
    expect(await db.hasChunks("a")).toBe(true);
  });

  it("replaces the old chunks of the same id", async () => {
    await db.putChunks("a", bytes, 1000);
    await db.putChunks("a", bytes.subarray(0, 50), 1000);
    const chunks = (await db.getChunks("a"))!;
    expect(chunks.length).toBe(1);
    expect(chunks[0].byteLength).toBe(50);
  });

  it("keeps ids apart, even when one id is a prefix of another", async () => {
    await db.putChunks("a", new Uint8Array([1]), 10);
    await db.putChunks("ab", new Uint8Array([2]), 10);
    expect(new Uint8Array((await db.getChunks("a"))![0])).toEqual(new Uint8Array([1]));
    expect((await db.chunkIds()).sort()).toEqual(["a", "ab"]);
    await db.deleteChunks("a");
    expect(await db.getChunks("a")).toBeNull();
    expect(await db.hasChunks("a")).toBe(false);
    expect(await db.hasChunks("ab")).toBe(true);
  });

  it("returns null when a chunk in the middle is missing", async () => {
    await db.putChunks("a", bytes, 4096);
    const raw = await new Promise<IDBDatabase>((resolve) => {
      const req = factory.open(CLIPS_DB_NAME);
      req.onsuccess = () => resolve(req.result);
    });
    await new Promise<void>((resolve) => {
      const tx = raw.transaction(CHUNKS_STORE, "readwrite");
      tx.objectStore(CHUNKS_STORE).delete(["a", 1]);
      tx.oncomplete = () => resolve();
    });
    raw.close();
    expect(await db.getChunks("a")).toBeNull();
  });

  it("refuses a chunk size that is not positive", async () => {
    await expect(db.putChunks("a", bytes, 0)).rejects.toThrow(RangeError);
    await expect(db.putChunks("a", bytes, Number.NaN)).rejects.toThrow(RangeError);
  });

  it("stores an empty clip as no chunks", async () => {
    expect(await db.putChunks("a", new Uint8Array(0))).toBe(0);
    expect(await db.getChunks("a")).toBeNull();
  });
});

/**
 * WebKit drops the IndexedDB connection of a tab in the background. Every later call
 * on it fails with "UnknownError: Connection to Indexed Database server lost", also a
 * retry (WebKit bug 273827; iOS 26.4 and Safari 26 field data). ClipsDb must open a
 * new connection and run the call again.
 */
describe("lost connections", () => {
  it("knows the errors of a lost connection", () => {
    expect(isLostConnectionError(new DOMException("x", "UnknownError"))).toBe(true);
    expect(isLostConnectionError(new DOMException("x", "InvalidStateError"))).toBe(true);
    expect(isLostConnectionError(new DOMException("x", "DataError"))).toBe(false);
    expect(isLostConnectionError(new DOMException("x", "QuotaExceededError"))).toBe(false);
    expect(isLostConnectionError(null)).toBe(false);
  });

  const LOST = () => new DOMException("Connection to Indexed Database server lost. Refresh the page to try again", "UnknownError");

  /** A factory that records every connection it opens. */
  function recordingFactory(base: IDBFactory): { factory: IDBFactory; opened: IDBDatabase[]; fail: { next: boolean } } {
    const opened: IDBDatabase[] = [];
    const fail = { next: false };
    const factory = {
      open(name: string, version?: number) {
        if (fail.next) {
          fail.next = false;
          throw new DOMException("open failed (test)", "UnknownError");
        }
        const req = base.open(name, version);
        req.addEventListener("success", () => opened.push(req.result));
        return req;
      },
    } as unknown as IDBFactory;
    return { factory, opened, fail };
  }

  let lost: ClipsDb | null = null;
  afterEach(() => {
    lost?.close();
    lost = null;
  });

  it("opens a new connection after WebKit's UnknownError, and never retries on the dead one", async () => {
    const { factory: wrapped, opened } = recordingFactory(factory);
    lost = await openClipsDb(wrapped, IDBKeyRange);
    await lost.put(row("a", "guest", 1));
    let deadCalls = 0;
    opened[0].transaction = (() => {
      deadCalls++;
      throw LOST();
    }) as IDBDatabase["transaction"];
    await lost.put(row("b", "guest", 2));
    expect(await lost.get("a")).toMatchObject({ id: "a" });
    expect(await lost.get("b")).toMatchObject({ id: "b" });
    expect(opened.length).toBe(2);
    expect(deadCalls).toBe(1);
  });

  it("opens a new connection when the old one is closed under it (InvalidStateError)", async () => {
    const { factory: wrapped, opened } = recordingFactory(factory);
    lost = await openClipsDb(wrapped, IDBKeyRange);
    await lost.put(row("a", "guest", 1));
    opened[0].close();
    expect(await lost.listAll()).toHaveLength(1);
    expect(opened.length).toBe(2);
  });

  it("opens a new connection at once after the browser's close event", async () => {
    const { factory: wrapped, opened } = recordingFactory(factory);
    lost = await openClipsDb(wrapped, IDBKeyRange);
    let deadCalls = 0;
    const dead = opened[0];
    const original = dead.transaction.bind(dead);
    dead.transaction = ((...args: Parameters<IDBDatabase["transaction"]>) => {
      deadCalls++;
      return original(...args);
    }) as IDBDatabase["transaction"];
    dead.close();
    dead.onclose?.call(dead, new Event("close"));
    await lost.put(row("a", "guest", 1));
    expect(deadCalls).toBe(0);
    expect(opened.length).toBe(2);
  });

  it("makes only one new connection for calls that arrive together", async () => {
    const { factory: wrapped, opened } = recordingFactory(factory);
    lost = await openClipsDb(wrapped, IDBKeyRange);
    opened[0].close();
    opened[0].onclose?.call(opened[0], new Event("close"));
    await Promise.all([lost.put(row("a", "guest", 1)), lost.put(row("b", "guest", 2)), lost.listAll()]);
    expect(opened.length).toBe(2);
    expect((await lost.listAll()).length).toBe(2);
  });

  it("fails the call when the new connection cannot open either", async () => {
    const { factory: wrapped, opened, fail } = recordingFactory(factory);
    lost = await openClipsDb(wrapped, IDBKeyRange);
    opened[0].transaction = (() => {
      throw LOST();
    }) as IDBDatabase["transaction"];
    fail.next = true;
    await expect(lost.get("a")).rejects.toMatchObject({ name: "UnknownError" });
    // The next call tries again and works.
    await lost.put(row("a", "guest", 1));
    expect(await lost.get("a")).toMatchObject({ id: "a" });
  });

  it("does not retry an error that is not a lost connection", async () => {
    const { factory: wrapped, opened } = recordingFactory(factory);
    lost = await openClipsDb(wrapped, IDBKeyRange);
    await expect(lost.put({ ...row("a", "guest", 1), id: undefined as unknown as string })).rejects.toMatchObject({ name: "DataError" });
    expect(opened.length).toBe(1);
  });

  it("never opens again after close()", async () => {
    const { factory: wrapped, opened } = recordingFactory(factory);
    lost = await openClipsDb(wrapped, IDBKeyRange);
    lost.close();
    await expect(lost.get("a")).rejects.toMatchObject({ name: "InvalidStateError" });
    expect(opened.length).toBe(1);
  });

  it("lets a newer version in another tab go ahead; this old code then fails with VersionError", async () => {
    lost = await openClipsDb(factory, IDBKeyRange);
    db.close();
    await new Promise<void>((resolve, reject) => {
      const req = factory.open(CLIPS_DB_NAME, CLIPS_DB_VERSION + 1);
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("blocked: the old connection did not close"));
    });
    await expect(lost.get("a")).rejects.toMatchObject({ name: "VersionError" });
  });

  it("without a reopen function, a lost connection fails the call", async () => {
    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(CLIPS_DB_NAME, CLIPS_DB_VERSION);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    lost = new ClipsDbClass(raw, IDBKeyRange);
    raw.close();
    await expect(lost.get("a")).rejects.toMatchObject({ name: "InvalidStateError" });
  });
});
