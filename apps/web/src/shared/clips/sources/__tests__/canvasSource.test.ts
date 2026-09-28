import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readbackRecord, WebGL2Mock } from "@/__tests__/webgl2-mock";
import type { FrameIn, HudState } from "../../protocol";
import { FramePump } from "../../runtime/framePump";
import { hasRafDispatcher } from "../../runtime/rafDispatcher";
import { FakeRealm } from "../../runtime/__tests__/fakeRealm";
import { detectCapturePath, MAX_CONSECUTIVE_ERRORS, registerCanvasSource } from "../canvasSource";
import { FakeCanvas, FakeVideoFrame, RecordingSink } from "./fakes";

const HUD: HudState = { gameName: "Breakout", emoji: "🧱", score: "120" };
const V = 1000 / 60;
const PAGE = { performance: { timeOrigin: 0 } };

function setup(kind: "2d" | "webgl" | "webgl2", opts: { realmOrigin?: number; mock?: WebGL2Mock } = {}) {
  const realm = new FakeRealm(opts.realmOrigin ?? 0);
  const mock = opts.mock ?? (kind === "webgl2" ? new WebGL2Mock({ width: 1280, height: 720 }) : undefined);
  const canvas = new FakeCanvas(realm, kind, mock ? mock.gl : {}, mock ? 1280 : 480, mock ? 720 : 640);
  const sink = new RecordingSink();
  const pump = new FramePump({ sink, displayHz: 60, targetFps: 30 });
  return { realm, canvas, sink, pump, mock };
}

/** A game loop that draws picture n in frame n. */
function startGame(realm: FakeRealm, canvas: FakeCanvas, mock?: WebGL2Mock) {
  let n = 0;
  let id = 0;
  const loop = () => {
    n++;
    canvas.content = n;
    mock?.drawFrame(n);
    id = realm.requestAnimationFrame(loop);
  };
  id = realm.requestAnimationFrame(loop);
  return { stop: () => realm.cancelAnimationFrame(id) };
}

function runFrames(env: ReturnType<typeof setup>, from: number, count: number): number {
  let t = from;
  for (let i = 0; i < count; i++) {
    env.sink.consumeAll(env.pump);
    env.mock?.nextFrame();
    t = from + i * V;
    env.realm.frame(t);
  }
  return t;
}

beforeEach(() => {
  FakeVideoFrame.made = [];
  vi.stubGlobal("VideoFrame", FakeVideoFrame);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("detectCapturePath", () => {
  it("reads the existing context type", () => {
    const realm = new FakeRealm();
    expect(detectCapturePath(new FakeCanvas(realm, "2d").asElement).path).toBe("P");
    expect(detectCapturePath(new FakeCanvas(realm, "webgl").asElement).path).toBe("D");
    const gl2 = new WebGL2Mock();
    const e = detectCapturePath(new FakeCanvas(realm, "webgl2", gl2.gl).asElement);
    expect(e.path).toBe("E");
    expect(e.gl2).toBe(gl2.gl);
    expect(detectCapturePath(new FakeCanvas(realm, "none").asElement).path).toBe("D");
    expect(detectCapturePath(new FakeCanvas(realm, "throws").asElement).path).toBe("D");
  });

  it("probes webgl2, then webgl, then 2d", () => {
    const canvas = new FakeCanvas(new FakeRealm(), "2d");
    detectCapturePath(canvas.asElement);
    expect(canvas.probes).toEqual(["webgl2", "webgl", "experimental-webgl", "2d"]);
  });
});

describe("registerCanvasSource", () => {
  it("path P takes the already-presented frame before the game draws", () => {
    const env = setup("2d");
    const order: string[] = [];
    const source = registerCanvasSource({
      canvas: env.canvas.asElement,
      hud: () => HUD,
      targetFps: 30,
      pump: env.pump,
      pageRealm: PAGE,
    });
    expect(source.path).toBe("P");
    const game = startGame(env.realm, env.canvas);
    env.realm.requestAnimationFrame(() => order.push(`game sees ${FakeVideoFrame.made.length} frames`));
    runFrames(env, 1000, 61);
    game.stop();
    // The first frame has nothing presented yet: no capture before the game ran.
    expect(order[0]).toBe("game sees 0 frames");
    const frames = env.sink.frames() as Extract<FrameIn, { t: "frame" }>[];
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

  it("path D takes the new frame after the game draws, in the same frame", () => {
    const env = setup("webgl");
    const source = registerCanvasSource({ canvas: env.canvas.asElement, hud: () => HUD, targetFps: 30, pump: env.pump, pageRealm: PAGE });
    expect(source.path).toBe("D");
    startGame(env.realm, env.canvas);
    runFrames(env, 0, 30);
    const frames = env.sink.frames() as Extract<FrameIn, { t: "frame" }>[];
    expect(frames.length).toBeGreaterThan(10);
    for (const f of frames) {
      const vf = f.frame as unknown as FakeVideoFrame;
      expect(Math.abs((vf.content - 1) * V * 1000 - f.tsUs)).toBeLessThanOrEqual(1);
    }
    source.unregister();
  });

  it("path E reads the WebGL2 frame back a frame later with the right picture and time", () => {
    const env = setup("webgl2");
    const costs: number[] = [];
    let clock = 0;
    const source = registerCanvasSource({
      canvas: env.canvas.asElement,
      hud: () => HUD,
      targetFps: 30,
      pump: env.pump,
      pageRealm: PAGE,
      onCaptureCost: (ms, path) => {
        expect(path).toBe("E");
        costs.push(ms);
      },
      now: () => (clock += 0.25),
    });
    expect(source.path).toBe("E");
    const game = startGame(env.realm, env.canvas, env.mock);
    runFrames(env, 0, 61);
    game.stop();
    // The game stopped: wake() still runs a frame to collect the last readback.
    runFrames(env, 61 * V, 2);
    source.unregister();
    const frames = env.sink.frames() as Extract<FrameIn, { t: "pixels" }>[];
    expect(frames.length).toBe(31);
    for (const f of frames) {
      expect(f.t).toBe("pixels");
      expect(f.width).toBe(640);
      expect(f.height).toBe(360);
      const rec = readbackRecord(f.data);
      expect(rec.flipped).toBe(true);
      expect(Math.abs((rec.frameId - 1) * V * 1000 - f.tsUs)).toBeLessThanOrEqual(1);
    }
    expect(env.mock!.violations).toEqual([]);
    expect(costs.length).toBeGreaterThan(30);
    expect(env.pump.stats().abandoned).toBe(0);
  });

  it("converts iframe realm timestamps to page time", () => {
    const env = setup("2d", { realmOrigin: 250 });
    const source = registerCanvasSource({ canvas: env.canvas.asElement, hud: () => HUD, targetFps: 30, pump: env.pump, pageRealm: PAGE });
    startGame(env.realm, env.canvas);
    runFrames(env, 100, 5);
    expect(env.sink.messages[0]).toEqual({ t: "timeline", state: "live", atPerfMs: 350 });
    source.unregister();
  });

  it("reports game frames only for frames in which the game ran", () => {
    const env = setup("2d");
    const seen: number[] = [];
    const source = registerCanvasSource({
      canvas: env.canvas.asElement,
      hud: () => HUD,
      targetFps: 30,
      pump: env.pump,
      pageRealm: PAGE,
      onGameFrame: (ms) => seen.push(ms),
    });
    const game = startGame(env.realm, env.canvas);
    runFrames(env, 0, 3);
    game.stop();
    runFrames(env, 3 * V, 2);
    expect(seen).toHaveLength(3);
    source.unregister();
  });

  it("stops and reports a tainted canvas (SecurityError)", () => {
    const env = setup("webgl");
    env.canvas.tainted = true;
    const onError = vi.fn();
    registerCanvasSource({ canvas: env.canvas.asElement, hud: () => HUD, targetFps: 30, pump: env.pump, pageRealm: PAGE, onError });
    startGame(env.realm, env.canvas);
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
    registerCanvasSource({ canvas: env.canvas.asElement, hud: () => HUD, targetFps: 30, pump: env.pump, pageRealm: PAGE, onError });
    startGame(env.realm, env.canvas);
    runFrames(env, 0, MAX_CONSECUTIVE_ERRORS * 2 + 4);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(env.pump.stats().abandoned).toBe(MAX_CONSECUTIVE_ERRORS);
  });

  it("keeps the last good HUD when the game's HUD callback throws, and leaks no frame", () => {
    const env = setup("webgl");
    let calls = 0;
    const source = registerCanvasSource({
      canvas: env.canvas.asElement,
      hud: () => {
        calls++;
        if (calls > 1) throw new Error("game bug");
        return HUD;
      },
      targetFps: 30,
      pump: env.pump,
      pageRealm: PAGE,
    });
    startGame(env.realm, env.canvas);
    runFrames(env, 0, 12);
    source.unregister();
    const frames = env.sink.frames();
    expect(frames.length).toBeGreaterThan(3);
    for (const f of frames) expect(f.hud).toEqual(HUD);
    // Every frame made is either sent or closed.
    const sent = new Set(frames.map((f) => (f as Extract<FrameIn, { t: "frame" }>).frame));
    for (const vf of FakeVideoFrame.made) expect(sent.has(vf as unknown as VideoFrame) || vf.closed).toBe(true);
  });

  it("skips a canvas with no pixels without an error", () => {
    const env = setup("2d");
    env.canvas.width = 0;
    const onError = vi.fn();
    const source = registerCanvasSource({ canvas: env.canvas.asElement, hud: () => HUD, targetFps: 30, pump: env.pump, pageRealm: PAGE, onError });
    startGame(env.realm, env.canvas);
    runFrames(env, 0, 10);
    expect(onError).not.toHaveBeenCalled();
    expect(env.pump.stats().offered).toBe(0);
    source.unregister();
  });

  it("unregister restores the realm and sends the held frame", () => {
    const env = setup("webgl");
    const source = registerCanvasSource({ canvas: env.canvas.asElement, hud: () => HUD, targetFps: 30, pump: env.pump, pageRealm: PAGE });
    const game = startGame(env.realm, env.canvas);
    runFrames(env, 0, 10);
    const before = env.sink.frames().length;
    env.sink.consumeAll(env.pump);
    source.unregister();
    expect(env.sink.frames().length).toBe(before + 1);
    expect(env.realm.requestAnimationFrame).toBe(env.realm.nativeRaf);
    // The game loop keeps running natively.
    const count = env.canvas.content;
    env.realm.frame(1000);
    expect(env.canvas.content).toBe(count + 1);
    game.stop();
    source.unregister();
  });

  it("stops path E on context loss and resumes on restore", () => {
    const env = setup("webgl2");
    const source = registerCanvasSource({ canvas: env.canvas.asElement, hud: () => HUD, targetFps: 30, pump: env.pump, pageRealm: PAGE });
    const game = startGame(env.realm, env.canvas, env.mock);
    // Frames 1 and 3 start readbacks; the one from frame 3 is still in flight.
    runFrames(env, 0, 3);
    env.mock!.loseContext();
    env.canvas.dispatchEvent(new Event("webglcontextlost"));
    expect(env.pump.stats().abandoned).toBeGreaterThanOrEqual(1);
    runFrames(env, 3 * V, 4);
    game.stop();
    const sentWhileLost = env.sink.frames().length;
    const restored = new WebGL2Mock({ width: 1280, height: 720 });
    (env.canvas as unknown as { context: unknown }).context = restored.gl;
    env.canvas.dispatchEvent(new Event("webglcontextrestored"));
    const env2 = { ...env, mock: restored };
    startGame(env.realm, env.canvas, restored);
    runFrames(env2, 7 * V, 10);
    expect(env.sink.frames().length).toBeGreaterThan(sentWhileLost);
    source.unregister();
  });

  it("falls back to path D when the first WebGL2 readback fails", () => {
    const env = setup("webgl2");
    env.mock!.failOn = "readPixels";
    const source = registerCanvasSource({ canvas: env.canvas.asElement, hud: () => HUD, targetFps: 30, pump: env.pump, pageRealm: PAGE });
    startGame(env.realm, env.canvas, env.mock);
    runFrames(env, 0, 10);
    expect(source.path).toBe("D");
    expect(env.sink.frames().some((f) => f.t === "frame")).toBe(true);
    source.unregister();
  });

  it("a forced path probes no context type except WebGL2 for path E", () => {
    const realm = new FakeRealm();
    const canvas = new FakeCanvas(realm, "2d");
    const pump = new FramePump({ sink: new RecordingSink(), displayHz: 60, targetFps: 30 });
    const s = registerCanvasSource({ canvas: canvas.asElement, hud: () => HUD, targetFps: 60, pump, path: "D", pageRealm: PAGE });
    expect(canvas.probes).toEqual([]);
    expect(pump.targetFps).toBe(60);
    s.unregister();
    const forcedE = registerCanvasSource({ canvas: canvas.asElement, hud: () => HUD, targetFps: 30, pump, path: "E", pageRealm: PAGE });
    expect(forcedE.path).toBe("D");
    forcedE.unregister();
  });

  it("needs VideoFrame for paths P and D, but not for path E", () => {
    vi.stubGlobal("VideoFrame", undefined);
    const p = setup("2d");
    expect(() =>
      registerCanvasSource({ canvas: p.canvas.asElement, hud: () => HUD, targetFps: 30, pump: p.pump, pageRealm: PAGE }),
    ).toThrow(/VideoFrame/);
    const e = setup("webgl2");
    const source = registerCanvasSource({ canvas: e.canvas.asElement, hud: () => HUD, targetFps: 30, pump: e.pump, pageRealm: PAGE });
    expect(source.path).toBe("E");
    source.unregister();
  });

  it("setReadbackWidth changes the path E size", () => {
    const env = setup("webgl2");
    const source = registerCanvasSource({ canvas: env.canvas.asElement, hud: () => HUD, targetFps: 30, pump: env.pump, pageRealm: PAGE });
    source.setReadbackWidth(480);
    startGame(env.realm, env.canvas, env.mock);
    runFrames(env, 0, 8);
    const f = env.sink.frames()[0] as Extract<FrameIn, { t: "pixels" }>;
    expect(f.width).toBe(480);
    expect(f.height).toBe(270);
    source.unregister();
  });
});
