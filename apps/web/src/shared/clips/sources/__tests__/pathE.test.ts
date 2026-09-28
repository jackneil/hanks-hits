import { describe, expect, it } from "vitest";
import { GL, readbackRecord, WebGL2Mock } from "@/__tests__/webgl2-mock";
import { PathEReader, readbackSize } from "../pathE";

/** Game-side state that three.js could leave bound between frames. */
function gameBindings(mock: WebGL2Mock) {
  const gl = mock.gl;
  const gameFb = gl.createFramebuffer();
  const gameRb = gl.createRenderbuffer();
  const gamePack = gl.createBuffer();
  mock.gameState({
    readFb: gameFb as never,
    drawFb: gameFb as never,
    renderbuffer: gameRb as never,
    packBuffer: gamePack as never,
    scissor: true,
    discard: false,
    packAlignment: 1,
    packRowLength: 7,
    packSkipRows: 2,
    packSkipPixels: 3,
  });
  return mock.snapshot();
}

describe("readbackSize", () => {
  it("scales to 640 wide with an even height (the measured 1334x622 -> 640x298)", () => {
    expect(readbackSize(1334, 622)).toEqual({ width: 640, height: 298 });
    expect(readbackSize(1000, 466)).toEqual({ width: 640, height: 298 });
  });
  it("never scales up and keeps both sides even", () => {
    expect(readbackSize(481, 641)).toEqual({ width: 480, height: 640 });
    expect(readbackSize(3, 3)).toEqual({ width: 2, height: 2 });
    expect(readbackSize(1920, 1080, 480)).toEqual({ width: 480, height: 270 });
  });
});

describe("PathEReader", () => {
  it("reads an upright 640-wide frame one frame later, without waiting", () => {
    const mock = new WebGL2Mock({ width: 1334, height: 622 });
    const reader = new PathEReader<string>(mock.gl);
    mock.drawFrame(11);
    expect(reader.kick("a")).toBe("ok");
    // Same task: the fence cannot signal yet.
    expect(reader.poll().ready).toEqual([]);
    mock.nextFrame();
    const { ready, dropped } = reader.poll();
    expect(dropped).toEqual([]);
    expect(ready).toHaveLength(1);
    expect(ready[0].tag).toBe("a");
    expect(ready[0].width).toBe(640);
    expect(ready[0].height).toBe(298);
    expect(ready[0].data.byteLength).toBe(640 * 298 * 4);
    expect(readbackRecord(ready[0].data)).toEqual({ frameId: 11, width: 640, height: 298, flipped: true });
    expect(mock.violations).toEqual([]);
    // Each readback is a new buffer, safe to transfer.
    mock.drawFrame(12);
    reader.kick("b");
    mock.nextFrame();
    const next = reader.poll().ready[0];
    expect(next.data).not.toBe(ready[0].data);
    expect(readbackRecord(next.data).frameId).toBe(12);
  });

  it("restores every binding and state the game had", () => {
    const mock = new WebGL2Mock();
    const before = gameBindings(mock);
    const reader = new PathEReader<number>(mock.gl);
    mock.drawFrame(1);
    expect(reader.kick(1)).toBe("ok");
    expect(mock.snapshot()).toEqual(before);
    mock.nextFrame();
    expect(reader.poll().ready).toHaveLength(1);
    expect(mock.snapshot()).toEqual(before);
    // The game's scissor and PACK_* values did not leak into the readback.
    expect(mock.violations).toEqual([]);
  });

  it("uses a resolve blit only when the drawing buffer is multisampled", () => {
    const msaa = new WebGL2Mock({ antialias: true });
    new PathEReader<number>(msaa.gl).kick(1);
    expect(msaa.calls.filter((c) => c[0] === "blitFramebuffer")).toHaveLength(2);
    expect(msaa.violations).toEqual([]);

    const plain = new WebGL2Mock({ antialias: false });
    new PathEReader<number>(plain.gl).kick(1);
    expect(plain.calls.filter((c) => c[0] === "blitFramebuffer")).toHaveLength(1);
    expect(plain.violations).toEqual([]);
  });

  it("resolves into RGB8 when the context has no alpha", () => {
    const mock = new WebGL2Mock({ alpha: false, antialias: true });
    const reader = new PathEReader<number>(mock.gl);
    mock.drawFrame(5);
    expect(reader.kick(1)).toBe("ok");
    expect(mock.violations).toEqual([]);
    const storage = mock.calls.filter((c) => c[0] === "renderbufferStorage").map((c) => c[1]);
    expect(storage).toContain(GL.RGB8);
    mock.nextFrame();
    expect(readbackRecord(reader.poll().ready[0].data).frameId).toBe(5);
  });

  it("waits for slow fences and returns readbacks in order", () => {
    const mock = new WebGL2Mock({ signalAfterFrames: 2 });
    const reader = new PathEReader<number>(mock.gl);
    mock.drawFrame(1);
    reader.kick(1);
    mock.nextFrame();
    mock.drawFrame(2);
    reader.kick(2);
    expect(reader.poll().ready).toEqual([]);
    mock.nextFrame();
    expect(reader.poll().ready.map((r) => r.tag)).toEqual([1]);
    mock.nextFrame();
    const second = reader.poll().ready;
    expect(second.map((r) => r.tag)).toEqual([2]);
    expect(readbackRecord(second[0].data).frameId).toBe(2);
    expect(mock.violations).toEqual([]);
    expect(mock.live().syncs).toBe(0);
  });

  it("reports the readback latency in polls, one per frame", () => {
    const mock = new WebGL2Mock({ signalAfterFrames: 3 });
    const reader = new PathEReader<number>(mock.gl);
    mock.drawFrame(1);
    reader.kick(1);
    mock.nextFrame();
    expect(reader.poll().ready).toEqual([]);
    mock.nextFrame();
    expect(reader.poll().ready).toEqual([]);
    mock.nextFrame();
    const ready = reader.poll().ready;
    expect(ready.map((r) => [r.tag, r.latencyFrames])).toEqual([[1, 3]]);
  });

  it("reads black when the game drew nothing since the last composite", () => {
    const mock = new WebGL2Mock();
    const reader = new PathEReader<string>(mock.gl);
    mock.drawFrame(4);
    mock.nextFrame();
    reader.kick("late");
    mock.nextFrame();
    expect(readbackRecord(reader.poll().ready[0].data).frameId).toBe(0);
  });

  it("canKick says whether a kick can queue a readback now", () => {
    const mock = new WebGL2Mock({ signalAfterFrames: 10 });
    const reader = new PathEReader<number>(mock.gl, { slots: 2 });
    expect(reader.canKick()).toBe(true);
    expect(reader.busy).toBe(false);
    reader.kick(1);
    reader.kick(2);
    expect(reader.busy).toBe(true);
    expect(reader.canKick()).toBe(false);
    for (let i = 0; i < 10; i++) mock.nextFrame();
    reader.poll();
    expect(reader.canKick()).toBe(true);
    mock.resize(1, 1);
    expect(reader.canKick()).toBe(false);
    mock.resize(640, 360);
    mock.loseContext();
    expect(reader.canKick()).toBe(false);
    expect(new PathEReader<number>({ isContextLost: () => false } as unknown as WebGL2RenderingContext).canKick()).toBe(false);
    const failed = new PathEReader<number>(new WebGL2Mock().gl);
    failed.dispose();
    expect(failed.canKick()).toBe(false);
  });

  it("drops a frame when all 4 slots are busy", () => {
    const mock = new WebGL2Mock({ signalAfterFrames: 10 });
    const reader = new PathEReader<number>(mock.gl);
    for (let i = 0; i < 4; i++) expect(reader.kick(i)).toBe("ok");
    expect(reader.pending).toBe(4);
    expect(reader.kick(99)).toBe("busy");
    for (let i = 0; i < 10; i++) mock.nextFrame();
    expect(reader.poll().ready.map((r) => r.tag)).toEqual([0, 1, 2, 3]);
    expect(reader.kick(4)).toBe("ok");
    // Slots are reused, not reallocated.
    expect(mock.created.buffers).toBe(4);
  });

  it("recreates the targets when the canvas is resized", () => {
    const mock = new WebGL2Mock({ width: 1334, height: 622 });
    const reader = new PathEReader<string>(mock.gl);
    mock.drawFrame(1);
    reader.kick("old");
    const fbBefore = mock.created.framebuffers;
    mock.resize(800, 1200);
    mock.drawFrame(2);
    expect(reader.kick("new")).toBe("ok");
    expect(mock.created.framebuffers).toBe(fbBefore + 2);
    expect(mock.live().framebuffers).toBe(2);
    expect(reader.size).toEqual({ width: 640, height: 960 });
    mock.nextFrame();
    const ready = reader.poll().ready;
    expect(ready.map((r) => [r.tag, r.width, r.height])).toEqual([
      ["old", 640, 298],
      ["new", 640, 960],
    ]);
    expect(readbackRecord(ready[1].data)).toMatchObject({ frameId: 2, width: 640, height: 960 });
    expect(mock.violations).toEqual([]);
  });

  it("changes the readback width for a governor content step", () => {
    const mock = new WebGL2Mock({ width: 1280, height: 720 });
    const reader = new PathEReader<number>(mock.gl);
    reader.kick(1);
    reader.setTargetWidth(480);
    reader.kick(2);
    expect(reader.size).toEqual({ width: 480, height: 270 });
  });

  it("stops cleanly on context loss and hands back the pending tags", () => {
    const mock = new WebGL2Mock();
    const reader = new PathEReader<number>(mock.gl);
    reader.kick(1);
    reader.kick(2);
    mock.loseContext();
    const polled = reader.poll();
    expect(polled.ready).toEqual([]);
    expect(polled.dropped).toEqual([1, 2]);
    expect(reader.kick(3)).toBe("lost");
    expect(reader.state).toBe("lost");
    expect(reader.dispose()).toEqual([]);
  });

  it("markLost (the webglcontextlost event) returns the pending tags", () => {
    const mock = new WebGL2Mock();
    const reader = new PathEReader<number>(mock.gl);
    reader.kick(7);
    expect(reader.markLost()).toEqual([7]);
    expect(reader.kick(8)).toBe("lost");
  });

  it("stops when the first readback raises a GL error", () => {
    const mock = new WebGL2Mock();
    const reader = new PathEReader<number>(mock.gl);
    mock.failOn = "readPixels";
    expect(reader.kick(1)).toBe("failed");
    expect(reader.state).toBe("failed");
    expect(reader.kick(2)).toBe("failed");
    expect(mock.live()).toMatchObject({ framebuffers: 0, renderbuffers: 0, buffers: 0 });
  });

  it("ignores a GL error that the game raised before the first readback", () => {
    const mock = new WebGL2Mock();
    mock.raiseError();
    const reader = new PathEReader<number>(mock.gl);
    expect(reader.kick(1)).toBe("ok");
  });

  it("never throws into the game frame when the context throws", () => {
    const mock = new WebGL2Mock();
    const before = gameBindings(mock);
    const reader = new PathEReader<number>(mock.gl);
    (mock as unknown as { blitFramebuffer: () => void }).blitFramebuffer = () => {
      throw new TypeError("broken driver");
    };
    expect(reader.kick(1)).toBe("failed");
    expect(mock.snapshot()).toEqual(before);
    expect(reader.state).toBe("failed");
  });

  it("stops and hands back tags when polling throws", () => {
    const mock = new WebGL2Mock();
    const reader = new PathEReader<number>(mock.gl);
    reader.kick(1);
    (mock as unknown as { clientWaitSync: () => number }).clientWaitSync = () => {
      throw new TypeError("broken driver");
    };
    const polled = reader.poll();
    expect(polled.dropped).toEqual([1]);
    expect(reader.state).toBe("failed");
  });

  it("stops as failed when the context cannot make a pixel buffer", () => {
    const mock = new WebGL2Mock();
    (mock as unknown as { createBuffer: () => null }).createBuffer = () => null;
    const reader = new PathEReader<number>(mock.gl);
    expect(reader.kick(1)).toBe("failed");
    expect(reader.state).toBe("failed");
    expect(reader.canKick()).toBe(false);
  });

  it("treats a context with no drawing buffer size as empty", () => {
    const gl = { isContextLost: () => false } as unknown as WebGL2RenderingContext;
    expect(new PathEReader<number>(gl).kick(1)).toBe("empty");
  });

  it("returns empty for a drawing buffer under 2x2", () => {
    const mock = new WebGL2Mock({ width: 0, height: 0 });
    const reader = new PathEReader<number>(mock.gl);
    expect(reader.kick(1)).toBe("empty");
    expect(mock.created.buffers).toBe(0);
  });

  it("dispose frees every GL object and returns in-flight tags", () => {
    const mock = new WebGL2Mock();
    const reader = new PathEReader<number>(mock.gl);
    reader.kick(1);
    reader.kick(2);
    mock.nextFrame();
    reader.poll();
    reader.kick(3);
    expect(reader.dispose()).toEqual([3]);
    expect(mock.live()).toEqual({ framebuffers: 0, renderbuffers: 0, buffers: 0, syncs: 0 });
    expect(reader.state).toBe("disposed");
    expect(reader.kick(4)).toBe("failed");
  });
});
