// @vitest-environment node
/**
 * The io worker's tier M and V commands, end to end: real ffmpeg segments
 * (segmentFixtures.ts), the real join (concat.ts), the real library on the
 * shared OPFS double and fake-indexeddb, and the segment journal with the
 * shared Web Locks double.
 *
 * - "index" answers with the keyframes and configs.
 * - "concat" stores a joined clip with the write protocol: a tier V file is
 *   stored and labeled as video/webm with the .webm extension, a tier M file
 *   as video/mp4 (with the AAC roll groups).
 * - "segmentRecord" journals each segment under the recording's lock, makes
 *   the parts at the end, and a dead tab's journal is stored at startup.
 */
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createOpfsMock, type OpfsMock } from "../../../../../__tests__/opfs-mock";
import type { StorageLike } from "../../../library/fsTypes";
import { ClipLibrary } from "../../../library/opfsStore";
import { inspectClip } from "../../../library/verify";
import type { ClipMeta, IoCmd, IoEvent, RecorderSegmentRef, SegmentContainer } from "../../../protocol";
import { FakeLockManager, settleLocks } from "../../../service/__tests__/fakeLocks";
import { indexSegment } from "../concat";
import { createIoHandler } from "../ioHandler";
import { PLACEHOLDER_POSTER } from "../poster";
import { JOURNAL_DIR, RECORD_LOCK_PREFIX, encodeFrame, holdRecordingLock } from "../recordJournal";
import { SEGMENT_JOURNAL_SUFFIX, readSegmentJournal } from "../segmentRecording";
import {
  CODE_PERIOD,
  FFMPEG_SKIP_REASON,
  blobOf,
  cleanupSegmentFixtures,
  decodeCodes,
  makeSegment,
} from "./segmentFixtures";

vi.setConfig({ testTimeout: 60_000 });

const SKIP = FFMPEG_SKIP_REASON !== "";
if (SKIP) console.warn(`[clips] segments.node.test: SKIPPED (${FFMPEG_SKIP_REASON})`);

const S = 1_000_000;

interface Seg {
  bytes: Uint8Array;
  blob: Blob;
  startUs: number;
}

const made: Record<SegmentContainer, Seg[]> = { webm: [], mp4: [] };
let odd: Seg;

beforeAll(() => {
  if (SKIP) return;
  for (const container of ["webm", "mp4"] as const) {
    made[container] = [
      [0, 5.25],
      [5, 5.25],
      [10, 2],
    ].map(([startSec, durationSec]) => {
      const bytes = makeSegment({ startSec, durationSec, container });
      return { bytes, blob: blobOf(bytes, container), startUs: startSec * S };
    });
  }
  const bytes = makeSegment({ startSec: 12, durationSec: 3, container: "webm", size: 48 });
  odd = { bytes, blob: blobOf(bytes, "webm"), startUs: 12 * S };
});

afterAll(() => cleanupSegmentFixtures());

function meta(id: string, overrides: Partial<ClipMeta> = {}): ClipMeta {
  return {
    id,
    ownerKey: "guest",
    gameId: "snake",
    kind: "clip",
    createdAt: Date.UTC(2026, 8, 28, 12),
    durationMs: 0,
    width: 64,
    height: 64,
    fps: 30,
    hasAudio: false,
    mime: "video/webm",
    kept: false,
    watched: false,
    moments: [],
    ...overrides,
  };
}

/** The windows of a clip over the three segments, as the engine's plan makes them. */
function windows(list: Seg[], fromUs: number, toUs: number): RecorderSegmentRef[] {
  return [
    { blob: list[0].blob, startUs: list[0].startUs, fromUs, toUs: list[1].startUs },
    { blob: list[1].blob, startUs: list[1].startUs, fromUs: list[1].startUs, toUs: list[2].startUs },
    { blob: list[2].blob, startUs: list[2].startUs, fromUs: list[2].startUs, toUs },
  ];
}

const libraries: ClipLibrary[] = [];

function harness(options: { mock?: OpfsMock; locks?: FakeLockManager; clientId?: string; picturePoster?: (png: Blob) => Promise<string> } = {}) {
  const mock = options.mock ?? createOpfsMock();
  const factory = new IDBFactory();
  const events: IoEvent[] = [];
  const handler = createIoHandler({
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
    journal: options.locks
      ? { storage: mock.storage as unknown as StorageLike, locks: options.locks.client(options.clientId ?? "tab-a") as never, log: () => undefined }
      : null,
    ...(options.picturePoster ? { picturePoster: options.picturePoster } : {}),
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

describe.skipIf(SKIP)("index", () => {
  it("answers with the segment's keyframes and configs", async () => {
    const h = harness();
    const event = await h.send({ t: "index", blob: made.webm[0].blob, container: "webm", rid: 4 });
    expect(event).toEqual({ t: "indexed", index: await indexSegment(made.webm[0].blob, "webm"), rid: 4 });
  });

  it("refuses a command with no segment, and reports a segment that does not parse", async () => {
    const h = harness();
    expect(await h.send({ t: "index", blob: "nope" as never, container: "webm" })).toMatchObject({ t: "error", code: "bad-command" });
    expect(await h.send({ t: "index", blob: new Blob([new Uint8Array(20)]), container: "webm" })).toMatchObject({
      t: "error",
      code: "mux-failed",
      detail: expect.stringMatching(/^unreadable:/),
    });
  });
});

describe.skipIf(SKIP)("concat", () => {
  it("tier V: stores a joined WebM as video/webm with the .webm extension, and every frame once", async () => {
    const h = harness();
    const event = await h.send({ t: "concat", job: { container: "webm", segments: windows(made.webm, 3 * S, 11 * S) }, meta: meta("v1"), rid: 7 });
    expect(event).toMatchObject({ t: "saved", rid: 7 });
    const record = (event as Extract<IoEvent, { t: "saved" }>).record;
    expect(record).toMatchObject({ id: "v1", mime: "video/webm", storage: "opfs", hasAudio: true });
    // 240 frames of 1/30 s. mediabunny reads a WebM's length to the start of its last frame (one frame less).
    expect(Math.abs(record.durationMs - 8000)).toBeLessThanOrEqual(34);
    const bytes = h.mock.readFile("lib/guest/v1.webm")!;
    expect(bytes).toBeTruthy();
    expect(h.mock.exists("lib/guest/v1.mp4")).toBe(false);
    expect(record.bytes).toBe(bytes.length);
    const facts = await inspectClip(bytes, "video/webm");
    expect(facts).toMatchObject({ mime: "video/webm", firstVideoIsKey: true, hasAudio: true });
    const codes = decodeCodes(bytes, "webm");
    expect(codes).toHaveLength(240);
    codes.forEach((code, i) => expect(code).toBe((90 + i) % CODE_PERIOD));
    // The row lists the clip, and a read gives a .webm file.
    await h.handler.handle({ t: "read", id: "v1" });
    const file = (h.events.at(-1) as Extract<IoEvent, { t: "file" }>).file;
    expect(file.type).toBe("video/webm");
    expect(file.name).toMatch(/\.webm$/);
  });

  it("tier M: stores a joined MP4 as video/mp4 with the AAC roll groups", async () => {
    const h = harness();
    const event = await h.send({ t: "concat", job: { container: "mp4", segments: windows(made.mp4, 3 * S, 11 * S) }, meta: meta("m1", { mime: "video/mp4" }) });
    const record = (event as Extract<IoEvent, { t: "saved" }>).record;
    expect(record).toMatchObject({ id: "m1", mime: "video/mp4", hasAudio: true });
    const bytes = h.mock.readFile("lib/guest/m1.mp4")!;
    expect(new TextDecoder("latin1").decode(bytes).includes("sgpd")).toBe(true);
    const codes = decodeCodes(bytes, "mp4");
    codes.forEach((code, i) => expect(code).toBe((60 + i) % CODE_PERIOD));
  });

  it("uses the game picture from the main thread as the poster when there is no video decoder (node has none)", async () => {
    const posters: Blob[] = [];
    const h = harness({
      picturePoster: async (jpeg) => {
        posters.push(jpeg);
        return "data:image/jpeg;base64,R0FNRQ==";
      },
    });
    const poster = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });
    const withPoster = await h.send({ t: "concat", job: { container: "webm", segments: windows(made.webm, 3 * S, 11 * S), poster }, meta: meta("p1") });
    expect((withPoster as Extract<IoEvent, { t: "saved" }>).record.posterDataUrl).toBe("data:image/jpeg;base64,R0FNRQ==");
    expect(posters).toEqual([poster]);
    const without = await h.send({ t: "concat", job: { container: "webm", segments: windows(made.webm, 3 * S, 11 * S) }, meta: meta("p2") });
    expect((without as Extract<IoEvent, { t: "saved" }>).record.posterDataUrl).toBe(PLACEHOLDER_POSTER);
  });

  it("reports a join that fails with its code and the clip id, and refuses a bad job", async () => {
    const h = harness();
    const mixed = await h.send({
      t: "concat",
      job: {
        container: "webm",
        segments: [
          { blob: made.webm[0].blob, startUs: 0, fromUs: 3 * S, toUs: 5 * S },
          { blob: odd.blob, startUs: 5 * S, fromUs: 5 * S, toUs: 7 * S },
        ],
      },
      meta: meta("x1"),
    });
    expect(mixed).toMatchObject({ t: "error", code: "mux-failed", id: "x1", detail: expect.stringMatching(/^mixed-configs:/) });
    expect(await h.send({ t: "concat", job: { container: "webm", segments: [{ blob: "x" } as never] }, meta: meta("x2") })).toMatchObject({
      t: "error",
      code: "bad-command",
      id: "x2",
    });
    expect(await h.send({ t: "concat", job: { container: "webm", segments: windows(made.webm, 3 * S, 11 * S) }, meta: meta("../bad") })).toMatchObject({
      t: "error",
      code: "mux-failed",
    });
    expect(h.mock.listFiles().filter((f) => f.startsWith("lib/"))).toEqual([]);
  });
});

describe.skipIf(SKIP)("segment Record", () => {
  function segmentsOf(list: Seg[], startUs: number, stopUs: number): RecorderSegmentRef[] {
    return windows(list, startUs, stopUs);
  }

  it("journals each segment under the recording's lock, makes the part at the end, and removes the journal", async () => {
    const locks = new FakeLockManager();
    const h = harness({ locks });
    await h.handler.handle({ t: "segmentRecord", recordingId: "recA", container: "webm", meta: meta("recA", { kind: "record" }), rid: 1 });
    expect(h.events.at(-1)).toEqual({ t: "recording", recordingId: "recA", rid: 1 });
    await settleLocks();
    expect(locks.holderOf(`${RECORD_LOCK_PREFIX}recA`)).toBe("tab-a");
    const segments = segmentsOf(made.webm, 2 * S, 11 * S);
    for (const segment of segments) await h.handler.handle({ t: "segmentRecordAdd", recordingId: "recA", segment, rid: 2 });
    const journal = readSegmentJournal(h.mock.readFile(`${JOURNAL_DIR}/recA${SEGMENT_JOURNAL_SUFFIX}`)!)!;
    expect(journal.meta).toMatchObject({ recordingId: "recA", container: "webm" });
    expect(journal.segments.map((s) => [s.startUs, s.fromUs, s.toUs])).toEqual(segments.map((s) => [s.startUs, s.fromUs, s.toUs]));
    await h.handler.handle({ t: "segmentRecordEnd", recordingId: "recA", rid: 3 });
    const recorded = h.events.find((e) => e.t === "recorded") as Extract<IoEvent, { t: "recorded" }>;
    // The recording's events answer its "segmentRecord" command.
    expect(recorded).toMatchObject({ recordingId: "recA", failed: 0, rid: 1 });
    expect(recorded.parts).toHaveLength(1);
    expect(recorded.parts[0].record).toMatchObject({ id: "recA", kind: "record", mime: "video/webm" });
    expect(recorded.parts[0].startUs).toBe(2 * S);
    expect(recorded.parts[0].endUs).toBeCloseTo(11 * S, -4);
    expect(h.mock.exists("lib/guest/recA.webm")).toBe(true);
    expect(h.mock.exists(`${JOURNAL_DIR}/recA${SEGMENT_JOURNAL_SUFFIX}`)).toBe(false);
    await settleLocks();
    expect(locks.holderOf(`${RECORD_LOCK_PREFIX}recA`)).toBeNull();
  });

  it("makes a new part at another video config, and counts a segment that does not parse as failed", async () => {
    const h = harness();
    await h.handler.handle({ t: "segmentRecord", recordingId: "recB", container: "webm", meta: meta("recB", { kind: "record" }), rid: 1 });
    const segments = [
      ...segmentsOf(made.webm, 2 * S, 12 * S),
      { blob: new Blob([new Uint8Array(30)]), startUs: 12 * S, fromUs: 12 * S, toUs: 12.5 * S },
      { blob: odd.blob, startUs: 12 * S, fromUs: 12 * S, toUs: 15 * S },
    ];
    for (const segment of segments) await h.handler.handle({ t: "segmentRecordAdd", recordingId: "recB", segment });
    await h.handler.handle({ t: "segmentRecordEnd", recordingId: "recB" });
    const errors = h.events.filter((e) => e.t === "error");
    expect(errors).toEqual([expect.objectContaining({ code: "mux-failed", id: "recB", rid: 1 })]);
    const recorded = h.events.find((e) => e.t === "recorded") as Extract<IoEvent, { t: "recorded" }>;
    expect(recorded.failed).toBe(1);
    expect(recorded.parts.map((p) => p.record.id)).toEqual(["recB", "recB-p2"]);
    // Part 2 is dated at its start in the recording.
    expect(recorded.parts[1].record.createdAt - recorded.parts[0].record.createdAt).toBe(10_000);
    expect(recorded.parts[1].record.width).toBe(64);
    expect((await inspectClip(h.mock.readFile("lib/guest/recB-p2.webm")!, "video/webm")).width).toBe(48);
  });

  it("refuses a second open of the same recording, adds to a recording that is not open, and a bad container", async () => {
    const h = harness();
    await h.handler.handle({ t: "segmentRecord", recordingId: "recC", container: "webm", meta: meta("recC") });
    expect(await h.send({ t: "segmentRecord", recordingId: "recC", container: "webm", meta: meta("recC") })).toMatchObject({ t: "error", code: "bad-command" });
    expect(await h.send({ t: "segmentRecordAdd", recordingId: "nope", segment: segmentsOf(made.webm, 0, 5 * S)[0] })).toMatchObject({ t: "error", code: "bad-command" });
    expect(await h.send({ t: "segmentRecordEnd", recordingId: "nope" })).toMatchObject({ t: "error", code: "bad-command" });
    expect(await h.send({ t: "segmentRecord", recordingId: "recD", container: "ogg" as never, meta: meta("recD") })).toMatchObject({ t: "error", code: "bad-command" });
  });

  it("stores a dead tab's segment journal at startup, and leaves a live tab's journal alone", async () => {
    const mock = createOpfsMock();
    const locks = new FakeLockManager();
    const frame = (s: RecorderSegmentRef, bytes: Uint8Array) => encodeFrame({ t: "segment", startUs: s.startUs, fromUs: s.fromUs, toUs: s.toUs }, [bytes]);
    const join = (parts: Uint8Array[]) => {
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of parts) {
        out.set(p, at);
        at += p.length;
      }
      return out;
    };
    const segs = segmentsOf(made.webm, 2 * S, 11 * S);
    const journalFor = (id: string) =>
      join([
        encodeFrame({ t: "segmeta", v: 1, recordingId: id, container: "webm", meta: meta(id, { kind: "record" }) }, []),
        ...segs.slice(0, 2).map((s, i) => frame(s, made.webm[i].bytes)),
        // A torn last frame: the tab died while it wrote the segment.
        frame(segs[2], made.webm[2].bytes).subarray(0, 100),
      ]);
    mock.writeFile(`${JOURNAL_DIR}/recDead${SEGMENT_JOURNAL_SUFFIX}`, journalFor("recDead"));
    mock.writeFile(`${JOURNAL_DIR}/recLive${SEGMENT_JOURNAL_SUFFIX}`, journalFor("recLive"));
    const live = await holdRecordingLock(locks.client("live-tab") as never, "recLive");
    const h = harness({ mock, locks, clientId: "new-tab" });
    await h.handler.start();
    await h.handler.idle();
    const recovered = h.events.find((e) => e.t === "recovered") as Extract<IoEvent, { t: "recovered" }>;
    expect(recovered.records.map((r) => r.id)).toEqual(["recDead"]);
    expect(recovered.records[0]).toMatchObject({ kind: "record", mime: "video/webm" });
    // The two whole segments: [2, 10) s (within one frame, as above).
    expect(Math.abs(recovered.records[0].durationMs - 8000)).toBeLessThanOrEqual(34);
    expect(mock.exists("lib/guest/recDead.webm")).toBe(true);
    expect(mock.exists(`${JOURNAL_DIR}/recDead${SEGMENT_JOURNAL_SUFFIX}`)).toBe(false);
    expect(mock.exists(`${JOURNAL_DIR}/recLive${SEGMENT_JOURNAL_SUFFIX}`)).toBe(true);
    live.release();
  });
});
