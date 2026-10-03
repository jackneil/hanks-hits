// @vitest-environment node
/**
 * The library client against the real io command loop (in process), the real
 * library, the shared OPFS double and fake-indexeddb.
 */
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createOpfsMock } from "../../../../__tests__/opfs-mock";
import { createIoHandler, type IoLibrary } from "../../engine/io/ioHandler";
import { PNG_3X2_HEX, hexBytes, makeClipPackets } from "../../engine/io/__tests__/fixtures";
import type { StorageLike } from "../../library/fsTypes";
import { ClipLibrary } from "../../library/opfsStore";
import type { ClipMeta, IoCmd, IoEvent, RecordTeeMsg } from "../../protocol";
import { OWNER_MEMORY_ITEM, IoClient, getClipLibrary, type ChannelLike, type IoWorkerLike, type SessionBusLike } from "../ioClient";
import { ownerKeyFor } from "../../library/ownerKey";
import { isClearedOnSignOut } from "@/lib/storage-keys";

const libraries: ClipLibrary[] = [];
const clients: IoClient[] = [];

afterEach(() => {
  clients.splice(0).forEach((c) => c.dispose());
  libraries.splice(0).forEach((l) => l.close());
});

/** The io worker, in process: the real command loop behind a Worker-shaped object. */
class InProcessWorker implements IoWorkerLike {
  onmessage: ((event: MessageEvent<IoEvent>) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  terminated = false;
  readonly sent: IoCmd[] = [];
  readonly handler;
  constructor(openLibrary: () => Promise<IoLibrary>) {
    this.handler = createIoHandler({
      post: (event) => queueMicrotask(() => this.onmessage?.({ data: event } as MessageEvent<IoEvent>)),
      openLibrary,
    });
    void this.handler.start();
  }
  postMessage(message: IoCmd): void {
    this.sent.push(message);
    void this.handler.handle(message);
  }
  terminate(): void {
    this.terminated = true;
  }
}

class FakeChannel implements ChannelLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  closed = false;
  close(): void {
    this.closed = true;
  }
}

/** The session bus (registry.ts) as a test double. */
class FakeBus implements SessionBusLike {
  latest: { userId: string | null } | null = null;
  readonly listeners = new Set<(userId: string | null) => void>();
  current() {
    return this.latest;
  }
  subscribe(listener: (userId: string | null) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  publish(userId: string | null) {
    this.latest = { userId };
    for (const l of [...this.listeners]) l(userId);
  }
}

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

function setup(options: { userId?: string | null; bus?: FakeBus; memory?: MemoryStorage } = {}) {
  const opfs = createOpfsMock();
  const factory = new IDBFactory();
  const openLibrary = async () => {
    const lib = await ClipLibrary.open({ storage: opfs.storage as unknown as StorageLike, indexedDB: factory, keyRange: IDBKeyRange, locks: null, channel: null });
    libraries.push(lib);
    return lib;
  };
  const workers: InProcessWorker[] = [];
  const channels: FakeChannel[] = [];
  const session = { userId: options.userId ?? null };
  const readUserId = vi.fn(async () => session.userId);
  const bus = options.bus ?? new FakeBus();
  const memory = options.memory ?? new MemoryStorage();
  const client = new IoClient({
    createWorker: async () => {
      const w = new InProcessWorker(openLibrary);
      workers.push(w);
      return w;
    },
    host: () => "hankshits.com",
    openChannel: () => {
      const c = new FakeChannel();
      channels.push(c);
      return c;
    },
    readUserId,
    sessionBus: bus,
    ownerMemory: memory,
    log: () => undefined,
  });
  clients.push(client);
  return { client, workers, channels, readUserId, opfs, bus, memory, session };
}

function meta(id: string, extra: Partial<ClipMeta> = {}): ClipMeta {
  return {
    id,
    ownerKey: "guest",
    gameId: "snake",
    kind: "clip",
    createdAt: new Date(2026, 8, 28, 14, 5).getTime(),
    durationMs: 1000,
    width: 64,
    height: 64,
    fps: 30,
    hasAudio: true,
    mime: "video/mp4",
    kept: false,
    watched: false,
    moments: [],
    ...extra,
  };
}

describe("io client", () => {
  it("muxes a clip, lists it for its owner, and hands out a file with the plan 12 name", async () => {
    const { client } = setup();
    const record = await client.mux(makeClipPackets({ seconds: 1 }), meta("c1"));
    expect(record).toMatchObject({ id: "c1", kind: "clip", ownerKey: "guest" });
    const api = client.libraryApi();
    expect((await api.list()).map((r) => r.id)).toEqual(["c1"]);
    expect(await api.list({ gameId: "other" })).toEqual([]);
    expect(await api.list({ kind: "record" })).toEqual([]);
    const file = await api.file("c1");
    expect(file.name).toBe("hankshits-com-snake-20260928-1405.mp4");
    expect(file.type).toBe("video/mp4");
    expect(file.size).toBe(record.bytes);
  });

  it("matches answers to their own commands by request id", async () => {
    const { client } = setup();
    const png = hexBytes(PNG_3X2_HEX).buffer;
    const [picture, list, usage] = await Promise.all([
      client.picture(png, meta("p1", { kind: "picture", mime: "image/png" })),
      client.list("guest"),
      client.usage("guest"),
    ]);
    // The worker runs commands in order: the list and the usage see the picture.
    expect(picture.id).toBe("p1");
    expect(list.map((r) => r.id)).toEqual(["p1"]);
    expect(usage).toMatchObject({ count: 1, bytes: hexBytes(PNG_3X2_HEX).byteLength });
  });

  it("marks watched and kept through the io worker's update, and removes", async () => {
    const { client } = setup();
    await client.mux(makeClipPackets({ seconds: 1 }), meta("c2"));
    const api = client.libraryApi();
    await api.markWatched("c2");
    await api.setKept("c2", true);
    expect((await api.list())[0]).toMatchObject({ watched: true, kept: true });
    expect((await api.list({ kept: true })).map((r) => r.id)).toEqual(["c2"]);
    await api.remove("c2");
    expect(await api.list()).toEqual([]);
  });

  it("rejects with the worker's code", async () => {
    const { client } = setup();
    await expect(client.read("missing")).rejects.toMatchObject({ name: "IoError", code: "not-found" });
    await expect(client.libraryApi().markWatched("nope")).rejects.toMatchObject({ code: "not-found" });
  });

  it("reads the owner from the session once, and follows setOwnerKey", async () => {
    const { client, readUserId } = setup({ userId: "user-1" });
    const key = await client.ownerKey();
    expect(key).toMatch(/^u_[0-9a-f]{20}$/);
    await client.ownerKey();
    expect(readUserId).toHaveBeenCalledTimes(1);
    await client.mux(makeClipPackets({ seconds: 1 }), meta("mine", { ownerKey: key }));
    await client.mux(makeClipPackets({ seconds: 1 }), meta("guests"));
    expect((await client.libraryApi().list()).map((r) => r.id)).toEqual(["mine"]);
    client.setOwnerKey("guest");
    expect((await client.libraryApi().list()).map((r) => r.id)).toEqual(["guests"]);
  });

  it("never keeps a failed session read: guest with nothing remembered, then the real owner at the next call", async () => {
    const { client, readUserId, memory } = setup({ userId: "user-1" });
    readUserId.mockRejectedValueOnce(new TypeError("offline"));
    expect(await client.resolveOwner()).toEqual({ key: "guest", confirmed: false });
    // The guess is not kept, and not remembered.
    expect(memory.getItem(OWNER_MEMORY_ITEM)).toBeNull();
    const key = await ownerKeyFor("user-1");
    expect(await client.resolveOwner()).toEqual({ key, confirmed: true });
    expect(memory.getItem(OWNER_MEMORY_ITEM)).toBe(key);
    expect(readUserId).toHaveBeenCalledTimes(2);
  });

  it("opens the last confirmed player's clips offline (plan 8.1: My Clips works offline)", async () => {
    const online = setup({ userId: "user-1" });
    const key = await online.client.ownerKey();
    await online.client.mux(makeClipPackets({ seconds: 1 }), meta("mine", { ownerKey: key }));
    await online.client.mux(makeClipPackets({ seconds: 1 }), meta("guests"));
    // A new page, offline: the same device (worker, library and localStorage), and the session read fails.
    const offlineRead = vi.fn(async (): Promise<string | null> => {
      throw new TypeError("offline");
    });
    const page = new IoClient({
      createWorker: async () => online.workers[0],
      readUserId: offlineRead,
      sessionBus: null,
      ownerMemory: online.memory,
      log: () => undefined,
    });
    clients.push(page);
    expect(await page.resolveOwner()).toEqual({ key, confirmed: false });
    expect((await page.libraryApi().list()).map((r) => r.id)).toEqual(["mine"]);
  });

  it("keeps the remembered player under a key that sign-out clears, so an offline read never opens a signed-out player's clips", () => {
    expect(isClearedOnSignOut(OWNER_MEMORY_ITEM)).toBe(true);
  });

  it("follows a client-side sign-in on the session bus, with no game mounted (plan 8.1 partitions)", async () => {
    const { client, bus, session } = setup();
    const heard = vi.fn();
    client.subscribe(heard);
    await client.mux(makeClipPackets({ seconds: 1 }), meta("guest-clip"));
    const userKey = await ownerKeyFor("user-1");
    await client.mux(makeClipPackets({ seconds: 1 }), meta("user-clip", { ownerKey: userKey }));
    expect((await client.libraryApi().list()).map((r) => r.id)).toEqual(["guest-clip"]);
    heard.mockClear();
    // The /login page signs in (router.push, the same page): next-auth's session changes.
    session.userId = "user-1";
    bus.publish("user-1");
    await vi.waitFor(() => expect(heard).toHaveBeenCalled());
    expect((await client.libraryApi().list()).map((r) => r.id)).toEqual(["user-clip"]);
    // Sign-out: null means "read again", and the read says guest.
    session.userId = null;
    bus.publish(null);
    expect((await client.libraryApi().list()).map((r) => r.id)).toEqual(["guest-clip"]);
  });

  it("never hands out another player's clip file", async () => {
    const { client } = setup();
    const otherKey = await ownerKeyFor("someone-else");
    await client.mux(makeClipPackets({ seconds: 1 }), meta("theirs", { ownerKey: otherKey }));
    await client.mux(makeClipPackets({ seconds: 1 }), meta("mine"));
    await expect(client.libraryApi().file("theirs")).rejects.toMatchObject({ name: "IoError", code: "not-found" });
    expect((await client.libraryApi().file("mine")).size).toBeGreaterThan(0);
  });

  it("keeps recovered recordings for their owner and hands each out once", async () => {
    const { client, workers } = setup();
    const heard = vi.fn();
    client.subscribe(heard);
    await client.list("guest");
    const record = await client.mux(makeClipPackets({ seconds: 1 }), meta("rec-old", { kind: "record" }));
    const theirs = { ...record, id: "rec-theirs", ownerKey: await ownerKeyFor("other") };
    workers[0].onmessage?.({ data: { t: "recovered", records: [record, theirs] } } as MessageEvent<IoEvent>);
    expect(heard).toHaveBeenCalled();
    const api = client.libraryApi();
    expect((await api.takeRecovered!()).map((r) => r.id)).toEqual(["rec-old"]);
    expect(await api.takeRecovered!()).toEqual([]);
  });

  it("tells subscribers about local changes and other tabs, and closes the channel after the last one leaves", async () => {
    const { client, channels } = setup();
    const heard = vi.fn();
    const stop = client.subscribe(heard);
    await client.mux(makeClipPackets({ seconds: 1 }), meta("c3"));
    expect(heard).toHaveBeenCalled();
    heard.mockClear();
    channels[0].onmessage?.({ data: { added: "x" } } as MessageEvent);
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    expect(channels[0].closed).toBe(true);
  });

  it("fails pending commands when the worker dies, and starts a new worker at the next call", async () => {
    const { client, workers } = setup();
    await client.list("guest");
    client.configure("mid");
    const first = workers[0];
    first.handler.handle = () => new Promise(() => undefined);
    const hung = client.list("guest");
    await Promise.resolve();
    await Promise.resolve();
    first.onerror?.(new Event("error"));
    await expect(hung).rejects.toMatchObject({ code: "worker-failed" });
    expect(first.terminated).toBe(true);
    expect(await client.list("guest")).toEqual([]);
    expect(workers).toHaveLength(2);
    // The memory class is sent again to the new worker.
    expect(workers[1].sent[0]).toEqual({ t: "configure", memoryClass: "mid" });
  });

  it("rejects when the worker cannot start, and tries again later", async () => {
    let attempts = 0;
    const client = new IoClient({
      createWorker: async () => {
        attempts++;
        throw new DOMException("blocked", "SecurityError");
      },
      readUserId: async () => null,
      sessionBus: null,
      ownerMemory: null,
      log: () => undefined,
    });
    clients.push(client);
    await expect(client.list("guest")).rejects.toMatchObject({ code: "worker-failed", message: expect.stringContaining("SecurityError") });
    await expect(client.list("guest")).rejects.toMatchObject({ code: "worker-failed" });
    expect(attempts).toBe(2);
  });

  it("runs a Record session: started, then every part at the end", async () => {
    const { client } = setup();
    const port = { onmessage: null as ((e: { data: unknown }) => void) | null, close: vi.fn() };
    const session = client.record("rec1", port as unknown as MessagePort, meta("rec1", { kind: "record" }));
    await session.started;
    const whole = makeClipPackets({ seconds: 1, baseUs: 0 });
    const chunk: RecordTeeMsg = { t: "chunk", recordingId: "rec1", packets: whole };
    port.onmessage?.({ data: chunk });
    port.onmessage?.({ data: { t: "end", recordingId: "rec1", endUs: whole.endUs } });
    const result = await session.finished;
    expect(result.failed).toBe(0);
    expect(result.parts.map((p) => p.record.id)).toEqual(["rec1"]);
    expect(result.parts[0].record.kind).toBe("record");
  });

  it("fails a Record session that the worker refuses", async () => {
    const { client } = setup();
    const session = client.record("../bad", {} as MessagePort, meta("x", { kind: "record" }));
    await expect(session.started).rejects.toMatchObject({ code: "bad-command" });
    await expect(session.finished).rejects.toMatchObject({ code: "bad-command" });
  });
});

describe("getClipLibrary", () => {
  it("is null on the server", () => {
    expect(typeof window).toBe("undefined");
    expect(getClipLibrary()).toBeNull();
  });
});


describe("account-bound guest continuation IO", () => {
  it("tracks A-B-A even when the final owner is the same", () => {
    const { client } = setup();
    const a = "u_aaaaaaaaaaaaaaaaaaaa", b = "u_bbbbbbbbbbbbbbbbbbbb";
    client.setOwnerKey(a);
    const generation = client.sessionGeneration;
    client.setOwnerKey(b);
    client.setOwnerKey(a);
    expect(client.sessionGeneration).toBeGreaterThan(generation);
  });

  it("does not confirm a stale session response after logout invalidated it", async () => {
    const { client, bus, readUserId } = setup();
    let complete!: (id: string | null) => void;
    readUserId.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    readUserId.mockResolvedValueOnce(null);
    const stale = client.resolveOwner();
    bus.publish(null);
    complete("previous-player");
    expect(await stale).toEqual({ key: "guest", confirmed: true });
    expect(readUserId).toHaveBeenCalledTimes(2);
  });

  it("re-reads a changed session after a stale lookup fails instead of accepting remembered identity", async () => {
    const { client, bus, readUserId, memory } = setup();
    memory.setItem(OWNER_MEMORY_ITEM, "u_aaaaaaaaaaaaaaaaaaaa");
    let fail!: (error: Error) => void;
    readUserId.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    readUserId.mockResolvedValueOnce(null);
    const stale = client.resolveOwner();
    bus.publish(null);
    fail(new Error("offline old request"));
    expect(await stale).toEqual({ key: "guest", confirmed: true });
    expect(readUserId).toHaveBeenCalledTimes(2);
  });

  it("does not overwrite a bus-confirmed owner when its async hash finishes during a session fetch", async () => {
    const { client, bus, readUserId } = setup();
    let complete!: (id: string | null) => void;
    readUserId.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    let heard!: () => void;
    const confirmed = new Promise<void>(resolve => { heard = resolve; });
    const stop = client.subscribe(heard);
    bus.publish("new-player");
    const pending = client.resolveOwner();
    const expected = await ownerKeyFor("new-player");
    // Wait for the bus hash, independently of the deliberately held fetch.
    await confirmed;
    stop();
    complete("old-player");
    expect(await pending).toEqual({ key: expected, confirmed: true });
    expect(await client.ownerKey()).toBe(expected);
  });

  it("checks owner generation after lazy worker startup before posting a mutation", async () => {
    let start!: (worker: IoWorkerLike) => void;
    const worker: IoWorkerLike = { postMessage: vi.fn(), onmessage: null, onerror: null, terminate: vi.fn() };
    const client = new IoClient({ createWorker: () => new Promise(resolve => { start = resolve; }), sessionBus: null, ownerMemory: null, openChannel: () => null });
    clients.push(client);
    const a = "u_aaaaaaaaaaaaaaaaaaaa", b = "u_bbbbbbbbbbbbbbbbbbbb";
    client.setOwnerKey(a);
    const result = client.updateForSession("chosen", { ownerKey: a }, a, client.sessionGeneration);
    client.setOwnerKey(b);
    client.setOwnerKey(a);
    start(worker);
    await expect(result).rejects.toThrow("player changed");
    expect(worker.postMessage).not.toHaveBeenCalled();
  });

  it("moves the selected durable video through the real library and refuses A-to-B moves", async () => {
    const { client } = setup();
    await client.mux(makeClipPackets({ seconds: 1 }), meta("selected"));
    await client.mux(makeClipPackets({ seconds: 1 }), meta("untouched"));
    const before = await client.read("selected");
    const a = "u_aaaaaaaaaaaaaaaaaaaa", b = "u_bbbbbbbbbbbbbbbbbbbb";
    client.setOwnerKey(a);
    const adopted = await client.updateForSession("selected", { ownerKey: a, kept: true }, a, client.sessionGeneration);
    expect(adopted).toMatchObject({ ownerKey: a, kept: true, storage: "opfs" });
    expect((await client.read("selected")).file.size).toBe(before.file.size);
    expect((await client.read("untouched")).record.ownerKey).toBe("guest");
    expect((await client.list(a)).map(record => record.id)).toEqual(["selected"]);
    client.setOwnerKey(b);
    await expect(client.updateForSession("selected", { ownerKey: b }, b, client.sessionGeneration)).rejects.toThrow("owner change");
    expect((await client.read("selected")).record.ownerKey).toBe(a);
  });
});
