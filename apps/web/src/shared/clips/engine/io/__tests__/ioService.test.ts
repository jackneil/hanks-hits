// @vitest-environment node
/**
 * The io commands that the clip service adds (PR 2.4): request ids, usage,
 * pictures and the Record tee. End to end on the shared OPFS double and
 * fake-indexeddb, with the real mux and the real library.
 */
import { BufferSource, Input, MP4 } from "mediabunny";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpfsMock, type OpfsMock } from "../../../../../__tests__/opfs-mock";
import { FakeLockManager, settleLocks } from "../../../service/__tests__/fakeLocks";
import { RECORD_LOCK_PREFIX } from "../recordJournal";
import type { ClipMeta, ClipPackets, IoCmd, IoEvent, RecordTeeMsg } from "../../../protocol";
import type { StorageLike } from "../../../library/fsTypes";
import { isClipId } from "../../../library/ownerKey";
import { ClipLibrary } from "../../../library/opfsStore";
import { createIoHandler, type IoHandler } from "../ioHandler";
import { RECORD_ID_MAX_LENGTH, RECORD_PART_MAX_BYTES, Recording, partId, type RecorderHost } from "../recorder";
import { AVCC_64_OTHER_HEX, PNG_3X2_HEX, epochInfo, hexBytes, makeClipPackets } from "./fixtures";

// Each record test muxes and parses real MP4 bytes; a busy machine can pass 5 s.
vi.setConfig({ testTimeout: 30_000 });

/** A signed-in player's owner key (the "u_" form of library/ownerKey). */
const SIGNED_IN_OWNER = `u_${"0123456789".repeat(2)}`;

const libraries: ClipLibrary[] = [];
afterEach(() => {
  libraries.splice(0).forEach((lib) => lib.close());
});

function meta(id: string, overrides: Partial<ClipMeta> = {}): ClipMeta {
  return {
    id,
    ownerKey: "guest",
    gameId: "snake",
    kind: "record",
    createdAt: Date.UTC(2026, 8, 28, 12),
    durationMs: 0,
    width: 64,
    height: 64,
    fps: 30,
    hasAudio: false,
    mime: "video/mp4",
    kept: false,
    watched: false,
    moments: [],
    ...overrides,
  };
}

function harness() {
  const mock = createOpfsMock();
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
  return { mock, events, handler };
}

/** A MessagePort double: the handler sets onmessage; the test delivers tee messages. */
class FakePort {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;
  close(): void {
    this.closed = true;
  }
  deliver(message: RecordTeeMsg): void {
    this.onmessage?.({ data: message });
  }
}

/**
 * Splits one continuous ClipPackets into Record tee chunks, one per GOP, the way the
 * encode worker's RecordTee posts them: each chunk starts at a keyframe and carries
 * the audio packets that start before its end.
 */
function teeChunks(whole: ClipPackets, recordingId: string): Array<Extract<RecordTeeMsg, { t: "chunk" }>> {
  const gops: ClipPackets["video"][] = [];
  for (const p of whole.video) {
    if (p.type === "key") gops.push([]);
    gops[gops.length - 1].push(p);
  }
  let audioIndex = 0;
  return gops.map((video, i) => {
    const endUs = video[video.length - 1].tsUs + video[video.length - 1].durUs;
    const audio: ClipPackets["audio"] = [];
    const last = i === gops.length - 1;
    while (audioIndex < whole.audio.length && (last || whole.audio[audioIndex].tsUs < endUs)) audio.push(whole.audio[audioIndex++]);
    return {
      t: "chunk" as const,
      recordingId,
      packets: {
        ...whole,
        requestId: recordingId,
        video,
        audio,
        startUs: video[0].tsUs,
        endUs,
        coveredSec: (endUs - video[0].tsUs) / 1e6,
      },
    };
  });
}

async function durationOf(file: Blob): Promise<number> {
  const input = new Input({ formats: [MP4], source: new BufferSource(new Uint8Array(await file.arrayBuffer())) });
  try {
    const track = await input.getPrimaryVideoTrack();
    return track ? await track.computeDuration() : 0;
  } finally {
    input.dispose();
  }
}

describe("io request ids", () => {
  it("copies the rid onto every event of the command, and never onto the startup check", async () => {
    const h = harness();
    await h.handler.handle({ t: "list", ownerKey: "guest", rid: 7 });
    await h.handler.handle({ t: "delete", id: "nope", rid: 8 });
    await h.handler.handle({ t: "list", ownerKey: "guest" });
    expect(h.events).toEqual([
      { t: "reconciled", reindexed: 0, missing: 0, unreadable: 0 },
      { t: "list", records: [], rid: 7 },
      { t: "deleted", id: "nope", rid: 8 },
      { t: "list", records: [] },
    ]);
  });

  it("tags an error answer and an unknown command with the rid", async () => {
    const h = harness();
    await h.handler.handle({ t: "read", id: "missing", rid: 3 });
    await h.handler.handle({ t: "nope", rid: 4 } as unknown as IoCmd);
    expect(h.events.slice(1)).toEqual([
      { t: "error", code: "not-found", detail: expect.any(String), id: "missing", rid: 3 },
      { t: "error", code: "bad-command", detail: expect.stringContaining("nope"), rid: 4 },
    ]);
  });
});

describe("io usage", () => {
  it("answers the bytes of all owners, the budget and the owner's clip count", async () => {
    const h = harness();
    const png = hexBytes(PNG_3X2_HEX).buffer;
    await h.handler.handle({ t: "picture", png: png.slice(0), meta: meta("pic1", { kind: "picture", ownerKey: "guest" }) });
    await h.handler.handle({ t: "picture", png: png.slice(0), meta: meta("pic2", { kind: "picture", ownerKey: SIGNED_IN_OWNER }) });
    await h.handler.handle({ t: "usage", ownerKey: "guest", rid: 9 });
    const usage = h.events.at(-1)!;
    expect(usage).toMatchObject({ t: "usage", count: 1, rid: 9 });
    const u = usage as Extract<IoEvent, { t: "usage" }>;
    expect(u.bytes).toBe(2 * png.byteLength);
    expect(u.budget).toBeGreaterThan(0);
  });

  it("refuses a bad owner key", async () => {
    const h = harness();
    await h.handler.handle({ t: "usage", ownerKey: "../x", rid: 1 });
    expect(h.events.at(-1)).toMatchObject({ t: "error", code: "bad-command", rid: 1 });
  });
});

describe("io picture", () => {
  it("stores a PNG as a picture row with no sound and no length", async () => {
    const h = harness();
    await h.handler.handle({
      t: "picture",
      png: hexBytes(PNG_3X2_HEX).buffer,
      meta: meta("shot", { kind: "picture", durationMs: 999, hasAudio: true }),
      rid: 2,
    });
    const saved = h.events.at(-1) as Extract<IoEvent, { t: "saved" }>;
    expect(saved).toMatchObject({ t: "saved", rid: 2 });
    expect(saved.record).toMatchObject({ id: "shot", kind: "picture", mime: "image/png", hasAudio: false, durationMs: 0 });
    expect(h.mock.listFiles()).toContain("lib/guest/shot.png");
  });

  it("refuses a picture with no bytes or a bad id", async () => {
    const h = harness();
    await h.handler.handle({ t: "picture", png: new ArrayBuffer(0), meta: meta("empty", { kind: "picture" }) });
    await h.handler.handle({ t: "picture", png: hexBytes(PNG_3X2_HEX).buffer, meta: meta("../bad", { kind: "picture" }) });
    expect(h.events.filter((e) => e.t === "error")).toEqual([
      expect.objectContaining({ code: "bad-command", id: "empty" }),
      expect.objectContaining({ code: "bad-command" }),
    ]);
    expect(h.mock.listFiles()).toEqual([]);
  });
});

describe("io record", () => {
  it("answers at once, stores the tee's chunks as one record clip at the end, and closes the port", async () => {
    const h = harness();
    const port = new FakePort();
    await h.handler.handle({ t: "record", recordingId: "rec1", port: port as unknown as MessagePort, meta: meta("rec1"), rid: 11 });
    expect(h.events.at(-1)).toEqual({ t: "recording", recordingId: "rec1", rid: 11 });

    const whole = makeClipPackets({ seconds: 3, baseUs: 2_000_000 });
    for (const chunk of teeChunks(whole, "rec1")) port.deliver(chunk);
    port.deliver({ t: "end", recordingId: "rec1", endUs: whole.endUs });
    await h.handler.idle();

    const saved = h.events.filter((e) => e.t === "saved") as Array<Extract<IoEvent, { t: "saved" }>>;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ rid: 11, record: { id: "rec1", kind: "record", hasAudio: true } });
    const recorded = h.events.at(-1) as Extract<IoEvent, { t: "recorded" }>;
    expect(recorded).toMatchObject({ t: "recorded", recordingId: "rec1", failed: 0, rid: 11 });
    expect(recorded.parts).toHaveLength(1);
    expect(recorded.parts[0]).toMatchObject({ startUs: 2_000_000, endUs: 5_000_000 });
    expect(port.closed).toBe(true);
    expect(port.onmessage).toBeNull();

    await h.handler.handle({ t: "read", id: "rec1" });
    const file = (h.events.at(-1) as Extract<IoEvent, { t: "file" }>).file;
    expect(await durationOf(file)).toBeCloseTo(3, 1);
  });

  it("starts a new part at a different video config and stores both, in order", async () => {
    const h = harness();
    const port = new FakePort();
    await h.handler.handle({ t: "record", recordingId: "rec2", port: port as unknown as MessagePort, meta: meta("rec2") });
    const first = makeClipPackets({ seconds: 2, baseUs: 1_000_000, epoch: epochInfo(0) });
    const second = makeClipPackets({ seconds: 2, baseUs: 3_000_000, epoch: epochInfo(1, AVCC_64_OTHER_HEX) });
    for (const chunk of [...teeChunks(first, "rec2"), ...teeChunks(second, "rec2")]) port.deliver(chunk);
    port.deliver({ t: "end", recordingId: "rec2", endUs: second.endUs });
    await h.handler.idle();

    const recorded = h.events.at(-1) as Extract<IoEvent, { t: "recorded" }>;
    expect(recorded.failed).toBe(0);
    expect(recorded.parts.map((p) => p.record.id)).toEqual(["rec2", "rec2-p2"]);
    expect(recorded.parts.map((p) => [p.startUs, p.endUs])).toEqual([
      [1_000_000, 3_000_000],
      [3_000_000, 5_000_000],
    ]);
    // Part 2 is dated 2 s after part 1, so the library lists them in recording order.
    expect(recorded.parts[1].record.createdAt - recorded.parts[0].record.createdAt).toBe(2000);
  });

  it("ignores messages of another recording and messages after the end", async () => {
    const h = harness();
    const port = new FakePort();
    await h.handler.handle({ t: "record", recordingId: "rec3", port: port as unknown as MessagePort, meta: meta("rec3") });
    const whole = makeClipPackets({ seconds: 1 });
    const [chunk] = teeChunks(whole, "rec3");
    port.deliver({ ...chunk, recordingId: "other" });
    port.deliver({ t: "end", recordingId: "other", endUs: 0 });
    await h.handler.idle();
    expect(h.events.some((e) => e.t === "recorded")).toBe(false);
    const handler = port.onmessage!;
    port.deliver(chunk);
    port.deliver({ t: "end", recordingId: "rec3", endUs: whole.endUs });
    await h.handler.idle();
    handler({ data: chunk });
    handler({ data: { t: "end", recordingId: "rec3", endUs: whole.endUs } });
    await h.handler.idle();
    expect(h.events.filter((e) => e.t === "recorded")).toHaveLength(1);
    expect(h.events.filter((e) => e.t === "saved")).toHaveLength(1);
  });

  it("stores what a recording has when recordEnd comes instead of the tee's end", async () => {
    const h = harness();
    const port = new FakePort();
    await h.handler.handle({ t: "record", recordingId: "rec5", port: port as unknown as MessagePort, meta: meta("rec5"), rid: 5 });
    const whole = makeClipPackets({ seconds: 2, baseUs: 0 });
    for (const chunk of teeChunks(whole, "rec5")) port.deliver(chunk);
    await h.handler.handle({ t: "recordEnd", recordingId: "rec5", rid: 6 });
    const recorded = h.events.at(-1) as Extract<IoEvent, { t: "recorded" }>;
    expect(recorded).toMatchObject({ t: "recorded", recordingId: "rec5", failed: 0, rid: 5 });
    expect(recorded.parts).toHaveLength(1);
    expect(port.closed).toBe(true);
    // A second end, or an end for a recording that is not open, does nothing.
    const count = h.events.length;
    await h.handler.handle({ t: "recordEnd", recordingId: "rec5" });
    await h.handler.handle({ t: "recordEnd", recordingId: "never" });
    expect(h.events).toHaveLength(count);
  });

  it("reports an empty recording (end before any chunk) with no parts", async () => {
    const h = harness();
    const port = new FakePort();
    await h.handler.handle({ t: "record", recordingId: "rec4", port: port as unknown as MessagePort, meta: meta("rec4") });
    port.deliver({ t: "end", recordingId: "rec4", endUs: 0 });
    await h.handler.idle();
    expect(h.events.at(-1)).toEqual({ t: "recorded", recordingId: "rec4", parts: [], failed: 0 });
  });

  it("refuses a bad recording id, a missing port, a long id and a second open of the same recording", async () => {
    const h = harness();
    const port = new FakePort() as unknown as MessagePort;
    await h.handler.handle({ t: "record", recordingId: "../x", port, meta: meta("a") });
    await h.handler.handle({ t: "record", recordingId: "r", port: undefined as unknown as MessagePort, meta: meta("b") });
    await h.handler.handle({ t: "record", recordingId: "r2", port, meta: meta("c".repeat(RECORD_ID_MAX_LENGTH + 1)) });
    await h.handler.handle({ t: "record", recordingId: "r3", port, meta: meta("d") });
    await h.handler.handle({ t: "record", recordingId: "r3", port, meta: meta("e") });
    const errors = h.events.filter((e) => e.t === "error");
    expect(errors).toHaveLength(4);
    for (const e of errors) expect(e).toMatchObject({ code: "bad-command" });
    expect(h.events.filter((e) => e.t === "recording")).toEqual([{ t: "recording", recordingId: "r3" }]);
  });
});

describe("Recording part limit", () => {
  function host(maxBytes: number, fail: (index: number) => boolean = () => false) {
    const stored: Array<{ packets: ClipPackets; meta: ClipMeta }> = [];
    const h: RecorderHost = {
      maxPartBytes: () => maxBytes,
      storePart: async (packets, m) => {
        stored.push({ packets: { ...packets, video: [...packets.video], audio: [...packets.audio] }, meta: m });
        if (fail(stored.length - 1)) return null;
        return { ...m, bytes: 1, storage: "memory", posterDataUrl: "" };
      },
    };
    return { h, stored };
  }

  it("splits at the byte limit without dropping a packet", async () => {
    const whole = makeClipPackets({ seconds: 5, baseUs: 0 });
    const chunks = teeChunks(whole, "rec");
    const gopBytes = chunks[0].packets.video.reduce((n, p) => n + p.data.byteLength, 0) + chunks[0].packets.audio.reduce((n, p) => n + p.data.byteLength, 0);
    // Room for two GOPs per part.
    const { h, stored } = host(gopBytes * 2 + 1);
    const posted: IoEvent[] = [];
    const rec = new Recording(h, "rec", meta("rec"), (e) => posted.push(e));
    for (const chunk of chunks) await rec.handle(chunk);
    await rec.handle({ t: "end", recordingId: "rec", endUs: whole.endUs });

    expect(stored.map((s) => s.meta.id)).toEqual(["rec", "rec-p2", "rec-p3"]);
    const video = stored.flatMap((s) => s.packets.video);
    const audio = stored.flatMap((s) => s.packets.audio);
    expect(video).toEqual(whole.video);
    expect(audio).toEqual(whole.audio);
    for (const s of stored) expect(s.packets.video[0].type).toBe("key");
    expect(posted.at(-1)).toMatchObject({ t: "recorded", failed: 0 });
    expect((posted.at(-1) as Extract<IoEvent, { t: "recorded" }>).parts).toHaveLength(3);
  });

  it("counts a part that failed to store and keeps going", async () => {
    const whole = makeClipPackets({ seconds: 2, baseUs: 0 });
    const chunks = teeChunks(whole, "rec");
    const { h } = host(1, (i) => i === 0);
    const posted: IoEvent[] = [];
    const rec = new Recording(h, "rec", meta("rec"), (e) => posted.push(e));
    for (const chunk of chunks) await rec.handle(chunk);
    await rec.handle({ t: "end", recordingId: "rec", endUs: whole.endUs });
    const recorded = posted.at(-1) as Extract<IoEvent, { t: "recorded" }>;
    expect(recorded.failed).toBe(1);
    expect(recorded.parts.map((p) => p.record.id)).toEqual(["rec-p2"]);
  });

  it("names parts from the recording id", () => {
    expect(partId("abc", 0)).toBe("abc");
    expect(partId("abc", 1)).toBe("abc-p2");
    // Part 9999 of the longest recording id is still a valid 64-character clip id.
    const longest = partId("x".repeat(RECORD_ID_MAX_LENGTH), 9998);
    expect(longest).toHaveLength(RECORD_ID_MAX_LENGTH + 6);
    expect(isClipId(longest)).toBe(true);
  });

  it("keeps each part under the share ceiling and the export memory budget", () => {
    // Chromium refuses shares over 50 MiB (plan 8.4); the mux holds a part twice (plan 6.5).
    for (const bytes of Object.values(RECORD_PART_MAX_BYTES)) expect(bytes).toBeLessThan(50 * 1024 * 1024);
    expect(RECORD_PART_MAX_BYTES.low * 2).toBeLessThanOrEqual(60 * 1000 * 1000);
    expect(RECORD_PART_MAX_BYTES.mid * 2).toBeLessThanOrEqual(120 * 1000 * 1000);
  });
});

describe("Record crash recovery (plan 8.4)", () => {
  const LOCK = (id: string) => `${RECORD_LOCK_PREFIX}${id}`;

  /** A tab's io worker: its own OPFS view (open handles are per tab), the shared IndexedDB and lock manager. */
  function tab(locks: FakeLockManager, clientId: string, shared: { factory: IDBFactory; mock?: OpfsMock }) {
    const mock = shared.mock ?? createOpfsMock();
    const events: IoEvent[] = [];
    const handler = createIoHandler({
      post: (event) => events.push(event),
      openLibrary: async () => {
        const lib = await ClipLibrary.open({
          storage: mock.storage as unknown as StorageLike,
          indexedDB: shared.factory,
          keyRange: IDBKeyRange,
          locks: null,
          channel: null,
        });
        libraries.push(lib);
        return lib;
      },
      journal: { storage: mock.storage as unknown as StorageLike, locks: locks.client(clientId), log: () => undefined },
    });
    return { mock, events, handler };
  }

  /** The files of a tab that died: they stay on disk, and no handle of it is open any more. */
  function afterCrash(from: OpfsMock): OpfsMock {
    const to = createOpfsMock();
    for (const path of from.listFiles()) to.writeFile(path, from.readFile(path)!);
    return to;
  }

  it("journals each chunk as it arrives under the recording's lock, and removes the journal when the part is stored", async () => {
    const locks = new FakeLockManager();
    const a = tab(locks, "tab-a", { factory: new IDBFactory() });
    const port = new FakePort();
    await a.handler.handle({ t: "record", recordingId: "recA", port: port as unknown as MessagePort, meta: meta("recA") });
    const whole = makeClipPackets({ seconds: 3, baseUs: 0 });
    const chunks = teeChunks(whole, "recA");
    port.deliver(chunks[0]);
    port.deliver(chunks[1]);
    await a.handler.idle();
    expect(a.mock.listFiles()).toContain("rec/recA.journal");
    expect(locks.holderOf(LOCK("recA"))).toBe("tab-a");
    port.deliver(chunks[2]);
    port.deliver({ t: "end", recordingId: "recA", endUs: whole.endUs });
    await a.handler.idle();
    await settleLocks();
    expect(a.events.filter((e) => e.t === "saved")).toHaveLength(1);
    expect(a.mock.listFiles().filter((p) => p.startsWith("rec/"))).toEqual([]);
    expect(a.mock.openSyncHandles()).toBe(0);
    expect(locks.holderOf(LOCK("recA"))).toBeNull();
  });

  it("stores the open part of a tab that died during Record at the next startup, and says so once", async () => {
    const locks = new FakeLockManager();
    const factory = new IDBFactory();
    const a = tab(locks, "tab-a", { factory });
    const port = new FakePort();
    await a.handler.handle({ t: "record", recordingId: "recB", port: port as unknown as MessagePort, meta: meta("recB") });
    const whole = makeClipPackets({ seconds: 3, baseUs: 1_000_000 });
    for (const chunk of teeChunks(whole, "recB")) port.deliver(chunk);
    await a.handler.idle();
    // The tab dies (a crash, or iOS kills the hidden page): no "end", no stored part.
    expect(a.events.some((e) => e.t === "saved")).toBe(false);
    locks.crash("tab-a");
    const b = tab(locks, "tab-b", { factory, mock: afterCrash(a.mock) });
    await b.handler.start();
    await b.handler.idle();
    const recovered = b.events.find((e) => e.t === "recovered") as Extract<IoEvent, { t: "recovered" }>;
    expect(recovered.records.map((r) => [r.id, r.kind])).toEqual([["recB", "record"]]);
    expect(recovered).not.toHaveProperty("rid");
    expect(b.mock.listFiles().filter((p) => p.startsWith("rec/"))).toEqual([]);
    await b.handler.handle({ t: "read", id: "recB" });
    const file = (b.events.at(-1) as Extract<IoEvent, { t: "file" }>).file;
    expect(await durationOf(file)).toBeCloseTo(3, 1);
    // The next startup finds nothing more.
    const c = tab(locks, "tab-c", { factory, mock: b.mock });
    await c.handler.start();
    await c.handler.idle();
    expect(c.events.some((e) => e.t === "recovered")).toBe(false);
  });

  it("never takes a live tab's recording", async () => {
    const locks = new FakeLockManager();
    const factory = new IDBFactory();
    const a = tab(locks, "tab-a", { factory });
    const port = new FakePort();
    await a.handler.handle({ t: "record", recordingId: "recC", port: port as unknown as MessagePort, meta: meta("recC") });
    for (const chunk of teeChunks(makeClipPackets({ seconds: 2, baseUs: 0 }), "recC")) port.deliver(chunk);
    await a.handler.idle();
    // Another tab starts while tab A still records (its lock is held).
    const b = tab(locks, "tab-b", { factory, mock: afterCrash(a.mock) });
    await b.handler.start();
    await b.handler.idle();
    expect(b.events.some((e) => e.t === "recovered")).toBe(false);
    expect(b.mock.listFiles()).toContain("rec/recC.journal");
  });

  it("stores the whole chunks before a torn last write", async () => {
    const locks = new FakeLockManager();
    const factory = new IDBFactory();
    const a = tab(locks, "tab-a", { factory });
    const port = new FakePort();
    await a.handler.handle({ t: "record", recordingId: "recD", port: port as unknown as MessagePort, meta: meta("recD") });
    for (const chunk of teeChunks(makeClipPackets({ seconds: 3, baseUs: 0 }), "recD")) port.deliver(chunk);
    await a.handler.idle();
    locks.crash("tab-a");
    const disk = afterCrash(a.mock);
    const journal = disk.readFile("rec/recD.journal")!;
    disk.writeFile("rec/recD.journal", journal.subarray(0, journal.length - 40));
    const b = tab(locks, "tab-b", { factory, mock: disk });
    await b.handler.start();
    await b.handler.idle();
    const recovered = b.events.find((e) => e.t === "recovered") as Extract<IoEvent, { t: "recovered" }>;
    expect(recovered.records.map((r) => r.id)).toEqual(["recD"]);
    await b.handler.handle({ t: "read", id: "recD" });
    const file = (b.events.at(-1) as Extract<IoEvent, { t: "file" }>).file;
    expect(await durationOf(file)).toBeCloseTo(2, 1);
  });

  it("keeps a recording in memory when its journal cannot be written", async () => {
    const locks = new FakeLockManager();
    const a = tab(locks, "tab-a", { factory: new IDBFactory() });
    a.mock.failAlways("createSyncAccessHandle", new DOMException("busy", "NoModificationAllowedError"));
    const port = new FakePort();
    await a.handler.handle({ t: "record", recordingId: "recE", port: port as unknown as MessagePort, meta: meta("recE") });
    const whole = makeClipPackets({ seconds: 2, baseUs: 0 });
    for (const chunk of teeChunks(whole, "recE")) port.deliver(chunk);
    // The library's own writes need sync handles again before the part is stored.
    await a.handler.idle();
    a.mock.failAlways("createSyncAccessHandle", null);
    port.deliver({ t: "end", recordingId: "recE", endUs: whole.endUs });
    await a.handler.idle();
    expect(a.events.filter((e) => e.t === "saved")).toHaveLength(1);
    expect(a.events.at(-1)).toMatchObject({ t: "recorded", failed: 0 });
    expect(a.mock.listFiles().filter((p) => p.startsWith("rec/"))).toEqual([]);
  });
});
