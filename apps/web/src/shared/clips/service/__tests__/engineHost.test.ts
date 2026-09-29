// @vitest-environment node
/**
 * EngineHost against the real worker handlers, in process:
 * - the encode worker (createEncodeWorker) on the shared WebCodecs double,
 * - the io worker (createIoHandler) with the real library on the shared OPFS
 *   double and fake-indexeddb,
 * - a game canvas in a canvas-mock realm, captured on path P by the real
 *   canvas source and frame pump.
 * One page clock drives the realm, both workers and the engine timers.
 */
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CanvasRealm, type FakeCanvas, type FakeContext2D } from "../../../../__tests__/canvas-mock";
import { createOpfsMock } from "../../../../__tests__/opfs-mock";
import {
  FakeVideoFrame as CodecVideoFrame,
  flushMicrotasks,
  installWebCodecsMock,
  rgbaPixels,
  type WebCodecsMock,
} from "../../../../__tests__/webcodecs-mock";
import { createEncodeWorker, type EncodeWorker } from "../../engine/encode/encode.worker";
import { createIoHandler } from "../../engine/io/ioHandler";
import { PNG_3X2_HEX, hexBytes } from "../../engine/io/__tests__/fixtures";
import type { StorageLike } from "../../library/fsTypes";
import { ClipLibrary } from "../../library/opfsStore";
import type { ClipMeta, EncodeCmd, EncodeEvent, IoCmd, IoEvent } from "../../protocol";
import type { CapabilityReport } from "../../runtime/capabilities";
import type { PowerState } from "../../runtime/governor";
import type { AudioTap } from "../audioTap";
import type { EngineEvent } from "../engine";
import {
  ARM_FAILURE_LIMIT,
  ENGINE_TICK_MS,
  EngineHost,
  NO_OUTPUT_MS,
  PICTURE_WAIT_MS,
  REARM_DELAY_MS,
  type EncodeWorkerLike,
  type PowerSource,
} from "../engineHost";
import { IoClient, type IoWorkerLike } from "../ioClient";

vi.setConfig({ testTimeout: 60_000 });

const FRAME_MS = 1000 / 60;

/** One page clock for everything: the realm's rAF, both workers and the engine's timers. */
class Clock {
  t = 10_000;
  private id = 0;
  private readonly timers = new Map<number, { fn: () => void; ms: number; next: number; repeat: boolean }>();
  now = () => this.t;
  setInterval = (fn: () => void, ms: number) => this.add(fn, ms, true);
  setTimeout = (fn: () => void, ms: number) => this.add(fn, ms, false);
  clear = (handle: unknown) => {
    this.timers.delete(handle as number);
  };
  private add(fn: () => void, ms: number, repeat: boolean): number {
    const id = ++this.id;
    this.timers.set(id, { fn, ms, next: this.t + ms, repeat });
    return id;
  }
  /** Runs every timer due up to t, in time order. */
  advanceTo(t: number): void {
    for (let guard = 0; ; guard++) {
      if (guard > 100_000) throw new Error(`timer loop at ${this.t}: ${[...this.timers.values()].map((x) => x.ms).join(",")}`);
      let due: [number, { fn: () => void; ms: number; next: number; repeat: boolean }] | null = null;
      for (const entry of this.timers) if (entry[1].next <= t && (!due || entry[1].next < due[1].next)) due = entry;
      if (!due) break;
      const [id, timer] = due;
      this.t = timer.next;
      if (timer.repeat) timer.next += timer.ms;
      else this.timers.delete(id);
      timer.fn();
    }
    this.t = t;
  }
  get pending(): number {
    return this.timers.size;
  }
}

/**
 * new VideoFrame(canvas) for the canvas-mock canvases: the pixels carry the
 * canvas picture number, so the encode worker's compositor (WebCodecs double)
 * can draw them. Every other source goes to the WebCodecs double unchanged.
 */
class BridgeVideoFrame extends CodecVideoFrame {
  constructor(source: unknown, init?: VideoFrameInit) {
    const canvas = source as FakeCanvas & { picture?: number };
    if (canvas && typeof canvas === "object" && "realm" in canvas && "getContextCalls" in canvas) {
      if (canvas.tainted) throw new DOMException("tainted", "SecurityError");
      super(rgbaPixels(canvas.width, canvas.height, (canvas.picture ?? 0) % 250), {
        format: "RGBA",
        codedWidth: canvas.width,
        codedHeight: canvas.height,
        timestamp: init?.timestamp ?? 0,
      });
    } else {
      super(source, init as never);
    }
  }
}

function report(overrides: Partial<CapabilityReport["caps"]> = {}): CapabilityReport {
  const attempt = (width: number, height: number, accel: "prefer-hardware" | "no-preference") => ({
    codec: "avc1.64001f",
    width,
    height,
    fps: 30,
    hardwareAcceleration: accel,
    ok: true,
    reason: null,
    outputs: 3,
    ms: 5,
  });
  return {
    caps: {
      tier: "W",
      videoEncoderH264: true,
      h264Levels: ["1f"],
      hardwareEncoder: true,
      audioEncoderAac: true,
      audioData: true,
      audioDecoder: true,
      mediaRecorderMp4: false,
      mediaRecorderWebm: false,
      webgl2AsyncReadback: false,
      opfsSyncAccess: true,
      shareFiles: false,
      memoryClass: "mid",
      displayHz: 60,
      ...overrides,
    },
    video: {
      ok: true,
      hardware: true,
      levels: ["1f"],
      codecByLevel: { "1f": "avc1.64001f" },
      portrait: true,
      attempts: [attempt(720, 1280, "prefer-hardware"), attempt(1280, 720, "prefer-hardware"), attempt(560, 992, "no-preference")],
    },
    audio: { aac: true, reason: null, description: "asc" },
    probeScope: "worker",
    workerFailure: null,
    fingerprint: "test",
    probedAt: 0,
    fromCache: false,
    cached: false,
  };
}

/** The encode worker, in process. It records every command it gets. */
class InProcessEncodeWorker implements EncodeWorkerLike {
  onmessage: ((event: MessageEvent<EncodeEvent>) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  terminated = false;
  readonly commands: EncodeCmd[] = [];
  readonly worker: EncodeWorker;
  constructor(clock: Clock) {
    this.worker = createEncodeWorker({
      post: (event) => queueMicrotask(() => this.onmessage?.({ data: event } as MessageEvent<EncodeEvent>)),
      now: clock.now,
      setInterval: clock.setInterval,
      clearInterval: clock.clear,
      aacKinds: async () => ["native"],
    });
  }
  postMessage(message: EncodeCmd): void {
    this.commands.push(message);
    void this.worker.handle(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  /** Sends an event as the worker would. */
  emit(event: EncodeEvent): void {
    this.onmessage?.({ data: event } as MessageEvent<EncodeEvent>);
  }
}

class InProcessIoWorker implements IoWorkerLike {
  onmessage: ((event: MessageEvent<IoEvent>) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  readonly handler;
  constructor(openLibrary: () => Promise<ClipLibrary>) {
    this.handler = createIoHandler({ post: (event) => queueMicrotask(() => this.onmessage?.({ data: event } as MessageEvent<IoEvent>)), openLibrary });
    void this.handler.start();
  }
  postMessage(message: IoCmd): void {
    void this.handler.handle(message);
  }
  terminate(): void {}
}

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
let codecs: WebCodecsMock;

beforeEach(() => {
  codecs = installWebCodecsMock();
  vi.stubGlobal("VideoFrame", BridgeVideoFrame);
});
afterEach(() => {
  vi.unstubAllGlobals();
  codecs.uninstall();
  libraries.splice(0).forEach((l) => l.close());
});

function setup(options: { probe?: (o: { force?: boolean }) => Promise<CapabilityReport>; tap?: AudioTap | null } = {}) {
  const clock = new Clock();
  const workers: InProcessEncodeWorker[] = [];
  const opfs = createOpfsMock();
  const factory = new IDBFactory();
  const io = new IoClient({
    createWorker: async () =>
      new InProcessIoWorker(async () => {
        const lib = await ClipLibrary.open({ storage: opfs.storage as unknown as StorageLike, indexedDB: factory, keyRange: IDBKeyRange, locks: null, channel: null });
        libraries.push(lib);
        return lib;
      }),
    host: () => "hankshits.com",
    openChannel: () => null,
    readUserId: async () => null,
    log: () => undefined,
  });
  const probe = vi.fn(options.probe ?? (async () => report()));
  const power = new TestPower();
  const logs: string[] = [];
  const engine = new EngineHost({
    probe,
    createEncodeWorker: async () => {
      const w = new InProcessEncodeWorker(clock);
      workers.push(w);
      return w;
    },
    io,
    audioTap: options.tap ?? null,
    power,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clear,
    setInterval: clock.setInterval,
    clearInterval: clock.clear,
    brandHost: () => "hankshits.com",
    log: (m) => logs.push(m),
  });
  const events: EngineEvent[] = [];
  engine.subscribe((e) => events.push(e));
  // The game: a 480x640 2D canvas that draws a new picture every frame.
  const realm = new CanvasRealm(performance.timeOrigin);
  const canvas = realm.createCanvas(480, 640);
  const ctx = canvas.getContext("2d") as FakeContext2D;
  let picture = 0;
  const loop = () => {
    ctx.drawPicture(++picture);
    realm.requestAnimationFrame(loop);
  };
  realm.requestAnimationFrame(loop);
  const play = async (ms: number) => {
    const end = clock.t + ms;
    while (clock.t < end) {
      const t = clock.t + FRAME_MS;
      clock.advanceTo(t);
      realm.frame(t);
      await flushMicrotasks(8);
    }
  };
  const meta = (id: string, extra: Partial<ClipMeta> = {}): ClipMeta => ({
    id,
    ownerKey: "guest",
    gameId: "breakout",
    kind: "clip",
    createdAt: Date.UTC(2026, 8, 28),
    durationMs: 0,
    width: 0,
    height: 0,
    fps: 0,
    hasAudio: false,
    mime: "video/mp4",
    kept: false,
    watched: false,
    moments: [],
    ...extra,
  });
  return { clock, workers, io, probe, power, logs, engine, events, realm, canvas, play, meta, opfs };
}

type Env = ReturnType<typeof setup>;

async function armedAndPlaying(env: Env, seconds = 5) {
  expect(await env.engine.prepare()).toEqual({ tier: "W", supported: true });
  env.engine.setGame({ appId: "breakout", gameName: "Breakout", emoji: "🧱", score: () => "120" });
  env.engine.registerCanvas(env.canvas.asElement);
  await flushMicrotasks(20);
  await env.play(seconds * 1000);
  await flushMicrotasks(50);
}

describe("EngineHost against the worker handlers", () => {
  it("arms at the first canvas, captures it, and stores a real clip through the io worker", async () => {
    const env = setup();
    await armedAndPlaying(env, 6);
    const [worker] = env.workers;
    const arm = worker.commands.find((c) => c.t === "arm") as Extract<EncodeCmd, { t: "arm" }>;
    expect(arm).toMatchObject({
      preset: { width: 720, height: 1280, orientation: "tall", targetFps: 30 },
      video: { codec: "avc1.64001f", latencyMode: "quality" },
      ringSeconds: 60,
      brandHost: "hankshits.com",
    });
    expect(arm.audioPort).toBeDefined();
    // The pump posts the timeline itself: "live" at its first frame, never an engine-made timeline.
    const timeline = worker.commands.filter((c) => c.t === "timeline");
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({ state: "live" });
    expect(env.events.map((e) => e.t)).toEqual(expect.arrayContaining(["source", "output", "buffered"]));
    // Every frame message got its "consumed": capture never stalled on backpressure.
    const frames = worker.commands.filter((c) => c.t === "frame").length;
    expect(frames).toBeGreaterThan(100);
    const buffered = env.events.filter((e) => e.t === "buffered").at(-1) as Extract<EngineEvent, { t: "buffered" }>;
    expect(buffered.seconds).toBeGreaterThan(3);

    const made = await env.engine.clip({ seconds: 30, meta: env.meta("clip1") });
    expect(made.record).toMatchObject({ id: "clip1", gameId: "breakout", kind: "clip", width: 720, height: 1280, mime: "video/mp4", hasAudio: true });
    expect(made.endUs - made.startUs).toBeGreaterThan(3_000_000);
    expect((await env.io.list("guest")).map((r) => r.id)).toEqual(["clip1"]);
    env.engine.dispose();
  });

  it("waits for the game's warm-up (the governor baseline) before the first frame", async () => {
    const env = setup();
    expect(await env.engine.prepare()).toMatchObject({ supported: true });
    env.engine.registerCanvas(env.canvas.asElement);
    await flushMicrotasks(20);
    await env.play(800);
    expect(env.workers[0].commands.filter((c) => c.t === "frame")).toHaveLength(0);
    await env.play(600);
    expect(env.workers[0].commands.filter((c) => c.t === "frame").length).toBeGreaterThan(0);
    env.engine.dispose();
  });

  it("refuses a clip before the first encoder output", async () => {
    const env = setup();
    await env.engine.prepare();
    await expect(env.engine.clip({ seconds: 30, meta: env.meta("early") })).rejects.toMatchObject({ reason: "warming" });
  });

  it("pauses and resumes the capture timeline by reason, and closes the encoder on request", async () => {
    const env = setup();
    await armedAndPlaying(env, 3);
    const worker = env.workers[0];
    env.engine.setPaused("hidden", true);
    env.engine.setPaused("break", true);
    env.engine.closeEncoder("hidden");
    env.engine.setPaused("hidden", false);
    await env.play(300);
    const framesWhilePaused = worker.commands.filter((c) => c.t === "frame").length;
    await env.play(300);
    expect(worker.commands.filter((c) => c.t === "frame").length).toBe(framesWhilePaused);
    env.engine.setPaused("break", false);
    await env.play(300);
    expect(worker.commands.filter((c) => c.t === "frame").length).toBeGreaterThan(framesWhilePaused);
    const kinds = worker.commands.filter((c) => c.t === "timeline" || c.t === "closeEncoder").map((c) => (c.t === "timeline" ? c.state : `close:${c.reason}`));
    expect(kinds).toEqual(["live", "paused", "close:hidden", "live"]);
    env.engine.dispose();
  });

  it("keeps an AAC restart out of the video failures", async () => {
    const env = setup();
    await armedAndPlaying(env, 2);
    const before = env.events.length;
    env.workers[0].emit({ t: "error", code: "audio-encoder-error", detail: "x" });
    env.workers[0].emit({ t: "error", code: "audio-encoder-missing", detail: "x" });
    expect(env.events.slice(before)).toEqual([]);
    env.workers[0].emit({ t: "error", code: "encoder-reclaimed", detail: "x" });
    expect(env.events.slice(before)).toEqual([{ t: "encoder-error", fatal: false }]);
    env.engine.dispose();
  });

  it("reports the recovery as the next encoder epoch after a failure", async () => {
    const env = setup();
    await armedAndPlaying(env, 2);
    const worker = env.workers[0];
    worker.emit({ t: "error", code: "encoder-error", detail: "x" });
    const info = { epoch: 9, codec: "avc1.64001f", codedWidth: 720, codedHeight: 1280, description: new ArrayBuffer(4) };
    worker.emit({ t: "epoch", info });
    expect(env.events.slice(-2)).toEqual([{ t: "encoder-error", fatal: false }, { t: "recovered" }]);
    env.engine.dispose();
  });

  it("probes again with no cache and arms again after the encoder refused its settings", async () => {
    const env = setup();
    await armedAndPlaying(env, 1);
    env.workers[0].emit({ t: "error", code: "config-unsupported", detail: "x" });
    // The session ends: the service hears the failure, then the reset of the timeline.
    expect(env.events.slice(-2)).toEqual([{ t: "encoder-error", fatal: true }, { t: "reset" }]);
    expect(env.workers[0].commands.at(-1)).toEqual({ t: "disarm" });
    env.clock.advanceTo(env.clock.t + REARM_DELAY_MS);
    await flushMicrotasks(30);
    expect(env.probe).toHaveBeenLastCalledWith({ force: true });
    expect(env.workers[0].commands.filter((c) => c.t === "arm")).toHaveLength(2);
    env.engine.dispose();
  });

  it("starts a new worker after a worker crash, and ends a running recording in the io worker", async () => {
    const env = setup();
    await armedAndPlaying(env, 4);
    const handle = await env.engine.startRecording(env.meta("rec1", { kind: "record" }));
    await env.play(1500);
    env.workers[0].onerror?.(new Event("error"));
    await flushMicrotasks(5);
    expect(env.workers[0].terminated).toBe(true);
    expect(env.events.slice(-2)).toEqual([{ t: "encoder-error", fatal: true }, { t: "reset" }]);
    const parts = await handle.stop();
    expect(parts.failed).toBe(0);
    env.clock.advanceTo(env.clock.t + REARM_DELAY_MS);
    await flushMicrotasks(30);
    expect(env.workers).toHaveLength(2);
    env.engine.dispose();
  });

  it("records through a MessageChannel from the encode worker to the io worker", async () => {
    const env = setup();
    await armedAndPlaying(env, 3);
    const handle = await env.engine.startRecording(env.meta("rec2", { kind: "record" }));
    const recordCmd = env.workers[0].commands.find((c) => c.t === "record" && c.on) as Extract<EncodeCmd, { t: "record"; on: true }>;
    expect(recordCmd).toMatchObject({ recordingId: "rec2" });
    expect(recordCmd.port).toBeDefined();
    await env.play(3000);
    const stopping = handle.stop();
    await env.play(500);
    await flushMicrotasks(50);
    const result = await stopping;
    expect(result.failed).toBe(0);
    expect(result.parts[0].record).toMatchObject({ id: "rec2", kind: "record", width: 720, height: 1280 });
    expect(result.parts[0].endUs - result.parts[0].startUs).toBeGreaterThan(2_000_000);
    env.engine.dispose();
  });

  // Lab FINDING 1 (plan 7): every Record row said the encoder's top rate (60 fps)
  // while the governor had stepped down and the file ran at 31 or 40 fps. The
  // row now holds the rung weighted by time over the part.
  it("gives a Record part the capture rung weighted over its span, not the encoder's top rate", async () => {
    const env = setup();
    await armedAndPlaying(env, 3);
    const handle = await env.engine.startRecording(env.meta("rec-rung", { kind: "record" }));
    await env.play(2000);
    env.power.listener?.({ pressure: "serious" });
    const stepped = env.events.filter((e) => e.t === "governor").at(-1) as Extract<EngineEvent, { t: "governor" }>;
    expect(stepped.resting).toBe(false);
    const low = stepped.level.fps;
    await env.play(2000);
    const stopping = handle.stop();
    await env.play(500);
    await flushMicrotasks(50);
    const result = await stopping;
    expect(result.failed).toBe(0);
    expect(result.parts).toHaveLength(1);
    const part = result.parts[0];
    // The top rung here is 30 fps (60 Hz, a 30 fps target); the step goes lower.
    const top = 30;
    expect(low).toBeLessThan(top);
    const fps = part.record.fps;
    // About 2 s (plus up to one GOP of pre-roll) at the top rung, then about 2.5 s lower.
    const spanSec = (part.endUs - part.startUs) / 1e6;
    const lowSec = 2.5;
    const expected = (top * (spanSec - lowSec) + low * lowSec) / spanSec;
    expect(fps).toBeGreaterThan(low);
    expect(fps).toBeLessThan(top);
    expect(Math.abs(fps - expected)).toBeLessThanOrEqual(2);
    env.engine.dispose();
  });

  it("gives a clip the capture rung weighted over the clip, not the rung at the press", async () => {
    const env = setup();
    await armedAndPlaying(env, 4);
    env.power.listener?.({ pressure: "serious" });
    const stepped = env.events.filter((e) => e.t === "governor").at(-1) as Extract<EngineEvent, { t: "governor" }>;
    const low = stepped.level.fps;
    await env.play(3000);
    const made = await env.engine.clip({ seconds: 5, meta: env.meta("clip-rung") });
    const top = 30;
    const spanSec = (made.endUs - made.startUs) / 1e6;
    const lowSec = 3;
    const expected = (top * (spanSec - lowSec) + low * lowSec) / spanSec;
    // The old row said the rung at the press (the low one) for 2 s of top-rung footage.
    expect(made.record.fps).toBeGreaterThan(low + 1);
    expect(made.record.fps).toBeLessThan(top);
    expect(Math.abs(made.record.fps - expected)).toBeLessThanOrEqual(2);
    env.engine.dispose();
  });

  it("rests capture on a critical pressure signal, and keeps Record at the low-power rung", async () => {
    const env = setup();
    await armedAndPlaying(env, 3);
    const worker = env.workers[0];
    env.power.listener?.({ pressure: "critical" });
    expect(env.events.at(-1)).toMatchObject({ t: "governor", resting: true, level: { kind: "resting" } });
    expect(worker.commands.filter((c) => c.t === "timeline").at(-1)).toMatchObject({ state: "paused" });
    await env.engine.startRecording(env.meta("rec3", { kind: "record" }));
    expect(worker.commands.filter((c) => c.t === "timeline").at(-1)).toMatchObject({ state: "live" });
    const before = worker.commands.filter((c) => c.t === "frame").length;
    await env.play(2000);
    const during = worker.commands.filter((c) => c.t === "frame").length - before;
    // The low-power rung is 15 fps at 60 Hz.
    expect(during).toBeGreaterThan(20);
    expect(during).toBeLessThan(40);
    env.power.listener?.({ pressure: "nominal" });
    expect(env.events.at(-1)).toMatchObject({ t: "governor", resting: false });
    env.engine.dispose();
  });

  it("takes a picture of the game canvas after its next draw", async () => {
    const env = setup();
    await armedAndPlaying(env, 2);
    const png = hexBytes(PNG_3X2_HEX);
    (env.canvas as unknown as { toBlob: (cb: (b: Blob) => void, type: string) => void }).toBlob = (cb, type) => {
      expect(type).toBe("image/png");
      cb(new Blob([png], { type: "image/png" }));
    };
    const pending = env.engine.picture(env.meta("pic1", { kind: "picture" }));
    await env.play(50);
    const record = await pending;
    expect(record).toMatchObject({ id: "pic1", kind: "picture", mime: "image/png", durationMs: 0, hasAudio: false });
    env.engine.dispose();
  });

  it("purges and arms again for a different game", async () => {
    const env = setup();
    await armedAndPlaying(env, 1);
    env.engine.setGame({ appId: "snake", gameName: "Snake", emoji: "🐍" });
    await flushMicrotasks(30);
    const kinds = env.workers[0].commands.map((c) => c.t).filter((t) => t === "purge" || t === "disarm" || t === "arm");
    expect(kinds).toEqual(["arm", "purge", "disarm", "arm"]);
    env.engine.dispose();
  });

  it("says no-output 2.5 s after the first frame with no encoder output, on a device with a software encoder", async () => {
    const env = setup();
    codecs.video.outputLatencyFrames = 100_000;
    await armedAndPlaying(env, 1.2);
    expect(env.events.some((e) => e.t === "no-output")).toBe(false);
    await env.play(NO_OUTPUT_MS + ENGINE_TICK_MS);
    expect(env.events.filter((e) => e.t === "no-output")).toHaveLength(1);
    env.engine.dispose();
  });

  it("attaches the audio tap with the other end of the audio port, and posts its anchors to the encode worker", async () => {
    const attach = vi.fn();
    const detach = vi.fn();
    const env = setup({ tap: { attach, detach } as unknown as AudioTap });
    await armedAndPlaying(env, 1);
    const arm = env.workers[0].commands.find((c) => c.t === "arm") as Extract<EncodeCmd, { t: "arm" }>;
    expect(attach).toHaveBeenCalledTimes(1);
    const [port, sink] = attach.mock.calls[0] as [MessagePort, { postAnchor: (a: unknown) => void }];
    expect(port).not.toBe(arm.audioPort);
    const anchor = { t: "anchor" as const, streamId: "page", perfMs: env.clock.t, ctxTimeSec: 1, timeOriginOffsetMs: 0, state: "running" as const };
    sink.postAnchor(anchor);
    expect(env.workers[0].commands.at(-1)).toEqual(anchor);
    env.engine.disarm();
    expect(detach).toHaveBeenCalled();
    env.engine.dispose();
  });

  it("treats a canvas it cannot read (tainted) as a lost source", async () => {
    const env = setup();
    await armedAndPlaying(env, 2);
    env.canvas.tainted = true;
    await env.play(100);
    // The stats timer can post "buffered" at any time: only the source events matter here.
    expect(env.events.filter((e) => e.t !== "buffered").slice(-2)).toEqual([{ t: "source-error" }, { t: "source", present: false }]);
    env.engine.dispose();
  });

  it("ends warming at the first video output when the sound encoder is missing (no armed follows)", async () => {
    const commands: EncodeCmd[] = [];
    const worker: EncodeWorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage: (message) => commands.push(message),
      terminate: () => undefined,
    };
    const clock = new Clock();
    const io = new IoClient({ createWorker: async () => ({ onmessage: null, onerror: null, postMessage: () => undefined, terminate: () => undefined }), readUserId: async () => null, log: () => undefined });
    const engine = new EngineHost({
      probe: async () => report(),
      createEncodeWorker: async () => worker,
      io,
      audioTap: null,
      power: null,
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clear,
      setInterval: clock.setInterval,
      clearInterval: clock.clear,
      brandHost: () => "hankshits.com",
      log: () => undefined,
    });
    const events: EngineEvent[] = [];
    engine.subscribe((e) => events.push(e));
    await engine.prepare();
    const realm = new CanvasRealm(performance.timeOrigin);
    const canvas = realm.createCanvas(640, 480);
    const ctx = canvas.getContext("2d") as FakeContext2D;
    engine.registerCanvas(canvas.asElement);
    await flushMicrotasks(20);
    // The encoder is chosen only once the game has drawn (its context type is known).
    expect(commands).toHaveLength(0);
    ctx.drawPicture(1);
    await flushMicrotasks(20);
    expect(commands[0]).toMatchObject({ t: "arm", preset: { orientation: "wide", width: 1280, height: 720 } });
    const info = { epoch: 0, codec: "avc1.64001f", codedWidth: 1280, codedHeight: 720, description: new ArrayBuffer(4) };
    worker.onmessage?.({ data: { t: "epoch", info } } as MessageEvent<EncodeEvent>);
    expect(events.some((e) => e.t === "output")).toBe(false);
    worker.onmessage?.({ data: { t: "error", code: "audio-encoder-missing", detail: "x" } } as MessageEvent<EncodeEvent>);
    expect(events.at(-1)).toEqual({ t: "output" });
    engine.dispose();
  });

  it("is not supported on tiers M, V and none", async () => {
    for (const tier of ["M", "V", "none"] as const) {
      const env = setup({ probe: async () => report({ tier }) });
      expect(await env.engine.prepare()).toEqual({ tier, supported: false });
    }
  });
});

describe("the governor on a healthy game (encoder signal per stats interval)", () => {
  it("keeps the top rung for 65 s of healthy play, with a quality-mode encoder that holds a frame", async () => {
    const env = setup();
    // Phase 0: "quality" mode holds about one frame; the epoch guard holds one packet too.
    expect(codecs.video.outputLatencyFrames).toBe(1);
    await armedAndPlaying(env, 65);
    // No governor decision at all: the level never left the top rung (no step down, no rest).
    expect(env.events.filter((e) => e.t === "governor")).toEqual([]);
    const timeline = env.workers[0].commands.filter((c) => c.t === "timeline");
    expect(timeline.map((c) => (c as { state: string }).state)).toEqual(["live"]);
    const buffered = env.events.filter((e) => e.t === "buffered").at(-1) as Extract<EngineEvent, { t: "buffered" }>;
    expect(buffered.seconds).toBeGreaterThan(55);
    env.engine.dispose();
  });

  it("steps down when the encoder really falls behind (its queue is full and it refuses frames)", async () => {
    const env = setup();
    await armedAndPlaying(env, 3);
    for (const encoder of codecs.videoEncoders) encoder.stall(true);
    await env.play(8000);
    const decisions = env.events.filter((e) => e.t === "governor") as Array<Extract<EngineEvent, { t: "governor" }>>;
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions[0].level.kind === "rung" && decisions[0].level.k === 2).toBe(false);
    env.engine.dispose();
  });

  it("keeps the full queue value equal to the encode worker's queue limit", async () => {
    const { MAX_ENCODE_QUEUE } = await import("../../engine/encode/videoSession");
    const { FULL_ENCODER_QUEUE } = await import("../engineHost");
    expect(FULL_ENCODER_QUEUE).toBe(MAX_ENCODE_QUEUE);
  });
});

describe("encoderSignal (pure)", () => {
  const stats = (framesIn: number, framesEncoded: number, framesDropped: number) =>
    ({ framesIn, framesEncoded, framesDropped, outOfOrder: 0, encodeQueueMax: 2, ringSeconds: 10, ringBytes: 0, audioStreams: 0, audioUnderrunMs: 0, ttfcMs: 1 }) as const;

  it("reads the running totals per interval: a constant difference is no queue", async () => {
    const { encoderSignal } = await import("../engineHost");
    // The difference is 3 in both samples (a held packet, a held frame, a lone keyframe): nothing waits longer.
    expect(encoderSignal(stats(300, 297, 0), stats(330, 327, 0), 30)).toEqual({ queue: 0, latencyMs: 0 });
  });

  it("reports growth as frames and time, and refused frames as a full queue", async () => {
    const { encoderSignal, FULL_ENCODER_QUEUE } = await import("../engineHost");
    expect(encoderSignal(stats(300, 297, 0), stats(330, 325, 0), 30)).toEqual({ queue: 2, latencyMs: (2 * 1000) / 30 });
    // 5 of 30 frames refused (over MAX_BACKPRESSURE_DROPS): the codec queue was full.
    expect(encoderSignal(stats(300, 297, 0), stats(330, 322, 5), 30).queue).toBe(FULL_ENCODER_QUEUE);
    // 2 of 30 refused is within the limit.
    expect(encoderSignal(stats(300, 297, 0), stats(330, 325, 2), 30).queue).toBe(0);
  });
});

describe("content kind (plan 5.1 bitrates)", () => {
  it("encodes a WebGL game as 3D, also when its context existed before registration", async () => {
    const env = setup();
    await env.engine.prepare();
    const gl = env.realm.createCanvas(480, 640);
    const ctx = gl.getContext("webgl2") as { clear(mask: number): void; drawArrays(mode: number, first: number, count: number): void };
    // The game's loop draws every frame (three.js clears, then draws).
    const loop = () => {
      ctx.clear(0x4000);
      ctx.drawArrays(4, 0, 3);
      env.realm.requestAnimationFrame(loop);
    };
    env.realm.requestAnimationFrame(loop);
    env.engine.registerCanvas(gl.asElement);
    await env.play(100);
    const arm = env.workers[0].commands.find((c) => c.t === "arm") as Extract<EncodeCmd, { t: "arm" }>;
    expect(arm.video.bitrate).toBe(3_000_000);
    env.engine.dispose();
  });

  it("encodes a 2D game at the 2D bitrate", async () => {
    const env = setup();
    await armedAndPlaying(env, 1);
    const arm = env.workers[0].commands.find((c) => c.t === "arm") as Extract<EncodeCmd, { t: "arm" }>;
    expect(arm.video.bitrate).toBe(2_000_000);
    env.engine.dispose();
  });

  it("does not arm (no encoder, no probe) until the game has a context on the canvas", async () => {
    const env = setup();
    await env.engine.prepare();
    const blank = env.realm.createCanvas(480, 640);
    env.engine.registerCanvas(blank.asElement);
    await env.play(500);
    expect(env.workers).toHaveLength(0);
    expect(env.probe).toHaveBeenCalledTimes(1);
    (blank.getContext("2d") as FakeContext2D).drawPicture(3);
    await flushMicrotasks(30);
    expect(env.workers[0].commands[0]).toMatchObject({ t: "arm" });
    env.engine.dispose();
  });
});

describe("the engine stops when it must (plan 7)", () => {
  it("never arms again after the service disarmed it from its failure listener (worker crash)", async () => {
    const env = setup();
    await armedAndPlaying(env, 2);
    // The service's listener: capture off (DISABLED) at the failure.
    env.engine.subscribe((e) => {
      if (e.t === "encoder-error") env.engine.disarm();
    });
    env.workers[0].onerror?.(new Event("error"));
    await flushMicrotasks(10);
    for (let i = 0; i < 5; i++) {
      env.clock.advanceTo(env.clock.t + 60_000);
      await flushMicrotasks(30);
    }
    expect(env.workers).toHaveLength(1);
    expect(env.probe).toHaveBeenCalledTimes(2);
    env.engine.dispose();
  });

  it("never arms or probes again after the service disarmed it at a config-unsupported", async () => {
    const env = setup();
    await armedAndPlaying(env, 1);
    env.engine.subscribe((e) => {
      if (e.t === "encoder-error") env.engine.disarm();
    });
    env.workers[0].emit({ t: "error", code: "config-unsupported", detail: "x" });
    for (let i = 0; i < 5; i++) {
      env.clock.advanceTo(env.clock.t + 60_000);
      await flushMicrotasks(30);
    }
    expect(env.workers[0].commands.filter((c) => c.t === "arm")).toHaveLength(1);
    expect(env.probe).toHaveBeenCalledTimes(2);
    env.engine.dispose();
  });

  it("backs off after failures in a row, forces one probe only, and stops with 'unavailable' after ARM_FAILURE_LIMIT", async () => {
    const env = setup();
    await armedAndPlaying(env, 1);
    const arms = () => env.workers[0].commands.filter((c) => c.t === "arm").length;
    const waits: number[] = [];
    for (let i = 1; i < ARM_FAILURE_LIMIT; i++) {
      env.workers[0].emit({ t: "error", code: "config-unsupported", detail: "x" });
      const before = arms();
      const wait = env.engine.rearmDelayMs();
      waits.push(wait);
      env.clock.advanceTo(env.clock.t + wait - 1);
      await flushMicrotasks(30);
      expect(arms()).toBe(before);
      env.clock.advanceTo(env.clock.t + 1);
      await flushMicrotasks(30);
      expect(arms()).toBe(before + 1);
    }
    expect(waits).toEqual([REARM_DELAY_MS, 2 * REARM_DELAY_MS, 4 * REARM_DELAY_MS, 8 * REARM_DELAY_MS, 16 * REARM_DELAY_MS].slice(0, ARM_FAILURE_LIMIT - 1));
    // The uncached probe ran once, at the first retry.
    expect(env.probe.mock.calls.filter(([o]) => o.force).length).toBe(1);
    env.workers[0].emit({ t: "error", code: "config-unsupported", detail: "x" });
    expect(env.events.at(-1)).toEqual({ t: "unavailable", reason: "failing" });
    const armsAtEnd = arms();
    env.clock.advanceTo(env.clock.t + 10 * 60_000);
    await flushMicrotasks(30);
    expect(arms()).toBe(armsAtEnd);
    env.engine.dispose();
  });

  it("says 'unavailable' (no re-arm loop) when a probe finds no encoder for the game's picture", async () => {
    let calls = 0;
    const noHardwareAttempt = () => {
      const r = report();
      // The first probe (prepare) says the device can capture; the arm's probe finds no usable setting.
      if (++calls > 1) r.video.attempts = r.video.attempts.filter((a) => a.hardwareAcceleration === "no-preference");
      return r;
    };
    const env = setup({ probe: async () => noHardwareAttempt() });
    expect(await env.engine.prepare()).toMatchObject({ supported: true });
    env.engine.registerCanvas(env.canvas.asElement);
    await env.play(200);
    expect(env.events.at(-1)).toEqual({ t: "unavailable", reason: "no-encoder" });
    env.clock.advanceTo(env.clock.t + 10 * 60_000);
    await flushMicrotasks(30);
    expect(env.workers).toHaveLength(0);
    expect(env.probe).toHaveBeenCalledTimes(2);
    env.engine.dispose();
  });

  it("arms again after a disarm when the next game (or source) comes", async () => {
    const env = setup();
    await armedAndPlaying(env, 1);
    env.engine.disarm();
    await flushMicrotasks(20);
    env.clock.advanceTo(env.clock.t + 60_000);
    await flushMicrotasks(20);
    expect(env.workers[0].commands.filter((c) => c.t === "arm")).toHaveLength(1);
    env.engine.setGame({ appId: "breakout", gameName: "Breakout", emoji: "🧱" });
    await env.play(100);
    expect(env.workers[0].commands.filter((c) => c.t === "arm")).toHaveLength(2);
    env.engine.dispose();
  });
});

describe("park (the game went away, the ring is kept)", () => {
  it("closes the encoders and suspends the audio tap, and the next source wakes the tap", async () => {
    const tap = { attach: vi.fn(), detach: vi.fn(), suspend: vi.fn(), resume: vi.fn() };
    const env = setup({ tap: tap as unknown as AudioTap });
    await armedAndPlaying(env, 2);
    const off = [...[env.canvas.asElement]];
    void off;
    env.engine.setPaused("source", true);
    env.engine.park();
    expect(env.workers[0].commands.at(-1)).toEqual({ t: "closeEncoder", reason: "hidden" });
    expect(tap.suspend).toHaveBeenCalledTimes(1);
    expect(tap.detach).not.toHaveBeenCalled();
    env.engine.park();
    expect(tap.suspend).toHaveBeenCalledTimes(1);
    env.engine.registerCanvas(env.canvas.asElement);
    expect(tap.resume).toHaveBeenCalledTimes(1);
    // The same session: no new arm.
    expect(env.workers[0].commands.filter((c) => c.t === "arm")).toHaveLength(1);
    env.engine.dispose();
  });
});

describe("pictures of a paused WebGL game (plan 11.4)", () => {
  function webglGame(env: Env) {
    const gl = env.realm.createCanvas(480, 640);
    const ctx = gl.getContext("webgl2") as { clear(mask: number): void; drawArrays(mode: number, first: number, count: number): void };
    const state = { paused: false, draws: 0 };
    const loop = () => {
      if (!state.paused) {
        ctx.clear(0x4000);
        ctx.drawArrays(4, 0, 3);
        state.draws++;
      }
      env.realm.requestAnimationFrame(loop);
    };
    env.realm.requestAnimationFrame(loop);
    const reads: number[] = [];
    (gl as unknown as { toBlob: (cb: (b: Blob) => void, type: string) => void }).toBlob = (cb) => {
      reads.push(state.draws);
      cb(new Blob([hexBytes(PNG_3X2_HEX)], { type: "image/png" }));
    };
    return { gl, state, reads };
  }

  it("takes the picture right after a draw of the game", async () => {
    const env = setup();
    await env.engine.prepare();
    const game = webglGame(env);
    env.engine.registerCanvas(game.gl.asElement);
    await env.play(300);
    const pending = env.engine.picture(env.meta("pic-gl", { kind: "picture" }));
    await env.play(50);
    expect(await pending).toMatchObject({ id: "pic-gl", kind: "picture" });
    expect(game.reads).toHaveLength(1);
    env.engine.dispose();
  });

  it("stores no blank picture when the game does not draw (paused): it fails with the reason 'hidden'", async () => {
    const env = setup();
    await env.engine.prepare();
    const game = webglGame(env);
    env.engine.registerCanvas(game.gl.asElement);
    await env.play(300);
    game.state.paused = true;
    const pending = env.engine.picture(env.meta("pic-blank", { kind: "picture" }));
    const settled = pending.catch((error: unknown) => error);
    await env.play(PICTURE_WAIT_MS + 50);
    expect(await settled).toMatchObject({ reason: "hidden" });
    expect(game.reads).toEqual([]);
    expect(await env.io.list("guest")).toEqual([]);
    env.engine.dispose();
  });
});
