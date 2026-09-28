// @vitest-environment node
/**
 * Library tests on the shared OPFS double, fake-indexeddb, Node's real Web Locks
 * (navigator.locks) and real MP4 bytes from the muxer.
 */
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { type OpfsMock, type OpfsMockOptions, createOpfsMock, installOpfsMock } from "../../../../__tests__/opfs-mock";
import { makeMp4 } from "../../engine/io/__tests__/fixtures";
import type { ClipRecord } from "../../protocol";
import { type ClipsDb, openClipsDb } from "../db";
import { LibraryError } from "../errors";
import type { LocksLike, StorageLike } from "../fsTypes";
import {
  ClipLibrary,
  LIBRARY_LOCK,
  type LibraryEnv,
  type LibraryMessage,
  type SaveMeta,
  downloadName,
} from "../opfsStore";
import { verifyClip } from "../verify";

// Each test muxes and parses real MP4 bytes. That is fast alone, but a busy machine
// (a parallel gate or a browser sweep) can pass the 5 s default.
vi.setConfig({ testTimeout: 30_000 });

const USER = "u_0123456789abcdef0123";
const OTHER = "u_fedcba9876543210fedc";

let clip: { bytes: Uint8Array; videoDurationSec: number };
let clip2s: { bytes: Uint8Array; videoDurationSec: number };

beforeAll(async () => {
  clip = await makeMp4({ seconds: 1 });
  clip2s = await makeMp4({ seconds: 2 });
});

let serial = 0;
function meta(overrides: Partial<SaveMeta> = {}): SaveMeta {
  serial++;
  return {
    id: `clip${serial}`,
    ownerKey: "guest",
    gameId: "snake",
    kind: "clip",
    createdAt: new Date(2026, 8, 28, 10, 0, serial).getTime(),
    durationMs: 0,
    width: 64,
    height: 64,
    fps: 30,
    hasAudio: false,
    mime: "video/mp4",
    kept: false,
    watched: false,
    posterDataUrl: "data:image/jpeg;base64,AA==",
    moments: [],
    ...overrides,
  };
}

const nodeLocks = (globalThis.navigator as unknown as { locks: LocksLike }).locks;

interface Harness {
  mock: OpfsMock;
  factory: IDBFactory;
  lib: ClipLibrary;
  messages: LibraryMessage[];
  lockNames: string[];
  clock: { now: number };
  rows(): Promise<ClipsDb>;
}

const open: ClipLibrary[] = [];
const dbs: ClipsDb[] = [];

async function setup(
  options: { mock?: OpfsMockOptions; env?: Partial<LibraryEnv>; noIdb?: boolean; noStorage?: boolean; mockInstance?: OpfsMock; factory?: IDBFactory } = {},
): Promise<Harness> {
  const clock = { now: Date.UTC(2026, 8, 28, 12) };
  const mock = options.mockInstance ?? createOpfsMock({ now: () => clock.now, ...options.mock });
  const factory = options.factory ?? new IDBFactory();
  const messages: LibraryMessage[] = [];
  const lockNames: string[] = [];
  const locks: LocksLike = {
    request: (name, callback) => {
      lockNames.push(name);
      return nodeLocks.request(name, callback);
    },
  };
  const lib = await ClipLibrary.open({
    storage: options.noStorage ? null : (mock.storage as unknown as StorageLike),
    indexedDB: options.noIdb ? null : factory,
    keyRange: IDBKeyRange,
    locks,
    channel: { postMessage: (message) => messages.push(message as LibraryMessage) },
    now: () => clock.now,
    posterFromFile: async () => "data:image/jpeg;base64,cG9zdGVy",
    ...options.env,
  });
  open.push(lib);
  return {
    mock,
    factory,
    lib,
    messages,
    lockNames,
    clock,
    rows: async () => {
      const db = await openClipsDb(factory, IDBKeyRange);
      dbs.push(db);
      return db;
    },
  };
}

afterEach(() => {
  open.splice(0).forEach((lib) => lib.close());
  dbs.splice(0).forEach((db) => db.close());
});

async function fileBytes(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

describe("ClipLibrary.open picks the first tier", () => {
  it("uses OPFS in a normal window", async () => {
    expect((await setup()).lib.tier).toBe("opfs");
  });

  it("uses memory in a private window (getDirectory rejects)", async () => {
    expect((await setup({ mock: { privateMode: true } })).lib.tier).toBe("memory");
  });

  it("uses memory when IndexedDB does not open", async () => {
    expect((await setup({ noIdb: true })).lib.tier).toBe("memory");
  });

  it("uses IndexedDB when the browser has no OPFS", async () => {
    expect((await setup({ noStorage: true })).lib.tier).toBe("idb");
  });

  it("reads navigator.storage, indexedDB and BroadcastChannel from the global scope by default", async () => {
    const holder = globalThis as { indexedDB?: unknown; IDBKeyRange?: unknown };
    // Node has none of these, so the default library holds clips in memory.
    const bare = await ClipLibrary.open();
    expect(bare.tier).toBe("memory");
    bare.close();

    const mock = installOpfsMock();
    holder.indexedDB = new IDBFactory();
    holder.IDBKeyRange = IDBKeyRange;
    const listener = new BroadcastChannel("hh-clips");
    const heard = new Promise((resolve) => (listener.onmessage = (event) => resolve(event.data)));
    try {
      const lib = await ClipLibrary.open();
      expect(lib.tier).toBe("opfs");
      await lib.save(clip.bytes, meta({ id: "global" }), clip.videoDurationSec);
      expect(mock.listFiles()).toEqual(["lib/guest/global.mp4"]);
      expect(await heard).toEqual({ added: "global" });
      lib.close();
    } finally {
      listener.close();
      mock.uninstall();
      delete holder.indexedDB;
      delete holder.IDBKeyRange;
    }
  });
});

describe("save: the OPFS write protocol", () => {
  it("checks the bytes, writes a temp file, checks it again, moves it, then writes the row under the lock", async () => {
    const steps: string[] = [];
    // The verify spy needs the harness, which exists only after setup returns.
    const ref: { h?: Harness } = {};
    const h = await setup({
      env: {
        verify: async (source, expected) => {
          const id = "clip-proto";
          const where = source instanceof Uint8Array ? "bytes" : "file";
          const { mock, rows } = ref.h!;
          const row = await (await rows()).get(id);
          steps.push(
            `verify ${where} tmp=${mock.exists(`tmp/${id}.mp4`)} lib=${mock.exists(`lib/guest/${id}.mp4`)} row=${!!row} open=${mock.openSyncHandles()}`,
          );
          return verifyClip(source, expected);
        },
      },
    });
    ref.h = h;
    const result = await h.lib.save(clip.bytes, meta({ id: "clip-proto" }), clip.videoDurationSec);
    expect(steps).toEqual([
      "verify bytes tmp=false lib=false row=false open=0",
      "verify file tmp=true lib=false row=false open=0",
    ]);
    expect(h.mock.flushCount()).toBe(1);
    expect(h.mock.listFiles()).toEqual(["lib/guest/clip-proto.mp4"]);
    expect(h.mock.readFile("lib/guest/clip-proto.mp4")).toEqual(clip.bytes);
    expect(result.record).toMatchObject({ id: "clip-proto", storage: "opfs", bytes: clip.bytes.length, durationMs: 1000 });
    expect(result.problems).toEqual([]);
    expect(result.eviction).toBeNull();
    expect(await (await h.rows()).get("clip-proto")).toEqual(result.record);
    expect(h.lockNames.filter((name) => name === LIBRARY_LOCK).length).toBe(2);
    expect(h.messages).toEqual([{ added: "clip-proto" }]);
  });

  it("does not write the row while another tab holds the library lock", async () => {
    const h = await setup();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let holding!: () => void;
    const acquired = new Promise<void>((resolve) => (holding = resolve));
    const other = nodeLocks.request(LIBRARY_LOCK, async () => {
      holding();
      await held;
    });
    await acquired;
    const saving = h.lib.save(clip.bytes, meta({ id: "clip-wait" }), clip.videoDurationSec);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await (await h.rows()).get("clip-wait")).toBeUndefined();
    expect(h.mock.exists("lib/guest/clip-wait.mp4")).toBe(false);
    release();
    await other;
    await saving;
    expect(await (await h.rows()).get("clip-wait")).toMatchObject({ storage: "opfs" });
  });

  it("stores the real duration and sound flag from the file", async () => {
    const h = await setup();
    const result = await h.lib.save(clip2s.bytes, meta({ durationMs: 99, hasAudio: false }), clip2s.videoDurationSec);
    expect(result.record.durationMs).toBe(2000);
    expect(result.record.hasAudio).toBe(true);
  });

  it("writes into the owner's own folder", async () => {
    const h = await setup();
    await h.lib.save(clip.bytes, meta({ id: "mine", ownerKey: USER }), clip.videoDurationSec);
    expect(h.mock.listFiles()).toEqual([`lib/${USER}/mine.mp4`]);
  });

  it("refuses bytes that do not parse, before anything is written", async () => {
    const h = await setup();
    const garbage = new Uint8Array(1000).fill(7);
    await expect(h.lib.save(garbage, meta(), 1)).rejects.toMatchObject({ code: "verify-failed" });
    expect(h.mock.listFiles()).toEqual([]);
    expect(await (await h.rows()).listAll()).toEqual([]);
  });

  it("refuses a file whose duration is not the expected one (more than 0.2 s off)", async () => {
    const h = await setup();
    await expect(h.lib.save(clip.bytes, meta(), clip.videoDurationSec + 0.5)).rejects.toMatchObject({ code: "verify-failed" });
    await expect(h.lib.save(clip.bytes, meta(), clip.videoDurationSec + 0.15)).resolves.toBeTruthy();
  });

  it("refuses an id or owner key that is not safe as a path", async () => {
    const h = await setup();
    await expect(h.lib.save(clip.bytes, meta({ id: "../x" }), 1)).rejects.toThrow(TypeError);
    await expect(h.lib.save(clip.bytes, meta({ ownerKey: "../../x" }), 1)).rejects.toThrow(TypeError);
  });

  it("writes with createWritable where there is no SyncAccessHandle (a window)", async () => {
    const h = await setup({ mock: { context: "window" } });
    const { record } = await h.lib.save(clip.bytes, meta({ id: "w" }), clip.videoDurationSec);
    expect(record.storage).toBe("opfs");
    expect(h.mock.readFile("lib/guest/w.mp4")).toEqual(clip.bytes);
    expect(h.mock.listFiles()).toEqual(["lib/guest/w.mp4"]);
  });

  it("copies the file when the browser has no move()", async () => {
    const h = await setup({ mock: { move: false } });
    await h.lib.save(clip.bytes, meta({ id: "c" }), clip.videoDurationSec);
    expect(h.mock.listFiles()).toEqual(["lib/guest/c.mp4"]);
    expect(h.mock.readFile("lib/guest/c.mp4")).toEqual(clip.bytes);
  });

  it("copies the file when move() refuses", async () => {
    const h = await setup();
    h.mock.failNext("move", new DOMException("no", "NotSupportedError"));
    await h.lib.save(clip.bytes, meta({ id: "c2" }), clip.videoDurationSec);
    expect(h.mock.listFiles()).toEqual(["lib/guest/c2.mp4"]);
  });

  it("falls back to IndexedDB chunks when an OPFS step fails in a normal window", async () => {
    const h = await setup({ env: { chunkBytes: 1000 } });
    h.mock.failNext("createSyncAccessHandle", new DOMException("busy", "InvalidStateError"));
    const result = await h.lib.save(clip.bytes, meta({ id: "fb" }), clip.videoDurationSec);
    expect(result.record.storage).toBe("idb");
    expect(result.problems).toEqual([expect.stringMatching(/^opfs: InvalidStateError/)]);
    expect(h.mock.listFiles()).toEqual([]);
    const db = await h.rows();
    expect((await db.getChunks("fb"))!.length).toBe(Math.ceil(clip.bytes.length / 1000));
    const { file } = await h.lib.read("fb");
    expect(await fileBytes(file)).toEqual(clip.bytes);
    expect(h.messages).toEqual([{ added: "fb" }]);
  });

  it("falls back to IndexedDB when the OPFS read-back check fails", async () => {
    let calls = 0;
    const h = await setup({
      env: {
        verify: async (source, expected) => {
          calls++;
          if (calls === 2) throw new LibraryError("verify-failed", "the disk returned other bytes");
          return verifyClip(source, expected);
        },
      },
    });
    const result = await h.lib.save(clip.bytes, meta({ id: "rb" }), clip.videoDurationSec);
    expect(result.record.storage).toBe("idb");
    expect(h.mock.listFiles()).toEqual([]);
  });

  it("falls back to memory when IndexedDB also fails", async () => {
    const h = await setup();
    h.mock.failNext("createSyncAccessHandle", new DOMException("busy", "InvalidStateError"));
    const db = await h.rows();
    // Fill the chunk path with a failure: a chunk size of 0 makes putChunks reject.
    const lib = await ClipLibrary.open({
      storage: h.mock.storage as unknown as StorageLike,
      indexedDB: h.factory,
      keyRange: IDBKeyRange,
      locks: null,
      channel: null,
      chunkBytes: 0,
    });
    open.push(lib);
    const result = await lib.save(clip.bytes, meta({ id: "mem" }), clip.videoDurationSec);
    expect(result.record.storage).toBe("memory");
    expect(result.problems.map((problem) => problem.split(":")[0])).toEqual(["opfs", "idb"]);
    expect(await db.get("mem")).toBeUndefined();
    expect(await fileBytes((await lib.read("mem")).file)).toEqual(clip.bytes);
  });

  it("treats QuotaExceededError as a normal quota error: no other tier, no temp file left", async () => {
    const h = await setup();
    h.mock.failNext("syncWrite", new DOMException("full", "QuotaExceededError"));
    const error = await h.lib.save(clip.bytes, meta({ id: "q" }), clip.videoDurationSec).catch((e) => e);
    expect(error).toBeInstanceOf(LibraryError);
    expect(error.code).toBe("quota");
    expect(h.mock.listFiles()).toEqual([]);
    expect(await (await h.rows()).listAll()).toEqual([]);
    expect(await (await h.rows()).chunkIds()).toEqual([]);
  });

  it("removes the moved file when the row cannot be written, so no file is left without a row", async () => {
    const h = await setup();
    const db = await h.rows();
    // A row with the same id but another key type cannot exist; instead close the
    // library's database connection so the row write fails after the move.
    (h.lib as unknown as { db: ClipsDb }).db.close();
    const result = await h.lib.save(clip.bytes, meta({ id: "norow" }), clip.videoDurationSec);
    expect(result.record.storage).toBe("memory");
    // The budget could not be read, the row write failed after the move, then the
    // IndexedDB tier failed too. The kid still gets the clip (in memory).
    expect(result.problems.map((problem) => problem.split(":")[0])).toEqual(["budget", "opfs", "idb"]);
    expect(h.mock.listFiles()).toEqual([]);
    expect(await db.get("norow")).toBeUndefined();
  });
});

describe("budget and eviction", () => {
  async function seedWatchedAuto(h: Harness, ids: string[]) {
    for (const [i, id] of ids.entries()) {
      await h.lib.save(clip.bytes, meta({ id, kind: "auto", watched: true, createdAt: 1000 + i }), clip.videoDurationSec);
    }
  }

  it("budget is 25% of estimate().quota", async () => {
    const h = await setup({ mock: { quota: 4_000_000 } });
    expect(await h.lib.budget()).toEqual({ budgetBytes: 1_000_000, usedBytes: 0 });
  });

  it("uses the write-then-truncate probe when estimate() is missing", async () => {
    const h = await setup({ mock: { quota: 400 * 1024 * 1024, estimate: false } });
    const { budgetBytes } = await h.lib.budget();
    expect(budgetBytes).toBeGreaterThan(95 * 1024 * 1024);
    expect(budgetBytes).toBeLessThanOrEqual(100 * 1024 * 1024);
    expect(h.mock.listFiles()).toEqual([]);
  });

  it("has no budget check when neither estimate() nor the probe works", async () => {
    const h = await setup({ mock: { estimate: false, context: "window" } });
    expect((await h.lib.budget()).budgetBytes).toBeNull();
    await expect(h.lib.save(clip.bytes, meta(), clip.videoDurationSec)).resolves.toMatchObject({ eviction: null });
  });

  it("removes the oldest watched, unkept auto clips only when over budget, and says what it kept", async () => {
    const size = clip.bytes.length;
    // Room for 3 clips.
    const h = await setup({ mock: { quota: 4 * (3 * size + 10) } });
    await seedWatchedAuto(h, ["a1", "a2"]);
    await h.lib.save(clip.bytes, meta({ id: "mine", kind: "clip" }), clip.videoDurationSec);
    expect(h.messages.filter((m) => "removed" in m)).toEqual([]);
    const result = await h.lib.save(clip.bytes, meta({ id: "new" }), clip.videoDurationSec);
    expect(result.eviction).toEqual({ kept: ["a2", "mine"], removed: ["a1"] });
    expect(h.mock.exists("lib/guest/a1.mp4")).toBe(false);
    expect(await (await h.rows()).get("a1")).toBeUndefined();
    expect(h.messages).toContainEqual({ removed: "a1" });
    expect((await h.lib.list("guest")).map((r) => r.id).sort()).toEqual(["a2", "mine", "new"]);
  });

  it("never removes NEW (unwatched) clips; a clip that cannot fit is a quota error and nothing is removed", async () => {
    const size = clip.bytes.length;
    const h = await setup({ mock: { quota: 4 * (2 * size + 10) } });
    await h.lib.save(clip.bytes, meta({ id: "n1", kind: "auto", watched: false }), clip.videoDurationSec);
    await h.lib.save(clip.bytes, meta({ id: "k1", kind: "auto", watched: true, kept: true }), clip.videoDurationSec);
    await expect(h.lib.save(clip.bytes, meta({ id: "x" }), clip.videoDurationSec)).rejects.toMatchObject({ code: "quota" });
    expect(h.mock.listFiles()).toEqual(["lib/guest/k1.mp4", "lib/guest/n1.mp4"]);
  });

  it("counts every owner's clips against the one origin budget", async () => {
    const size = clip.bytes.length;
    const h = await setup({ mock: { quota: 4 * (2 * size + 10) } });
    await h.lib.save(clip.bytes, meta({ id: "o1", ownerKey: OTHER, kind: "auto", watched: true }), clip.videoDurationSec);
    await h.lib.save(clip.bytes, meta({ id: "g1" }), clip.videoDurationSec);
    const result = await h.lib.save(clip.bytes, meta({ id: "g2" }), clip.videoDurationSec);
    expect(result.eviction?.removed).toEqual(["o1"]);
  });

  it("applies the memory budget in a private window", async () => {
    const size = clip.bytes.length;
    const h = await setup({ mock: { privateMode: true }, env: { memoryBudgetBytes: 2 * size + 10 } });
    await h.lib.save(clip.bytes, meta({ id: "m1", kind: "auto", watched: true }), clip.videoDurationSec);
    await h.lib.save(clip.bytes, meta({ id: "m2" }), clip.videoDurationSec);
    const third = await h.lib.save(clip.bytes, meta({ id: "m3" }), clip.videoDurationSec);
    expect(third.eviction).toEqual({ kept: ["m2"], removed: ["m1"] });
    await expect(h.lib.save(clip.bytes, meta({ id: "m4" }), clip.videoDurationSec)).rejects.toMatchObject({ code: "quota" });
    expect(await h.lib.budget()).toEqual({ budgetBytes: 2 * size + 10, usedBytes: 2 * size });
  });

  it("uses the probe when estimate() fails", async () => {
    const h = await setup({ mock: { quota: 400 * 1024 * 1024 } });
    h.mock.failNext("estimate", new Error("estimate broke"));
    const { budgetBytes } = await h.lib.budget();
    expect(budgetBytes).toBeGreaterThan(95 * 1024 * 1024);
    expect(budgetBytes).toBeLessThanOrEqual(100 * 1024 * 1024);
  });
});

describe("memory tier (private window)", () => {
  it("saves, lists, reads and removes clips without touching OPFS or IndexedDB", async () => {
    const h = await setup({ mock: { privateMode: true } });
    const { record } = await h.lib.save(clip.bytes, meta({ id: "p1", ownerKey: USER }), clip.videoDurationSec);
    expect(record.storage).toBe("memory");
    expect(h.mock.listFiles()).toEqual([]);
    expect(await (await h.rows()).listAll()).toEqual([]);
    expect((await h.lib.list(USER)).map((r) => r.id)).toEqual(["p1"]);
    const { file } = await h.lib.read("p1");
    expect(file.type).toBe("video/mp4");
    expect(await fileBytes(file)).toEqual(clip.bytes);
    expect(await h.lib.remove("p1")).toBe(true);
    expect(await h.lib.list(USER)).toEqual([]);
    // Memory clips exist in this worker only, so no other tab is told.
    expect(h.messages).toEqual([]);
  });
});

describe("read, remove and list", () => {
  it("reads a clip as a File named for sharing", async () => {
    const h = await setup();
    const saved = await h.lib.save(clip.bytes, meta({ id: "r1", gameId: "Flappy Bird!", kind: "auto" }), clip.videoDurationSec);
    const { file, record } = await h.lib.read("r1");
    expect(record).toEqual(saved.record);
    expect(file.name).toBe("flappy-bird-auto-2026-09-28.mp4");
    expect(file.type).toBe("video/mp4");
    expect(file.lastModified).toBe(saved.record.createdAt);
    expect(await fileBytes(file)).toEqual(clip.bytes);
  });

  it("gives not-found for an unknown id, a bad id, or a file the browser removed", async () => {
    const h = await setup();
    await expect(h.lib.read("nope")).rejects.toMatchObject({ code: "not-found" });
    await expect(h.lib.read("../etc")).rejects.toMatchObject({ code: "not-found" });
    await h.lib.save(clip.bytes, meta({ id: "gone" }), clip.videoDurationSec);
    await (await (await h.mock.root.getDirectoryHandle("lib")).getDirectoryHandle("guest")).removeEntry("gone.mp4");
    await expect(h.lib.read("gone")).rejects.toMatchObject({ code: "not-found" });
  });

  it("gives not-found for an IndexedDB clip whose chunks are gone", async () => {
    const h = await setup({ noStorage: true });
    await h.lib.save(clip.bytes, meta({ id: "ch" }), clip.videoDurationSec);
    await (await h.rows()).deleteChunks("ch");
    await expect(h.lib.read("ch")).rejects.toMatchObject({ code: "not-found" });
  });

  it("removes the file and the row, and tells other tabs", async () => {
    const h = await setup();
    await h.lib.save(clip.bytes, meta({ id: "d1" }), clip.videoDurationSec);
    expect(await h.lib.remove("d1")).toBe(true);
    expect(h.mock.listFiles()).toEqual([]);
    expect(await (await h.rows()).get("d1")).toBeUndefined();
    expect(h.messages).toEqual([{ added: "d1" }, { removed: "d1" }]);
    expect(await h.lib.remove("d1")).toBe(false);
    expect(await h.lib.remove("../x")).toBe(false);
  });

  it("removes IndexedDB chunks with the row", async () => {
    const h = await setup({ noStorage: true });
    await h.lib.save(clip.bytes, meta({ id: "d2" }), clip.videoDurationSec);
    await h.lib.remove("d2");
    expect(await (await h.rows()).chunkIds()).toEqual([]);
  });

  it("lists only one player's clips, newest first", async () => {
    const h = await setup();
    await h.lib.save(clip.bytes, meta({ id: "g-old", createdAt: 1 }), clip.videoDurationSec);
    await h.lib.save(clip.bytes, meta({ id: "g-new", createdAt: 3 }), clip.videoDurationSec);
    await h.lib.save(clip.bytes, meta({ id: "u-1", ownerKey: USER, createdAt: 2 }), clip.videoDurationSec);
    expect((await h.lib.list("guest")).map((r) => r.id)).toEqual(["g-new", "g-old"]);
    expect((await h.lib.list(USER)).map((r) => r.id)).toEqual(["u-1"]);
  });

  it("two tabs saving at the same time both keep their clips", async () => {
    const first = await setup();
    const second = await setup({ mockInstance: first.mock, factory: first.factory });
    await Promise.all([
      first.lib.save(clip.bytes, meta({ id: "tab1" }), clip.videoDurationSec),
      second.lib.save(clip2s.bytes, meta({ id: "tab2" }), clip2s.videoDurationSec),
    ]);
    expect(first.mock.listFiles()).toEqual(["lib/guest/tab1.mp4", "lib/guest/tab2.mp4"]);
    expect((await first.lib.list("guest")).map((r) => r.id).sort()).toEqual(["tab1", "tab2"]);
  });
});

describe("reconcile", () => {
  async function seedRow(h: Harness, record: Partial<ClipRecord> & { id: string }) {
    const full: ClipRecord = { ...meta({ id: record.id }), bytes: 10, storage: "opfs", ...record };
    await (await h.rows()).put(full);
    return full;
  }

  it("gives a file without a row a new row: kind clip (never auto-removed) and NEW", async () => {
    const h = await setup();
    h.mock.writeFile(`lib/${USER}/lost1.mp4`, clip2s.bytes, { lastModified: 12345 });
    const result = await h.lib.reconcile();
    expect(result).toMatchObject({ reindexed: 1, missing: 0, unreadable: 0 });
    const row = await (await h.rows()).get("lost1");
    expect(row).toEqual({
      id: "lost1",
      ownerKey: USER,
      gameId: "unknown",
      kind: "clip",
      createdAt: 12345,
      durationMs: 2000,
      width: 64,
      height: 64,
      fps: 30,
      hasAudio: true,
      mime: "video/mp4",
      bytes: clip2s.bytes.length,
      kept: false,
      watched: false,
      storage: "opfs",
      posterDataUrl: "data:image/jpeg;base64,cG9zdGVy",
      moments: [],
    });
    expect(h.messages).toContainEqual({ added: "lost1" });
    expect(h.messages).toContainEqual({ reconciled: result });
  });

  it("removes a row whose file is gone, and counts it", async () => {
    const h = await setup();
    await seedRow(h, { id: "ghost" });
    const result = await h.lib.reconcile();
    expect(result).toMatchObject({ missing: 1, reindexed: 0 });
    expect(await (await h.rows()).get("ghost")).toBeUndefined();
    expect(h.messages).toContainEqual({ removed: "ghost" });
  });

  it("removes a file without a row that does not parse, and counts it", async () => {
    const h = await setup();
    h.mock.writeFile("lib/guest/junk.mp4", new Uint8Array(500).fill(1));
    const result = await h.lib.reconcile();
    expect(result).toMatchObject({ unreadable: 1, reindexed: 0 });
    expect(h.mock.listFiles()).toEqual([]);
  });

  it("moves a file in the wrong owner folder to its row's owner", async () => {
    const h = await setup();
    await seedRow(h, { id: "moved", ownerKey: USER });
    h.mock.writeFile("lib/guest/moved.mp4", clip.bytes);
    const result = await h.lib.reconcile();
    expect(result).toMatchObject({ relocated: 1, missing: 0 });
    expect(h.mock.listFiles()).toEqual([`lib/${USER}/moved.mp4`]);
    expect(await fileBytes((await h.lib.read("moved")).file)).toEqual(clip.bytes);
  });

  it("removes a stray OPFS copy of a clip that lives in IndexedDB", async () => {
    const h = await setup();
    await seedRow(h, { id: "dup", storage: "idb" });
    await (await h.rows()).putChunks("dup", clip.bytes);
    h.mock.writeFile("lib/guest/dup.mp4", clip.bytes);
    const result = await h.lib.reconcile();
    expect(h.mock.listFiles()).toEqual([]);
    expect(result.missing).toBe(0);
    expect(await (await h.rows()).get("dup")).toMatchObject({ storage: "idb" });
  });

  it("removes IndexedDB rows without chunks, memory rows, and chunks without rows", async () => {
    const h = await setup();
    await seedRow(h, { id: "nochunks", storage: "idb" });
    await seedRow(h, { id: "memrow", storage: "memory" });
    await (await h.rows()).putChunks("orphan", new Uint8Array([1, 2, 3]));
    const result = await h.lib.reconcile();
    expect(result).toMatchObject({ missing: 2, orphanChunks: 1 });
    expect(await (await h.rows()).listAll()).toEqual([]);
    expect(await (await h.rows()).chunkIds()).toEqual([]);
  });

  it("removes stale temp files and keeps fresh ones (a write in progress)", async () => {
    const h = await setup();
    h.mock.writeFile("tmp/stale.mp4", new Uint8Array(10), { lastModified: h.clock.now - 11 * 60 * 1000 });
    h.mock.writeFile("tmp/fresh.mp4", new Uint8Array(10), { lastModified: h.clock.now - 60 * 1000 });
    const result = await h.lib.reconcile();
    expect(result.staleTemp).toBe(1);
    expect(h.mock.listFiles()).toEqual(["tmp/fresh.mp4"]);
  });

  it("leaves folders and files it does not know alone", async () => {
    const h = await setup();
    h.mock.writeFile("lib/not-an-owner/x.mp4", clip.bytes);
    h.mock.writeFile("lib/guest/notes.txt", new Uint8Array([1]));
    h.mock.writeFile("timeline/part1.mp4", new Uint8Array([1]));
    await h.lib.reconcile();
    expect(h.mock.listFiles()).toEqual(["lib/guest/notes.txt", "lib/not-an-owner/x.mp4", "timeline/part1.mp4"]);
  });

  it("keeps OPFS rows when OPFS cannot be read in this window", async () => {
    const h = await setup({ noStorage: true });
    await seedRow(h, { id: "keep" });
    const result = await h.lib.reconcile();
    expect(result.missing).toBe(0);
    expect(await (await h.rows()).get("keep")).toBeTruthy();
  });

  it("counts an entry it cannot check and goes on with the rest", async () => {
    const h = await setup();
    h.mock.writeFile("lib/guest/a.mp4", clip.bytes);
    h.mock.writeFile("lib/guest/b.mp4", clip.bytes);
    h.mock.failNext("getFile", new DOMException("busy", "NoModificationAllowedError"));
    const result = await h.lib.reconcile();
    expect(result.errors).toBe(1);
    expect(result.reindexed).toBe(1);
  });

  it("does nothing and sends nothing when all is in order", async () => {
    const h = await setup();
    await h.lib.save(clip.bytes, meta({ id: "ok" }), clip.videoDurationSec);
    h.messages.length = 0;
    const result = await h.lib.reconcile();
    expect(result).toEqual({ reindexed: 0, missing: 0, unreadable: 0, relocated: 0, orphanChunks: 0, staleTemp: 0, errors: 0 });
    expect(h.messages).toEqual([]);
  });

  it("does nothing in the memory tier", async () => {
    const h = await setup({ noIdb: true });
    h.mock.writeFile("lib/guest/a.mp4", clip.bytes);
    expect((await h.lib.reconcile()).reindexed).toBe(0);
  });
});

describe("downloadName", () => {
  it("uses the game id, the kind and the local date, with safe characters only", () => {
    const record = { ...meta({ gameId: "../Monster Truck!!", kind: "record", createdAt: new Date(2026, 0, 5).getTime() }), bytes: 1, storage: "opfs" } as ClipRecord;
    expect(downloadName(record)).toBe("monster-truck-record-2026-01-05.mp4");
    expect(downloadName({ ...record, gameId: "", mime: "image/png", kind: "picture" })).toBe("game-picture-2026-01-05.png");
    expect(downloadName({ ...record, mime: "video/webm", createdAt: Number.NaN })).toBe("monster-truck-record-clip.webm");
  });
});
