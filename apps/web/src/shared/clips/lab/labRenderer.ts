/**
 * Draws the lab picture (plan 15.1 lab pattern).
 *
 * - A flash frame is fully white, edge to edge.
 * - Any other frame is dark, with a light bar that moves one step per frame
 *   (so each frame differs, as in a game) and, on the 2D canvas, the beat
 *   number.
 * The 2D renderer uses a CanvasRenderingContext2D (capture path P). The
 * WebGL2 renderer clears the default framebuffer each frame with a scissor
 * for the bar (capture path E reads the frame after the draw). Both draw
 * every frame, as a game does.
 */

/** Backing size of the lab canvas (16:9, the "wide" preset). */
export const LAB_CANVAS_WIDTH = 640;
export const LAB_CANVAS_HEIGHT = 360;

export const LAB_COLORS = Object.freeze({
  /** The normal picture: a dark slate. */
  background: [0x14, 0x20, 0x2b] as const,
  /** The moving bar. */
  bar: [0x5a, 0x6b, 0x7a] as const,
  flash: [0xff, 0xff, 0xff] as const,
});

const BAR_WIDTH = 24;
const BAR_STEP = 8;

export interface LabFrame {
  flash: boolean;
  /** Frames drawn so far (moves the bar). */
  frame: number;
  /** The newest beat number, or -1 before the first beat. */
  beat: number;
}

export interface LabRenderer {
  readonly kind: "2d" | "webgl2";
  draw(frame: LabFrame): void;
}

function css([r, g, b]: readonly [number, number, number]): string {
  return `rgb(${r}, ${g}, ${b})`;
}

/** The left edge of the moving bar in frame n. */
export function barX(frame: number, width = LAB_CANVAS_WIDTH): number {
  const travel = width - BAR_WIDTH;
  return ((frame * BAR_STEP) % travel + travel) % travel;
}

/** The 2D renderer (path P). */
export function create2dRenderer(ctx: CanvasRenderingContext2D): LabRenderer {
  const { width, height } = ctx.canvas;
  return {
    kind: "2d",
    draw({ flash, frame, beat }) {
      if (flash) {
        ctx.fillStyle = css(LAB_COLORS.flash);
        ctx.fillRect(0, 0, width, height);
        return;
      }
      ctx.fillStyle = css(LAB_COLORS.background);
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = css(LAB_COLORS.bar);
      ctx.fillRect(barX(frame, width), 0, BAR_WIDTH, height);
      ctx.font = "bold 28px sans-serif";
      ctx.fillText(beat < 0 ? "ready" : `beat ${beat + 1}`, 16, 44);
    },
  };
}

/** The WebGL2 calls the renderer uses. */
export type LabGl = Pick<
  WebGL2RenderingContext,
  "clearColor" | "clear" | "enable" | "disable" | "scissor" | "viewport" | "bindFramebuffer" | "COLOR_BUFFER_BIT" | "SCISSOR_TEST" | "FRAMEBUFFER" | "drawingBufferWidth" | "drawingBufferHeight"
>;

/** The WebGL2 renderer (path E). */
export function createGlRenderer(gl: LabGl): LabRenderer {
  const unit = (value: number) => value / 255;
  return {
    kind: "webgl2",
    draw({ flash, frame }) {
      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.SCISSOR_TEST);
      const [r, g, b] = flash ? LAB_COLORS.flash : LAB_COLORS.background;
      gl.clearColor(unit(r), unit(g), unit(b), 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (flash) return;
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(barX(frame, width), 0, BAR_WIDTH, height);
      const [br, bg, bb] = LAB_COLORS.bar;
      gl.clearColor(unit(br), unit(bg), unit(bb), 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.SCISSOR_TEST);
    },
  };
}

/**
 * Makes the renderer for `canvas`. The lab makes the context itself, before
 * it registers the canvas, so the capture source sees the context type.
 * Null when the browser cannot make the context.
 */
export function createLabRenderer(canvas: HTMLCanvasElement, kind: "2d" | "webgl2"): LabRenderer | null {
  if (kind === "webgl2") {
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, preserveDrawingBuffer: false });
    return gl ? createGlRenderer(gl) : null;
  }
  const ctx = canvas.getContext("2d", { alpha: false });
  return ctx ? create2dRenderer(ctx) : null;
}
