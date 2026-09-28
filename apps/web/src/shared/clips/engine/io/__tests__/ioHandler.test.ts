// @vitest-environment node
/**
 * The io worker's command loop, end to end on the shared OPFS double and
 * fake-indexeddb: real mux, real roll-group patch, real library. Node has no
 * VideoDecoder, so posters are the placeholder (the poster fallback path).
 */
import { BufferSource, Input, MP4 } from "mediabunny";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type OpfsMock, createOpfsMock } from "../../../../../__tests__/opfs-mock";
import type { IoCmd, IoEvent } from "../../../protocol";
import type { StorageLike } from "../../../library/fsTypes";
import { ClipLibrary } from "../../../library/opfsStore";
import { describeBoxes } from "../moovPatch";
import { type IoHandler, type IoLibrary, createIoHandler } from "../ioHandler";
import { type IoWorkerScope, installIoWorker, isWorkerScope } from "../io.worker";
import { PLACEHOLDER_POSTER } from "../poster";
import { makeClipPackets } from "./fixtures";

// Each test muxes and parses real MP4 bytes. That is fast alone, but a busy machine
// (a parallel gate or a browser sweep) can pass the 5 s default.
vi.setConfig({ testTimeout: 30_000 });

type MuxCmd = Extract<IoCmd, { t: "mux" }>;

function muxCmd(id: string, overrides: Partial<MuxCmd["meta"]> = {}, clipOptions: Parameters<typeof makeClipPackets>[0] = {}): MuxCmd {
  return {
    t: "mux",
    packets: makeClipPackets({ seconds: 1, ...clipOptions }),
    meta: {
      id,
      ownerKey: "guest",
      gameId: "snake",
      kind: "clip",
      createdAt: Date.UTC(2026, 8, 28, 12),
      durationMs: 5000,
      width: 64,
      height: 64,
      fps: 30,
      hasAudio: false,
      mime: "video/mp4",
      kept: false,
      watched: false,
      moments: [{ kind: "new-best", label: "New best!", emoji: "🏆", priority: "featured", offsetSec: -1 }],
      ...overrides,
    },
  };
}

const libraries: ClipLibrary[] = [];

async function harness(options: { quota?: number; privateMode?: boolean } = {}) {
  const mock: OpfsMock = createOpfsMock({ quota: options.quota, privateMode: options.privateMode });
  const factory = new IDBFactory();
  const events: IoEvent[] = [];
  const handler: IoHandler = createIoHandler({
    post: (event) => events.push(event),
    openLibrary: async () => {
      const lib = await ClipLibrary.open({
        storage: mock.storage as unknown as StorageLike,
        indexedDB: factory,
        keyRange: IDBKeyRange,
        locks: null,
        channel: null,
      });
      libraries.push(lib);
      return lib;
    },
  });
  const send = async (cmd: IoCmd) => {
    await handler.handle(cmd);
    return events.at(-1)!;
  };
  return { mock, events, handler, send };
}

afterEach(() => {
  libraries.splice(0).forEach((lib) => lib.close());
});

describe("io command loop", () => {
  it("runs the startup check once, before the first command's result", async () => {
    const h = await harness();
    h.mock.writeFile("lib/guest/orphan.mp4", new Uint8Array(100).fill(3));
    await h.handler.handle({ t: "list", ownerKey: "guest" });
    await h.handler.handle({ t: "list", ownerKey: "guest" });
    expect(h.events).toEqual([
      { t: "reconciled", reindexed: 0, missing: 0, unreadable: 1 },
      { t: "list", records: [] },
      { t: "list", records: [] },
    ]);
  });

  it("start() runs the startup check once, and commands after it do not repeat it", async () => {
    const h = await harness();
    h.mock.writeFile(`lib/guest/lost.mp4`, new Uint8Array(10));
    await Promise.all([h.handler.start(), h.handler.start()]);
    expect(h.events).toEqual([{ t: "reconciled", reindexed: 0, missing: 0, unreadable: 1 }]);
    await h.handler.handle({ t: "list", ownerKey: "guest" });
    expect(h.events.map((event) => event.t)).toEqual(["reconciled", "list"]);
  });

  it("mux: saves a patched, verified clip and reports the record", async () => {
    const h = await harness();
    const event = await h.send(muxCmd("c1"));
    expect(event.t).toBe("saved");
    const saved = event as Extract<IoEvent, { t: "saved" }>;
    expect(saved.record).toMatchObject({
      id: "c1",
      storage: "opfs",
      durationMs: 1000,
      hasAudio: true,
      mime: "video/mp4",
      posterDataUrl: PLACEHOLDER_POSTER,
      moments: [{ kind: "new-best" }],
    });
    expect(saved.muxMs).toBeGreaterThanOrEqual(0);
    const bytes = h.mock.readFile("lib/guest/c1.mp4")!;
    expect(saved.record.bytes).toBe(bytes.length);
    // The stored file has the roll group and no metadata box.
    const boxes = describeBoxes(bytes);
    expect(boxes).toContain("/moov/trak/mdia/minf/stbl/sgpd");
    expect(boxes).toContain("/moov/trak/mdia/minf/stbl/sbgp");
    expect(boxes.some((path) => path.endsWith("/udta") || path.endsWith("/meta"))).toBe(false);
    const input = new Input({ formats: [MP4], source: new BufferSource(bytes) });
    expect(await input.computeDuration()).toBeGreaterThan(0.9);
    input.dispose();
  });

  it("mux: a video-only clip gets no roll group", async () => {
    const h = await harness();
    const event = await h.send(muxCmd("v1", {}, { audio: false }));
    expect(event).toMatchObject({ t: "saved", record: { hasAudio: false } });
    expect(describeBoxes(h.mock.readFile("lib/guest/v1.mp4")!).some((path) => path.endsWith("sgpd"))).toBe(false);
  });

  it("read, list and delete", async () => {
    const h = await harness();
    await h.send(muxCmd("c1"));
    await h.send(muxCmd("c2", { createdAt: Date.UTC(2026, 8, 29) }));
    const list = await h.send({ t: "list", ownerKey: "guest" });
    expect(list.t === "list" && list.records.map((r) => r.id)).toEqual(["c2", "c1"]);
    const read = await h.send({ t: "read", id: "c1" });
    expect(read.t).toBe("file");
    const file = (read as Extract<IoEvent, { t: "file" }>).file;
    expect(file.name).toBe("snake-clip-2026-09-28.mp4");
    expect(file.type).toBe("video/mp4");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(h.mock.readFile("lib/guest/c1.mp4"));
    expect(await h.send({ t: "delete", id: "c1" })).toEqual({ t: "deleted", id: "c1" });
    expect(await h.send({ t: "read", id: "c1" })).toMatchObject({ t: "error", code: "not-found", id: "c1" });
    // Deleting again is not an error: the result is the same.
    expect(await h.send({ t: "delete", id: "c1" })).toEqual({ t: "deleted", id: "c1" });
  });

  it("mux errors carry the clip id and the reason", async () => {
    const h = await harness();
    const cmd = muxCmd("bad");
    cmd.packets.video.shift(); // The clip now starts on a delta frame.
    expect(await h.send(cmd)).toMatchObject({ t: "error", code: "mux-failed", id: "bad", detail: expect.stringContaining("first-not-key") });
    expect(h.mock.listFiles()).toEqual([]);
  });

  it("rejects ids and owner keys that are not safe", async () => {
    const h = await harness();
    expect(await h.send(muxCmd("../x"))).toMatchObject({ t: "error", code: "mux-failed" });
    expect(await h.send(muxCmd("ok", { ownerKey: "../../etc" }))).toMatchObject({ t: "error", code: "mux-failed", id: "ok" });
    expect(await h.send({ t: "read", id: "../x" })).toMatchObject({ t: "error", code: "not-found" });
    expect(await h.send({ t: "delete", id: "a/b" })).toMatchObject({ t: "error", code: "not-found" });
    expect(await h.send({ t: "list", ownerKey: "../x" })).toEqual({ t: "list", records: [] });
    expect(h.mock.listFiles()).toEqual([]);
  });

  it("reports a quota error with the clip id", async () => {
    const h = await harness({ quota: 4000 });
    expect(await h.send(muxCmd("big"))).toMatchObject({ t: "error", code: "quota", id: "big" });
  });

  it("reports removed clips before the saved clip when the budget needs space", async () => {
    const probe = await harness();
    await probe.send(muxCmd("size"));
    const size = probe.mock.readFile("lib/guest/size.mp4")!.length;
    const h = await harness({ quota: 4 * (2 * size + 50) });
    await h.send(muxCmd("old", { kind: "auto", watched: true, createdAt: 1 }));
    await h.send(muxCmd("mine", { createdAt: 2 }));
    await h.handler.handle(muxCmd("new", { createdAt: 3 }));
    expect(h.events.slice(-2)).toEqual([
      { t: "evicted", kept: ["mine"], removed: ["old"] },
      expect.objectContaining({ t: "saved", record: expect.objectContaining({ id: "new" }) }),
    ]);
  });

  it("saves to memory in a private window", async () => {
    const h = await harness({ privateMode: true });
    expect(await h.send(muxCmd("p1"))).toMatchObject({ t: "saved", record: { storage: "memory" } });
    expect(await h.send({ t: "read", id: "p1" })).toMatchObject({ t: "file", id: "p1" });
  });

  it("answers commands in the order they came, even when they arrive together", async () => {
    const h = await harness();
    await Promise.all([
      h.handler.handle(muxCmd("a")),
      h.handler.handle({ t: "read", id: "a" }),
      h.handler.handle({ t: "list", ownerKey: "guest" }),
      h.handler.handle({ t: "delete", id: "a" }),
    ]);
    expect(h.events.map((event) => event.t)).toEqual(["reconciled", "saved", "file", "list", "deleted"]);
  });

  it("reports an unknown command and keeps working", async () => {
    const h = await harness();
    await h.handler.handle({ t: "nope" } as unknown as IoCmd);
    expect(h.events.at(-1)).toMatchObject({ t: "error", code: "mux-failed", detail: expect.stringContaining("nope") });
    expect(await h.send({ t: "list", ownerKey: "guest" })).toEqual({ t: "list", records: [] });
  });

  it("reports a startup check failure and still serves commands", async () => {
    const events: IoEvent[] = [];
    const library: IoLibrary = {
      reconcile: async () => {
        throw new Error("idb broke");
      },
      list: async () => [],
      save: vi.fn(),
      read: vi.fn(),
      remove: vi.fn(),
    };
    const handler = createIoHandler({ post: (event) => events.push(event), openLibrary: async () => library });
    await handler.handle({ t: "list", ownerKey: "guest" });
    expect(events).toEqual([
      { t: "error", code: "opfs-unavailable", detail: expect.stringContaining("idb broke") },
      { t: "list", records: [] },
    ]);
  });

  it("tries to open the library again after an open failure", async () => {
    const events: IoEvent[] = [];
    let attempts = 0;
    const library: IoLibrary = {
      reconcile: async () => ({ reindexed: 0, missing: 0, unreadable: 0, relocated: 0, orphanChunks: 0, staleTemp: 0, errors: 0 }),
      list: async () => [],
      save: vi.fn(),
      read: vi.fn(),
      remove: vi.fn(),
    };
    const handler = createIoHandler({
      post: (event) => events.push(event),
      openLibrary: async () => {
        attempts++;
        if (attempts === 1) throw new Error("first open failed");
        return library;
      },
    });
    await handler.handle({ t: "list", ownerKey: "guest" });
    expect(events).toEqual([{ t: "error", code: "opfs-unavailable", detail: "Error: first open failed" }]);
    await handler.handle({ t: "list", ownerKey: "guest" });
    expect(attempts).toBe(2);
    expect(events.slice(1)).toEqual([{ t: "reconciled", reindexed: 0, missing: 0, unreadable: 0 }, { t: "list", records: [] }]);
  });

  it("turns an unexpected library failure into an error event", async () => {
    const events: IoEvent[] = [];
    const library: IoLibrary = {
      reconcile: async () => ({ reindexed: 0, missing: 0, unreadable: 0, relocated: 0, orphanChunks: 0, staleTemp: 0, errors: 0 }),
      list: async () => {
        throw new TypeError("boom");
      },
      save: async () => {
        throw new Error("disk gone");
      },
      read: vi.fn(),
      remove: vi.fn(),
    };
    const handler = createIoHandler({ post: (event) => events.push(event), openLibrary: async () => library });
    await handler.handle({ t: "list", ownerKey: "guest" });
    await handler.handle(muxCmd("x"));
    expect(events.slice(1)).toEqual([
      { t: "error", code: "opfs-unavailable", detail: "TypeError: boom" },
      { t: "error", code: "opfs-unavailable", detail: "Error: disk gone", id: "x" },
    ]);
  });
});

describe("io.worker entry", () => {
  it("does not start outside a worker", () => {
    expect(isWorkerScope()).toBe(false);
  });

  it("detects a worker scope by WorkerGlobalScope", () => {
    class FakeWorkerGlobalScope {}
    const holder = globalThis as { WorkerGlobalScope?: unknown };
    holder.WorkerGlobalScope = FakeWorkerGlobalScope;
    try {
      expect(isWorkerScope(new FakeWorkerGlobalScope())).toBe(true);
      expect(isWorkerScope({})).toBe(false);
    } finally {
      delete holder.WorkerGlobalScope;
    }
  });

  it("connects messages to the command loop and posts events back", async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const posted: IoEvent[] = [];
    const scope: IoWorkerScope = {
      postMessage: (message) => posted.push(message),
      addEventListener: (type: string, listener: (event: never) => void) => {
        listeners.set(type, listener as (event: unknown) => void);
      },
    };
    const library: IoLibrary = {
      reconcile: async () => ({ reindexed: 0, missing: 0, unreadable: 0, relocated: 0, orphanChunks: 0, staleTemp: 0, errors: 0 }),
      list: async (ownerKey) => (ownerKey === "guest" ? [] : []),
      save: vi.fn(),
      read: vi.fn(),
      remove: vi.fn(),
    };
    const handler = installIoWorker(scope, { openLibrary: async () => library });
    // The startup check runs at load, before any command.
    await handler.idle();
    expect(posted).toEqual([{ t: "reconciled", reindexed: 0, missing: 0, unreadable: 0 }]);
    listeners.get("message")!({ data: { t: "list", ownerKey: "guest" } });
    await handler.idle();
    expect(posted).toEqual([{ t: "reconciled", reindexed: 0, missing: 0, unreadable: 0 }, { t: "list", records: [] }]);
    listeners.get("messageerror")!({});
    expect(posted.at(-1)).toMatchObject({ t: "error", code: "mux-failed" });
  });
});
