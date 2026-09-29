// @vitest-environment node
/**
 * The io worker's tier M and V commands, end to end: real ffmpeg segments
 * and sound runs (segmentFixtures.ts), the real join (concat.ts), the real
 * sound store, the real library on the shared OPFS double and
 * fake-indexeddb, and the segment journal with the shared Web Locks double.
 *
 * - "index" answers with the keyframes, packet times and config.
 * - "concat" stores a joined clip with the write protocol: a tier V file is
 *   stored and labeled as video/webm with the .webm extension, a tier M file
 *   as video/mp4 (with the AAC roll groups). The sound of the job's timeline
 *   comes from the sound runs ("audioRun", "audioAppend", "audioEnd"), which
 *   run at once, not behind a join in the queue.
 * - "segmentRecord" journals each segment and the sound under the
 *   recording's lock, puts the segments in order at the end, makes the parts
 *   with their sound and their tile pictures, and a dead tab's journal is
 *   stored at startup.
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
  decodePcm,
  makeSegment,
  makeSoundRun,
  toneSmoothness,
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
const sounds: Record<SegmentContainer, Uint8Array> = { webm: new Uint8Array(0), mp4: new Uint8Array(0) };
let odd: Seg;

beforeAll(() => {
  if (SKIP) return;
  for (const container of ["webm", "mp4"] as const) {
    made[container] = [
      [0, 5.25],
      [5, 5.25],
      [10, 2],
    ].map(([startSec, durationSec]) => {
      const bytes = makeSegment({ startSec, durationSec, container, audio: false });
      return { bytes, blob: blobOf(bytes, container), startUs: startSec * S };
    });
    sounds[container] = makeSoundRun({ container, seconds: 16 });
  }
  const bytes = makeSegment({ startSec: 12, durationSec: 3, container: "webm", size: 48, audio: false });
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

const JPEG = (n: number) => new Blob([new Uint8Array([0xff, 0xd8, n, 0xff, 0xd9])], { type: "image/jpeg" });

const libraries: ClipLibrary[] = [];

function harness(options: { mock?: OpfsMock; locks?: FakeLockManager; clientId?: string } = {}) {
  const mock = options.mock ?? createOpfsMock();
  const factory = new IDBFactory();
  const events: IoEvent[] = [];
  const posters: number[] = [];
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
    // The tile picture that the main thread sent: its third byte says which one.
    picturePoster: async (jpeg) => {
      const n = new Uint8Array(await jpeg.arrayBuffer())[2];
      posters.push(n);
      return `data:image/jpeg;base64,poster-${n}`;
    },
    log: () => undefined,
  });
  const send = async (cmd: IoCmd) => {
    await handler.handle(cmd);
    return events.at(-1)!;
  };
  /** One sound run of `timeline` from capture 0: all of its bytes, then its end. */
  const soundRun = (container: SegmentContainer, timeline: number, runId: number, startUs = 0, bytes = sounds[container]) => {
    void handler.handle({ t: "audioRun", runId, timeline, container, startUs, keepSeconds: 60 });
    for (let at = 0; at < bytes.length; at += 4000) void handler.handle({ t: "audioAppend", runId, bytes: bytes.slice(at, at + 4000).buffer });
    void handler.handle({ t: "audioEnd", runId });
  };
  return { mock, events, handler, send, posters, soundRun };
}

afterEach(() => {
  libraries.splice(0).forEach((lib) => lib.close());
});

describe.skipIf(SKIP)("index", () => {
  it("answers with the segment's keyframes, packet times and config", async () => {
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
  it("tier V: stores a joined WebM as video/webm with the .webm extension, every frame once, and the run's sound", async () => {
    const h = harness();
    h.soundRun("webm", 3, 101);
    const event = await h.send({ t: "concat", job: { container: "webm", segments: windows(made.webm, 3 * S, 11 * S), timeline: 3 }, meta: meta("v1"), rid: 7 });
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
    // The sound across the hand-offs is as smooth as the run's own.
    const clean = toneSmoothness(decodePcm(sounds.webm, "webm"));
    expect(toneSmoothness(decodePcm(bytes, "webm")).maxStep).toBeLessThanOrEqual(clean.maxStep * 1.25);
    // The row lists the clip, and a read gives a .webm file.
    await h.handler.handle({ t: "read", id: "v1" });
    const file = (h.events.at(-1) as Extract<IoEvent, { t: "file" }>).file;
    expect(file.type).toBe("video/webm");
    expect(file.name).toMatch(/\.webm$/);
  });

  it("tier M: stores a joined MP4 as video/mp4 with the AAC roll groups", async () => {
    const h = harness();
    h.soundRun("mp4", 1, 102);
    const event = await h.send({ t: "concat", job: { container: "mp4", segments: windows(made.mp4, 3 * S, 11 * S), timeline: 1 }, meta: meta("m1", { mime: "video/mp4" }) });
    const record = (event as Extract<IoEvent, { t: "saved" }>).record;
    expect(record).toMatchObject({ id: "m1", mime: "video/mp4", hasAudio: true });
    const bytes = h.mock.readFile("lib/guest/m1.mp4")!;
    expect(new TextDecoder("latin1").decode(bytes).includes("sgpd")).toBe(true);
    const codes = decodeCodes(bytes, "mp4");
    codes.forEach((code, i) => expect(code).toBe((90 + i) % CODE_PERIOD));
  });

  it("a join waits for the sound up to its end: the sound commands run while the join waits in the queue", async () => {
    const h = harness();
    const bytes = sounds.webm;
    void h.handler.handle({ t: "audioRun", runId: 103, timeline: 5, container: "webm", startUs: 0, keepSeconds: 60 });
    // Only the first 2 s of sound so far.
    const first = Math.floor(bytes.length / 8);
    void h.handler.handle({ t: "audioAppend", runId: 103, bytes: bytes.slice(0, first).buffer });
    const joined = h.handler.handle({ t: "concat", job: { container: "webm", segments: windows(made.webm, 3 * S, 11 * S), timeline: 5 }, meta: meta("w1") });
    // The rest comes after the join command, and does not wait behind it.
    await new Promise((resolve) => setTimeout(resolve, 20));
    for (let at = first; at < bytes.length; at += 4000) void h.handler.handle({ t: "audioAppend", runId: 103, bytes: bytes.slice(at, at + 4000).buffer });
    await joined;
    const saved = h.events.find((e) => e.t === "saved") as Extract<IoEvent, { t: "saved" }>;
    expect(saved.record.hasAudio).toBe(true);
    const audio = decodePcm(h.mock.readFile("lib/guest/w1.webm")!, "webm");
    // The sound covers the clip to its end (8 s), not only the first bytes.
    expect(audio.length / 48_000).toBeGreaterThan(7.8);
  });

  it("a job with no timeline, or a timeline with no sound run, has no sound", async () => {
    const h = harness();
    h.soundRun("webm", 1, 104);
    const none = await h.send({ t: "concat", job: { container: "webm", segments: windows(made.webm, 3 * S, 11 * S) }, meta: meta("n1") });
    expect((none as Extract<IoEvent, { t: "saved" }>).record.hasAudio).toBe(false);
    const other = await h.send({ t: "concat", job: { container: "webm", segments: windows(made.webm, 3 * S, 11 * S), timeline: 9 }, meta: meta("n2") });
    expect((other as Extract<IoEvent, { t: "saved" }>).record.hasAudio).toBe(false);
  });

  it("uses the game picture from the main thread as the poster when there is no video decoder (node has none)", async () => {
    const h = harness();
    const withPoster = await h.send({ t: "concat", job: { container: "webm", segments: windows(made.webm, 3 * S, 11 * S), poster: JPEG(7) }, meta: meta("p1") });
    expect((withPoster as Extract<IoEvent, { t: "saved" }>).record.posterDataUrl).toBe("data:image/jpeg;base64,poster-7");
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
  const open = (recordingId: string, extra: Partial<Extract<IoCmd, { t: "segmentRecord" }>> = {}): Extract<IoCmd, { t: "segmentRecord" }> => ({
    t: "segmentRecord",
    recordingId,
    container: "webm",
    meta: meta(recordingId, { kind: "record" }),
    timeline: 1,
    startUs: 2 * S,
    ...extra,
  });

  it("journals each segment and the sound under the recording's lock, makes the part with its sound at the end, and removes the journal", async () => {
    const locks = new FakeLockManager();
    const h = harness({ locks });
    h.soundRun("webm", 1, 201);
    await h.handler.handle({ ...open("recA", { poster: JPEG(1) }), rid: 1 });
    expect(h.events.at(-1)).toEqual({ t: "recording", recordingId: "recA", rid: 1 });
    await settleLocks();
    expect(locks.holderOf(`${RECORD_LOCK_PREFIX}recA`)).toBe("tab-a");
    const segments = windows(made.webm, 2 * S, 11 * S);
    for (const segment of segments) await h.handler.handle({ t: "segmentRecordAdd", recordingId: "recA", segment, poster: JPEG(2), rid: 2 });
    const journal = readSegmentJournal(h.mock.readFile(`${JOURNAL_DIR}/recA${SEGMENT_JOURNAL_SUFFIX}`)!)!;
    expect(journal.meta).toMatchObject({ recordingId: "recA", container: "webm", tapUs: 2 * S });
    expect(journal.segments.map((s) => [s.segment.startUs, s.segment.fromUs, s.segment.toUs])).toEqual(segments.map((s) => [s.startUs, s.fromUs, s.toUs]));
    // The sound from before the tap (15 s back at most) on is in the journal too.
    expect(journal.sound.length).toBeGreaterThan(400);
    expect(journal.poster).not.toBeNull();
    await h.handler.handle({ t: "segmentRecordEnd", recordingId: "recA", rid: 3 });
    const recorded = h.events.find((e) => e.t === "recorded") as Extract<IoEvent, { t: "recorded" }>;
    // The recording's events answer its "segmentRecord" command.
    expect(recorded).toMatchObject({ recordingId: "recA", failed: 0, rid: 1 });
    expect(recorded.parts).toHaveLength(1);
    expect(recorded.parts[0].record).toMatchObject({ id: "recA", kind: "record", mime: "video/webm", hasAudio: true });
    // The tile is the picture sent with the part's first segment.
    expect(recorded.parts[0].record.posterDataUrl).toBe("data:image/jpeg;base64,poster-2");
    expect(recorded.parts[0].startUs).toBe(2 * S);
    expect(recorded.parts[0].endUs).toBeCloseTo(11 * S, -4);
    const bytes = h.mock.readFile("lib/guest/recA.webm")!;
    expect(toneSmoothness(decodePcm(bytes, "webm")).maxStep).toBeLessThanOrEqual(toneSmoothness(decodePcm(sounds.webm, "webm")).maxStep * 1.25);
    expect(h.mock.exists(`${JOURNAL_DIR}/recA${SEGMENT_JOURNAL_SUFFIX}`)).toBe(false);
    await settleLocks();
    expect(locks.holderOf(`${RECORD_LOCK_PREFIX}recA`)).toBeNull();
  });

  it("segments that come out of order with windows that overlap (a pause in a hand-off) make one whole part", async () => {
    // The fault this guards: the old window reached past the new segment's start, and the whole part failed ("bad-window").
    const h = harness();
    await h.handler.handle(open("recO", { startUs: 3 * S }));
    const [a, b] = made.webm;
    // The pause at 5.1 s stopped both recorders; the new segment's file came first.
    await h.handler.handle({ t: "segmentRecordAdd", recordingId: "recO", segment: { blob: b.blob, startUs: b.startUs, fromUs: b.startUs, toUs: 5.1 * S } });
    await h.handler.handle({ t: "segmentRecordAdd", recordingId: "recO", segment: { blob: a.blob, startUs: a.startUs, fromUs: 3 * S, toUs: 5.1 * S } });
    await h.handler.handle({ t: "segmentRecordEnd", recordingId: "recO" });
    const recorded = h.events.find((e) => e.t === "recorded") as Extract<IoEvent, { t: "recorded" }>;
    expect(recorded.failed).toBe(0);
    expect(recorded.parts).toHaveLength(1);
    const codes = decodeCodes(h.mock.readFile("lib/guest/recO.webm")!, "webm");
    // Frames 90 (3 s) to 152 (5.07 s), each once.
    expect(codes).toEqual(Array.from({ length: 63 }, (_, i) => (90 + i) % CODE_PERIOD));
  });

  it("makes a new part at another video config with its own tile, and counts a segment that does not parse as failed", async () => {
    const h = harness();
    await h.handler.handle({ ...open("recB", { poster: JPEG(1) }), rid: 1 });
    const segments = [
      ...windows(made.webm, 2 * S, 12 * S).map((segment, i) => ({ segment, poster: JPEG(10 + i) })),
      { segment: { blob: new Blob([new Uint8Array(30)]), startUs: 12 * S, fromUs: 12 * S, toUs: 12.5 * S }, poster: JPEG(20) },
      { segment: { blob: odd.blob, startUs: 12 * S, fromUs: 12 * S, toUs: 15 * S }, poster: JPEG(21) },
    ];
    for (const { segment, poster } of segments) await h.handler.handle({ t: "segmentRecordAdd", recordingId: "recB", segment, poster });
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
    // Each part's tile is the picture sent with its first segment: no gray placeholder.
    expect(recorded.parts.map((p) => p.record.posterDataUrl)).toEqual(["data:image/jpeg;base64,poster-10", "data:image/jpeg;base64,poster-21"]);
  });

  it("refuses a second open of the same recording, adds to a recording that is not open, a bad container, and no timeline", async () => {
    const h = harness();
    await h.handler.handle(open("recC"));
    expect(await h.send(open("recC"))).toMatchObject({ t: "error", code: "bad-command" });
    expect(await h.send({ t: "segmentRecordAdd", recordingId: "nope", segment: windows(made.webm, 0, 5 * S)[0] })).toMatchObject({ t: "error", code: "bad-command" });
    expect(await h.send({ t: "segmentRecordEnd", recordingId: "nope" })).toMatchObject({ t: "error", code: "bad-command" });
    expect(await h.send(open("recD", { container: "ogg" as never }))).toMatchObject({ t: "error", code: "bad-command" });
    expect(await h.send(open("recE", { timeline: undefined as never }))).toMatchObject({ t: "error", code: "bad-command" });
  });

  it("stores a dead tab's segment journal at startup with its sound and tiles, and leaves a live tab's journal alone", async () => {
    // Write two real journals the way a live recording does, from a first tab.
    const oldTab = createOpfsMock();
    const first = harness({ mock: oldTab, locks: new FakeLockManager(), clientId: "old-tab" });
    first.soundRun("webm", 1, 301);
    for (const id of ["recDead", "recLive"]) {
      await first.handler.handle({ ...open(id, { poster: JPEG(1) }) });
      const segs = windows(made.webm, 2 * S, 11 * S);
      for (const [i, segment] of segs.slice(0, 2).entries()) await first.handler.handle({ t: "segmentRecordAdd", recordingId: id, segment, poster: JPEG(30 + i) });
    }
    const file = (id: string) => `${JOURNAL_DIR}/${id}${SEGMENT_JOURNAL_SUFFIX}`;
    // The disk after the tab died: its files stay (its open handles and locks are gone).
    const mock = createOpfsMock();
    const locks = new FakeLockManager();
    // A torn last frame: the tab died while it wrote the third segment.
    const torn = encodeFrame({ t: "segment", startUs: 10 * S, fromUs: 10 * S, toUs: 11 * S, posterBytes: 0 }, [made.webm[2].bytes]).subarray(0, 100);
    for (const id of ["recDead", "recLive"]) {
      const bytes = oldTab.readFile(file(id))!;
      const joined = new Uint8Array(bytes.length + torn.length);
      joined.set(bytes);
      joined.set(torn, bytes.length);
      mock.writeFile(file(id), joined);
    }
    // A live tab still holds recLive's lock.
    const live = await holdRecordingLock(locks.client("live-tab") as never, "recLive");
    const h = harness({ mock, locks, clientId: "new-tab" });
    await h.handler.start();
    await h.handler.idle();
    const recovered = h.events.find((e) => e.t === "recovered") as Extract<IoEvent, { t: "recovered" }>;
    expect(recovered.records.map((r) => r.id)).toEqual(["recDead"]);
    expect(recovered.records[0]).toMatchObject({ kind: "record", mime: "video/webm", hasAudio: true });
    expect(recovered.records[0].posterDataUrl).toBe("data:image/jpeg;base64,poster-30");
    // The two whole segments: [2, 10) s (within one frame).
    expect(Math.abs(recovered.records[0].durationMs - 8000)).toBeLessThanOrEqual(34);
    expect(mock.exists("lib/guest/recDead.webm")).toBe(true);
    expect(mock.exists(file("recDead"))).toBe(false);
    expect(mock.exists(file("recLive"))).toBe(true);
    live.release();
  });

  it("two tabs that start at once after a crash store a dead segment journal once", async () => {
    const oldTab = createOpfsMock();
    const first = harness({ mock: oldTab, locks: new FakeLockManager(), clientId: "old-tab" });
    first.soundRun("webm", 1, 302);
    await first.handler.handle({ ...open("recTwice", { poster: JPEG(1) }) });
    for (const [i, segment] of windows(made.webm, 2 * S, 11 * S).slice(0, 2).entries()) {
      await first.handler.handle({ t: "segmentRecordAdd", recordingId: "recTwice", segment, poster: JPEG(30 + i) });
    }
    const file = `${JOURNAL_DIR}/recTwice${SEGMENT_JOURNAL_SUFFIX}`;
    // The disk after the tab died, seen by two new tabs that start together.
    const mock = createOpfsMock();
    mock.writeFile(file, oldTab.readFile(file)!);
    const locks = new FakeLockManager();
    const a = harness({ mock, locks, clientId: "tab-a" });
    const b = harness({ mock, locks, clientId: "tab-b" });
    await Promise.all([a.handler.start(), b.handler.start()]);
    await Promise.all([a.handler.idle(), b.handler.idle()]);
    const recoveredIds = [...a.events, ...b.events]
      .filter((e): e is Extract<IoEvent, { t: "recovered" }> => e.t === "recovered")
      .flatMap((e) => e.records.map((r) => r.id));
    expect(recoveredIds).toEqual(["recTwice"]);
    expect(mock.exists(file)).toBe(false);
    expect(locks.holderOf(`${RECORD_LOCK_PREFIX}recTwice`)).toBeNull();
  });
});
