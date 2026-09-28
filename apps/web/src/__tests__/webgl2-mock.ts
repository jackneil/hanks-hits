/**
 * WebGL2 test double for the clips capture path E (async GPU readback).
 * Single copy: every test that needs a WebGL2 context with real binding
 * state, blits, pixel-buffer readback and fences imports it from here.
 *
 * It behaves like the real API where path E depends on it:
 * - Binding state is real: FRAMEBUFFER sets READ and DRAW, getParameter reads
 *   it back, and enable/disable/pixelStorei change it.
 * - Fences never signal in the task that created them (WebGL 2.0 spec 5.27).
 *   They signal after `signalAfterFrames` calls of nextFrame() (default 1:
 *   "one frame later", as measured on the iPhone in plan 3a).
 * - blitFramebuffer from a multisampled default framebuffer must keep the
 *   same size (a resolve); a scaled blit from it is INVALID_OPERATION.
 * - The scissor test and rasterizer discard clip or drop a blit. The mock
 *   records a violation when a blit runs with either one enabled.
 * - readPixels into a PIXEL_PACK_BUFFER records which picture (frame id) the
 *   buffer holds, the size, and whether rows were flipped.
 * - getBufferSubData before the fence signals is a pipeline stall on a real
 *   GPU. The mock records a violation.
 * - After loseContext(), calls do nothing and clientWaitSync returns
 *   WAIT_FAILED, like a lost context. restoreContext() gives a fresh context
 *   state (default bindings), like webglcontextrestored.
 * - Compositing clears the drawing buffer (WebGL 1.0 spec, section 2.2):
 *   nextFrame() ends the frame, and without preserveDrawingBuffer the default
 *   framebuffer then holds picture 0 (black) until the game draws again. A
 *   read in a frame where the game did not draw is therefore black, as
 *   measured in Chrome 153 ([0,0,0,0]).
 *
 * Content model: the default framebuffer shows picture `frameId`. The game
 * draws picture n with drawFrame(n): it binds the default framebuffer, calls
 * clear and drawArrays THROUGH THE OBJECT (so wrappers on the prototype see
 * the draws, as they see three.js), then restores the game's binding. Any
 * clear or draw call while the default framebuffer is bound for drawing
 * writes `nextPicture`. A blit copies the id; a readback writes the id as a
 * little-endian Uint32 at byte 0 of the buffer data, then the width and the
 * height, then 1 when the rows were flipped.
 */

export const GL = {
  NO_ERROR: 0,
  INVALID_VALUE: 0x0501,
  INVALID_OPERATION: 0x0502,
  CONTEXT_LOST_WEBGL: 0x9242,
  SCISSOR_TEST: 0x0c11,
  RASTERIZER_DISCARD: 0x8c89,
  PACK_ALIGNMENT: 0x0d05,
  PACK_ROW_LENGTH: 0x0d02,
  PACK_SKIP_ROWS: 0x0d03,
  PACK_SKIP_PIXELS: 0x0d04,
  FRAMEBUFFER: 0x8d40,
  READ_FRAMEBUFFER: 0x8ca8,
  DRAW_FRAMEBUFFER: 0x8ca9,
  FRAMEBUFFER_BINDING: 0x8ca6,
  DRAW_FRAMEBUFFER_BINDING: 0x8ca6,
  READ_FRAMEBUFFER_BINDING: 0x8caa,
  RENDERBUFFER: 0x8d41,
  RENDERBUFFER_BINDING: 0x8ca7,
  PIXEL_PACK_BUFFER: 0x88eb,
  PIXEL_PACK_BUFFER_BINDING: 0x88ed,
  COPY_READ_BUFFER: 0x8f36,
  COLOR_ATTACHMENT0: 0x8ce0,
  COLOR_BUFFER_BIT: 0x4000,
  NEAREST: 0x2600,
  LINEAR: 0x2601,
  RGBA: 0x1908,
  RGBA8: 0x8058,
  RGB8: 0x8051,
  UNSIGNED_BYTE: 0x1401,
  STREAM_READ: 0x88e1,
  SAMPLES: 0x80a9,
  FRAMEBUFFER_COMPLETE: 0x8cd5,
  SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
  ALREADY_SIGNALED: 0x911a,
  TIMEOUT_EXPIRED: 0x911b,
  CONDITION_SATISFIED: 0x911c,
  WAIT_FAILED: 0x911d,
} as const;

interface MockRenderbuffer {
  kind: "renderbuffer";
  id: number;
  deleted: boolean;
  format: number;
  width: number;
  height: number;
  content: number;
  /** Rows are bottom-up relative to the default framebuffer. */
  flipped: boolean;
}
interface MockFramebuffer {
  kind: "framebuffer";
  id: number;
  deleted: boolean;
  color: MockRenderbuffer | null;
}
interface MockBuffer {
  kind: "buffer";
  id: number;
  deleted: boolean;
  size: number;
  /** Readback record. */
  frameId: number;
  width: number;
  height: number;
  flipped: boolean;
  /** The fence that follows the last readPixels into this buffer. */
  fence: MockSync | null;
}
interface MockSync {
  kind: "sync";
  id: number;
  deleted: boolean;
  createdFrame: number;
}

export interface WebGL2MockOptions {
  width?: number;
  height?: number;
  /** The canvas object that gl.canvas returns. Its size is the drawing buffer size. */
  canvas?: { width: number; height: number };
  alpha?: boolean;
  antialias?: boolean;
  /** Keep the drawing buffer after compositing. Default false, as in three.js. */
  preserveDrawingBuffer?: boolean;
  /** Samples of the default framebuffer. Default: 4 when antialias, else 0. */
  samples?: number;
  /** Frames until a fence signals. Default 1. */
  signalAfterFrames?: number;
}

export interface BindingSnapshot {
  readFb: unknown;
  drawFb: unknown;
  renderbuffer: unknown;
  packBuffer: unknown;
  scissor: boolean;
  discard: boolean;
  packAlignment: number;
  packRowLength: number;
  packSkipRows: number;
  packSkipPixels: number;
}

export class WebGL2Mock {
  readonly canvas: { width: number; height: number };
  /** Every call, in order: [name, ...args]. */
  readonly calls: unknown[][] = [];
  /** Things a real GPU would get wrong or stall on. Tests assert it stays empty. */
  readonly violations: string[] = [];
  /** Picture id currently in the default framebuffer. 0 is the cleared (black) buffer. */
  frameId = 0;
  /** The picture that the next clear or draw on the default framebuffer writes. */
  nextPicture = 0;
  /** Frames ended with nextFrame(). */
  private frame = 0;
  private lost = false;
  private error: number = GL.NO_ERROR;
  private nextId = 1;
  private readonly attrs: { alpha: boolean; antialias: boolean; preserveDrawingBuffer: boolean };
  private readonly samples: number;
  signalAfterFrames: number;

  // Binding state.
  readFb: MockFramebuffer | null = null;
  drawFb: MockFramebuffer | null = null;
  renderbuffer: MockRenderbuffer | null = null;
  packBuffer: MockBuffer | null = null;
  copyReadBuffer: MockBuffer | null = null;
  scissor = false;
  discard = false;
  packAlignment = 4;
  packRowLength = 0;
  packSkipRows = 0;
  packSkipPixels = 0;

  readonly created = { framebuffers: 0, renderbuffers: 0, buffers: 0, syncs: 0 };
  readonly deletedCount = { framebuffers: 0, renderbuffers: 0, buffers: 0, syncs: 0 };

  constructor(options: WebGL2MockOptions = {}) {
    const width = options.width ?? options.canvas?.width ?? 1334;
    const height = options.height ?? options.canvas?.height ?? 622;
    this.canvas = options.canvas ?? { width, height };
    this.canvas.width = width;
    this.canvas.height = height;
    this.attrs = {
      alpha: options.alpha ?? true,
      antialias: options.antialias ?? true,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    };
    this.samples = options.samples ?? (this.attrs.antialias ? 4 : 0);
    this.signalAfterFrames = options.signalAfterFrames ?? 1;
    Object.assign(this, GL);
  }

  /** The drawing buffer follows the canvas size, as in a browser. */
  get drawingBufferWidth(): number {
    return this.canvas.width;
  }
  get drawingBufferHeight(): number {
    return this.canvas.height;
  }

  /** The mock as the real type, for code under test. */
  get gl(): WebGL2RenderingContext {
    return this as unknown as WebGL2RenderingContext;
  }

  // ---- test controls -------------------------------------------------------

  /**
   * The game renders picture `id` into the default framebuffer, with real
   * calls: bind the default framebuffer, clear, draw, then put the game's
   * draw binding back.
   */
  drawFrame(id: number): void {
    const saved = this.drawFb;
    this.nextPicture = id;
    this.bindFramebuffer(GL.DRAW_FRAMEBUFFER, null);
    this.clear(GL.COLOR_BUFFER_BIT);
    this.drawArrays(4, 0, 3);
    this.bindFramebuffer(GL.DRAW_FRAMEBUFFER, saved as unknown as WebGLFramebuffer | null);
  }
  /**
   * End the frame: return to the event loop and composite. One frame passes
   * for fences. Without preserveDrawingBuffer the drawing buffer is cleared.
   */
  nextFrame(): void {
    this.frame++;
    if (!this.attrs.preserveDrawingBuffer) this.frameId = 0;
  }
  /** Resize the canvas and the drawing buffer (the game changed canvas.width). */
  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }
  /** The game caused a GL error that nobody read yet. */
  raiseError(code: number = GL.INVALID_OPERATION): void {
    if (this.error === GL.NO_ERROR) this.error = code;
  }
  loseContext(): void {
    this.lost = true;
    this.error = GL.CONTEXT_LOST_WEBGL;
  }
  /** The context came back (webglcontextrestored): default state, a black buffer. */
  restoreContext(): void {
    this.lost = false;
    this.error = GL.NO_ERROR;
    this.frameId = 0;
    this.readFb = null;
    this.drawFb = null;
    this.renderbuffer = null;
    this.packBuffer = null;
    this.copyReadBuffer = null;
    this.scissor = false;
    this.discard = false;
    this.packAlignment = 4;
    this.packRowLength = 0;
    this.packSkipRows = 0;
    this.packSkipPixels = 0;
  }
  snapshot(): BindingSnapshot {
    return {
      readFb: this.readFb,
      drawFb: this.drawFb,
      renderbuffer: this.renderbuffer,
      packBuffer: this.packBuffer,
      scissor: this.scissor,
      discard: this.discard,
      packAlignment: this.packAlignment,
      packRowLength: this.packRowLength,
      packSkipRows: this.packSkipRows,
      packSkipPixels: this.packSkipPixels,
    };
  }
  /** Objects created and not deleted. */
  live(): { framebuffers: number; renderbuffers: number; buffers: number; syncs: number } {
    return {
      framebuffers: this.created.framebuffers - this.deletedCount.framebuffers,
      renderbuffers: this.created.renderbuffers - this.deletedCount.renderbuffers,
      buffers: this.created.buffers - this.deletedCount.buffers,
      syncs: this.created.syncs - this.deletedCount.syncs,
    };
  }
  /** Set a game-side binding state, as three.js would leave it. */
  gameState(state: Partial<BindingSnapshot>): void {
    Object.assign(this, state);
  }

  // ---- WebGL2 API subset ---------------------------------------------------

  /** The next call of this method raises INVALID_OPERATION (a driver error). */
  failOn: string | null = null;

  private log(name: string, ...args: unknown[]): boolean {
    this.calls.push([name, ...args]);
    if (this.failOn === name) {
      this.failOn = null;
      if (this.error === GL.NO_ERROR) this.error = GL.INVALID_OPERATION;
    }
    return !this.lost;
  }
  private fail(code: number, why: string): void {
    if (this.error === GL.NO_ERROR) this.error = code;
    this.violations.push(why);
  }

  isContextLost(): boolean {
    return this.lost;
  }
  getContextAttributes(): WebGLContextAttributes | null {
    if (this.lost) return null;
    return { ...this.attrs };
  }
  getError(): number {
    this.calls.push(["getError"]);
    const e = this.error;
    this.error = GL.NO_ERROR;
    return e;
  }

  // Draw calls. Only the default framebuffer changes the picture; a draw
  // into a framebuffer object is off screen.
  private drawCall(name: string, args: unknown[]): void {
    if (!this.log(name, ...args)) return;
    if (this.drawFb === null) this.frameId = this.nextPicture;
  }
  clear(mask: number): void {
    this.drawCall("clear", [mask]);
  }
  drawArrays(mode: number, first: number, count: number): void {
    this.drawCall("drawArrays", [mode, first, count]);
  }
  drawElements(mode: number, count: number, type: number, offset: number): void {
    this.drawCall("drawElements", [mode, count, type, offset]);
  }
  drawArraysInstanced(mode: number, first: number, count: number, instances: number): void {
    this.drawCall("drawArraysInstanced", [mode, first, count, instances]);
  }
  drawElementsInstanced(mode: number, count: number, type: number, offset: number, instances: number): void {
    this.drawCall("drawElementsInstanced", [mode, count, type, offset, instances]);
  }
  drawRangeElements(mode: number, start: number, end: number, count: number, type: number, offset: number): void {
    this.drawCall("drawRangeElements", [mode, start, end, count, type, offset]);
  }
  getExtension(name: string): unknown {
    this.log("getExtension", name);
    if (name === "WEBGL_multi_draw") {
      const draw = () => {
        if (!this.lost && this.drawFb === null) this.frameId = this.nextPicture;
      };
      this.multiDraw ??= { multiDrawArraysWEBGL: draw, multiDrawElementsWEBGL: draw };
      return this.multiDraw;
    }
    return null;
  }
  private multiDraw: { multiDrawArraysWEBGL: () => void; multiDrawElementsWEBGL: () => void } | undefined;

  getParameter(pname: number): unknown {
    if (!this.log("getParameter", pname)) return null;
    switch (pname) {
      case GL.READ_FRAMEBUFFER_BINDING:
        return this.readFb;
      case GL.DRAW_FRAMEBUFFER_BINDING:
        return this.drawFb;
      case GL.RENDERBUFFER_BINDING:
        return this.renderbuffer;
      case GL.PIXEL_PACK_BUFFER_BINDING:
        return this.packBuffer;
      case GL.PACK_ALIGNMENT:
        return this.packAlignment;
      case GL.PACK_ROW_LENGTH:
        return this.packRowLength;
      case GL.PACK_SKIP_ROWS:
        return this.packSkipRows;
      case GL.PACK_SKIP_PIXELS:
        return this.packSkipPixels;
      case GL.SAMPLES:
        return this.drawFb === null ? this.samples : 0;
      default:
        return null;
    }
  }
  isEnabled(cap: number): boolean {
    if (!this.log("isEnabled", cap)) return false;
    if (cap === GL.SCISSOR_TEST) return this.scissor;
    if (cap === GL.RASTERIZER_DISCARD) return this.discard;
    return false;
  }
  enable(cap: number): void {
    if (!this.log("enable", cap)) return;
    if (cap === GL.SCISSOR_TEST) this.scissor = true;
    if (cap === GL.RASTERIZER_DISCARD) this.discard = true;
  }
  disable(cap: number): void {
    if (!this.log("disable", cap)) return;
    if (cap === GL.SCISSOR_TEST) this.scissor = false;
    if (cap === GL.RASTERIZER_DISCARD) this.discard = false;
  }
  pixelStorei(pname: number, value: number): void {
    if (!this.log("pixelStorei", pname, value)) return;
    if (pname === GL.PACK_ALIGNMENT) this.packAlignment = value;
    if (pname === GL.PACK_ROW_LENGTH) this.packRowLength = value;
    if (pname === GL.PACK_SKIP_ROWS) this.packSkipRows = value;
    if (pname === GL.PACK_SKIP_PIXELS) this.packSkipPixels = value;
  }

  createFramebuffer(): WebGLFramebuffer | null {
    if (!this.log("createFramebuffer")) return null;
    this.created.framebuffers++;
    const fb: MockFramebuffer = { kind: "framebuffer", id: this.nextId++, deleted: false, color: null };
    return fb as unknown as WebGLFramebuffer;
  }
  createRenderbuffer(): WebGLRenderbuffer | null {
    if (!this.log("createRenderbuffer")) return null;
    this.created.renderbuffers++;
    const rb: MockRenderbuffer = {
      kind: "renderbuffer",
      id: this.nextId++,
      deleted: false,
      format: 0,
      width: 0,
      height: 0,
      content: -1,
      flipped: false,
    };
    return rb as unknown as WebGLRenderbuffer;
  }
  createBuffer(): WebGLBuffer | null {
    if (!this.log("createBuffer")) return null;
    this.created.buffers++;
    const b: MockBuffer = {
      kind: "buffer",
      id: this.nextId++,
      deleted: false,
      size: 0,
      frameId: -1,
      width: 0,
      height: 0,
      flipped: false,
      fence: null,
    };
    return b as unknown as WebGLBuffer;
  }
  deleteFramebuffer(fb: WebGLFramebuffer | null): void {
    const f = fb as unknown as MockFramebuffer | null;
    if (!this.log("deleteFramebuffer", f?.id) || !f || f.deleted) return;
    f.deleted = true;
    this.deletedCount.framebuffers++;
    if (this.readFb === f) this.readFb = null;
    if (this.drawFb === f) this.drawFb = null;
  }
  deleteRenderbuffer(rb: WebGLRenderbuffer | null): void {
    const r = rb as unknown as MockRenderbuffer | null;
    if (!this.log("deleteRenderbuffer", r?.id) || !r || r.deleted) return;
    r.deleted = true;
    this.deletedCount.renderbuffers++;
    if (this.renderbuffer === r) this.renderbuffer = null;
  }
  deleteBuffer(buffer: WebGLBuffer | null): void {
    const b = buffer as unknown as MockBuffer | null;
    if (!this.log("deleteBuffer", b?.id) || !b || b.deleted) return;
    b.deleted = true;
    this.deletedCount.buffers++;
    if (this.packBuffer === b) this.packBuffer = null;
  }

  bindFramebuffer(target: number, fb: WebGLFramebuffer | null): void {
    const f = fb as unknown as MockFramebuffer | null;
    if (!this.log("bindFramebuffer", target, f?.id ?? null)) return;
    if (f?.deleted) return this.fail(GL.INVALID_OPERATION, "bind of a deleted framebuffer");
    if (target === GL.FRAMEBUFFER || target === GL.READ_FRAMEBUFFER) this.readFb = f;
    if (target === GL.FRAMEBUFFER || target === GL.DRAW_FRAMEBUFFER) this.drawFb = f;
  }
  bindRenderbuffer(_target: number, rb: WebGLRenderbuffer | null): void {
    const r = rb as unknown as MockRenderbuffer | null;
    if (!this.log("bindRenderbuffer", r?.id ?? null)) return;
    this.renderbuffer = r;
  }
  bindBuffer(target: number, buffer: WebGLBuffer | null): void {
    const b = buffer as unknown as MockBuffer | null;
    if (!this.log("bindBuffer", target, b?.id ?? null)) return;
    if (b?.deleted) return this.fail(GL.INVALID_OPERATION, "bind of a deleted buffer");
    if (target === GL.PIXEL_PACK_BUFFER) this.packBuffer = b;
    if (target === GL.COPY_READ_BUFFER) this.copyReadBuffer = b;
  }
  renderbufferStorage(_target: number, format: number, width: number, height: number): void {
    if (!this.log("renderbufferStorage", format, width, height)) return;
    const r = this.renderbuffer;
    if (!r) return this.fail(GL.INVALID_OPERATION, "renderbufferStorage with no renderbuffer");
    r.format = format;
    r.width = width;
    r.height = height;
  }
  framebufferRenderbuffer(target: number, _attachment: number, _rbTarget: number, rb: WebGLRenderbuffer | null): void {
    const r = rb as unknown as MockRenderbuffer | null;
    if (!this.log("framebufferRenderbuffer", target, r?.id ?? null)) return;
    const fb = target === GL.READ_FRAMEBUFFER ? this.readFb : this.drawFb;
    if (!fb) return this.fail(GL.INVALID_OPERATION, "attach to the default framebuffer");
    fb.color = r;
  }
  checkFramebufferStatus(): number {
    this.log("checkFramebufferStatus");
    return GL.FRAMEBUFFER_COMPLETE;
  }
  bufferData(target: number, size: number, usage: number): void {
    if (!this.log("bufferData", target, size, usage)) return;
    const b = target === GL.PIXEL_PACK_BUFFER ? this.packBuffer : this.copyReadBuffer;
    if (!b) return this.fail(GL.INVALID_OPERATION, "bufferData with no buffer");
    b.size = size;
    b.frameId = -1;
    b.fence = null;
  }

  blitFramebuffer(
    sx0: number,
    sy0: number,
    sx1: number,
    sy1: number,
    dx0: number,
    dy0: number,
    dx1: number,
    dy1: number,
    mask: number,
    filter: number,
  ): void {
    if (!this.log("blitFramebuffer", sx0, sy0, sx1, sy1, dx0, dy0, dx1, dy1, mask, filter)) return;
    if (this.scissor) this.violations.push("blit with SCISSOR_TEST enabled (clipped)");
    if (this.discard) this.violations.push("blit with RASTERIZER_DISCARD enabled (dropped)");
    const src = this.readFb;
    const dst = this.drawFb;
    if (!dst || !dst.color) return this.fail(GL.INVALID_OPERATION, "blit to the default framebuffer");
    const srcW = Math.abs(sx1 - sx0);
    const srcH = Math.abs(sy1 - sy0);
    const dstW = Math.abs(dx1 - dx0);
    const dstH = Math.abs(dy1 - dy0);
    let content: number;
    let srcFlipped = false;
    if (src === null) {
      if (srcW > this.drawingBufferWidth || srcH > this.drawingBufferHeight) {
        return this.fail(GL.INVALID_OPERATION, "blit source rectangle outside the drawing buffer");
      }
      if (this.samples > 0 && (srcW !== dstW || srcH !== dstH)) {
        return this.fail(GL.INVALID_OPERATION, "scaled blit from a multisampled framebuffer");
      }
      if (this.samples > 0 && dst.color.format !== (this.attrs.alpha ? GL.RGBA8 : GL.RGB8)) {
        return this.fail(GL.INVALID_OPERATION, "resolve blit into a different format");
      }
      content = this.frameId;
    } else {
      if (!src.color) return this.fail(GL.INVALID_OPERATION, "blit from an incomplete framebuffer");
      content = src.color.content;
      srcFlipped = src.color.flipped;
    }
    dst.color.content = content;
    dst.color.flipped = dy0 > dy1 !== srcFlipped;
  }

  readPixels(x: number, y: number, width: number, height: number, format: number, type: number, offset: number): void {
    if (!this.log("readPixels", x, y, width, height, format, type, offset)) return;
    const b = this.packBuffer;
    if (!b) {
      this.violations.push("readPixels with no PIXEL_PACK_BUFFER (a synchronous read)");
      return;
    }
    if (this.packRowLength !== 0 || this.packSkipPixels !== 0 || this.packSkipRows !== 0) {
      this.violations.push("readPixels with non-zero PACK_ROW_LENGTH or PACK_SKIP_*");
    }
    const need = width * height * 4;
    if (b.size < need) return this.fail(GL.INVALID_OPERATION, "readPixels into a buffer that is too small");
    const fb = this.readFb;
    if (!fb || !fb.color) return this.fail(GL.INVALID_OPERATION, "readPixels from the default framebuffer");
    b.frameId = fb.color.content;
    b.width = width;
    b.height = height;
    b.flipped = fb.color.flipped;
    b.fence = null;
    this.pendingReadback = b;
  }
  private pendingReadback: MockBuffer | null = null;

  fenceSync(condition: number, flags: number): WebGLSync | null {
    if (!this.log("fenceSync", condition, flags)) return null;
    this.created.syncs++;
    const sync: MockSync = { kind: "sync", id: this.nextId++, deleted: false, createdFrame: this.frame };
    if (this.pendingReadback) {
      this.pendingReadback.fence = sync;
      this.pendingReadback = null;
    }
    return sync as unknown as WebGLSync;
  }
  clientWaitSync(sync: WebGLSync, flags: number, timeout: number): number {
    const s = sync as unknown as MockSync;
    this.calls.push(["clientWaitSync", s.id, flags, timeout]);
    if (timeout !== 0) this.violations.push("clientWaitSync with a non-zero timeout (blocks the main thread)");
    if (this.lost || s.deleted) return GL.WAIT_FAILED;
    return this.frame - s.createdFrame >= this.signalAfterFrames ? GL.CONDITION_SATISFIED : GL.TIMEOUT_EXPIRED;
  }
  deleteSync(sync: WebGLSync | null): void {
    const s = sync as unknown as MockSync | null;
    if (!this.log("deleteSync", s?.id) || !s || s.deleted) return;
    s.deleted = true;
    this.deletedCount.syncs++;
  }
  getBufferSubData(target: number, srcByteOffset: number, dst: ArrayBufferView): void {
    if (!this.log("getBufferSubData", target, srcByteOffset, dst.byteLength)) return;
    const b = target === GL.PIXEL_PACK_BUFFER ? this.packBuffer : this.copyReadBuffer;
    if (!b) return this.fail(GL.INVALID_OPERATION, "getBufferSubData with no buffer");
    if (b.fence && this.frame - b.fence.createdFrame < this.signalAfterFrames) {
      this.violations.push("getBufferSubData before the fence signaled (GPU stall)");
    }
    if (dst.byteLength > b.size) return this.fail(GL.INVALID_VALUE, "getBufferSubData past the end");
    const view = new DataView(dst.buffer, dst.byteOffset, dst.byteLength);
    if (dst.byteLength >= 16) {
      view.setUint32(0, b.frameId >>> 0, true);
      view.setUint32(4, b.width, true);
      view.setUint32(8, b.height, true);
      view.setUint32(12, b.flipped ? 1 : 0, true);
    }
  }
}

/** Read the record that getBufferSubData wrote into a readback. */
export function readbackRecord(data: ArrayBuffer): { frameId: number; width: number; height: number; flipped: boolean } {
  const view = new DataView(data);
  return {
    frameId: view.getUint32(0, true),
    width: view.getUint32(4, true),
    height: view.getUint32(8, true),
    flipped: view.getUint32(12, true) === 1,
  };
}
