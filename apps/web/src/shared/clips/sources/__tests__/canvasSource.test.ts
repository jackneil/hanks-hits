import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasRealm, FakeContext2D, FakeVideoFrame, FakeWebGLContext, type FakeCanvas } from "@/__tests__/canvas-mock";
import { readbackRecord, WebGL2Mock, type WebGL2MockOptions } from "@/__tests__/webgl2-mock";
import type { CapturePath, FrameIn, HudState } from "../../protocol";
import { FramePump } from "../../runtime/framePump";
import { Governor, governorInputs } from "../../runtime/governor";
import { hasRafDispatcher } from "../../runtime/rafDispatcher";
import { installCanvasActivity } from "../canvasActivity";
import {
  BASELINE_WARMUP_MS,
  MAX_CONSECUTIVE_ERRORS,
  registerCanvasSource,
  type CanvasSourceOptions,
  type CaptureCostSample,
  type ReadbackSignal,
} from "../canvasSource";
import { RecordingSink } from "./fakes";

const HUD: HudState = { gameName: "Breakout", emoji: "🧱", score: "120" };
const V = 1000 / 60;
const PAGE = { performance: { timeOrigin: 0 } };

type Kind = "2d" | "webgl" | "webgl2";
type AnyContext = FakeContext2D | FakeWebGLContext | WebGL2Mock;
type PixelsFrame = Extract<FrameIn, { t: "pixels" }>;
type VideoFrameMsg = Extract<FrameIn, { t: "frame" }>;

function setup(kind: Kind, opts: { realmOrigin?: number; targetFps?: 30 | 60 } = {}) {
  const realm = new CanvasRealm(opts.realmOrigin ?? 0);
  const gl = kind === "webgl2";
  const canvas = realm.createCanvas(gl ? 1280 : 480, gl ? 720 : 640);
  const sink = new RecordingSink();
  const pump = new FramePump({ sink, displayHz: 60, targetFps: opts.targetFps ?? 30 });
  return { realm, canvas, sink, pump, kind };
}
type Env = ReturnType<typeof setup>;

function register(env: Env, extra: Partial<CanvasSourceOptions> = {}) {
  return registerCanvasSource({
    canvas: env.canvas.asElement,
    hud: () => HUD,
    targetFps: env.pump.targetFps as 30 | 60,
    pump: env.pump,
    pageRealm: PAGE,
    warmupMs: 0,
    ...extra,
  });
}

function makeContext(env: Env, mock?: WebGL2MockOptions): AnyContext {
  return env.canvas.getContext(env.kind, mock ? { mock } : undefined) as AnyContext;
}

function draw(ctx: AnyContext, n: number): void {
  if (ctx instanceof WebGL2Mock) ctx.drawFrame(n);
  else ctx.drawPicture(n);
}

/**
 * A game loop that draws picture n in its frame n. It makes its context at
 * the start (contextNow, default) or in its first frame. drawEvery > 1 draws
 * only on some frames (a game with a frame-rate cap).
 */
function startGame(env: Env, opts: { contextNow?: boolean; drawEvery?: number; mock?: WebGL2MockOptions } = {}) {
  let n = 0;
  let id = 0;
  let ctx: AnyContext | null = opts.contextNow === false ? null : makeContext(env, opts.mock);
  const loop = () => {
    n++;
    ctx ??= makeContext(env, opts.mock);
    if (n % (opts.drawEvery ?? 1) === 0) draw(ctx, n);
    id = env.realm.requestAnimationFrame(loop);
  };
  id = env.realm.requestAnimationFrame(loop);
  return {
    stop: () => env.realm.cancelAnimationFrame(id),
    get context() {
      return ctx;
    },
  };
}

function runFrames(env: Env, from: number, count: number): number {
  let t = from;
  for (let i = 0; i < count; i++) {
    env.sink.consumeAll(env.pump);
    t = from + i * V;
    env.realm.frame(t);
  }
  return t;
}

function pixels(env: Env): PixelsFrame[] {
  return env.sink.frames().filter((f): f is PixelsFrame => f.t === "pixels");
}
function videoFrames(env: Env): VideoFrameMsg[] {
  return env.sink.frames().filter((f): f is VideoFrameMsg => f.t === "frame");
}
function contentOf(f: VideoFrameMsg): number {
  return (f.frame as unknown as FakeVideoFrame).content;
}

beforeEach(() => {
  FakeVideoFrame.made = [];
  vi.stubGlobal("VideoFrame", FakeVideoFrame);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("registerCanvasSource: paths", () => {
  it("path P takes the already-presented frame before the game draws", () => {
    const env = setup("2d");
    const order: string[] = [];
    const source = register(env);
    const game = startGame(env);
    expect(source.path).toBe("P");
    env.realm.requestAnimationFrame(() => order.push(`game sees ${FakeVideoFrame.made.length} frames`));
    runFrames(env, 1000, 61);
    game.stop();
    // The first frame has nothing presented yet: no capture before the game ran.
    expect(order[0]).toBe("game sees 0 frames");
    const frames = videoFrames(env);
    expect(frames.length).toBeGreaterThan(25);
    for (const f of frames) {
      const vf = f.frame as unknown as FakeVideoFrame;
      // Picture n was drawn in frame n (time 1000 + (n - 1) V); epoch is frame 1.
      expect(Math.abs((vf.content - 1) * V * 1000 - f.tsUs)).toBeLessThanOrEqual(1);
      expect(vf.init.alpha).toBe("discard");
      expect(f.hud).toEqual(HUD);
    }
    expect(env.sink.messages[0]).toEqual({ t: "timeline", state: "live", atPerfMs: 1000 });
    source.unregister();
  });

  it("path D takes the new WebGL1 frame after the game draws, in the same frame", () => {
    const env = setup("webgl");
    const source = register(env);
    startGame(env);
    expect(source.path).toBe("D");
    runFrames(env, 0, 30);
    const frames = videoFrames(env);
    expect(frames.length).toBeGreaterThan(10);
    for (const f of frames) {
      expect(contentOf(f)).not.toBe(0);
      expect(Math.abs((contentOf(f) - 1) * V * 1000 - f.tsUs)).toBeLessThanOrEqual(1);
    }
    source.unregister();
  });

  it("path E reads the WebGL2 frame back a frame later with the right picture and time", () => {
    const env = setup("webgl2");
    const costs: CaptureCostSample[] = [];
    const signals: ReadbackSignal[] = [];
    let clock = 0;
    const source = register(env, {
      onCaptureCost: (s) => costs.push(s),
      onReadback: (s) => signals.push(s),
      now: () => (clock += 0.25),
    });
    const game = startGame(env);
    expect(source.path).toBe("E");
    runFrames(env, 0, 61);
    game.stop();
    // The game stopped: wake() still runs a frame to collect the last readback.
    runFrames(env, 61 * V, 2);
    source.unregister();
    const frames = pixels(env);
    expect(frames.length).toBe(31);
    for (const f of frames) {
      expect(f.width).toBe(640);
      expect(f.height).toBe(360);
      const rec = readbackRecord(f.data);
      expect(rec.flipped).toBe(true);
      expect(rec.frameId).not.toBe(0);
      expect(Math.abs((rec.frameId - 1) * V * 1000 - f.tsUs)).toBeLessThanOrEqual(1);
    }
    const gl = game.context as WebGL2Mock;
    expect(gl.violations).toEqual([]);
    expect(costs.every((c) => c.path === "E")).toBe(true);
    expect(costs.filter((c) => c.ticket)).toHaveLength(31);
    const done = signals.filter((s): s is Extract<ReadbackSignal, { kind: "done" }> => s.kind === "done");
    expect(done.map((s) => s.latencyFrames)).toEqual(Array(31).fill(1));
    expect(env.pump.stats()).toMatchObject({ abandoned: 0, outOfOrder: 0 });
  });

  it("converts iframe realm timestamps to page time", () => {
    const env = setup("2d", { realmOrigin: 250 });
    const source = register(env);
    startGame(env);
    runFrames(env, 100, 5);
    expect(env.sink.messages[0]).toEqual({ t: "timeline", state: "live", atPerfMs: 350 });
    source.unregister();
  });

  it("reports game frames only for frames in which the game ran", () => {
    const env = setup("2d");
    const seen: number[] = [];
    const source = register(env, { onGameFrame: (ms) => seen.push(ms) });
    const game = startGame(env);
    runFrames(env, 0, 3);
    game.stop();
    runFrames(env, 3 * V, 2);
    expect(seen).toHaveLength(3);
    source.unregister();
  });
});

describe("registerCanvasSource: never takes the game's canvas", () => {
  for (const kind of ["2d", "webgl", "webgl2"] as const) {
    it(`waits for the game's own ${kind} context and never calls getContext`, () => {
      const env = setup(kind);
      const paths: Array<[CapturePath, string]> = [];
      const source = register(env, { onPathChange: (p, why) => paths.push([p, why]) });
      expect(source.path).toBeNull();
      // Other rAF users run frames before the game sets up its canvas.
      for (let i = 0; i < 5; i++) env.realm.requestAnimationFrame(() => undefined);
      runFrames(env, 0, 5);
      expect(env.canvas.getContextCalls).toEqual([]);
      expect(env.pump.stats().offered).toBe(0);
      // Now the game makes its context in its first frame: it gets it (not null).
      const game = startGame(env, { contextNow: false });
      runFrames(env, 5 * V, 12);
      expect(game.context).not.toBeNull();
      expect(env.canvas.getContextCalls).toEqual([kind]);
      expect(source.path).toBe(kind === "2d" ? "P" : kind === "webgl" ? "D" : "E");
      expect(paths).toEqual([[source.path, "context"]]);
      expect(env.sink.frames().length).toBeGreaterThan(2);
      source.unregister();
    });
  }

  it("learns a context made before the install from its first draw", () => {
    const env = setup("webgl2");
    const gl = makeContext(env) as WebGL2Mock;
    const source = register(env);
    expect(source.path).toBeNull();
    let n = 0;
    const loop = () => {
      gl.drawFrame(++n);
      env.realm.requestAnimationFrame(loop);
    };
    env.realm.requestAnimationFrame(loop);
    runFrames(env, 0, 10);
    expect(source.path).toBe("E");
    expect(env.canvas.getContextCalls).toEqual(["webgl2"]);
    expect(pixels(env).length).toBeGreaterThan(2);
    for (const f of pixels(env)) expect(readbackRecord(f.data).frameId).not.toBe(0);
    source.unregister();
  });
});

describe("registerCanvasSource: no black WebGL frames", () => {
  for (const [kind, targetFps] of [
    ["webgl2", 60],
    ["webgl2", 30],
    ["webgl", 60],
  ] as const) {
    it(`${kind} at ${targetFps} fps: captures only drawn frames, and stops once the game stops`, () => {
      const env = setup(kind, { targetFps });
      const source = register(env);
      const game = startGame(env);
      runFrames(env, 0, 30);
      game.stop();
      const offeredAtStop = env.pump.stats().offered;
      runFrames(env, 30 * V, 5);
      // One wake at most collects the last readback; then nothing is pending.
      expect(env.realm.pendingNative).toBe(0);
      expect(env.pump.stats().offered).toBe(offeredAtStop);
      if (kind === "webgl2") {
        expect(pixels(env).length).toBeGreaterThan(10);
        for (const f of pixels(env)) expect(readbackRecord(f.data).frameId).not.toBe(0);
      } else {
        expect(videoFrames(env).length).toBeGreaterThan(10);
        for (const f of videoFrames(env)) expect(contentOf(f)).not.toBe(0);
      }
      source.unregister();
    });
  }

  it("skips dispatches in which only another rAF user ran", () => {
    const env = setup("webgl2", { targetFps: 60 });
    const source = register(env);
    const game = startGame(env, { drawEvery: 2 });
    // A second rAF user in the page (a UI animation) that never draws the canvas.
    const ui = () => env.realm.requestAnimationFrame(ui);
    ui();
    runFrames(env, 0, 40);
    game.stop();
    runFrames(env, 40 * V, 10);
    const frames = pixels(env);
    expect(frames.length).toBeGreaterThan(10);
    // Only the even frames were drawn: every capture is a drawn picture.
    for (const f of frames) {
      const id = readbackRecord(f.data).frameId;
      expect(id).not.toBe(0);
      expect(id % 2).toBe(0);
    }
    source.unregister();
  });

  it("gives every drawn frame a slot even when the fences lag past the slot count", () => {
    const env = setup("webgl2", { targetFps: 60 });
    const signals: ReadbackSignal[] = [];
    const source = register(env, { onReadback: (s) => signals.push(s) });
    const game = startGame(env, { mock: { signalAfterFrames: 6 } });
    runFrames(env, 0, 60);
    game.stop();
    runFrames(env, 60 * V, 10);
    const stats = env.pump.stats();
    const busy = signals.filter((s) => s.kind === "busy").length;
    expect(busy).toBeGreaterThan(0);
    expect(stats.outOfOrder).toBe(0);
    expect(stats.abandoned).toBe(0);
    // Every draw is either captured or counted busy.
    expect(stats.captured + busy).toBe(60);
    expect(stats.captured).toBeGreaterThanOrEqual(35);
    const done = signals.filter((s): s is Extract<ReadbackSignal, { kind: "done" }> => s.kind === "done");
    expect(done.every((s) => s.latencyFrames === 6)).toBe(true);
    for (const f of pixels(env)) expect(readbackRecord(f.data).frameId).not.toBe(0);
    source.unregister();
  });
});

describe("registerCanvasSource: governor inputs", () => {
  it("reports a capture cost only for dispatches with capture work, with the ticket flag", () => {
    const env = setup("webgl2");
    const costs: CaptureCostSample[] = [];
    const source = register(env, { onCaptureCost: (s) => costs.push(s), now: () => 0 });
    const game = startGame(env);
    runFrames(env, 0, 20);
    game.stop();
    runFrames(env, 20 * V, 3);
    // At k = 2: a kick every other frame; the frame after a kick only collects.
    expect(costs.filter((c) => c.ticket)).toHaveLength(10);
    expect(costs.filter((c) => !c.ticket)).toHaveLength(10);
    // Every sample carries the frame time and the path, even a 0 ms one.
    expect(costs.every((c) => c.ms === 0 && c.path === "E" && Number.isFinite(c.frameMs))).toBe(true);
    source.unregister();
  });

  it("paths P and D report one ticketed cost per captured frame", () => {
    for (const kind of ["2d", "webgl"] as const) {
      const env = setup(kind);
      const costs: CaptureCostSample[] = [];
      const source = register(env, { onCaptureCost: (s) => costs.push(s) });
      startGame(env);
      runFrames(env, 0, 20);
      source.unregister();
      expect(costs.length).toBe(env.pump.stats().offered);
      expect(costs.length).toBeGreaterThan(5);
      expect(costs.every((c) => c.ticket)).toBe(true);
    }
  });

  it("warms up with no capture and marks those game frames as baseline", () => {
    const env = setup("2d");
    const frames: Array<{ ms: number; baseline: boolean }> = [];
    const source = register(env, { warmupMs: undefined, onGameFrame: (ms, info) => frames.push({ ms, ...info }) });
    startGame(env);
    runFrames(env, 0, 90);
    source.unregister();
    const baseline = frames.filter((f) => f.baseline);
    // One second of live play at 60 fps.
    expect(baseline.length).toBeGreaterThanOrEqual(Math.floor(BASELINE_WARMUP_MS / V));
    expect(baseline.length).toBeLessThanOrEqual(Math.ceil(BASELINE_WARMUP_MS / V) + 1);
    expect(frames.slice(baseline.length).every((f) => !f.baseline)).toBe(true);
    // The first ticket comes after the warmup.
    const firstTimeline = env.sink.messages[0] as { t: string; atPerfMs: number };
    expect(firstTimeline.t).toBe("timeline");
    expect(firstTimeline.atPerfMs).toBeGreaterThanOrEqual(BASELINE_WARMUP_MS - V);
  });

  it("restarts the warmup when the pump pauses, and skips it once the pump has started", () => {
    const env = setup("2d");
    const baseline: number[] = [];
    env.pump.pause(0);
    const first = register(env, { warmupMs: 500, onGameFrame: (ms, info) => void (info.baseline && baseline.push(ms)) });
    startGame(env);
    runFrames(env, 0, 30);
    expect(baseline).toEqual([]);
    env.pump.resume(30 * V);
    runFrames(env, 30 * V, 60);
    expect(baseline.length).toBeGreaterThanOrEqual(30);
    expect(env.pump.started).toBe(true);
    first.unregister();
    const again: boolean[] = [];
    const second = register(env, { warmupMs: undefined, onGameFrame: (_ms, info) => again.push(info.baseline) });
    runFrames(env, 90 * V, 5);
    expect(again.length).toBeGreaterThan(0);
    expect(again.every((b) => !b)).toBe(true);
    second.unregister();
  });

  it("feeds a governor end to end: baseline from the warmup, clean windows for a light game", () => {
    const env = setup("webgl2");
    const governor = new Governor({ displayHz: 60, targetFps: 30 });
    const source = register(env, { warmupMs: undefined, ...governorInputs(governor), now: () => 0 });
    startGame(env);
    runFrames(env, 0, 60 * 8);
    governor.tick(8000);
    source.unregister();
    expect(governor.baselineFps).toBeCloseTo(60, 0);
    const judged = governor.windowReports.filter((r) => r.judged);
    expect(judged.length).toBeGreaterThanOrEqual(3);
    for (const r of judged) {
      expect(r.violations).toEqual([]);
      expect(r.captures).toBeGreaterThan(25);
      expect(r.readbackLatency).toBe(1);
    }
    expect(governor.levelIndex).toBe(0);
  });

  it("feeds a governor end to end: a path E game that halves its frame rate under capture rests", () => {
    const env = setup("webgl2", { targetFps: 60 });
    const governor = new Governor({ displayHz: 60, targetFps: 60 });
    const source = register(env, { warmupMs: undefined, ...governorInputs(governor), now: () => 0 });
    startGame(env);
    // One second of warmup at 60 fps, then capture on every frame and the
    // game runs at 30 fps (the GPU is the bottleneck).
    let t = runFrames(env, 0, 61);
    for (let i = 0; i < 30 * 10; i++) {
      env.sink.consumeAll(env.pump);
      t += 2 * V;
      env.realm.frame(t);
    }
    governor.tick(t + 1);
    source.unregister();
    expect(governor.baselineFps).toBeCloseTo(60, 0);
    expect(governor.history.map((d) => d.reason)).toContain("severe");
    expect(governor.resting).toBe(true);
  });

  it("registering again keeps the governor's rung on the pump", () => {
    const env = setup("2d");
    const governor = new Governor({ displayHz: 60, targetFps: 30, startLevel: 1 });
    env.pump.configure({ stride: governor.level.k });
    expect(env.pump.stride).toBe(3);
    const first = register(env);
    expect(env.pump.stride).toBe(3);
    first.unregister();
    const second = register(env);
    expect(env.pump.stride).toBe(3);
    second.unregister();
  });
});

describe("registerCanvasSource: errors and lifecycle", () => {
  it("stops and reports a tainted canvas (SecurityError)", () => {
    const env = setup("webgl");
    env.canvas.tainted = true;
    const onError = vi.fn();
    register(env, { onError });
    startGame(env);
    runFrames(env, 0, 5);
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0][0] as DOMException).name).toBe("SecurityError");
    expect(hasRafDispatcher(env.realm)).toBe(false);
    expect(env.pump.stats().abandoned).toBe(1);
  });

  it("gives up after repeated transient errors", () => {
    const env = setup("webgl");
    const onError = vi.fn();
    vi.stubGlobal(
      "VideoFrame",
      class {
        constructor() {
          throw new DOMException("busy", "OperationError");
        }
      },
    );
    register(env, { onError });
    startGame(env);
    runFrames(env, 0, MAX_CONSECUTIVE_ERRORS * 2 + 4);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(env.pump.stats().abandoned).toBe(MAX_CONSECUTIVE_ERRORS);
  });

  it("keeps the last good HUD when the game's HUD callback throws, and leaks no frame", () => {
    const env = setup("webgl");
    let calls = 0;
    const source = register(env, {
      hud: () => {
        calls++;
        if (calls > 1) throw new Error("game bug");
        return HUD;
      },
    });
    startGame(env);
    runFrames(env, 0, 12);
    source.unregister();
    const frames = env.sink.frames();
    expect(frames.length).toBeGreaterThan(3);
    for (const f of frames) expect(f.hud).toEqual(HUD);
    // Every frame made is either sent or closed.
    const sent = new Set(frames.map((f) => (f as VideoFrameMsg).frame));
    for (const vf of FakeVideoFrame.made) expect(sent.has(vf as unknown as VideoFrame) || vf.closed).toBe(true);
  });

  it("skips a canvas with no pixels without an error", () => {
    const env = setup("2d");
    env.canvas.width = 0;
    const onError = vi.fn();
    const source = register(env, { onError });
    startGame(env);
    runFrames(env, 0, 10);
    expect(onError).not.toHaveBeenCalled();
    expect(env.pump.stats().offered).toBe(0);
    source.unregister();
  });

  it("unregister restores the realm and its canvas classes, and sends the held frame", () => {
    const env = setup("webgl");
    const proto = env.realm.WebGLRenderingContext.prototype as unknown as Record<string, unknown>;
    const before = Object.getOwnPropertyNames(proto);
    const source = register(env);
    const game = startGame(env);
    expect(Object.getOwnPropertyNames(proto).length).toBeGreaterThan(before.length);
    runFrames(env, 0, 10);
    const sent = env.sink.frames().length;
    env.sink.consumeAll(env.pump);
    source.unregister();
    expect(env.sink.frames().length).toBe(sent + 1);
    expect(env.realm.requestAnimationFrame).toBe(env.realm.nativeRaf);
    expect(Object.getOwnPropertyNames(proto)).toEqual(before);
    // The game loop keeps running natively.
    const ctx = game.context as FakeWebGLContext;
    const last = ctx.nextPicture;
    env.realm.frame(1000);
    expect(ctx.nextPicture).toBe(last + 1);
    game.stop();
    source.unregister();
  });

  it("stops path E on context loss and resumes on restore with the same context", () => {
    const env = setup("webgl2");
    const source = register(env);
    const game = startGame(env);
    const gl = game.context as WebGL2Mock;
    // Frames 1 and 3 start readbacks; the one from frame 3 is still in flight.
    runFrames(env, 0, 3);
    gl.loseContext();
    env.canvas.dispatchEvent(new Event("webglcontextlost"));
    expect(env.pump.stats().abandoned).toBeGreaterThanOrEqual(1);
    runFrames(env, 3 * V, 4);
    const sentWhileLost = env.sink.frames().length;
    gl.restoreContext();
    env.canvas.dispatchEvent(new Event("webglcontextrestored"));
    runFrames(env, 7 * V, 10);
    expect(env.sink.frames().length).toBeGreaterThan(sentWhileLost);
    for (const f of pixels(env)) expect(readbackRecord(f.data).frameId).not.toBe(0);
    game.stop();
    source.unregister();
  });

  it("falls back to path D when the first WebGL2 readback fails, and says so", () => {
    const env = setup("webgl2");
    const paths: Array<[CapturePath, string]> = [];
    const source = register(env, { onPathChange: (p, why) => paths.push([p, why]) });
    const game = startGame(env);
    (game.context as WebGL2Mock).failOn = "readPixels";
    runFrames(env, 0, 10);
    expect(source.path).toBe("D");
    expect(paths).toEqual([
      ["E", "context"],
      ["D", "readback-failed"],
    ]);
    const frames = videoFrames(env);
    expect(frames.length).toBeGreaterThan(0);
    for (const f of frames) expect(contentOf(f)).not.toBe(0);
    source.unregister();
  });

  it("a forced path P or D needs no context; a forced E on a 2D canvas uses D", () => {
    const env = setup("2d");
    const pump = new FramePump({ sink: new RecordingSink(), displayHz: 60, targetFps: 30 });
    const d = register({ ...env, pump }, { path: "D", targetFps: 60 });
    expect(d.path).toBe("D");
    expect(pump.targetFps).toBe(60);
    d.unregister();
    const forcedE = register({ ...env, pump }, { path: "E" });
    expect(forcedE.path).toBeNull();
    startGame(env);
    expect(forcedE.path).toBe("D");
    expect(env.canvas.getContextCalls).toEqual(["2d"]);
    forcedE.unregister();
  });

  it("needs VideoFrame for paths P and D, but not for path E", () => {
    vi.stubGlobal("VideoFrame", undefined);
    const p = setup("2d");
    // The tracker already knows the game's context, so the path is known at once.
    const watch = installCanvasActivity(p.realm);
    startGame(p);
    expect(() => register(p)).toThrow(/VideoFrame/);
    watch.uninstall();
    // The failed registration left nothing behind.
    expect(Object.getOwnPropertyNames(p.realm.CanvasRenderingContext2D.prototype)).toEqual(["constructor"]);
    expect(hasRafDispatcher(p.realm)).toBe(false);
    const e = setup("webgl2");
    const source = register(e);
    startGame(e);
    expect(source.path).toBe("E");
    source.unregister();
  });

  it("reports a missing VideoFrame when the path becomes known later", () => {
    vi.stubGlobal("VideoFrame", undefined);
    const env = setup("2d");
    const onError = vi.fn();
    const source = register(env, { onError });
    startGame(env);
    runFrames(env, 0, 3);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0][0])).toMatch(/VideoFrame/);
    expect(hasRafDispatcher(env.realm)).toBe(false);
    source.unregister();
  });

  it("setReadbackWidth changes the path E size", () => {
    const env = setup("webgl2");
    const source = register(env);
    startGame(env);
    source.setReadbackWidth(480);
    runFrames(env, 0, 8);
    const f = pixels(env)[0];
    expect(f.width).toBe(480);
    expect(f.height).toBe(270);
    source.unregister();
  });
});

describe("canvas mock sanity", () => {
  it("getContext creates on the first call and refuses another type", () => {
    const realm = new CanvasRealm();
    const canvas: FakeCanvas = realm.createCanvas();
    expect(canvas.getContext("webgl2")).toBeInstanceOf(realm.WebGL2RenderingContext);
    expect(canvas.getContext("2d")).toBeNull();
    expect(canvas.getContextCalls).toEqual(["webgl2", "2d"]);
  });

  it("a WebGL frame with no draw composites to black", () => {
    const realm = new CanvasRealm();
    const gl = realm.createCanvas().getContext("webgl2") as WebGL2Mock;
    gl.drawFrame(5);
    expect(gl.frameId).toBe(5);
    realm.frame(0);
    expect(gl.frameId).toBe(0);
  });
});
