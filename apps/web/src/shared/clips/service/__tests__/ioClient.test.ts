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
import { IoClient, getClipLibrary, type ChannelLike, type IoWorkerLike } from "../ioClient";

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

function setup(options: { userId?: string | null } = {}) {
  const opfs = createOpfsMock();
  const factory = new IDBFactory();
  const openLibrary = async () => {
    const lib = await ClipLibrary.open({ storage: opfs.storage as unknown as StorageLike, indexedDB: factory, keyRange: IDBKeyRange, locks: null, channel: null });
    libraries.push(lib);
    return lib;
  };
  const workers: InProcessWorker[] = [];
  const channels: FakeChannel[] = [];
  const readUserId = vi.fn(async () => options.userId ?? null);
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
    log: () => undefined,
  });
  clients.push(client);
  return { client, workers, channels, readUserId, opfs };
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

  it("falls back to the guest partition when the session cannot be read", async () => {
    const { client, readUserId } = setup();
    readUserId.mockRejectedValueOnce(new Error("offline"));
    expect(await client.ownerKey()).toBe("guest");
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

