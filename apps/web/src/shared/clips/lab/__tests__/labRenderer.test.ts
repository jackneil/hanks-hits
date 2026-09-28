import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeContext2D, installCanvasContexts, type InstalledContexts } from "@/__tests__/canvas-mock";

import {
  LAB_CANVAS_HEIGHT,
  LAB_CANVAS_WIDTH,
  LAB_COLORS,
  barX,
  create2dRenderer,
  createGlRenderer,
  createLabRenderer,
  type LabGl,
} from "../labRenderer";

/** The shared 2D double, plus a log of each fill with its fill style. */
class Recording2D extends FakeContext2D {
  fillStyle = "";
  font = "";
  readonly fills: Array<{ style: string; rect: number[] }> = [];
  readonly texts: string[] = [];
  override fillRect(...args: number[]): void {
    this.fills.push({ style: this.fillStyle, rect: args });
    super.fillRect(...args);
  }
  override fillText(...args: unknown[]): void {
    this.texts.push(String(args[0]));
    super.fillText(...args);
  }
}

function canvas2d() {
  const canvas = { width: LAB_CANVAS_WIDTH, height: LAB_CANVAS_HEIGHT, content: 0 };
  const ctx = new Recording2D(canvas);
  return { ctx, renderer: create2dRenderer(ctx as unknown as CanvasRenderingContext2D) };
}

/**
 * A recorder for the WebGL2 calls the renderer uses. The shared WebGL2Mock
 * keeps the scissor TEST in a field named `scissor`, so it cannot also take
 * the gl.scissor(x, y, w, h) call; this recorder models the clear semantics
 * the renderer depends on: a clear fills the scissor box (or the whole
 * buffer) of the bound framebuffer with the clear color.
 */
class GlRecorder implements LabGl {
  readonly COLOR_BUFFER_BIT = 0x4000;
  readonly SCISSOR_TEST = 0x0c11;
  readonly FRAMEBUFFER = 0x8d40;
  readonly drawingBufferWidth = LAB_CANVAS_WIDTH;
  readonly drawingBufferHeight = LAB_CANVAS_HEIGHT;
  private color: number[] = [0, 0, 0, 0];
  private scissorOn = false;
  private box = [0, 0, 0, 0];
  private boundDefault = false;
  readonly clears: Array<{ color: number[]; box: number[] | null; defaultFb: boolean }> = [];
  readonly viewports: number[][] = [];
  bindFramebuffer(target: number, fb: WebGLFramebuffer | null): void {
    if (target === this.FRAMEBUFFER) this.boundDefault = fb === null;
  }
  viewport(x: number, y: number, w: number, h: number): void {
    this.viewports.push([x, y, w, h]);
  }
  enable(cap: number): void {
    if (cap === this.SCISSOR_TEST) this.scissorOn = true;
  }
  disable(cap: number): void {
    if (cap === this.SCISSOR_TEST) this.scissorOn = false;
  }
  scissor(x: number, y: number, w: number, h: number): void {
    this.box = [x, y, w, h];
  }
  clearColor(r: number, g: number, b: number, a: number): void {
    this.color = [r, g, b, a];
  }
  clear(mask: number): void {
    if (mask & this.COLOR_BUFFER_BIT) this.clears.push({ color: this.color, box: this.scissorOn ? this.box : null, defaultFb: this.boundDefault });
  }
}

const unit = (rgb: readonly number[]) => [...rgb.map((v) => v / 255), 1];

describe("barX", () => {
  it("moves one step per frame and stays inside the canvas", () => {
    expect(barX(0)).toBe(0);
    expect(barX(1)).toBe(8);
    for (let frame = -50; frame < 500; frame++) {
      const x = barX(frame);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x + 24).toBeLessThanOrEqual(LAB_CANVAS_WIDTH);
    }
    // Two frames in a row are never at the same place (each frame differs, as in a game).
    for (let frame = 0; frame < 200; frame++) expect(barX(frame + 1)).not.toBe(barX(frame));
  });
});

describe("the 2D renderer (path P)", () => {
  it("fills the whole frame white on a flash, and draws nothing else", () => {
    const { ctx, renderer } = canvas2d();
    renderer.draw({ flash: true, frame: 5, beat: 2 });
    expect(ctx.fills).toEqual([{ style: "rgb(255, 255, 255)", rect: [0, 0, LAB_CANVAS_WIDTH, LAB_CANVAS_HEIGHT] }]);
    expect(ctx.texts).toEqual([]);
  });

  it("draws the dark picture, the moving bar and the beat number on other frames", () => {
    const { ctx, renderer } = canvas2d();
    renderer.draw({ flash: false, frame: 3, beat: 4 });
    expect(ctx.fills[0]).toEqual({ style: `rgb(${LAB_COLORS.background.join(", ")})`, rect: [0, 0, LAB_CANVAS_WIDTH, LAB_CANVAS_HEIGHT] });
    expect(ctx.fills[1]).toEqual({ style: `rgb(${LAB_COLORS.bar.join(", ")})`, rect: [barX(3), 0, 24, LAB_CANVAS_HEIGHT] });
    expect(ctx.texts).toEqual(["beat 5"]);
    renderer.draw({ flash: false, frame: 0, beat: -1 });
    expect(ctx.texts[1]).toBe("ready");
  });

  it("keeps the normal picture much darker than the flash", () => {
    const luma = ([r, g, b]: readonly number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    expect(luma(LAB_COLORS.flash) - luma(LAB_COLORS.bar)).toBeGreaterThan(120);
    expect(luma(LAB_COLORS.flash) - luma(LAB_COLORS.background)).toBeGreaterThan(200);
  });
});

describe("the WebGL2 renderer (path E)", () => {
  it("clears the whole default framebuffer white on a flash, with the scissor test off", () => {
    const gl = new GlRecorder();
    createGlRenderer(gl).draw({ flash: true, frame: 7, beat: 0 });
    expect(gl.clears).toEqual([{ color: unit(LAB_COLORS.flash), box: null, defaultFb: true }]);
    expect(gl.viewports).toEqual([[0, 0, LAB_CANVAS_WIDTH, LAB_CANVAS_HEIGHT]]);
  });

  it("clears the dark picture and then the bar in its scissor box on other frames", () => {
    const gl = new GlRecorder();
    // A game-like state left over from the frame before: scissor on, another framebuffer bound.
    gl.enable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, {} as WebGLFramebuffer);
    createGlRenderer(gl).draw({ flash: false, frame: 9, beat: 0 });
    expect(gl.clears).toEqual([
      { color: unit(LAB_COLORS.background), box: null, defaultFb: true },
      { color: unit(LAB_COLORS.bar), box: [barX(9), 0, 24, LAB_CANVAS_HEIGHT], defaultFb: true },
    ]);
    // The scissor test is off again after the draw.
    gl.clear(gl.COLOR_BUFFER_BIT);
    expect(gl.clears[2].box).toBeNull();
  });
});

describe("createLabRenderer", () => {
  let contexts: InstalledContexts;
  beforeEach(() => {
    contexts = installCanvasContexts(window);
  });
  afterEach(() => {
    contexts.restore();
  });

  it("makes the context that the capture path needs", () => {
    const flat = document.createElement("canvas");
    expect(createLabRenderer(flat, "2d")?.kind).toBe("2d");
    expect((flat as unknown as { getContextCalls: string[] }).getContextCalls).toEqual(["2d"]);

    const gl = document.createElement("canvas");
    expect(createLabRenderer(gl, "webgl2")?.kind).toBe("webgl2");
    expect((gl as unknown as { getContextCalls: string[] }).getContextCalls).toEqual(["webgl2"]);
  });

  it("gives null when the browser cannot make the context", () => {
    const canvas = document.createElement("canvas");
    canvas.getContext("2d");
    expect(createLabRenderer(canvas, "webgl2")).toBeNull();
  });
});
