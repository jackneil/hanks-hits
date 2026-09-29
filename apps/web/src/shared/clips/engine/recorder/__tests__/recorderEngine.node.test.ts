// @vitest-environment node
/**
 * The MediaRecorder engine (tiers M and V, plan 5), end to end in process:
 * - a 2D game in a canvas-mock realm, drawn every display frame;
 * - the real canvas feed, pacer, governor, capture clock, rotator, anchor,
 *   ring and sound recorder;
 * - a compositor double whose canvas track delivers a frame at each paint
 *   and each touch (a code per paint, so a clip's frames can be checked one
 *   by one);
 * - the MediaRecorder double, which records the frames its track delivers
 *   the way each browser does (Chromium: the first frame after start(), and
 *   "start" after the first encode; Gecko: the frame the track holds at
 *   start()), with a random first-encode delay, and gives each recorder a
 *   REAL file of exactly those frames (ffmpeg and mediabunny,
 *   segmentFixtures.ts). A segment's "start" event is never its first frame:
 *   the engine must find that from the packet times.
 * - the sound recorder double gives a real sound run (a 440 Hz tone, Opus
 *   in WebM or AAC in fragmented MP4) in timeslice chunks cut at any byte;
 * - the real io client and io worker handler, with the real sound store,
 *   join and library on the shared OPFS double and fake-indexeddb.
 * One test clock drives the realm's frames, the engine's timers, the
 * rotator's timers, the recorders' events and the io worker's waits.
 */
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CanvasRealm, type FakeContext2D } from "../../../../../__tests__/canvas-mock";
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
import type { PowerSource } from "../../../service/engineShared";
import type { PowerState } from "../../../runtime/governor";
import { IoClient, type IoWorkerLike } from "../../../service/ioClient";
import { createIoHandler } from "../../io/ioHandler";
import {
  CODE_PERIOD,
  FFMPEG_SKIP_REASON,
  blobOf,
  cleanupSegmentFixtures,
  decodeCodes,
  decodePcm,
  makeFramesSegment,
  makeSoundRun,
  mp4FragmentStarts,
  toneSmoothness,
  type FrameSpec,
} from "../../io/__tests__/segmentFixtures";
import { RecorderAudio, type RecorderAudioBus } from "../audioTrack";
import { HANDOFF_OVERLAP_MS, RECORDER_FAILURE_LIMIT, ROTATION_MS } from "../constants";
import type { MediaRecorderLike } from "../rotator";
import { RecorderEngine, type CompositorLike } from "../recorderEngine";
import { TestClock } from "./testClock";

vi.setConfig({ testTimeout: 180_000 });

const SKIP = FFMPEG_SKIP_REASON !== "";
if (SKIP) console.warn(`[clips] recorderEngine.node.test: SKIPPED (${FFMPEG_SKIP_REASON})`);

const S = 1_000_000;
const FRAME_MS = 1000 / 60;
const SOUND_SECONDS = 90;

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
      mediaRecorderMp4: tier === "M" || tier === "W",
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

/** One frame the compositor's track delivered. */
interface Delivered {
  atUs: number;
  code: number;
  touch: boolean;
}

/** The code of the empty frame (a purge): game paints use the codes below it. */
const BLANK = CODE_PERIOD - 1;

/**
 * The page compositor double: each paint is a new picture (its code counts
 * up, 0 to BLANK - 1), each touch is the last picture again, a clear is the
 * empty frame (BLANK), and the canvas track delivers a frame for each, at
 * the capture time of the paint.
 */
class FakeCompositor implements CompositorLike {
  painted: Array<{ hud: HudState; scale: number }> = [];
  delivered: Delivered[] = [];
  disposed = false;
  cleared = 0;
  private code = 0;
  private paints = 0;
  readonly track: FakeTrack;
  constructor(
    readonly preset: OutputPreset,
    private readonly captureUs: () => number,
    schedule: (fn: () => void) => void,
  ) {
    // Canvas capture takes the canvas after the task that painted it.
    this.track = new FakeTrack("video", schedule);
  }
  paint(_source: { width: number; height: number }, hud: HudState, scale: number): void {
    this.painted.push({ hud, scale });
    this.code = ++this.paints % BLANK;
    this.deliver(false);
  }
  touch(): void {
    this.deliver(true);
  }
  clear(): void {
    this.cleared++;
    this.code = BLANK;
    this.deliver(false);
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
  private deliver(touch: boolean): void {
    const frame = { atUs: this.captureUs(), code: this.code, touch };
    this.delivered.push(frame);
    this.track.deliver(frame);
  }
}

interface Options {
  tier?: "M" | "V";
  gop?: number;
  behaviors?: FakeRecorderBehavior[];
  /** The game's sound bus exists from the start. Default true. */
  sound?: boolean;
  /** The device's limit of recorders that hold an encoder session at the same time. */
  maxRecording?: number;
  /** Chromium ("next-frame", the default) or Gecko ("held"). */
  firstFrame?: "next-frame" | "held";
  /** The first encode's delay, ms. Default: 10 to 150 ms, random. */
  startDelayMs?: () => number;
  /** Delays one io command (a busy io worker), ms. */
  ioDelay?: (cmd: IoCmd) => number;
  probe?: () => CapabilityReport;
  onTierChange?: (report: CapabilityReport) => Promise<boolean>;
  seed?: number;
  /** A power source the test drives (Compute Pressure), so the governor changes the rung. */
  power?: TestPower;
}

/** A power source whose pressure the test sets. */
class TestPower implements PowerSource {
  listener: ((state: PowerState) => void) | null = null;
  subscribe(listener: (state: PowerState) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }
}

const libraries: ClipLibrary[] = [];
const engines: RecorderEngine[] = [];
const soundRuns: Record<"webm" | "mp4", Uint8Array> = { webm: new Uint8Array(0), mp4: new Uint8Array(0) };

beforeAll(() => {
  if (SKIP) return;
  soundRuns.webm = makeSoundRun({ container: "webm", seconds: SOUND_SECONDS });
  soundRuns.mp4 = makeSoundRun({ container: "mp4", seconds: SOUND_SECONDS, fragmentMs: 250 });
});

function rng(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    return x / 2 ** 31;
  };
}

function setup(options: Options = {}) {
  const tier = options.tier ?? "V";
  const container: "mp4" | "webm" = tier === "M" ? "mp4" : "webm";
  const clock = new TestClock(10_000);
  const realm = new CanvasRealm(performance.timeOrigin);
  const canvas = realm.createCanvas(64, 64);
  const ctx = canvas.getContext("2d") as FakeContext2D;
  let picture = 0;
  let drawing = true;
  const loop = () => {
    if (!drawing) return;
    ctx.drawPicture(++picture);
    realm.requestAnimationFrame(loop);
  };
  realm.requestAnimationFrame(loop);
  clock.setInterval(() => realm.frame(clock.t), FRAME_MS);

  // The io worker, in process: the real handler behind the real client.
  const mock = createOpfsMock();
  const factory = new IDBFactory();
  const ioEvents: IoEvent[] = [];
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
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clear,
    log: () => undefined,
  });
  const worker: IoWorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage: (cmd: IoCmd) => {
      const delay = options.ioDelay?.(cmd) ?? 0;
      if (delay > 0) clock.setTimeout(() => void handler.handle(cmd), delay);
      else void handler.handle(cmd);
    },
    terminate: () => undefined,
  };
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
  const captureUs = () => engineRef.current!.mediaEndUs();
  const random = rng(options.seed ?? 5);
  const segmentsMade: Array<{ frames: FrameSpec[]; recorder: number }> = [];
  const recorders = fakeRecorderFactory({
    schedule: clock.schedule,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clear,
    captureUs,
    behaviors: options.behaviors,
    maxRecording: options.maxRecording,
    firstFrame: options.firstFrame ?? "next-frame",
    startDelayMs: options.startDelayMs ?? (() => 10 + Math.round(random() * 140)),
    segment: async (recorder: FakeMediaRecorder) => {
      const frames = recorder.frames.map((f) => ({ atUs: f.atUs, code: f.code }));
      segmentsMade.push({ frames, recorder: recorder.id });
      return blobOf(await makeFramesSegment({ frames, container, gop: options.gop }), container);
    },
  });
  // The sound recorders: each run gives the tone file's bytes as its time goes by.
  const soundState = new Map<FakeMediaRecorder, { at: number }>();
  const soundRecorders = fakeRecorderFactory({
    schedule: clock.schedule,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clear,
    captureUs,
    segment: () => new Blob([]),
    chunk: (recorder, final) => {
      const bytes = soundRuns[container];
      const state = soundState.get(recorder) ?? { at: 0 };
      soundState.set(recorder, state);
      const elapsedUs = captureUs() - (recorder.startCalledUs ?? 0);
      let target = Math.min(bytes.length, Math.floor((bytes.length * elapsedUs) / (SOUND_SECONDS * S)));
      // A recorder that stops closes its last fragment (an MP4 file ends whole).
      if (final && container === "mp4") target = mp4FragmentStarts(bytes).find((at) => at >= target) ?? bytes.length;
      if (target <= state.at) return null;
      const chunk = bytes.slice(state.at, target);
      state.at = target;
      return new Blob([chunk]);
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
  const probe = options.probe ?? (() => report(tier));
  const engine = new RecorderEngine({
    report: report(tier),
    probe: async () => probe(),
    io,
    createRecorder: (stream, recorderOptions) =>
      recorders.create(stream as unknown as FakeMediaStream, recorderOptions as unknown as Record<string, unknown> & { mimeType: string }) as unknown as MediaRecorderLike,
    createSoundRecorder: (stream, soundOptions) =>
      soundRecorders.create(stream as unknown as FakeMediaStream, soundOptions as unknown as Record<string, unknown> & { mimeType: string }) as unknown as MediaRecorderLike,
    isTypeSupported: () => true,
    createStream: (tracks) => new FakeMediaStream(tracks) as unknown as MediaStream,
    createCompositor: (preset) => {
      const made = new FakeCompositor(preset, captureUs, clock.schedule);
      compositors.push(made);
      return made;
    },
    audio: new RecorderAudio({ bus, log: () => undefined }),
    power: options.power ?? null,
    canRecord: () => true,
    ...(options.onTierChange ? { onTierChange: options.onTierChange } : {}),
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
  const during = async <T>(work: Promise<T>, ms = 4000): Promise<T> => {
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
    mime: container === "mp4" ? "video/mp4" : "video/webm",
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
  const recording = () => recorders.made.filter((r) => r.state === "recording").length;
  /** The codes of the frames the compositor delivered in [fromUs, toUs). */
  const expected = (fromUs: number, toUs: number) => compositors[0].delivered.filter((f) => f.atUs >= fromUs && f.atUs < toUs).map((f) => f.code);
  /**
   * A clip of [fromUs, toUs) shows exactly the frames delivered in its span.
   * A frame painted less than 1 ms before the end can go either way (WebM
   * times are whole milliseconds; concat.ts FRAME_END_SLACK_US).
   */
  const check = (shown: number[], fromUs: number, toUs: number, collapsed = false) => {
    const fit = (codes: number[]) => (collapsed ? collapse(codes) : codes);
    const full = fit(expected(fromUs, toUs));
    const short = fit(expected(fromUs, toUs - 1000));
    const got = fit(shown);
    if (got.length === short.length && got.length !== full.length) expect(got).toEqual(short);
    else expect(got).toEqual(full);
  };
  const file = (id: string) => mock.readFile(`lib/guest/${id}.${container}`)!;
  return {
    clock,
    engine,
    events,
    recorders,
    soundRecorders,
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
    recording,
    expected,
    check,
    file,
    stopDrawing: () => {
      drawing = false;
    },
  };
}

afterEach(() => {
  engines.splice(0).forEach((engine) => engine.dispose());
  libraries.splice(0).forEach((lib) => lib.close());
});

afterAll(() => cleanupSegmentFixtures());

/** Consecutive equal codes as one (a held frame repeats the picture on the screen). */
function collapse(codes: number[]): number[] {
  return codes.filter((c, i) => i === 0 || c !== codes[i - 1]);
}

describe.skipIf(SKIP)("RecorderEngine: rotation and clips (tier V, WebM)", () => {
  it("rotates every ROTATION_MS with two recorders only across the hand-off, and a clip shows every painted frame once (Chromium)", async () => {
    const h = setup();
    await h.start();
    let most = 0;
    while (h.engine.mediaEndUs() < 13 * S) {
      await h.clock.advance(25);
      most = Math.max(most, h.recording());
    }
    expect(most).toBe(2);
    expect(h.events.filter((e) => e.t === "output")).toHaveLength(1);
    // Recorders started ROTATION_MS apart; each "start" event came after its first frame.
    const calls = h.recorders.made.slice(0, 3).map((r) => r.startCalledUs!);
    expect(calls[1] - calls[0]).toBeCloseTo(ROTATION_MS * 1000, -4);
    expect(calls[2] - calls[1]).toBeCloseTo(ROTATION_MS * 1000, -4);
    for (const r of h.recorders.made.slice(0, 3)) expect(r.startedUs!).toBeGreaterThan(r.frames[0].atUs);
    // Each stopped HANDOFF_OVERLAP_MS after the next one started.
    expect((h.recorders.made[0].stoppedUs! - h.recorders.made[1].startedUs!) / 1000).toBeCloseTo(HANDOFF_OVERLAP_MS, -1);
    // The compositor got game frames with the band values (never a player name).
    const compositor = h.compositors[0];
    expect(compositor.preset).toMatchObject({ width: 960, height: 544, orientation: "wide" });
    expect(compositor.painted.length).toBeGreaterThan(100);
    expect(compositor.painted.at(-1)!.hud).toEqual({ gameName: "Snake", emoji: "🐍", score: "12" });

    const made = await h.during(h.engine.clip({ seconds: 9, endAtUs: 13 * S, meta: h.meta("c1") }));
    expect(made.endUs).toBe(13 * S);
    expect(made.record).toMatchObject({ id: "c1", mime: "video/webm", storage: "opfs", hasAudio: true, width: 960, height: 544 });
    // Across two hand-offs: every frame the recorders got, once, in order. No repeated or skipped slice.
    h.check(decodeCodes(h.file("c1"), "webm"), made.startUs, made.endUs);
    expect((await inspectClip(h.file("c1"), "video/webm")).firstVideoIsKey).toBe(true);
    // Granularity: the rotation period at output, then the measured keyframe spacing.
    const granularity = h.events.filter((e) => e.t === "granularity").map((e) => (e as { seconds: number }).seconds);
    expect(granularity[0]).toBe(ROTATION_MS / 1000);
    expect(granularity.at(-1)).toBe(1);
  });

  it("Gecko's held first frame: a clip across hand-offs shows every painted frame in order, none skipped", async () => {
    const h = setup({ firstFrame: "held", seed: 17 });
    await h.start();
    await h.toCapture(13 * S);
    const made = await h.during(h.engine.clip({ seconds: 9, endAtUs: 13 * S, meta: h.meta("g1") }));
    const shown = decodeCodes(h.file("g1"), "webm");
    // A held frame repeats the picture that is on the screen: collapse repeats, then every paint once.
    h.check(shown, made.startUs, made.endUs, true);
    expect(h.logs.some((m) => m.includes("do not fit the paint times"))).toBe(false);
  });

  it("the first recorder starts at the first paint after the warmup, so a clip from the arm on starts with the game and runs whole across the first hand-off", async () => {
    // The fault this guards: the first recorder recorded an empty canvas for the 1 s warmup, and the first segment sat 1 s early.
    const h = setup({ seed: 23 });
    await h.start();
    await h.toCapture(8 * S);
    const firstPaint = h.compositors[0].delivered[0].atUs;
    expect(firstPaint).toBeGreaterThanOrEqual(900_000);
    expect(h.recorders.made[0].startCalledUs!).toBeGreaterThanOrEqual(firstPaint);
    const made = await h.during(h.engine.clip({ seconds: 30, endAtUs: 8 * S, meta: h.meta("w1") }));
    expect(made.startUs).toBe(h.recorders.made[0].frames[0].atUs);
    h.check(decodeCodes(h.file("w1"), "webm"), made.startUs, made.endUs);
  });

  it("with Firefox's sparse keyframes (one per segment), the granularity is the rotation period and a clip starts at a segment start", async () => {
    const h = setup({ gop: 1000 });
    await h.start();
    await h.toCapture(12 * S);
    const made = await h.during(h.engine.clip({ seconds: 5, endAtUs: 12 * S, meta: h.meta("c2") }));
    const starts = h.recorders.made.map((r) => r.frames[0]?.atUs);
    expect(starts).toContain(made.startUs);
    h.check(decodeCodes(h.file("c2"), "webm"), made.startUs, made.endUs);
    // One keyframe per segment: the gap is the time from one segment's first frame to the next one's (the rotation, rounded up).
    const granularity = h.events.filter((e) => e.t === "granularity").map((e) => (e as { seconds: number }).seconds);
    expect(granularity.at(-1)!).toBeGreaterThanOrEqual(ROTATION_MS / 1000);
    expect(granularity.at(-1)!).toBeLessThanOrEqual(ROTATION_MS / 1000 + 0.1);
  });

  it("a pause stops the recorders and the capture time; a clip across the pause shows no gap and no paused time", async () => {
    const h = setup();
    await h.start();
    await h.toCapture(6 * S);
    h.engine.setPaused("break", true);
    await h.clock.advance(50);
    expect(h.recording()).toBe(0);
    expect(h.soundRecorders.made.filter((r) => r.state === "recording")).toHaveLength(0);
    const frozen = h.engine.mediaEndUs();
    await h.clock.advance(3000);
    expect(h.engine.mediaEndUs()).toBe(frozen);
    h.engine.setPaused("break", false);
    await h.toCapture(9 * S);
    const made = await h.during(h.engine.clip({ seconds: 6, endAtUs: 9 * S, meta: h.meta("c3") }));
    const shown = decodeCodes(h.file("c3"), "webm");
    // The new recorder's first frame is a repaint of the picture from before the pause (a touch): collapse it.
    h.check(shown, made.startUs, made.endUs, true);
    expect(made.endUs - made.startUs).toBeGreaterThan(5.5 * S);
  });

  it("a clip right after a pause waits for the segment that the pause ended", async () => {
    const h = setup();
    await h.start();
    await h.toCapture(6 * S);
    h.engine.setPaused("break", true);
    const endUs = h.engine.mediaEndUs();
    const made = await h.during(h.engine.clip({ seconds: 4, endAtUs: endUs, meta: h.meta("c7") }));
    expect(made.endUs).toBeLessThanOrEqual(endUs);
    expect(made.endUs).toBeGreaterThan(endUs - 100_000);
    h.check(decodeCodes(h.file("c7"), "webm"), made.startUs, made.endUs);
  });

  it.each(["next-frame", "held"] as const)("a purge keeps every frame from before it out of later clips (%s)", async (firstFrame) => {
    const h = setup({ firstFrame });
    await h.start();
    await h.toCapture(7 * S);
    const before = h.compositors[0].delivered.length;
    h.engine.purge();
    const purgeUs = h.engine.mediaEndUs();
    expect(h.events.at(-1)).toEqual({ t: "buffered", seconds: 0 });
    expect(h.compositors[0].cleared).toBe(1);
    await h.toCapture(12 * S);
    const made = await h.during(h.engine.clip({ seconds: 30, endAtUs: 12 * S, meta: h.meta("c5") }));
    expect(made.startUs).toBeGreaterThanOrEqual(purgeUs);
    const shown = decodeCodes(h.file("c5"), "webm");
    // The clip starts with the empty frame or a picture painted after the purge, never an older one.
    const after = new Set(h.compositors[0].delivered.slice(before).map((f) => f.code));
    expect(after.has(shown[0])).toBe(true);
    const lastBefore = h.compositors[0].delivered[before - 1].code;
    expect(shown[0] === BLANK || shown[0] !== lastBefore).toBe(true);
    h.check(shown, made.startUs, made.endUs, true);
  });

  it("too little footage is 'warming', never a broken file", async () => {
    const h = setup();
    await h.start();
    await h.toCapture(1.2 * S);
    await expect(h.during(h.engine.clip({ seconds: 30, meta: h.meta("c6") }))).rejects.toMatchObject({ reason: "warming" });
    expect(h.mock.listFiles().filter((f) => f.startsWith("lib/"))).toEqual([]);
  });

  it("the buffered seconds grow from the running recorder's start: the button warms up before the first rotation", async () => {
    // The fault this guards: nothing counted until the first segment finished, so the button stayed warming for a whole rotation.
    const h = setup();
    await h.start();
    await h.toCapture(4.5 * S);
    expect(h.recorders.made).toHaveLength(1);
    const buffered = h.events.filter((e) => e.t === "buffered").map((e) => (e as { seconds: number }).seconds);
    expect(buffered.at(-1)!).toBeGreaterThan(3);
  });

  it("a game that stops drawing: each new recorder still gets a first frame (a repaint), and capture goes on", async () => {
    const h = setup();
    await h.start();
    await h.toCapture(3 * S);
    h.stopDrawing();
    await h.toCapture(16 * S);
    expect(h.recorders.made.length).toBeGreaterThanOrEqual(3);
    // Every recorder started (a Chromium recorder with no frame never fires "start").
    expect(h.recorders.made.every((r) => r.startedUs !== null)).toBe(true);
    expect(h.events.filter((e) => e.t === "encoder-error")).toEqual([]);
    const made = await h.during(h.engine.clip({ seconds: 10, endAtUs: 16 * S, meta: h.meta("s1") }));
    expect(made.endUs - made.startUs).toBeGreaterThan(9 * S);
  });
});

describe.skipIf(SKIP)("RecorderEngine: game sound", () => {
  it.each(["V", "M"] as const)("tier %s: a clip's sound comes from one sound run, as smooth across the video hand-offs as the run itself", async (tier) => {
    const h = setup({ tier });
    await h.start();
    await h.toCapture(14 * S);
    // One sound recorder the whole time: it did not restart at the video hand-offs.
    expect(h.soundRecorders.made).toHaveLength(1);
    expect(h.recorders.made.length).toBeGreaterThanOrEqual(3);
    // The video recorders record video only.
    expect(h.recorders.made.every((r) => r.stream.getTracks().every((t) => (t as FakeTrack).kind === "video"))).toBe(true);
    const made = await h.during(h.engine.clip({ seconds: 10, endAtUs: 14 * S, meta: h.meta("a1") }));
    expect(made.record.hasAudio).toBe(true);
    const bytes = h.file("a1");
    const sound = decodePcm(bytes, h.container);
    // The sound covers the clip.
    expect(sound.length / 48_000).toBeGreaterThan((made.endUs - made.startUs) / S - 0.15);
    const clean = toneSmoothness(decodePcm(soundRuns[h.container], h.container));
    const smooth = toneSmoothness(sound);
    expect(smooth.maxStep).toBeLessThanOrEqual(clean.maxStep * 1.25);
    expect(smooth.minRms).toBeGreaterThanOrEqual(clean.minRms * 0.8);
  });

  it("the sound starts when the game's sound bus appears, with no video hand-off", async () => {
    const h = setup({ sound: false });
    await h.start();
    await h.toCapture(2 * S);
    expect(h.soundRecorders.made).toHaveLength(0);
    h.makeBus();
    await h.clock.advance(50);
    expect(h.soundRecorders.made).toHaveLength(1);
    expect(h.recorders.made).toHaveLength(1);
    await h.toCapture(7 * S);
    const made = await h.during(h.engine.clip({ seconds: 5, endAtUs: 7 * S, meta: h.meta("a2") }));
    expect(made.record.hasAudio).toBe(true);
    h.check(decodeCodes(h.file("a2"), "webm"), made.startUs, made.endUs);
  });

  it("a pause ends the sound run; the run after it starts at resume", async () => {
    const h = setup();
    await h.start();
    await h.toCapture(3 * S);
    h.engine.setPaused("hidden", true);
    await h.clock.advance(200);
    expect(h.soundRecorders.made[0].state).toBe("inactive");
    h.engine.setPaused("hidden", false);
    await h.clock.advance(100);
    expect(h.soundRecorders.made).toHaveLength(2);
    expect(h.soundRecorders.made[1].state).toBe("recording");
  });
});

describe.skipIf(SKIP)("RecorderEngine: one encoder session at a time", () => {
  it("falls back to hand-offs with no overlap (Chromium order), keeps rotating, and a clip across them shows every frame", async () => {
    const h = setup({ tier: "M", maxRecording: 1 });
    await h.start();
    let most = 0;
    while (h.engine.mediaEndUs() < 16 * S) {
      await h.clock.advance(25);
      most = Math.max(most, h.recording());
    }
    expect(most).toBe(1);
    expect(h.events.filter((e) => e.t === "unavailable")).toEqual([]);
    expect(h.logs.some((m) => m.includes("one recorder at a time"))).toBe(true);
    const made = await h.during(h.engine.clip({ seconds: 8, endAtUs: 16 * S, meta: h.meta("s1") }));
    const shown = decodeCodes(h.file("s1"), "mp4");
    // No overlap: the frames between one recorder's stop and the next one's first frame are not in any segment.
    const want = h.expected(made.startUs, made.endUs);
    expect(shown.length).toBeGreaterThan(want.length - 12);
    const inOrder = shown.every((code, i) => i === 0 || want.indexOf(code, want.indexOf(shown[i - 1])) >= 0);
    expect(inOrder).toBe(true);
  });
});

describe.skipIf(SKIP)("RecorderEngine: tier M (MP4)", () => {
  it("records H.264 segments and AAC sound, and stores an MP4 clip", async () => {
    const h = setup({ tier: "M" });
    await h.start();
    expect(h.compositors[0].preset).toMatchObject({ width: 1280, height: 720 });
    await h.toCapture(3 * S);
    const options = h.recorders.made[0].options;
    expect(options).toMatchObject({ mimeType: "video/mp4;codecs=avc1,mp4a.40.2", videoKeyFrameIntervalDuration: 1000 });
    expect(options).not.toHaveProperty("audioBitsPerSecond");
    expect(h.soundRecorders.made[0].options).toMatchObject({ mimeType: "audio/mp4;codecs=mp4a.40.2" });
    await h.toCapture(8 * S);
    const made = await h.during(h.engine.clip({ seconds: 5, endAtUs: 8 * S, meta: h.meta("m1") }));
    expect(made.record).toMatchObject({ mime: "video/mp4", hasAudio: true });
    h.check(decodeCodes(h.file("m1"), "mp4"), made.startUs, made.endUs);
  });
});

describe.skipIf(SKIP)("RecorderEngine: Record", () => {
  it("keeps every segment from the tap on, and stores the recording with its sound at the end", async () => {
    const h = setup();
    await h.start();
    await h.toCapture(3 * S);
    const tapUs = h.engine.mediaEndUs();
    const handle = await h.during(h.engine.startRecording(h.meta("rec1", { kind: "record" })));
    await h.toCapture(13 * S);
    const result = await h.during(handle.stop(), 6000);
    expect(result.failed).toBe(0);
    expect(result.parts).toHaveLength(1);
    const part = result.parts[0];
    expect(part.record).toMatchObject({ id: "rec1", kind: "record", mime: "video/webm", hasAudio: true });
    // It starts at the last keyframe at or before the tap (a keyframe every second).
    expect(part.startUs).toBeLessThanOrEqual(tapUs);
    expect(part.startUs).toBeGreaterThan(tapUs - 1.1 * S);
    h.check(decodeCodes(h.file("rec1"), "webm"), part.startUs, part.endUs);
    // It ends at the stop tap (13 s), within one frame.
    expect(Math.abs(part.endUs - 13 * S)).toBeLessThan(70_000);
  });

  // Wave C int3: the governor changes the paint rate mid-file on tiers M and
  // V too. A clip row and a Record part row get the rung weighted over their
  // span (rungTimeline.ts), never the rung at the press or RECORDER_FPS.
  it("a clip across a rung step gets the rung weighted over the clip, not the rung at the press", async () => {
    const power = new TestPower();
    const h = setup({ power });
    await h.start();
    await h.toCapture(4 * S);
    power.listener?.({ pressure: "serious" });
    const stepUs = h.engine.mediaEndUs();
    const low = (h.events.filter((e) => e.t === "governor").at(-1) as Extract<EngineEvent, { t: "governor" }>).level.fps;
    const top = 30;
    expect(low).toBeLessThan(top);
    await h.toCapture(stepUs + 4 * S);
    const made = await h.during(h.engine.clip({ seconds: 7, meta: h.meta("rung-clip") }));
    expect(made.startUs).toBeLessThan(stepUs - S);
    const expected = (top * (stepUs - made.startUs) + low * (made.endUs - stepUs)) / (made.endUs - made.startUs);
    expect(Math.abs(made.record.fps - expected)).toBeLessThanOrEqual(0.5);
  });

  it("a Record across a rung step gets the weighted rung, and its footage from before the tap counts at its own rung", async () => {
    const power = new TestPower();
    const h = setup({ power });
    await h.start();
    await h.toCapture(4 * S);
    power.listener?.({ pressure: "serious" });
    const stepUs = h.engine.mediaEndUs();
    const low = (h.events.filter((e) => e.t === "governor").at(-1) as Extract<EngineEvent, { t: "governor" }>).level.fps;
    const top = 30;
    await h.toCapture(stepUs + 50_000);
    const handle = await h.during(h.engine.startRecording(h.meta("rung-rec", { kind: "record" })));
    await h.toCapture(stepUs + 5 * S);
    const result = await h.during(handle.stop(), 6000);
    expect(result.failed).toBe(0);
    expect(result.parts).toHaveLength(1);
    const part = result.parts[0];
    // It starts at the keyframe before the tap, before the step.
    expect(part.startUs).toBeLessThan(stepUs);
    const expected = (top * (stepUs - part.startUs) + low * (part.endUs - stepUs)) / (part.endUs - part.startUs);
    expect(part.record.fps).toBeLessThan(top);
    expect(Math.abs(part.record.fps - expected)).toBeLessThanOrEqual(0.6);
  });

  it("a stop tap in the middle of a rotation hand-off still keeps the footage up to the tap", async () => {
    const h = setup();
    await h.start();
    await h.toCapture(3 * S);
    const handle = await h.during(h.engine.startRecording(h.meta("rec3", { kind: "record" })));
    // Wait for a hand-off: two recorders record.
    while (h.recording() < 2 || h.engine.mediaEndUs() < 5 * S) await h.clock.advance(10);
    const tapUs = h.engine.mediaEndUs();
    const result = await h.during(handle.stop(), 6000);
    expect(result.failed).toBe(0);
    const part = result.parts[0];
    h.check(decodeCodes(h.file("rec3"), "webm"), part.startUs, part.endUs);
    expect(Math.abs(part.endUs - tapUs)).toBeLessThan(70_000);
  });

  it("a pause inside a hand-off's overlap while Record runs loses nothing", async () => {
    // The fault this guards: both recorders stopped with windows that overlapped, and the io worker refused the whole part.
    const h = setup({ seed: 31 });
    await h.start();
    await h.toCapture(3 * S);
    const handle = await h.during(h.engine.startRecording(h.meta("rec4", { kind: "record" })));
    while (h.recording() < 2) await h.clock.advance(5);
    await h.clock.advance(20);
    expect(h.recording()).toBe(2);
    h.engine.setPaused("break", true);
    await h.clock.advance(500);
    h.engine.setPaused("break", false);
    await h.toCapture(h.engine.mediaEndUs() + 3 * S);
    const result = await h.during(handle.stop(), 6000);
    expect(result).toMatchObject({ failed: 0 });
    expect(result.parts).toHaveLength(1);
    const part = result.parts[0];
    h.check(decodeCodes(h.file("rec4"), "webm"), part.startUs, part.endUs, true);
  });

  it("a slow io worker: the Record still starts at the tap, not at the next segment", async () => {
    // The fault this guards: a hand-off during the open wait sent the segment that holds the tap nowhere.
    const h = setup({ ioDelay: (cmd) => (cmd.t === "segmentRecord" ? 2600 : 0) });
    await h.start();
    await h.toCapture(1.5 * S);
    // The tap 200 ms before the first rotation.
    const rotateAt = h.recorders.made[0].startCalledUs! + ROTATION_MS * 1000;
    await h.toCapture(rotateAt - 200_000);
    const tapUs = h.engine.mediaEndUs();
    const handle = await h.during(h.engine.startRecording(h.meta("rec5", { kind: "record" })), 5000);
    // The hand-off finished while the io worker was busy.
    expect(h.recorders.made[0].state).toBe("inactive");
    await h.toCapture(tapUs + 6 * S);
    const result = await h.during(handle.stop(), 6000);
    expect(result.failed).toBe(0);
    const part = result.parts[0];
    expect(part.startUs).toBeLessThanOrEqual(tapUs);
    expect(part.startUs).toBeGreaterThan(tapUs - 1.1 * S);
    h.check(decodeCodes(h.file("rec5"), "webm"), part.startUs, part.endUs);
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

  it("Chromium order: new recorders that fire start and then error never stop capture; it goes on with one recorder at a time", async () => {
    const h = setup({ behaviors: [{}, { errorAfterStart: true }, { errorAfterStart: true }] });
    await h.start();
    await h.toCapture(12 * S);
    expect(h.events.filter((e) => e.t === "encoder-error")).toEqual([]);
    expect(h.events.filter((e) => e.t === "unavailable")).toEqual([]);
    expect(h.logs.some((m) => m.includes("one recorder at a time"))).toBe(true);
    expect(h.recording()).toBe(1);
    const made = await h.during(h.engine.clip({ seconds: 5, endAtUs: 12 * S, meta: h.meta("f1") }));
    expect(made.endUs).toBe(12 * S);
  });

  it("whatever leaves no recorder running while capture is on, the next tick starts one again", async () => {
    const h = setup();
    await h.start();
    await h.toCapture(2 * S);
    // A white-box break: the rotator stops with no failure callback.
    const session = (h.engine as unknown as { session: { rotator: { stop(): Promise<void> } } }).session;
    await Promise.all([session.rotator.stop(), h.clock.advance(50)]);
    await h.clock.advance(2000);
    expect(h.events).toContainEqual({ t: "encoder-error", fatal: false });
    expect(h.recording()).toBe(1);
  });

  it("RECORDER_FAILURE_LIMIT failures in a row stop the engine: unavailable", async () => {
    const behaviors: FakeRecorderBehavior[] = [{}, ...Array.from({ length: RECORDER_FAILURE_LIMIT }, () => ({ errorAtStart: true }))];
    const h = setup({ behaviors });
    await h.start();
    await h.toCapture(1.5 * S);
    h.recorders.made[0].fail();
    await h.clock.advance(60_000);
    expect(h.events).toContainEqual({ t: "unavailable", reason: "failing" });
    expect(h.events.at(-1)).toEqual({ t: "reset" });
    expect(h.compositors[0].disposed).toBe(true);
  });
});

describe.skipIf(SKIP)("RecorderEngine: prepare and the tier switch", () => {
  it("claims only tiers M and V, and only where the browser can record a canvas", async () => {
    const h = setup();
    expect(await h.engine.prepare()).toEqual({ tier: "V", supported: true });
    const other = new RecorderEngine({
      report: report("W"),
      io: { configure: vi.fn() } as never,
      audio: null,
      power: null,
      canRecord: () => true,
    });
    expect(await other.prepare()).toEqual({ tier: "W", supported: false });
    const noCanvasCapture = new RecorderEngine({ report: report("V"), io: { configure: vi.fn() } as never, audio: null, power: null, canRecord: () => false });
    expect(await noCanvasCapture.prepare()).toEqual({ tier: "V", supported: false });
    other.dispose();
    noCanvasCapture.dispose();
  });

  it("a fresh probe at arm that finds tier W hands the game to the engine switch, before any recorder", async () => {
    const asked: CapabilityReport[] = [];
    const h = setup({ tier: "M", probe: () => report("W"), onTierChange: async (r) => (asked.push(r), true) });
    await h.start();
    expect(asked.map((r) => r.caps.tier)).toEqual(["W"]);
    expect(h.compositors).toHaveLength(0);
    expect(h.recorders.made).toHaveLength(0);
  });

  it("when the switch keeps it, the engine records with MediaRecorder and does not ask again", async () => {
    const asked: CapabilityReport[] = [];
    const h = setup({ tier: "M", probe: () => report("W"), onTierChange: async (r) => (asked.push(r), false) });
    const unregister = await h.start();
    await h.toCapture(2 * S);
    expect(h.recorders.made.length).toBeGreaterThan(0);
    // Another arm (a new game) probes again, but asks no more.
    unregister();
    h.engine.setGame({ appId: "pong", gameName: "Pong", emoji: "🏓" });
    h.engine.registerCanvas(h.canvas as unknown as HTMLCanvasElement);
    await h.clock.advance(200);
    expect(asked).toHaveLength(1);
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

  it("disarm stops everything and resets; a recording that runs is still stored, with its sound", async () => {
    const h = setup();
    await h.start();
    await h.toCapture(2 * S);
    const handle = await h.during(h.engine.startRecording(h.meta("rec2", { kind: "record" })));
    await h.toCapture(5 * S);
    h.engine.disarm();
    expect(h.events.at(-1)).toEqual({ t: "reset" });
    expect(h.engine.mediaEndUs()).toBe(0);
    const result = await h.during(handle.stop(), 6000);
    expect(result.parts.map((p) => p.record.id)).toEqual(["rec2"]);
    expect(result.parts[0].record.hasAudio).toBe(true);
    expect(h.recorders.made.every((r) => r.state === "inactive")).toBe(true);
    expect(h.soundRecorders.made.every((r) => r.state === "inactive")).toBe(true);
    expect(h.compositors[0].disposed).toBe(true);
  });
});
