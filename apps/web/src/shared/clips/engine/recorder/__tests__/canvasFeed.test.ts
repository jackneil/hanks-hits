// @vitest-environment node
/**
 * The canvas feed of tiers M and V (plan 3a, 6.1, 6.2) on the canvas-mock
 * realm: when it reads the game canvas (2D before the game draws, WebGL only
 * after a draw), the pace, the warmup baseline, a canvas it cannot read, and
 * pictures. The draw callback reads the canvas the way drawImage does: the
 * picture that is on it at that moment.
 */
import { describe, expect, it } from "vitest";
import { CanvasRealm, type FakeCanvas, type FakeContext2D, type FakeWebGLContext } from "../../../../../__tests__/canvas-mock";
import type { HudState } from "../../../protocol";
import { Pacer, startCanvasFeed, type CanvasFeedOptions } from "../canvasFeed";

const FRAME_MS = 1000 / 60;

function setup(type: "2d" | "webgl", options: Partial<CanvasFeedOptions> & { drawEvery?: number; stride?: number } = {}) {
  const realm = new CanvasRealm(performance.timeOrigin);
  const canvas = realm.createCanvas(64, 48);
  const ctx = canvas.getContext(type) as FakeContext2D | FakeWebGLContext;
  const callsBefore = canvas.getContextCalls.length;
  let frame = 0;
  const drawEvery = options.drawEvery ?? 1;
  const loop = () => {
    frame++;
    if (frame % drawEvery === 0) ctx.drawPicture(frame);
    realm.requestAnimationFrame(loop);
  };
  realm.requestAnimationFrame(loop);
  const read: Array<{ picture: number; hud: HudState }> = [];
  const costs: Array<{ frameMs: number; path: string }> = [];
  const gameFrames: Array<{ ms: number; baseline: boolean }> = [];
  let live = true;
  let t = 0;
  const pacer = new Pacer(60, options.stride ?? 1);
  const feed = startCanvasFeed({
    canvas: canvas as unknown as HTMLCanvasElement,
    draw: (c, hud) => {
      const picture = (c as unknown as FakeCanvas).picture;
      if ((options as { throwOn?: number }).throwOn === picture) throw new DOMException("tainted", "SecurityError");
      read.push({ picture, hud });
    },
    hud: () => ({ gameName: "Snake", emoji: "🐍" }),
    pacer,
    live: () => live,
    onCaptureCost: (s) => costs.push({ frameMs: s.frameMs, path: s.path }),
    onGameFrame: (ms, info) => gameFrames.push({ ms, baseline: info.baseline }),
    warmupMs: 0,
    now: () => t,
    ...options,
  });
  const run = (frames: number) => {
    for (let i = 0; i < frames; i++) {
      t += FRAME_MS;
      realm.frame(t);
    }
  };
  return {
    realm,
    canvas,
    feed,
    read,
    costs,
    gameFrames,
    run,
    pacer,
    setLive: (v: boolean) => (live = v),
    frame: () => frame,
    getContextCallsSinceStart: () => canvas.getContextCalls.length - callsBefore,
  };
}

describe("canvas feed timing", () => {
  it("2D: reads the frame that is on screen, before the game draws the next one (path P)", () => {
    const h = setup("2d");
    h.run(5);
    // Frame n's pre hook sees picture n - 1: the game draws picture n only after it.
    // (Frame 1 draws first: the game queued it before the feed's dispatcher existed.)
    expect(h.read.map((r) => r.picture)).toEqual([1, 2, 3, 4]);
    expect(h.costs.every((c) => c.path === "P")).toBe(true);
    expect(h.read[0].hud).toEqual({ gameName: "Snake", emoji: "🐍" });
  });

  it("WebGL: reads only in a dispatch in which the game drew, after the draw (the buffer is clear otherwise)", () => {
    const h = setup("webgl", { drawEvery: 2 });
    h.run(8);
    expect(h.read.map((r) => r.picture)).toEqual([2, 4, 6, 8]);
    expect(h.costs.every((c) => c.path === "D")).toBe(true);
  });

  it("never calls getContext on the game canvas", () => {
    const h = setup("webgl");
    h.run(10);
    expect(h.getContextCallsSinceStart()).toBe(0);
  });

  it("paces captures on the vsync grid: stride 2 at 60 Hz takes every other frame", () => {
    const h = setup("2d", { stride: 2 });
    h.run(10);
    expect(h.read).toHaveLength(5);
    h.pacer.setStride(1);
    h.run(4);
    expect(h.read).toHaveLength(9);
  });

  it("captures nothing while capture is off, and restarts its warmup then", () => {
    const h = setup("2d", { warmupMs: 100 });
    h.run(5);
    // 83 ms of live play: still warming up; those frames are the baseline.
    expect(h.read).toHaveLength(0);
    expect(h.gameFrames.every((f) => f.baseline)).toBe(true);
    h.setLive(false);
    h.run(10);
    expect(h.read).toHaveLength(0);
    h.setLive(true);
    h.run(5);
    expect(h.read).toHaveLength(0);
    h.run(3);
    expect(h.read.length).toBeGreaterThan(0);
    expect(h.gameFrames.at(-1)!.baseline).toBe(false);
  });

  it("a canvas it cannot read (SecurityError) stops the feed and reports once", () => {
    const errors: unknown[] = [];
    const h = setup("2d", { onError: (e) => errors.push(e), ...({ throwOn: 3 } as object) });
    h.run(8);
    expect(h.read.map((r) => r.picture)).toEqual([1, 2]);
    expect(errors).toHaveLength(1);
    expect(h.feed.stopped).toBe(true);
  });
});

describe("pictures", () => {
  const timers = () => {
    const pending: Array<{ fn: () => void; at: number }> = [];
    return {
      set: (fn: () => void, ms: number) => {
        const entry = { fn, at: ms };
        pending.push(entry);
        return entry;
      },
      clear: (h: unknown) => {
        const i = pending.indexOf(h as { fn: () => void; at: number });
        if (i >= 0) pending.splice(i, 1);
      },
      fire: () => pending.splice(0).forEach((p) => p.fn()),
      pending,
    };
  };

  it("2D: a PNG of the canvas at the next dispatch", async () => {
    const h = setup("2d");
    (h.canvas as unknown as { toBlob: (cb: (b: Blob) => void, type: string) => void }).toBlob = (cb, type) =>
      cb(new Blob([`picture ${h.canvas.picture}`], { type }));
    const t = timers();
    const shot = h.feed.snapshotPng(500, t);
    h.run(1);
    const result = await shot;
    expect(result).toMatchObject({ width: 64, height: 48 });
    expect(new TextDecoder().decode((result as { png: ArrayBuffer }).png)).toBe("picture 1");
    expect(t.pending).toHaveLength(0);
  });

  it("WebGL: waits for a draw; a paused game gives 'no-draw' at the timeout", async () => {
    const h = setup("webgl", { drawEvery: 1000 });
    (h.canvas as unknown as { toBlob: (cb: (b: Blob) => void) => void }).toBlob = (cb) => cb(new Blob(["x"]));
    const t = timers();
    const shot = h.feed.snapshotPng(500, t);
    h.run(3);
    t.fire();
    expect(await shot).toBe("no-draw");
  });

  it("a stopped feed gives no picture", async () => {
    const h = setup("2d");
    h.feed.stop();
    expect(await h.feed.snapshotPng(500, timers())).toBeNull();
  });
});

describe("Pacer", () => {
  it("is due at once, then after `stride` vsyncs; reset() makes the next frame due", () => {
    const pacer = new Pacer(60, 2);
    expect(pacer.due(0)).toBe(true);
    pacer.mark(0);
    expect(pacer.due(FRAME_MS)).toBe(false);
    // Half a vsync of jitter never moves a frame to another slot.
    expect(pacer.due(2 * FRAME_MS - 7)).toBe(true);
    pacer.mark(2 * FRAME_MS);
    pacer.reset();
    expect(pacer.due(2 * FRAME_MS + 1)).toBe(true);
    pacer.setStride(0);
    expect(pacer.currentStride).toBe(1);
  });
});
