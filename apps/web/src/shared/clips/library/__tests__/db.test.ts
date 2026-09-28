// @vitest-environment node
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ClipRecord } from "../../protocol";
import {
  CHUNKS_STORE,
  CLIPS_DB_NAME,
  CLIPS_DB_VERSION,
  CLIPS_STORE,
  type ClipsDb,
  OWNER_CREATED_INDEX,
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
