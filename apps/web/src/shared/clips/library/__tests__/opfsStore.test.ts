// @vitest-environment node
/**
 * Library tests on the shared OPFS double, fake-indexeddb, Node's real Web Locks
 * (navigator.locks) and real MP4, WebM and PNG bytes.
 */
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { type OpfsMock, type OpfsMockOptions, createOpfsMock, installOpfsMock } from "../../../../__tests__/opfs-mock";
import { PNG_3X2_HEX, hexBytes, makeMp4, makeWebm } from "../../engine/io/__tests__/fixtures";
import type { ClipRecord } from "../../protocol";
import { MEMORY_BUDGET_BYTES, NO_ESTIMATE_BUDGET_BYTES } from "../budget";
import { ClipsDb, openClipsDb } from "../db";
import { LibraryError } from "../errors";
import type { LocksLike, StorageLike } from "../fsTypes";
import { ClipLibrary, LIBRARY_LOCK, type LibraryEnv, type LibraryMessage, type SaveMeta } from "../opfsStore";
import { verifyClip } from "../verify";

// Each test muxes and parses real MP4 bytes. That is fast alone, but a busy machine
// (a parallel gate or a browser sweep) can pass the 5 s default.
vi.setConfig({ testTimeout: 30_000 });

const USER = "u_0123456789abcdef0123";
const OTHER = "u_fedcba9876543210fedc";
const LOST = () => new DOMException("Connection to Indexed Database server lost. Refresh the page to try again", "UnknownError");

let clip: { bytes: Uint8Array; videoDurationSec: number };
let clip2s: { bytes: Uint8Array; videoDurationSec: number };
let webm: { bytes: Uint8Array; videoDurationSec: number };
const png = hexBytes(PNG_3X2_HEX);

beforeAll(async () => {
  clip = await makeMp4({ seconds: 1 });
  clip2s = await makeMp4({ seconds: 2 });
  webm = await makeWebm({ seconds: 1 });
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

/** An IDBFactory that records every connection it opens, and can refuse the next open. */
function recordingFactory(base: IDBFactory): { factory: IDBFactory; opened: IDBDatabase[]; failNextOpen(): void } {
  const opened: IDBDatabase[] = [];
  let fail = false;
  const factory = {
    open(name: string, version?: number) {
      if (fail) {
        fail = false;
        throw new DOMException("open failed (test)", "UnknownError");
      }
      const req = base.open(name, version);
      req.addEventListener("success", () => opened.push(req.result));
      return req;
    },
  } as unknown as IDBFactory;
  return {
    factory,
    opened,
    failNextOpen() {
      fail = true;
    },
  };
}

interface Harness {
  mock: OpfsMock;
  factory: IDBFactory;
  lib: ClipLibrary;
  messages: LibraryMessage[];
  lockNames: string[];
  /** Lock depth of this library right now (0: not in the lock). */
  lockDepth(): number;
  clock: { now: number };
  rows(): Promise<ClipsDb>;
}

const open: ClipLibrary[] = [];
const dbs: ClipsDb[] = [];

async function setup(
  options: {
    mock?: OpfsMockOptions;
    env?: Partial<LibraryEnv>;
    noIdb?: boolean;
    noStorage?: boolean;
    mockInstance?: OpfsMock;
    factory?: IDBFactory;
    /** The factory the library uses, when it differs from the one rows() reads. */
    libraryFactory?: IDBFactory;
  } = {},
): Promise<Harness> {
  const clock = { now: Date.UTC(2026, 8, 28, 12) };
  const mock = options.mockInstance ?? createOpfsMock({ now: () => clock.now, ...options.mock });
  const factory = options.factory ?? new IDBFactory();
  const messages: LibraryMessage[] = [];
  const lockNames: string[] = [];
  let depth = 0;
  const locks: LocksLike = {
    request: (name, callback) => {
      lockNames.push(name);
      return nodeLocks.request(name, async (lock) => {
        depth++;
        try {
          return await callback(lock);
        } finally {
          depth--;
        }
      });
    },
  };
  const lib = await ClipLibrary.open({
    storage: options.noStorage ? null : (mock.storage as unknown as StorageLike),
    indexedDB: options.noIdb ? null : (options.libraryFactory ?? factory),
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
    lockDepth: () => depth,
    clock,
    rows: async () => {
      const db = await openClipsDb(factory, IDBKeyRange);
      dbs.push(db);
      return db;
    },
  };
}

/** The library's own database connection, for tests that make it fail. */
function libraryDb(lib: ClipLibrary): ClipsDb {
  return (lib as unknown as { db: ClipsDb }).db;
}

afterEach(() => {
  vi.restoreAllMocks();
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

  it("uses memory when IndexedDB does not exist", async () => {
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

describe("a short failure at startup does not keep a normal window in memory", () => {
  it("tries IndexedDB again at the next save", async () => {
    const base = new IDBFactory();
    const rec = recordingFactory(base);
    rec.failNextOpen();
    const h = await setup({ factory: base, libraryFactory: rec.factory });
    expect(h.lib.tier).toBe("memory");
    const { record } = await h.lib.save(clip.bytes, meta({ id: "back" }), clip.videoDurationSec);
    expect(h.lib.tier).toBe("opfs");
    expect(record.storage).toBe("opfs");
    expect(h.mock.listFiles()).toEqual(["lib/guest/back.mp4"]);
  });

  it("tries getDirectory() again at the next operation (WebKit gives the same UnknownError as a private window)", async () => {
    const mock = createOpfsMock();
    mock.failNext("getDirectory", new DOMException("unknown transient reason", "UnknownError"));
    const h = await setup({ mockInstance: mock });
    expect(h.lib.tier).toBe("memory");
    expect(await h.lib.list("guest")).toEqual([]);
    expect(h.lib.tier).toBe("opfs");
    expect((await h.lib.save(clip.bytes, meta(), clip.videoDurationSec)).record.storage).toBe("opfs");
  });

  it("a real private window rejects every time, so it stays in memory", async () => {
    const h = await setup({ mock: { privateMode: true } });
    const first = await h.lib.save(clip.bytes, meta({ id: "p1" }), clip.videoDurationSec);
    const second = await h.lib.save(clip.bytes, meta({ id: "p2" }), clip.videoDurationSec);
    expect([first.record.storage, second.record.storage]).toEqual(["memory", "memory"]);
    expect(h.lib.tier).toBe("memory");
  });
});

describe("save: the OPFS write protocol", () => {
  it("checks the bytes, writes a temp file, checks it again, then moves it and writes the row in one lock", async () => {
    const steps: string[] = [];
    // The verify spy needs the harness, which exists only after setup returns.
    const ref: { h?: Harness } = {};
    const h = await setup({
      env: {
        verify: async (source, expected) => {
          const id = "clip-proto";
          const where = source instanceof Uint8Array ? "bytes" : "file";
          const { mock, rows, lockDepth } = ref.h!;
          const row = await (await rows()).get(id);
          steps.push(
            `verify ${where} tmp=${mock.exists(`tmp/${id}.mp4`)} lib=${mock.exists(`lib/guest/${id}.mp4`)} row=${!!row} open=${mock.openSyncHandles()} lock=${lockDepth()}`,
          );
          return verifyClip(source, expected);
        },
      },
    });
    ref.h = h;
    const result = await h.lib.save(clip.bytes, meta({ id: "clip-proto" }), clip.videoDurationSec);
    expect(steps).toEqual([
      "verify bytes tmp=false lib=false row=false open=0 lock=0",
      "verify file tmp=true lib=false row=false open=0 lock=0",
    ]);
    expect(h.mock.flushCount()).toBe(1);
    expect(h.mock.listFiles()).toEqual(["lib/guest/clip-proto.mp4"]);
    expect(h.mock.readFile("lib/guest/clip-proto.mp4")).toEqual(clip.bytes);
    expect(result.record).toMatchObject({ id: "clip-proto", storage: "opfs", bytes: clip.bytes.length, durationMs: 1000 });
    expect(result.problems).toEqual([]);
    expect(result.eviction).toBeNull();
    expect(await (await h.rows()).get("clip-proto")).toEqual(result.record);
    expect(h.lockNames.filter((name) => name === LIBRARY_LOCK).length).toBe(1);
    expect(h.messages).toEqual([{ added: "clip-proto" }]);
  });

  it("writes the row and moves the file only while it holds the library lock (another tab holds it after the check)", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let other: Promise<void> | null = null;
    let verified = false;
    const h = await setup({
      env: {
        verify: async (source, expected) => {
          const facts = await verifyClip(source, expected);
          if (!(source instanceof Uint8Array)) {
            // The temp file is checked. Now another tab takes the lock and keeps it.
            let holding!: () => void;
            const acquired = new Promise<void>((resolve) => (holding = resolve));
            other = nodeLocks.request(LIBRARY_LOCK, async () => {
              holding();
              await held;
            });
            await acquired;
            verified = true;
          }
          return facts;
        },
      },
    });
    const saving = h.lib.save(clip.bytes, meta({ id: "clip-wait" }), clip.videoDurationSec);
    await vi.waitFor(() => expect(verified).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Checked and waiting: the temp file exists, but no row and no library file yet.
    expect(h.mock.exists("tmp/clip-wait.mp4")).toBe(true);
    expect(await (await h.rows()).get("clip-wait")).toBeUndefined();
    expect(h.mock.exists("lib/guest/clip-wait.mp4")).toBe(false);
    release();
    await other;
    await saving;
    expect(await (await h.rows()).get("clip-wait")).toMatchObject({ storage: "opfs" });
    expect(h.mock.listFiles()).toEqual(["lib/guest/clip-wait.mp4"]);
  });

  it("every row write of a save happens inside the library lock", async () => {
    const h = await setup();
    const depths: number[] = [];
    const put = vi.spyOn(ClipsDb.prototype, "put");
    put.mockImplementation(async function (this: ClipsDb, record: ClipRecord) {
      depths.push(h.lockDepth());
      put.mockRestore();
      return ClipsDb.prototype.put.call(this, record);
    });
    await h.lib.save(clip.bytes, meta({ id: "in-lock" }), clip.videoDurationSec);
    expect(depths).toEqual([1]);
    expect(await (await h.rows()).get("in-lock")).toBeTruthy();
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

  it("refuses bytes that do not parse, and a cut file, before anything is written", async () => {
    const h = await setup();
    const garbage = new Uint8Array(1000).fill(7);
    await expect(h.lib.save(garbage, meta(), 1)).rejects.toMatchObject({ code: "verify-failed" });
    const cut = clip.bytes.subarray(0, clip.bytes.length - 40);
    await expect(h.lib.save(cut, meta(), clip.videoDurationSec)).rejects.toMatchObject({ code: "verify-failed" });
    expect(h.mock.listFiles()).toEqual([]);
    expect(await (await h.rows()).listAll()).toEqual([]);
  });

  it("refuses a file whose duration is not the expected one (more than 0.2 s off)", async () => {
    const h = await setup();
    await expect(h.lib.save(clip.bytes, meta(), clip.videoDurationSec + 0.5)).rejects.toMatchObject({ code: "verify-failed" });
    await expect(h.lib.save(clip.bytes, meta(), clip.videoDurationSec + 0.15)).resolves.toBeTruthy();
  });

  it("refuses an id, owner key or mime type that is not safe or not stored", async () => {
    const h = await setup();
    await expect(h.lib.save(clip.bytes, meta({ id: "../x" }), 1)).rejects.toThrow(TypeError);
    await expect(h.lib.save(clip.bytes, meta({ ownerKey: "../../x" }), 1)).rejects.toThrow(TypeError);
    await expect(h.lib.save(clip.bytes, meta({ mime: "video/quicktime" as never }), 1)).rejects.toThrow(TypeError);
  });

  it("writes with createWritable where there is no SyncAccessHandle (a window)", async () => {
    const h = await setup({ mock: { context: "window" } });
    const { record } = await h.lib.save(clip.bytes, meta({ id: "w" }), clip.videoDurationSec);
    expect(record.storage).toBe("opfs");
    expect(h.mock.readFile("lib/guest/w.mp4")).toEqual(clip.bytes);
    expect(h.mock.listFiles()).toEqual(["lib/guest/w.mp4"]);
  });

  it("works with the async SyncAccessHandle of Safari 15.2 to 16.3", async () => {
    const h = await setup({ mock: { syncAccess: "async" } });
    const { record } = await h.lib.save(clip.bytes, meta({ id: "old-safari" }), clip.videoDurationSec);
    expect(record.storage).toBe("opfs");
    expect(h.mock.readFile("lib/guest/old-safari.mp4")).toEqual(clip.bytes);
    expect(h.mock.openSyncHandles()).toBe(0);
    expect(h.mock.flushCount()).toBe(1);
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
    // A chunk size of 0 makes putChunks reject.
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
    expect(error.eviction).toBeNull();
    expect(h.mock.listFiles()).toEqual([]);
    expect(await (await h.rows()).listAll()).toEqual([]);
    expect(await (await h.rows()).chunkIds()).toEqual([]);
  });
});

describe("save: the IndexedDB connection and the row write", () => {
  it("a lost IndexedDB connection between two saves: the second clip still goes to OPFS (WebKit bug 273827)", async () => {
    const base = new IDBFactory();
    const rec = recordingFactory(base);
    const h = await setup({ factory: base, libraryFactory: rec.factory });
    await h.lib.save(clip.bytes, meta({ id: "first" }), clip.videoDurationSec);
    // WebKit dropped the connection while the tab was in the background.
    rec.opened[0].transaction = (() => {
      throw LOST();
    }) as IDBDatabase["transaction"];
    const second = await h.lib.save(clip.bytes, meta({ id: "second" }), clip.videoDurationSec);
    expect(second.record.storage).toBe("opfs");
    expect(second.problems).toEqual([]);
    expect(h.mock.listFiles()).toEqual(["lib/guest/first.mp4", "lib/guest/second.mp4"]);
    expect((await h.lib.list("guest")).map((r) => r.id).sort()).toEqual(["first", "second"]);
    expect(rec.opened.length).toBe(2);
  });

  it("a connection closed under the library opens again for list, read and delete too", async () => {
    const base = new IDBFactory();
    const rec = recordingFactory(base);
    const h = await setup({ factory: base, libraryFactory: rec.factory });
    await h.lib.save(clip.bytes, meta({ id: "keep" }), clip.videoDurationSec);
    rec.opened[0].close();
    expect((await h.lib.list("guest")).map((r) => r.id)).toEqual(["keep"]);
    rec.opened[1].close();
    expect(await fileBytes((await h.lib.read("keep")).file)).toEqual(clip.bytes);
    rec.opened[2].close();
    expect(await h.lib.remove("keep")).toBe(true);
    expect(h.mock.listFiles()).toEqual([]);
  });

  describe("when the row cannot be written at all", () => {
    async function stuckSave(h: Harness, id: string) {
      const db = libraryDb(h.lib);
      const put = vi.spyOn(db, "put").mockRejectedValue(new DOMException("disk", "UnknownError"));
      const result = await h.lib.save(clip.bytes, meta({ id }), clip.videoDurationSec);
      put.mockRestore();
      return result;
    }

    it("keeps the verified file in lib/ and the clip in memory, so nothing is lost", async () => {
      const h = await setup();
      const result = await stuckSave(h, "stuck");
      expect(result.record.storage).toBe("memory");
      expect(result.problems.map((problem) => problem.split(":")[0])).toEqual(["opfs", "idb"]);
      expect(h.mock.listFiles()).toEqual(["lib/guest/stuck.mp4"]);
      expect(await (await h.rows()).chunkIds()).toEqual([]);
      expect(await fileBytes((await h.lib.read("stuck")).file)).toEqual(clip.bytes);
    });

    it("the next startup gives the file a row (kind clip, NEW)", async () => {
      const h = await setup();
      await stuckSave(h, "stuck2");
      const restarted = await setup({ mockInstance: h.mock, factory: h.factory });
      expect(await restarted.lib.reconcile()).toMatchObject({ reindexed: 1 });
      expect(await (await h.rows()).get("stuck2")).toMatchObject({ kind: "clip", watched: false, storage: "opfs" });
    });

    it("deleting the memory clip also deletes the file, so it does not come back", async () => {
      const h = await setup();
      await stuckSave(h, "stuck3");
      expect(await h.lib.remove("stuck3")).toBe(true);
      expect(h.mock.listFiles()).toEqual([]);
      const restarted = await setup({ mockInstance: h.mock, factory: h.factory });
      expect(await restarted.lib.reconcile()).toMatchObject({ reindexed: 0 });
    });
  });
});

describe("tier V WebM and pictures", () => {
  it("stores a WebM as <id>.webm and reads it back as video/webm", async () => {
    const h = await setup();
    const { record } = await h.lib.save(webm.bytes, meta({ id: "tv1", mime: "video/webm" }), webm.videoDurationSec);
    // A WebM SimpleBlock has no duration, so the file ends at the last frame's start:
    // one frame (33 ms) short, well inside the 0.2 s check.
    expect(record).toMatchObject({ storage: "opfs", mime: "video/webm", durationMs: 967, hasAudio: false });
    expect(h.mock.listFiles()).toEqual(["lib/guest/tv1.webm"]);
    const { file } = await h.lib.read("tv1");
    expect(file.type).toBe("video/webm");
    expect(file.name).toBe("snake-clip-2026-09-28.webm");
    expect(await fileBytes(file)).toEqual(webm.bytes);
    expect(await h.lib.remove("tv1")).toBe(true);
    expect(h.mock.listFiles()).toEqual([]);
  });

  it("stores a picture as <id>.png with no duration", async () => {
    const h = await setup();
    const { record } = await h.lib.save(png, meta({ id: "pic1", mime: "image/png", kind: "picture" }), null);
    expect(record).toMatchObject({ storage: "opfs", mime: "image/png", kind: "picture", durationMs: 0, bytes: png.length });
    expect(h.mock.listFiles()).toEqual(["lib/guest/pic1.png"]);
    const { file } = await h.lib.read("pic1");
    expect(file.type).toBe("image/png");
    expect(file.name).toBe("snake-picture-2026-09-28.png");
  });

  it("stores both on the IndexedDB tier too", async () => {
    const h = await setup({ noStorage: true });
    await h.lib.save(webm.bytes, meta({ id: "tv2", mime: "video/webm" }), webm.videoDurationSec);
    await h.lib.save(png, meta({ id: "pic2", mime: "image/png", kind: "picture" }), null);
    expect(await fileBytes((await h.lib.read("tv2")).file)).toEqual(webm.bytes);
    expect((await h.lib.read("pic2")).file.type).toBe("image/png");
  });

  it("refuses bytes that are not the mime type they claim", async () => {
    const h = await setup();
    await expect(h.lib.save(webm.bytes, meta({ mime: "video/mp4" }), 1)).rejects.toMatchObject({ code: "verify-failed" });
    await expect(h.lib.save(clip.bytes, meta({ mime: "video/webm" }), 1)).rejects.toMatchObject({ code: "verify-failed" });
    await expect(h.lib.save(clip.bytes, meta({ mime: "image/png" }), null)).rejects.toMatchObject({ code: "verify-failed" });
    expect(h.mock.listFiles()).toEqual([]);
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

  it("uses the fixed 256 MiB budget where estimate() is missing, and never writes a probe file", async () => {
    const h = await setup({ mock: { quota: 400 * 1024 * 1024, estimate: false } });
    expect((await h.lib.budget()).budgetBytes).toBe(NO_ESTIMATE_BUDGET_BYTES);
    await h.lib.save(clip.bytes, meta({ id: "s16" }), clip.videoDurationSec);
    expect(h.mock.listFiles()).toEqual(["lib/guest/s16.mp4"]);
  });

  it("uses the fixed budget when estimate() fails", async () => {
    const h = await setup({ mock: { quota: 400 * 1024 * 1024 } });
    h.mock.failNext("estimate", new Error("estimate broke"));
    expect((await h.lib.budget()).budgetBytes).toBe(NO_ESTIMATE_BUDGET_BYTES);
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
    await expect(h.lib.save(clip.bytes, meta({ id: "x" }), clip.videoDurationSec)).rejects.toMatchObject({ code: "quota", eviction: null });
    expect(h.mock.listFiles()).toEqual(["lib/guest/k1.mp4", "lib/guest/n1.mp4"]);
  });

  it("a real quota failure on the temp write removes no old clip (other site data filled the quota)", async () => {
    const size = clip.bytes.length;
    const quota = 4 * (2 * size + 10);
    const h = await setup({ mock: { quota } });
    await seedWatchedAuto(h, ["old1", "old2"]);
    // Data that is not the library's fills the origin, so the new clip cannot be written.
    h.mock.writeFile("cache/other.bin", new Uint8Array(quota - h.mock.usage() - Math.floor(size / 2)));
    const error = await h.lib.save(clip.bytes, meta({ id: "new" }), clip.videoDurationSec).catch((e) => e);
    expect(error).toMatchObject({ code: "quota", eviction: null });
    // Both old clips are still there: nothing was removed for a clip that was not saved.
    expect(h.mock.listFiles()).toEqual(["cache/other.bin", "lib/guest/old1.mp4", "lib/guest/old2.mp4"]);
    expect((await (await h.rows()).listAll()).map((r) => r.id).sort()).toEqual(["old1", "old2"]);
    expect(h.messages.filter((m) => "removed" in m)).toEqual([]);
  });

  it("reports every removal when the save goes on to another tier", async () => {
    const size = clip.bytes.length;
    const h = await setup({ mock: { quota: 4 * (2 * size + 10) } });
    await seedWatchedAuto(h, ["e1", "e2"]);
    const put = vi.spyOn(libraryDb(h.lib), "put").mockRejectedValue(new DOMException("disk", "UnknownError"));
    const result = await h.lib.save(clip.bytes, meta({ id: "after" }), clip.videoDurationSec);
    put.mockRestore();
    expect(result.record.storage).toBe("memory");
    expect(result.eviction).toEqual({ kept: ["e2"], removed: ["e1"] });
    expect(h.messages).toContainEqual({ removed: "e1" });
  });

  it("puts the removals on the error when the save fails after them (never a silent eviction)", async () => {
    const size = clip.bytes.length;
    const h = await setup({ mock: { quota: 4 * (2 * size + 10) }, env: { memoryBudgetBytes: 10 } });
    await seedWatchedAuto(h, ["f1", "f2"]);
    const put = vi.spyOn(libraryDb(h.lib), "put").mockRejectedValue(new DOMException("disk", "UnknownError"));
    const error = await h.lib.save(clip.bytes, meta({ id: "lost" }), clip.videoDurationSec).catch((e) => e);
    put.mockRestore();
    expect(error).toBeInstanceOf(LibraryError);
    expect(error.code).toBe("quota");
    expect(error.eviction).toEqual({ kept: ["f2"], removed: ["f1"] });
  });

  it("counts every owner's clips against the one origin budget", async () => {
    const size = clip.bytes.length;
    const h = await setup({ mock: { quota: 4 * (2 * size + 10) } });
    await h.lib.save(clip.bytes, meta({ id: "o1", ownerKey: OTHER, kind: "auto", watched: true }), clip.videoDurationSec);
    await h.lib.save(clip.bytes, meta({ id: "g1" }), clip.videoDurationSec);
    const result = await h.lib.save(clip.bytes, meta({ id: "g2" }), clip.videoDurationSec);
    expect(result.eviction?.removed).toEqual(["o1"]);
  });

  it("does not remove a clip that stopped being removable after the plan (a write outside the lock)", async () => {
    const size = clip.bytes.length;
    const h = await setup({ mock: { quota: 4 * (3 * size + 10) } });
    await seedWatchedAuto(h, ["r1", "r2", "r3"]);
    const db = libraryDb(h.lib);
    const listAll = db.listAll.bind(db);
    const spy = vi.spyOn(db, "listAll").mockImplementation(async () => {
      const rows = await listAll();
      spy.mockRestore();
      // The kid taps Keep on r1 between the plan and the removal.
      await (await h.rows()).update("r1", { kept: true });
      return rows;
    });
    const result = await h.lib.save(clip.bytes, meta({ id: "n" }), clip.videoDurationSec);
    expect(result.eviction).toBeNull();
    expect(await (await h.rows()).get("r1")).toMatchObject({ kept: true });
    expect(h.mock.exists("lib/guest/r1.mp4")).toBe(true);
  });

  it("removes a clip that the UI read a short time ago last", async () => {
    const size = clip.bytes.length;
    const h = await setup({ mock: { quota: 4 * (3 * size + 10) } });
    await seedWatchedAuto(h, ["d1", "d2", "d3"]);
    // d1 is the oldest, but the share sheet has it open.
    await h.lib.read("d1");
    const result = await h.lib.save(clip.bytes, meta({ id: "n" }), clip.videoDurationSec);
    expect(result.eviction?.removed).toEqual(["d2"]);
    // Ten minutes later the deferral is over.
    h.clock.now += 11 * 60 * 1000;
    const later = await h.lib.save(clip.bytes, meta({ id: "n2" }), clip.videoDurationSec);
    expect(later.eviction?.removed).toEqual(["d1"]);
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

  it("applies the memory budget and evicts watched auto clips", async () => {
    const size = clip.bytes.length;
    const h = await setup({ mock: { privateMode: true }, env: { memoryBudgetBytes: 2 * size + 10 } });
    await h.lib.save(clip.bytes, meta({ id: "m1", kind: "auto", watched: true }), clip.videoDurationSec);
    await h.lib.save(clip.bytes, meta({ id: "m2" }), clip.videoDurationSec);
    const third = await h.lib.save(clip.bytes, meta({ id: "m3" }), clip.videoDurationSec);
    expect(third.eviction).toEqual({ kept: ["m2"], removed: ["m1"] });
    await expect(h.lib.save(clip.bytes, meta({ id: "m4" }), clip.videoDurationSec)).rejects.toMatchObject({ code: "quota" });
    expect(await h.lib.budget()).toEqual({ budgetBytes: 2 * size + 10, usedBytes: 2 * size });
  });

  it("sizes the memory budget by the memory class: low until the class arrives (plan 6.5)", async () => {
    const h = await setup({ mock: { privateMode: true } });
    expect((await h.lib.budget()).budgetBytes).toBe(MEMORY_BUDGET_BYTES.low);
    h.lib.setMemoryClass("high");
    expect((await h.lib.budget()).budgetBytes).toBe(MEMORY_BUDGET_BYTES.high);
    const mid = await setup({ mock: { privateMode: true }, env: { memoryClass: "mid" } });
    expect((await mid.lib.budget()).budgetBytes).toBe(MEMORY_BUDGET_BYTES.mid);
  });

  it("lets the UI mark a memory clip watched, so it can be evicted", async () => {
    const size = clip.bytes.length;
    const h = await setup({ mock: { privateMode: true }, env: { memoryBudgetBytes: 2 * size + 10 } });
    await h.lib.save(clip.bytes, meta({ id: "w1", kind: "auto" }), clip.videoDurationSec);
    await h.lib.save(clip.bytes, meta({ id: "w2", kind: "auto" }), clip.videoDurationSec);
    // Both are NEW, so a third clip does not fit.
    await expect(h.lib.save(clip.bytes, meta({ id: "w3" }), clip.videoDurationSec)).rejects.toMatchObject({ code: "quota" });
    expect(await h.lib.update("w1", { watched: true })).toMatchObject({ id: "w1", watched: true, storage: "memory" });
    const third = await h.lib.save(clip.bytes, meta({ id: "w3" }), clip.videoDurationSec);
    expect(third.eviction?.removed).toEqual(["w1"]);
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

describe("update (the io worker is the only row writer)", () => {
  it("changes Keep, watched and stars, and tells other tabs", async () => {
    const h = await setup();
    await h.lib.save(clip.bytes, meta({ id: "u1", kind: "auto" }), clip.videoDurationSec);
    const moments = [{ kind: "win" as const, label: "Win!", emoji: "🏁", priority: "featured" as const, offsetSec: -2 }];
    const next = await h.lib.update("u1", { kept: true, watched: true, moments, challengeScore: 900 });
    expect(next).toMatchObject({ id: "u1", kept: true, watched: true, moments, challengeScore: 900 });
    expect(await (await h.rows()).get("u1")).toEqual(next);
    expect(h.messages).toContainEqual({ updated: "u1" });
    expect(h.lockDepth()).toBe(0);
  });

  it("a claim (guest to player) moves the file with the row; read, delete and reconcile then agree", async () => {
    const h = await setup();
    await h.lib.save(clip.bytes, meta({ id: "c1" }), clip.videoDurationSec);
    expect(await h.lib.update("c1", { ownerKey: USER })).toMatchObject({ ownerKey: USER });
    expect(h.mock.listFiles()).toEqual([`lib/${USER}/c1.mp4`]);
    expect(await fileBytes((await h.lib.read("c1")).file)).toEqual(clip.bytes);
    expect((await h.lib.list(USER)).map((r) => r.id)).toEqual(["c1"]);
    expect(await h.lib.list("guest")).toEqual([]);
    expect(await h.lib.remove("c1")).toBe(true);
    expect(h.mock.listFiles()).toEqual([]);
    expect(await h.lib.reconcile()).toMatchObject({ reindexed: 0, missing: 0 });
    expect(await h.lib.list("guest")).toEqual([]);
  });

  it("a give-back (player to guest) moves the file back", async () => {
    const h = await setup();
    await h.lib.save(clip.bytes, meta({ id: "c2", ownerKey: USER }), clip.videoDurationSec);
    await h.lib.update("c2", { ownerKey: "guest" });
    expect(h.mock.listFiles()).toEqual(["lib/guest/c2.mp4"]);
  });

  it("refuses a move from one player straight to another, and a bad patch; nothing changes", async () => {
    const h = await setup();
    await h.lib.save(clip.bytes, meta({ id: "c3", ownerKey: USER }), clip.videoDurationSec);
    await expect(h.lib.update("c3", { ownerKey: OTHER })).rejects.toThrow(TypeError);
    await expect(h.lib.update("c3", { storage: "idb" })).rejects.toThrow(TypeError);
    await expect(h.lib.update("c3", { kept: "yes" })).rejects.toThrow(TypeError);
    expect(h.mock.listFiles()).toEqual([`lib/${USER}/c3.mp4`]);
    expect(await (await h.rows()).get("c3")).toMatchObject({ ownerKey: USER, kept: false, storage: "opfs" });
  });

  it("gives not-found for an unknown clip", async () => {
    const h = await setup();
    await expect(h.lib.update("nope", { kept: true })).rejects.toMatchObject({ code: "not-found" });
    await expect(h.lib.update("../x", { kept: true })).rejects.toMatchObject({ code: "not-found" });
  });

  it("an IndexedDB clip changes owner in the row only", async () => {
    const h = await setup({ noStorage: true });
    await h.lib.save(clip.bytes, meta({ id: "c4" }), clip.videoDurationSec);
    await h.lib.update("c4", { ownerKey: USER });
    expect((await h.lib.list(USER)).map((r) => r.id)).toEqual(["c4"]);
    expect(await fileBytes((await h.lib.read("c4")).file)).toEqual(clip.bytes);
  });

  it("puts the file back when the row change fails, so the file and the row agree", async () => {
    const h = await setup();
    await h.lib.save(clip.bytes, meta({ id: "c5" }), clip.videoDurationSec);
    vi.spyOn(libraryDb(h.lib), "update").mockRejectedValue(new DOMException("disk", "UnknownError"));
    await expect(h.lib.update("c5", { ownerKey: USER })).rejects.toMatchObject({ name: "UnknownError" });
    expect(h.mock.listFiles()).toEqual(["lib/guest/c5.mp4"]);
    expect(await (await h.rows()).get("c5")).toMatchObject({ ownerKey: "guest" });
  });

  it("a row whose owner changed without its file (a write outside the io worker) is still read, deleted and not brought back", async () => {
    // The review's reproduction: before the fix, read gave not-found, delete left the
    // file, and the next reconcile brought the deleted clip back as a NEW guest clip.
    const h = await setup();
    await h.lib.save(clip.bytes, meta({ id: "c6" }), clip.videoDurationSec);
    await (await h.rows()).update("c6", { ownerKey: USER });
    expect(await fileBytes((await h.lib.read("c6")).file)).toEqual(clip.bytes);
    expect(await h.lib.remove("c6")).toBe(true);
    expect(h.mock.listFiles()).toEqual([]);
    expect(await h.lib.reconcile()).toMatchObject({ reindexed: 0 });
    expect(await h.lib.list("guest")).toEqual([]);
    expect(await h.lib.list(USER)).toEqual([]);
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

  it("gives a WebM its mime type and a PNG the kind picture", async () => {
    const h = await setup();
    h.mock.writeFile("lib/guest/lostw.webm", webm.bytes);
    h.mock.writeFile("lib/guest/lostp.png", png);
    expect(await h.lib.reconcile()).toMatchObject({ reindexed: 2 });
    const db = await h.rows();
    expect(await db.get("lostw")).toMatchObject({ mime: "video/webm", kind: "clip", durationMs: 967, hasAudio: false });
    expect(await db.get("lostp")).toMatchObject({ mime: "image/png", kind: "picture", width: 3, height: 2, durationMs: 0 });
  });

  it("removes a row whose file is gone, and counts it", async () => {
    const h = await setup();
    await seedRow(h, { id: "ghost" });
    const result = await h.lib.reconcile();
    expect(result).toMatchObject({ missing: 1, reindexed: 0 });
    expect(await (await h.rows()).get("ghost")).toBeUndefined();
    expect(h.messages).toContainEqual({ removed: "ghost" });
  });

  it("removes a file without a row that does not parse, or that is cut (a copy that stopped), and counts it", async () => {
    const h = await setup();
    h.mock.writeFile("lib/guest/junk.mp4", new Uint8Array(500).fill(1));
    h.mock.writeFile("lib/guest/half.mp4", clip2s.bytes.subarray(0, clip2s.bytes.length - 100));
    const result = await h.lib.reconcile();
    expect(result).toMatchObject({ unreadable: 2, reindexed: 0 });
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

  it("keeps a moved file that the check meets again in its new folder (the folder comes later in the walk)", async () => {
    const h = await setup();
    // The guest folder comes first, and the owner's folder already exists.
    h.mock.writeFile("lib/guest/walk.mp4", clip.bytes);
    await h.lib.save(clip.bytes, meta({ id: "other", ownerKey: USER }), clip.videoDurationSec);
    await seedRow(h, { id: "walk", ownerKey: USER });
    const result = await h.lib.reconcile();
    expect(result).toMatchObject({ relocated: 1, missing: 0, errors: 0 });
    expect(h.mock.listFiles()).toEqual([`lib/${USER}/other.mp4`, `lib/${USER}/walk.mp4`]);
    expect(await (await h.rows()).get("walk")).toBeTruthy();
  });

  it("keeps one copy of a file found in two owner folders (a copy-move that stopped)", async () => {
    const h = await setup();
    await seedRow(h, { id: "twice", ownerKey: USER });
    h.mock.writeFile("lib/guest/twice.mp4", clip.bytes);
    h.mock.writeFile(`lib/${USER}/twice.mp4`, clip.bytes);
    const result = await h.lib.reconcile();
    expect(result).toMatchObject({ missing: 0, errors: 0 });
    expect(h.mock.listFiles()).toEqual([`lib/${USER}/twice.mp4`]);
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
