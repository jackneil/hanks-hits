import { Blob as NodeBlob } from "node:buffer";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { IDBDatabase, IDBFactory, IDBObjectStore } from "fake-indexeddb";

import {
  createSaveStateStore,
  isQuotaError,
  SAVE_DB_NAME,
  SaveStateError,
  type SaveStateStore,
} from "../lib/saveStates";

const GUEST = "guest";
const HANK = "u_0123456789abcdef0123";
const SISTER = "u_fedcba9876543210fedc";
const TETRIS = { gameId: "gb-tetris.gb", name: "tetris.gb", system: "gb" };
const MARIO = { gameId: "snes-Super Mario World", name: "Super Mario World", system: "snes" };

function pattern(length: number, seed = 7): ArrayBuffer {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = (i * 31 + seed) & 0xff;
  return bytes.buffer;
}

function sameBytes(a: ArrayBuffer | null, b: ArrayBuffer): boolean {
  if (!a || a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

// fake-indexeddb copies each value with structuredClone, like a browser.
// The jsdom Blob is a plain script object that structuredClone cannot copy,
// so this file uses the real Blob of Node (the browser Blob works the same).
const jsdomBlob = globalThis.Blob;
beforeAll(() => {
  globalThis.Blob = NodeBlob as unknown as typeof Blob;
});
afterAll(() => {
  globalThis.Blob = jsdomBlob;
});

let stores: SaveStateStore[] = [];
function freshStore() {
  const factory = new IDBFactory();
  const store = createSaveStateStore(() => factory);
  stores.push(store);
  return { store, factory };
}

afterEach(() => {
  for (const store of stores) store.close();
  stores = [];
  vi.restoreAllMocks();
});

describe("save states in IndexedDB", () => {
  it("keeps a 16 MB state as a Blob and gives back the same bytes", async () => {
    const { store, factory } = freshStore();
    const state = pattern(16 * 1024 * 1024);
    await store.put(GUEST, TETRIS, "manual", state);

    const back = await store.get(GUEST, TETRIS.gameId, "manual");
    expect(back?.byteLength).toBe(16 * 1024 * 1024);
    expect(sameBytes(back, pattern(16 * 1024 * 1024))).toBe(true);

    // The record holds a Blob, not base64 text and not a plain array.
    const raw = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const open = factory.open(SAVE_DB_NAME);
      open.onsuccess = () => {
        const request = open.result.transaction("states").objectStore("states").get([GUEST, TETRIS.gameId, "manual"]);
        request.onsuccess = () => {
          open.result.close();
          resolve(request.result);
        };
        request.onerror = () => reject(request.error);
      };
    });
    expect(raw.data).toBeInstanceOf(Blob);
    expect((raw.data as Blob).size).toBe(16 * 1024 * 1024);
    expect(raw.bytes).toBe(16 * 1024 * 1024);
  }, 60_000);

  it("keeps the auto slot and the manual slot of a game apart", async () => {
    const { store } = freshStore();
    await store.put(GUEST, TETRIS, "auto", pattern(100, 1));
    await store.put(GUEST, TETRIS, "manual", pattern(100, 2));
    expect(sameBytes(await store.get(GUEST, TETRIS.gameId, "auto"), pattern(100, 1))).toBe(true);
    expect(sameBytes(await store.get(GUEST, TETRIS.gameId, "manual"), pattern(100, 2))).toBe(true);
    // A new save replaces the old one in the same slot.
    await store.put(GUEST, TETRIS, "auto", pattern(50, 3));
    expect(sameBytes(await store.get(GUEST, TETRIS.gameId, "auto"), pattern(50, 3))).toBe(true);
  });

  it("gives null for an empty slot", async () => {
    const { store } = freshStore();
    expect(await store.get(GUEST, TETRIS.gameId, "manual")).toBeNull();
  });

  it("never keeps an empty state", async () => {
    const { store } = freshStore();
    await expect(store.put(GUEST, TETRIS, "manual", new ArrayBuffer(0))).rejects.toMatchObject({ kind: "write" });
    expect(await store.get(GUEST, TETRIS.gameId, "manual")).toBeNull();
  });
});

describe("save states: one partition for each owner", () => {
  it("never gives one owner the save of another owner", async () => {
    const { store } = freshStore();
    await store.put(HANK, TETRIS, "manual", pattern(64, 1));
    await store.put(SISTER, TETRIS, "manual", pattern(64, 2));

    expect(sameBytes(await store.get(HANK, TETRIS.gameId, "manual"), pattern(64, 1))).toBe(true);
    expect(sameBytes(await store.get(SISTER, TETRIS.gameId, "manual"), pattern(64, 2))).toBe(true);
    expect(await store.get(GUEST, TETRIS.gameId, "manual")).toBeNull();
  });

  it("lists only the games of the owner, newest first, with the size of all slots", async () => {
    const { store } = freshStore();
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1_000);
    await store.put(HANK, TETRIS, "auto", pattern(200));
    now.mockReturnValue(2_000);
    await store.put(HANK, TETRIS, "manual", pattern(300));
    now.mockReturnValue(3_000);
    await store.put(HANK, MARIO, "manual", pattern(400));
    now.mockReturnValue(4_000);
    await store.put(SISTER, MARIO, "auto", pattern(999));

    const list = await store.list(HANK);
    expect(list.map((game) => game.gameId)).toEqual([MARIO.gameId, TETRIS.gameId]);
    expect(list[1]).toMatchObject({ name: "tetris.gb", system: "gb", bytes: 500, savedAt: 2_000 });
    expect([...list[1].slots].sort()).toEqual(["auto", "manual"]);
    expect(await store.list(GUEST)).toEqual([]);
    expect((await store.list(SISTER)).map((game) => game.bytes)).toEqual([999]);
  });

  it("deletes both slots of one game for one owner only", async () => {
    const { store } = freshStore();
    await store.put(HANK, TETRIS, "auto", pattern(10));
    await store.put(HANK, TETRIS, "manual", pattern(10));
    await store.put(SISTER, TETRIS, "manual", pattern(10, 9));

    await store.remove(HANK, TETRIS.gameId);

    expect(await store.get(HANK, TETRIS.gameId, "auto")).toBeNull();
    expect(await store.get(HANK, TETRIS.gameId, "manual")).toBeNull();
    expect(sameBytes(await store.get(SISTER, TETRIS.gameId, "manual"), pattern(10, 9))).toBe(true);
  });

  it.each(["", "Guest", "u_short", "u_0123456789ABCDEF0123", "../other"])(
    "refuses the owner key %j",
    async (owner) => {
      const { store } = freshStore();
      await expect(store.put(owner, TETRIS, "manual", pattern(4))).rejects.toThrow(TypeError);
      await expect(store.get(owner, TETRIS.gameId, "manual")).rejects.toThrow(TypeError);
      await expect(store.list(owner)).rejects.toThrow(TypeError);
    }
  );
});

describe("save states: failures are never silent", () => {
  it("reports a full device as a quota error", async () => {
    const { store } = freshStore();
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });
    const failure = await store.put(GUEST, TETRIS, "manual", pattern(64)).catch((error) => error);
    expect(failure).toBeInstanceOf(SaveStateError);
    expect(failure.kind).toBe("quota");
    // A quota error is final: no second attempt fills the device again.
    expect(IDBObjectStore.prototype.put).toHaveBeenCalledTimes(1);
  });

  it("reports a quota error that aborts the transaction", async () => {
    const { store } = freshStore();
    const realPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args) {
      const request = realPut.apply(this, args as Parameters<IDBObjectStore["put"]>);
      // A browser that runs out of space mid-write aborts the transaction
      // with a QuotaExceededError on transaction.error.
      const tx = this.transaction;
      Object.defineProperty(tx, "error", {
        configurable: true,
        get: () => new DOMException("No space", "QuotaExceededError"),
      });
      tx.abort();
      return request;
    });
    await expect(store.put(GUEST, TETRIS, "manual", pattern(64))).rejects.toMatchObject({ kind: "quota" });
  });

  it("stores the bytes as an ArrayBuffer when WebKit cannot store the Blob", async () => {
    const { store } = freshStore();
    const realPut = IDBObjectStore.prototype.put;
    let calls = 0;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, key) {
      calls++;
      if ((value as { data?: unknown }).data instanceof Blob) {
        throw new DOMException("Error preparing Blob/File data to be stored in object store", "UnknownError");
      }
      return realPut.call(this, value, key);
    });
    await store.put(GUEST, TETRIS, "manual", pattern(2048));
    expect(calls).toBe(2);
    vi.restoreAllMocks();
    expect(sameBytes(await store.get(GUEST, TETRIS.gameId, "manual"), pattern(2048))).toBe(true);
  });

  it("reports a write error when the second attempt also fails", async () => {
    const { store } = freshStore();
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("Disk I/O error", "UnknownError");
    });
    await expect(store.put(GUEST, TETRIS, "manual", pattern(64))).rejects.toMatchObject({ kind: "write" });
  });

  it("reports an unavailable IndexedDB", async () => {
    const store = createSaveStateStore(() => undefined);
    await expect(store.put(GUEST, TETRIS, "manual", pattern(8))).rejects.toMatchObject({ kind: "unavailable" });
    await expect(store.get(GUEST, TETRIS.gameId, "manual")).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("opens a new connection and tries once more when the old connection is closed", async () => {
    const { store, factory } = freshStore();
    await store.put(GUEST, TETRIS, "manual", pattern(32, 4));
    const open = vi.spyOn(factory, "open");
    // WebKit closes the IndexedDB connection of a background tab (bug
    // 273827). The next transaction on it throws InvalidStateError.
    const realTransaction = IDBDatabase.prototype.transaction;
    let failed = false;
    vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (this: IDBDatabase, ...args) {
      if (!failed) {
        failed = true;
        throw new DOMException("The database connection is closing.", "InvalidStateError");
      }
      return realTransaction.apply(this, args as Parameters<IDBDatabase["transaction"]>);
    });
    expect(sameBytes(await store.get(GUEST, TETRIS.gameId, "manual"), pattern(32, 4))).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["QuotaExceededError", true],
    ["NS_ERROR_DOM_QUOTA_REACHED", true],
    ["UnknownError", false],
    ["AbortError", false],
  ])("isQuotaError(%s) is %s", (name, expected) => {
    expect(isQuotaError(new DOMException("x", name))).toBe(expected);
  });
});
