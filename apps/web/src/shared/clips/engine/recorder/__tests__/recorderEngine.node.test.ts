// @vitest-environment node
/**
 * The MediaRecorder engine (tiers M and V, plan 5), end to end in process:
 * - a 2D game in a canvas-mock realm, drawn every display frame;
 * - the real canvas feed, pacer, governor, capture clock, rotator and ring;
 * - the MediaRecorder double, which gives each recorder a REAL segment file
 *   of exactly its span of the capture timeline (ffmpeg, segmentFixtures.ts:
 *   frame N of the source shows the code N mod 50, so a clip's frames can be
 *   checked one by one);
 * - the real io client and io worker handler, with the real join and the
 *   real library on the shared OPFS double and fake-indexeddb.
 * One test clock drives the realm's frames, the engine's timers, the
 * rotator's timers and the recorders' events.
 */
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { CanvasRealm, type FakeCanvas, type FakeContext2D } from "../../../../../__tests__/canvas-mock";
import {
  FakeMediaStream,
  FakeTrack,
  fakeRecorderFactory,
  type FakeMediaRecorder,
  type FakeRecorderBehavior,
} from "../../../../../__tests__/mediarecorder-mock";
import { createOpfsMock } from "../../../../../__tests__/opfs-mock";
import type { StorageLike } from "../../../library/fsTypes";
import { ClipLibrary } from "../../../library/opfsStore";
import { inspectClip } from "../../../library/verify";
import type { ClipMeta, HudState, IoCmd, IoEvent, OutputPreset } from "../../../protocol";
import type { CapabilityReport } from "../../../runtime/capabilities";
import type { EngineEvent } from "../../../service/engine";
import { IoClient, type IoWorkerLike } from "../../../service/ioClient";
import { createIoHandler } from "../../io/ioHandler";
import { CODE_PERIOD, FFMPEG_SKIP_REASON, blobOf, cleanupSegmentFixtures, decodeCodes, makeSegment } from "../../io/__tests__/segmentFixtures";
import { RecorderAudio, type RecorderAudioBus } from "../audioTrack";
import { HANDOFF_OVERLAP_MS, RECORDER_FAILURE_LIMIT, ROTATION_MS } from "../constants";
import type { MediaRecorderLike } from "../rotator";
import { RecorderEngine, type CompositorLike } from "../recorderEngine";
import { TestClock } from "./testClock";

vi.setConfig({ testTimeout: 120_000 });

const SKIP = FFMPEG_SKIP_REASON !== "";
if (SKIP) console.warn(`[clips] recorderEngine.node.test: SKIPPED (${FFMPEG_SKIP_REASON})`);

const S = 1_000_000;
const FRAME_MS = 1000 / 60;

function report(tier: "M" | "V" | "W"): CapabilityReport {
  return {
    caps: {
      tier,
      videoEncoderH264: tier === "W",
      h264Levels: [],
      hardwareEncoder: false,
      audioEncoderAac: false,
      audioData: false,
      audioDecoder: false,
      mediaRecorderMp4: tier === "M",
      mediaRecorderWebm: tier === "V",
      webgl2AsyncReadback: false,
      opfsSyncAccess: true,
      shareFiles: false,
      memoryClass: "mid",
      displayHz: 60,
    },
    video: { ok: tier === "W", hardware: false, levels: [], codecByLevel: {}, portrait: false, attempts: [] },
    audio: { aac: false, reason: null, description: "none" },
    probeScope: "worker",
    workerFailure: null,
    fingerprint: "test",
    probedAt: 0,
    fromCache: false,
    cached: false,
  };
}

class FakeCompositor implements CompositorLike {
  painted: Array<{ picture: number; hud: HudState; scale: number }> = [];
  disposed = false;
  readonly track = new FakeTrack("video");
  constructor(readonly preset: OutputPreset) {}
  paint(source: { width: number; height: number }, hud: HudState, scale: number): void {
    this.painted.push({ picture: (source as unknown as FakeCanvas).picture, hud, scale });
  }
  captureTrack(): MediaStreamTrack | null {
    return this.track as unknown as MediaStreamTrack;
  }
  async posterJpeg(): Promise<Blob | null> {
    return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });
  }
  dispose(): void {
    this.disposed = true;
  }
}

interface Options {
  tier?: "M" | "V";
  gop?: number;
  behaviors?: FakeRecorderBehavior[];
  /** The game's sound bus exists from the start. Default true. */
  sound?: boolean;
  /** The device's limit of recorders that record at the same time. */
  maxRecording?: number;
}

const libraries: ClipLibrary[] = [];
const engines: RecorderEngine[] = [];

function setup(options: Options = {}) {
  const tier = options.tier ?? "V";
  const container = tier === "M" ? "mp4" : "webm";
  const clock = new TestClock(10_000);
  const realm = new CanvasRealm(performance.timeOrigin);
  const canvas = realm.createCanvas(64, 64);
  const ctx = canvas.getContext("2d") as FakeContext2D;
  let picture = 0;
  const loop = () => {
    ctx.drawPicture(++picture);
    realm.requestAnimationFrame(loop);
  };
  realm.requestAnimationFrame(loop);
  clock.setInterval(() => realm.frame(clock.t), FRAME_MS);

  // The io worker, in process: the real handler behind the real client.
  const mock = createOpfsMock();
  const factory = new IDBFactory();
  const ioEvents: IoEvent[] = [];
  const worker: IoWorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage: (cmd: IoCmd) => void handler.handle(cmd),
    terminate: () => undefined,
  };
  const handler = createIoHandler({
    post: (event) => {
      ioEvents.push(event);
      worker.onmessage?.({ data: event } as MessageEvent<IoEvent>);
    },
    openLibrary: async () => {
      const lib = await ClipLibrary.open({ storage: mock.storage as unknown as StorageLike, indexedDB: factory, keyRange: IDBKeyRange, locks: null, channel: null });
      libraries.push(lib);
      return lib;
    },
    journal: null,
  });
  const io = new IoClient({
    createWorker: async () => worker,
    sessionBus: null,
    readUserId: async () => null,
    ownerMemory: null,
    openChannel: () => null,
    host: () => "hankshits.com",
    log: () => undefined,
  });

  // The recorders read the engine's capture time; the engine is made below.
  const engineRef: { current: RecorderEngine | null } = { current: null };
  const segmentsMade: Array<{ startUs: number; endUs: number; audio: boolean }> = [];
  const recorders = fakeRecorderFactory({
    schedule: clock.schedule,
    captureUs: () => engineRef.current!.mediaEndUs(),
    behaviors: options.behaviors,
    maxRecording: options.maxRecording,
    segment: (recorder: FakeMediaRecorder) => {
      const startUs = recorder.startedUs!;
      const endUs = recorder.stoppedUs!;
      const audio = recorder.stream.getTracks().some((t) => (t as FakeTrack).kind === "audio");
      segmentsMade.push({ startUs, endUs, audio });
      const bytes = makeSegment({ startSec: startUs / S, durationSec: Math.max(0.05, (endUs - startUs) / S), container, gop: options.gop, audio });
      return blobOf(bytes, container);
    },
  });

  const audioTrack = new FakeTrack("audio");
  const tap = { connect: vi.fn(), disconnect: vi.fn(), context: null as unknown };
  const audioContext = { createMediaStreamDestination: () => ({ stream: new FakeMediaStream([audioTrack]) }) };
  tap.context = audioContext;
  let busListener: ((bus: { context: BaseAudioContext }) => void) | null = null;
  let busReady = options.sound ?? true;
  const bus: RecorderAudioBus = {
    getTapPoint: () => (busReady ? (tap as unknown as AudioNode) : null),
    onCreated: (listener) => {
      busListener = listener;
      if (busReady) listener({ context: audioContext as unknown as BaseAudioContext });
      return () => {
        busListener = null;
      };
    },
  };

  const compositors: FakeCompositor[] = [];
  const logs: string[] = [];
  const engine = new RecorderEngine({
    report: report(tier),
    probe: async () => report(tier),
    io,
    createRecorder: (stream, recorderOptions) =>
      recorders.create(stream as unknown as FakeMediaStream, recorderOptions as unknown as Record<string, unknown> & { mimeType: string }) as unknown as MediaRecorderLike,
    createStream: (tracks) => new FakeMediaStream(tracks) as unknown as MediaStream,
    createCompositor: (preset) => {
      const made = new FakeCompositor(preset);
      compositors.push(made);
      return made;
    },
    audio: new RecorderAudio({ bus, log: () => undefined }),
    power: null,
    canRecord: () => true,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clear,
    setInterval: clock.setInterval,
    clearInterval: clock.clear,
    brandHost: () => "hankshits.com",
    log: (m) => logs.push(m),
  });
  engineRef.current = engine;
  engines.push(engine);
  const events: EngineEvent[] = [];
  engine.subscribe((event) => events.push(event));

  /** Advances the page clock until capture time reaches `us`. */
  const toCapture = async (us: number) => {
    for (let guard = 0; engine.mediaEndUs() < us; guard++) {
      if (guard > 100_000) throw new Error("capture time does not move");
      await clock.advance(Math.min(50, Math.max(1, (us - engine.mediaEndUs()) / 1000)));
    }
  };
  /** Runs `work` while the clock moves on, and gives its result. */
  const during = async <T>(work: Promise<T>, ms = 2000): Promise<T> => {
    let settled = false;
    const tracked = work.finally(() => {
      settled = true;
    });
    for (let waited = 0; waited < ms && !settled; waited += 50) await clock.advance(50);
    return tracked;
  };
  const meta = (id: string, overrides: Partial<ClipMeta> = {}): ClipMeta => ({
    id,
    ownerKey: "guest",
    gameId: "snake",
    kind: "clip",
    createdAt: Date.UTC(2026, 8, 28, 12),
    durationMs: 0,
    width: 0,
    height: 0,
    fps: 0,
    hasAudio: false,
    mime: "video/webm",
    kept: false,
    watched: false,
    moments: [],
    ...overrides,
  });
  const start = async () => {
    expect(await engine.prepare()).toEqual({ tier, supported: true });
    engine.setGame({ appId: "snake", gameName: "Snake", emoji: "🐍", score: () => "12" });
    const unregister = engine.registerCanvas(canvas as unknown as HTMLCanvasElement);
    await clock.advance(100);
    return unregister;
  };
  const makeBus = () => {
    busReady = true;
    busListener?.({ context: audioContext as unknown as BaseAudioContext });
  };
  return {
    clock,
    engine,
    events,
    recorders,
    segmentsMade,
    compositors,
    mock,
    ioEvents,
    logs,
    canvas,
    toCapture,
    during,
    meta,
    start,
    makeBus,
    container,
  };
}

afterEach(() => {
  engines.splice(0).forEach((engine) => engine.dispose());
  libraries.splice(0).forEach((lib) => lib.close());
});

afterAll(() => cleanupSegmentFixtures());

/** The codes a file must show for source frames [first, last]. */
function codes(first: number, last: number): number[] {
  const out: number[] = [];
  for (let n = first; n <= last; n++) out.push(n % CODE_PERIOD);
  return out;
}

describe.skipIf(SKIP)("RecorderEngine: rotation and clips (tier V, WebM)", () => {
  it("rotates every ROTATION_MS with two recorders only across the hand-off, and a clip shows every frame once", async () => {
    const h = setup();
    await h.start();
    expect(h.events.filter((e) => e.t === "output")).toHaveLength(1);
    let most = 0;
    while (h.engine.mediaEndUs() < 12 * S) {
      await h.clock.advance(25);
      most = Math.max(most, h.recorders.made.filter((r) => r.state === "recording").length);
    }
    expect(most).toBe(2);
    // Recorders started at capture 0, 5 and 10 s (every ROTATION_MS).
    expect(h.recorders.made.slice(0, 3).map((r) => Math.round(r.startedUs! / 1000))).toEqual([0, ROTATION_MS, 2 * ROTATION_MS]);
    // Each stopped HANDOFF_OVERLAP_MS after the next one started.
    expect(Math.round(h.recorders.made[0].stoppedUs! / 1000)).toBe(ROTATION_MS + HANDOFF_OVERLAP_MS);
    // The compositor got game frames with the band values (never a player name).
    const compositor = h.compositors[0];
    expect(compositor.preset).toMatchObject({ width: 960, height: 544, orientation: "wide" });
    expect(compositor.painted.length).toBeGreaterThan(100);
    expect(compositor.painted.at(-1)!.hud).toEqual({ gameName: "Snake", emoji: "🐍", score: "12" });

    const made = await h.during(h.engine.clip({ seconds: 8, endAtUs: 12 * S, meta: h.meta("c1") }));
    // The segment [0, 5.25) has a keyframe every second: the clip starts at 4 s.
    expect(made.startUs).toBe(4 * S);
    expect(made.endUs).toBe(12 * S);
    expect(made.record).toMatchObject({ id: "c1", mime: "video/webm", storage: "opfs", hasAudio: true, width: 960, height: 544 });
    const bytes = h.mock.readFile("lib/guest/c1.webm")!;
    expect(decodeCodes(bytes, "webm")).toEqual(codes(120, 359));
    expect((await inspectClip(bytes, "video/webm")).firstVideoIsKey).toBe(true);
    // Granularity: the rotation period at output, then the measured keyframe spacing.
    const granularity = h.events.filter((e) => e.t === "granularity").map((e) => (e as { seconds: number }).seconds);
    expect(granularity[0]).toBe(ROTATION_MS / 1000);
    expect(granularity.at(-1)).toBe(1);
  });

  it("with Firefox's sparse keyframes (one per segment), the granularity is the rotation period and a clip starts at a segment start", async () => {
    const h = setup({ gop: 1000 });
    await h.start();
    await h.toCapture(12 * S);
    const made = await h.during(h.engine.clip({ seconds: 8, endAtUs: 12 * S, meta: h.meta("c2") }));
    expect(made.startUs).toBe(0);
    expect(decodeCodes(h.mock.readFile("lib/guest/c2.webm")!, "webm")).toEqual(codes(0, 359));
    const granularity = h.events.filter((e) => e.t === "granularity").map((e) => (e as { seconds: number }).seconds);
    expect(granularity.at(-1)).toBe(ROTATION_MS / 1000);
  });

  it("a pause stops the recorders and the capture time; a clip across the pause shows no gap and no paused time", async () => {
    const h = setup();
    await h.start();
    await h.toCapture(6 * S);
    h.engine.setPaused("break", true);
    await h.clock.advance(50);
    expect(h.recorders.made.filter((r) => r.state === "recording")).toHaveLength(0);
    const frozen = h.engine.mediaEndUs();
    await h.clock.advance(3000);
    expect(h.engine.mediaEndUs()).toBe(frozen);
    h.engine.setPaused("break", false);
    await h.toCapture(9 * S);
    const made = await h.during(h.engine.clip({ seconds: 7, endAtUs: 9 * S, meta: h.meta("c3") }));
    expect(made.startUs).toBe(2 * S);
    const shown = decodeCodes(h.mock.readFile("lib/guest/c3.webm")!, "webm");
    // Capture time is the source time: every frame from 2 s to 9 s, the paused wall time left out.
    expect(shown).toEqual(codes(60, 269));
  });

  it("a clip right after a pause waits for the segment that the pause ended", async () => {
    const h = setup();
    await h.start();
    await h.toCapture(6 * S);
    h.engine.setPaused("break", true);
    const endUs = h.engine.mediaEndUs();
    // No clock step between the pause and the clip: the last recorder is still giving its file.
    expect(h.recorders.made.some((r) => r.stoppedUs !== null && r.startedUs !== null)).toBe(true);
    const made = await h.during(h.engine.clip({ seconds: 4, endAtUs: endUs, meta: h.meta("c7") }));
    expect(made.endUs).toBe(endUs);
    const shown = decodeCodes(h.mock.readFile("lib/guest/c7.webm")!, "webm");
    // From the keyframe at 2 s to the pause.
    expect(shown).toEqual(codes(60, 60 + shown.length - 1));
    expect(Math.abs(60 + shown.length - Math.round((endUs / S) * 30))).toBeLessThanOrEqual(1);
  });

  it("the game's sound starts at the next segment when the sound bus appears", async () => {
    const h = setup({ sound: false });
    await h.start();
    await h.toCapture(2 * S);
    expect(h.recorders.made[0].stream.getTracks()).toHaveLength(1);
    h.makeBus();
    await h.clock.advance(400);
    // A hand-off at once: the new recorder records the sound track too.
    expect(h.recorders.made).toHaveLength(2);
    expect(h.recorders.made[1].stream.getTracks().map((t) => (t as FakeTrack).kind)).toEqual(["video", "audio"]);
    await h.toCapture(6 * S);
    const made = await h.during(h.engine.clip({ seconds: 5, endAtUs: 6 * S, meta: h.meta("c4") }));
    expect(made.record.hasAudio).toBe(true);
    expect(h.segmentsMade[0].audio).toBe(false);
    expect(decodeCodes(h.mock.readFile("lib/guest/c4.webm")!, "webm")).toEqual(codes(30, 179));
  });

  it("a purge keeps every frame from before it out of later clips", async () => {
    const h = setup();
    await h.start();
    await h.toCapture(7 * S);
    h.engine.purge();
    expect(h.events.at(-1)).toEqual({ t: "buffered", seconds: 0 });
    await h.toCapture(11 * S);
    const made = await h.during(h.engine.clip({ seconds: 30, endAtUs: 11 * S, meta: h.meta("c5") }));
    // The first segment after the purge starts at the purge (7 s).
    expect(made.startUs).toBe(7 * S);
    expect(decodeCodes(h.mock.readFile("lib/guest/c5.webm")!, "webm")[0]).toBe((7 * 30) % CODE_PERIOD);
  });

  it("too little footage is 'warming', never a broken file", async () => {
    const h = setup();
    await h.start();
    await h.toCapture(1 * S);
    await expect(h.during(h.engine.clip({ seconds: 30, meta: h.meta("c6") }))).rejects.toMatchObject({ reason: "warming" });
    expect(h.mock.listFiles().filter((f) => f.startsWith("lib/"))).toEqual([]);
  });
});

describe.skipIf(SKIP)("RecorderEngine: one encoder session at a time", () => {
  it("falls back to hand-offs with no overlap, keeps rotating, and a clip across them shows every frame", async () => {
    const h = setup({ tier: "M", maxRecording: 1 });
    await h.start();
    let most = 0;
    while (h.engine.mediaEndUs() < 14 * S) {
      await h.clock.advance(25);
      most = Math.max(most, h.recorders.made.filter((r) => r.state === "recording").length);
    }
    expect(most).toBe(1);
    // Two overlaps failed (at 5 s and at the retry 1 s later), then the rotation went on alone.
    expect(h.events.filter((e) => e.t === "unavailable")).toEqual([]);
    expect(h.logs.some((m) => m.includes("one recorder at a time"))).toBe(true);
    expect(h.segmentsMade.length).toBeGreaterThanOrEqual(2);
    const made = await h.during(h.engine.clip({ seconds: 10, endAtUs: 14 * S, meta: h.meta("s1", { mime: "video/mp4" }) }));
    const shown = decodeCodes(h.mock.readFile("lib/guest/s1.mp4")!, "mp4");
    const first = shown[0];
    shown.forEach((code, i) => expect(code).toBe((first + i) % CODE_PERIOD));
    expect(made.endUs).toBe(14 * S);
  });
});

describe.skipIf(SKIP)("RecorderEngine: tier M (MP4)", () => {
  it("records H.264 and AAC segments and stores an MP4 clip", async () => {
    const h = setup({ tier: "M" });
    await h.start();
    expect(h.compositors[0].preset).toMatchObject({ width: 1280, height: 720 });
    const options = h.recorders.made[0].options;
    expect(options).toMatchObject({ mimeType: "video/mp4;codecs=avc1,mp4a.40.2", videoKeyFrameIntervalDuration: 1000 });
    await h.toCapture(7 * S);
    const made = await h.during(h.engine.clip({ seconds: 5, endAtUs: 7 * S, meta: h.meta("m1") }));
    expect(made.record).toMatchObject({ mime: "video/mp4", hasAudio: true });
    const bytes = h.mock.readFile("lib/guest/m1.mp4")!;
    const shown = decodeCodes(bytes, "mp4");
    const first = shown[0];
    shown.forEach((code, i) => expect(code).toBe((first + i) % CODE_PERIOD));
    expect(made.startUs).toBeLessThanOrEqual(2 * S);
  });
});

describe.skipIf(SKIP)("RecorderEngine: Record", () => {
  it("keeps every segment from the tap on, and stores the recording at the end", async () => {
    const h = setup();
    await h.start();
    await h.toCapture(3 * S);
    const handle = await h.during(h.engine.startRecording(h.meta("rec1", { kind: "record" })));
    await h.toCapture(12 * S);
    const result = await h.during(handle.stop(), 3000);
    expect(result.failed).toBe(0);
    expect(result.parts).toHaveLength(1);
    const part = result.parts[0];
    expect(part.record).toMatchObject({ id: "rec1", kind: "record", mime: "video/webm" });
    expect(part.startUs).toBe(3 * S);
    const bytes = h.mock.readFile("lib/guest/rec1.webm")!;
    const shown = decodeCodes(bytes, "webm");
    expect(shown).toEqual(codes(90, 90 + shown.length - 1));
    // It ends at the stop tap (12 s), within one frame.
    expect(Math.abs(90 + shown.length - 360)).toBeLessThanOrEqual(1);
  });

  it("a stop tap in the middle of a rotation hand-off still keeps the footage up to the tap", async () => {
    const h = setup();
    await h.start();
    await h.toCapture(3 * S);
    const handle = await h.during(h.engine.startRecording(h.meta("rec3", { kind: "record" })));
    // The rotation at 10 s starts a new recorder; the old one records on until 10.25 s.
    await h.toCapture(10.1 * S);
    expect(h.recorders.made.filter((r) => r.state === "recording")).toHaveLength(2);
    const tapUs = h.engine.mediaEndUs();
    expect(tapUs).toBeLessThan(10.25 * S);
    const result = await h.during(handle.stop(), 3000);
    const shown = decodeCodes(h.mock.readFile(`lib/guest/${result.parts[0].record.id}.webm`)!, "webm");
    expect(shown).toEqual(codes(90, 90 + shown.length - 1));
    // Frames up to the tap (after the new recorder's start at 10 s), within one frame.
    expect(Math.abs(90 + shown.length - Math.round((tapUs / S) * 30))).toBeLessThanOrEqual(1);
  });
});

describe.skipIf(SKIP)("RecorderEngine: failures", () => {
  it("a recorder that fails says encoder-error, and the engine starts a new one (recovered)", async () => {
    const h = setup();
    await h.start();
    await h.toCapture(2 * S);
    h.recorders.made[0].fail();
    await h.clock.advance(50);
    expect(h.events).toContainEqual({ t: "encoder-error", fatal: false });
    await h.clock.advance(1500);
    expect(h.events).toContainEqual({ t: "recovered" });
    expect(h.recorders.made.at(-1)!.state).toBe("recording");
  });

  it("RECORDER_FAILURE_LIMIT failures in a row stop the engine: unavailable", async () => {
    const behaviors: FakeRecorderBehavior[] = [{}, ...Array.from({ length: RECORDER_FAILURE_LIMIT }, () => ({ errorAtStart: true }))];
    const h = setup({ behaviors });
    await h.start();
    await h.toCapture(1 * S);
    h.recorders.made[0].fail();
    await h.clock.advance(60_000);
    expect(h.events).toContainEqual({ t: "unavailable", reason: "failing" });
    expect(h.events.at(-1)).toEqual({ t: "reset" });
    expect(h.compositors[0].disposed).toBe(true);
  });
});

describe.skipIf(SKIP)("RecorderEngine: prepare", () => {
  it("claims only tiers M and V, and only where the browser can record a canvas", async () => {
    const h = setup();
    expect(await h.engine.prepare()).toEqual({ tier: "V", supported: true });
    const other = new RecorderEngine({
      report: report("W"),
      io: { configure: vi.fn() } as never,
      audio: null,
      power: null,
      canRecord: () => true,
      createCompositor: (preset) => new FakeCompositor(preset),
    });
    expect(await other.prepare()).toEqual({ tier: "W", supported: false });
    const noCanvasCapture = new RecorderEngine({ report: report("V"), io: { configure: vi.fn() } as never, audio: null, power: null, canRecord: () => false });
    expect(await noCanvasCapture.prepare()).toEqual({ tier: "V", supported: false });
    other.dispose();
    noCanvasCapture.dispose();
  });
});

describe.skipIf(SKIP)("RecorderEngine: picture and disarm", () => {
  it("takes a picture of the game canvas as a PNG", async () => {
    const h = setup();
    await h.start();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 3, 0, 0, 0, 2, 8, 6, 0, 0, 0, 0x9d, 0x74, 0x66, 0x1a, 0, 0, 0, 0x11, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x38, 0xa1, 0xa1, 0xf1, 0x1f, 0x86, 0x19, 0x90, 0x39, 0x00, 0xa1, 0x2d, 0x0c, 0x8b, 0x3f, 0x86, 0xca, 0xb6, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
    (h.canvas as unknown as { toBlob: (cb: (b: Blob) => void) => void }).toBlob = (cb) => cb(new Blob([png], { type: "image/png" }));
    const record = await h.during(h.engine.picture(h.meta("pic1", { kind: "picture" })));
    expect(record).toMatchObject({ id: "pic1", kind: "picture", mime: "image/png", width: 64, height: 64 });
  });

  it("disarm stops everything and resets; a recording that runs is still stored", async () => {
    const h = setup();
    await h.start();
    await h.toCapture(2 * S);
    const handle = await h.during(h.engine.startRecording(h.meta("rec2", { kind: "record" })));
    await h.toCapture(4 * S);
    h.engine.disarm();
    expect(h.events.at(-1)).toEqual({ t: "reset" });
    expect(h.engine.mediaEndUs()).toBe(0);
    const result = await h.during(handle.stop(), 3000);
    expect(result.parts.map((p) => p.record.id)).toEqual(["rec2"]);
    expect(h.recorders.made.every((r) => r.state === "inactive")).toBe(true);
    expect(h.compositors[0].disposed).toBe(true);
  });
});
