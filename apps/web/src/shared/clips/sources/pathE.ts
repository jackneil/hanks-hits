/**
 * Path E: asynchronous GPU readback on the game's own WebGL2 context (plan 3a).
 *
 * Call kick() right after the game rendered, in the same task (a rAF post
 * hook, or R3F addAfterEffect). It only queues GPU work and never waits:
 *
 *   1. resolve blit of the drawing buffer into a same-size RGBA8 (or RGB8)
 *      renderbuffer (needed when the default framebuffer is multisampled;
 *      a scaled blit from a multisampled buffer is illegal)
 *   2. scale-and-flip blit to a small renderbuffer (640 wide, even height)
 *   3. readPixels into one of 4 PIXEL_PACK_BUFFER slots
 *   4. fenceSync
 *
 * Call poll() every frame. It checks each fence with clientWaitSync(sync, 0, 0)
 * and, when the fence signaled, copies the pixels out with getBufferSubData
 * into a new ArrayBuffer (rows top-down, RGBA). On the iPhone SE the fence was
 * always signaled one frame later, and the main-thread cost was 0-1 ms.
 *
 * Every binding and state that path E touches is saved and restored:
 * READ and DRAW framebuffer, renderbuffer, PIXEL_PACK_BUFFER, SCISSOR_TEST,
 * RASTERIZER_DISCARD and the PACK_* pixel store values. three.js caches GL
 * state and renders wrong frames when a binding changes under it.
 *
 * A canvas resize recreates the targets at the next kick. Readbacks that are
 * in flight finish at their old size. Context loss stops the reader: it
 * returns the pending tags, so the caller can abandon their tickets.
 *
 * Call canKick() before you take a capture ticket: it is false when all slots
 * are in flight, when the drawing buffer is empty, or when the reader
 * stopped. Then no ticket is taken for a frame that cannot be read.
 *
 * Each readback reports latencyFrames: the number of poll() calls from its
 * kick until its fence signaled. Poll once per frame, and it is the GPU
 * delay in frames (the governor watches it).
 */

export type KickResult =
  /** The readback is queued. */
  | "ok"
  /** All slots are in flight. The frame is dropped. */
  | "busy"
  /** The drawing buffer has no pixels (size under 2x2). Try again later. */
  | "empty"
  /** The context is lost. The reader is stopped. */
  | "lost"
  /** The first readback raised a GL error. The reader is stopped. */
  | "failed";

export interface PathEReadback<T> {
  tag: T;
  /** RGBA bytes, rows top-down, width * height * 4 bytes. */
  data: ArrayBuffer;
  width: number;
  height: number;
  /** poll() calls from the kick until the fence signaled (1 = the next frame). */
  latencyFrames: number;
}

export interface PathEPoll<T> {
  ready: PathEReadback<T>[];
  /** Tags whose readback cannot complete (context loss, a failed fence). */
  dropped: T[];
}

export interface PathEOptions {
  /** Width of the readback picture. Default 640. Never wider than the source. */
  targetWidth?: number;
  /** Pixel-buffer slots. Default 4. */
  slots?: number;
}

interface Slot<T> {
  buffer: WebGLBuffer;
  width: number;
  height: number;
  sync: WebGLSync | null;
  tag: T | undefined;
  seq: number;
  readWidth: number;
  readHeight: number;
  /** The poll count at the kick. */
  kickPoll: number;
}

interface Targets {
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
  msaa: boolean;
  fullFb: WebGLFramebuffer | null;
  fullRb: WebGLRenderbuffer | null;
  smallFb: WebGLFramebuffer;
  smallRb: WebGLRenderbuffer;
}

interface SavedState {
  read: WebGLFramebuffer | null;
  draw: WebGLFramebuffer | null;
  renderbuffer: WebGLRenderbuffer | null;
  pack: WebGLBuffer | null;
  scissor: boolean;
  discard: boolean;
  alignment: number;
  rowLength: number;
  skipRows: number;
  skipPixels: number;
}

/** Readback size for a source: at most targetWidth wide, both sides even. */
export function readbackSize(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth = 640,
): { width: number; height: number } {
  const evenSource = sourceWidth - (sourceWidth % 2);
  const width = Math.max(2, Math.min(targetWidth - (targetWidth % 2), evenSource));
  const height = Math.max(2, Math.round((width * sourceHeight) / sourceWidth / 2) * 2);
  return { width, height };
}

export class PathEReader<T> {
  private readonly gl: WebGL2RenderingContext;
  private targetWidth: number;
  private readonly slotCount: number;
  private slots: Slot<T>[] = [];
  private targets: Targets | null = null;
  private seq = 0;
  private polls = 0;
  private validated = false;
  private stopped: "lost" | "failed" | "disposed" | null = null;

  constructor(gl: WebGL2RenderingContext, options: PathEOptions = {}) {
    this.gl = gl;
    this.targetWidth = options.targetWidth ?? 640;
    this.slotCount = options.slots ?? 4;
  }

  /** "lost", "failed" or "disposed" once the reader stopped; otherwise null. */
  get state(): "lost" | "failed" | "disposed" | null {
    return this.stopped;
  }

  /** Readbacks in flight. */
  get pending(): number {
    return this.slots.filter((s) => s.sync !== null).length;
  }

  /** True when all slots are in flight (a kick now would return "busy"). */
  get busy(): boolean {
    return this.slots.length > 0 && this.slots.every((s) => s.sync !== null);
  }

  /**
   * True when a kick now can queue a readback: the reader runs, a slot is
   * free and the drawing buffer has pixels. Never throws.
   */
  canKick(): boolean {
    if (this.stopped) return false;
    try {
      const gl = this.gl;
      if (gl.isContextLost()) return false;
      if (!(gl.drawingBufferWidth >= 2 && gl.drawingBufferHeight >= 2)) return false;
    } catch {
      return false;
    }
    return !this.busy;
  }

  /** Current readback size, or null before the first kick. */
  get size(): { width: number; height: number } | null {
    return this.targets ? { width: this.targets.width, height: this.targets.height } : null;
  }

  /** Change the readback width (a governor content step). Applies at the next kick. */
  setTargetWidth(width: number): void {
    if (width === this.targetWidth) return;
    this.targetWidth = width;
    this.dropTargets();
  }

  /** Queue a readback of the drawing buffer as it is now. Never waits and never throws. */
  kick(tag: T): KickResult {
    let saved: SavedState | null = null;
    try {
      const result = this.kickUnsafe(tag, (s) => (saved = s));
      this.safeRestore(saved);
      return result;
    } catch {
      // A context that throws is not usable for capture. The error must never
      // reach the game's frame.
      this.safeRestore(saved);
      this.stopped = "failed";
      this.releaseGl();
      return "failed";
    }
  }

  private kickUnsafe(tag: T, onSaved: (s: SavedState) => void): KickResult {
    const gl = this.gl;
    if (this.stopped === "lost" || gl.isContextLost()) {
      this.stopped = "lost";
      return "lost";
    }
    if (this.stopped) return "failed";
    const sw = gl.drawingBufferWidth;
    const sh = gl.drawingBufferHeight;
    if (!(sw >= 2 && sh >= 2)) return "empty";
    if (this.slots.length === 0) {
      this.createSlots();
      // A context that cannot make a pixel buffer cannot read back at all.
      if (this.slots.length === 0) {
        this.stopped = "failed";
        return "failed";
      }
    }
    const slot = this.slots.find((s) => s.sync === null);
    if (!slot) return "busy";
    if (!this.validated) gl.getError(); // Clear an old error, so the check below is ours.

    onSaved(this.save());
    const t = this.ensureTargets(sw, sh);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 4);
    gl.pixelStorei(gl.PACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.PACK_SKIP_ROWS, 0);
    gl.pixelStorei(gl.PACK_SKIP_PIXELS, 0);
    if (t.msaa && t.fullFb) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.fullFb);
      gl.blitFramebuffer(0, 0, sw, sh, 0, 0, sw, sh, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.fullFb);
    } else {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    }
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.smallFb);
    // Destination y runs from height to 0: this flips the rows to top-down.
    gl.blitFramebuffer(0, 0, sw, sh, 0, t.height, t.width, 0, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.smallFb);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, slot.buffer);
    if (slot.width !== t.width || slot.height !== t.height) {
      gl.bufferData(gl.PIXEL_PACK_BUFFER, t.width * t.height * 4, gl.STREAM_READ);
      slot.width = t.width;
      slot.height = t.height;
    }
    gl.readPixels(0, 0, t.width, t.height, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!sync) {
      this.stopped = "lost";
      return "lost";
    }
    slot.sync = sync;
    slot.tag = tag;
    slot.seq = ++this.seq;
    slot.readWidth = t.width;
    slot.readHeight = t.height;
    slot.kickPoll = this.polls;
    if (!this.validated) {
      this.validated = true;
      const error = gl.getError();
      if (error !== gl.NO_ERROR) {
        slot.sync = null;
        slot.tag = undefined;
        gl.deleteSync(sync);
        this.stopped = "failed";
        this.releaseGl();
        return "failed";
      }
    }
    return "ok";
  }

  /** Collect the readbacks whose fence signaled, oldest first. Never waits. */
  poll(): PathEPoll<T> {
    const result: PathEPoll<T> = { ready: [], dropped: [] };
    this.polls++;
    if (this.stopped === "lost" || this.gl.isContextLost()) {
      result.dropped = this.takeAllTags();
      this.stopped = "lost";
      return result;
    }
    const gl = this.gl;
    const busy = this.slots.filter((s) => s.sync !== null).sort((a, b) => a.seq - b.seq);
    if (busy.length === 0) return result;
    let previousPack: WebGLBuffer | null = null;
    let touched = false;
    try {
      previousPack = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING) as WebGLBuffer | null;
      for (const slot of busy) {
        const status = gl.clientWaitSync(slot.sync as WebGLSync, 0, 0);
        if (status === gl.TIMEOUT_EXPIRED) break; // Fences signal in order.
        gl.deleteSync(slot.sync);
        slot.sync = null;
        const tag = slot.tag as T;
        slot.tag = undefined;
        if (status === gl.WAIT_FAILED) {
          result.dropped.push(tag);
          continue;
        }
        const bytes = new Uint8Array(slot.readWidth * slot.readHeight * 4);
        touched = true;
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, slot.buffer);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, bytes);
        result.ready.push({
          tag,
          data: bytes.buffer,
          width: slot.readWidth,
          height: slot.readHeight,
          latencyFrames: this.polls - slot.kickPoll,
        });
      }
      if (touched) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, previousPack);
    } catch {
      // A context that throws is not usable. Stop, and hand back what is left.
      result.dropped.push(...this.takeAllTags());
      this.stopped = "failed";
      this.releaseGl();
    }
    return result;
  }

  /** The canvas fired webglcontextlost. Returns the tags that will never complete. */
  markLost(): T[] {
    this.stopped = "lost";
    this.targets = null;
    const tags = this.takeAllTags();
    this.slots = [];
    return tags;
  }

  /** Free every GL object. Returns the tags of readbacks still in flight. */
  dispose(): T[] {
    const tags = this.slots
      .filter((s) => s.sync !== null)
      .sort((a, b) => a.seq - b.seq)
      .map((s) => s.tag as T);
    if (this.stopped !== "lost" && !this.gl.isContextLost()) this.releaseGl();
    this.slots = [];
    this.targets = null;
    if (this.stopped === null) this.stopped = "disposed";
    return tags;
  }

  // -------------------------------------------------------------------------

  private takeAllTags(): T[] {
    const tags: T[] = [];
    for (const slot of [...this.slots].sort((a, b) => a.seq - b.seq)) {
      if (slot.sync === null) continue;
      tags.push(slot.tag as T);
      slot.sync = null;
      slot.tag = undefined;
    }
    return tags;
  }

  private createSlots(): void {
    const gl = this.gl;
    for (let i = 0; i < this.slotCount; i++) {
      const buffer = gl.createBuffer();
      if (!buffer) continue;
      this.slots.push({ buffer, width: 0, height: 0, sync: null, tag: undefined, seq: 0, readWidth: 0, readHeight: 0, kickPoll: 0 });
    }
  }

  /** Create or recreate the render targets for the current source size. Bindings are saved by the caller. */
  private ensureTargets(sw: number, sh: number): Targets {
    const current = this.targets;
    if (current && current.sourceWidth === sw && current.sourceHeight === sh) return current;
    this.dropTargets();
    const gl = this.gl;
    const { width, height } = readbackSize(sw, sh, this.targetWidth);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    const samples = Number(gl.getParameter(gl.SAMPLES) ?? 0);
    const msaa = samples > 0;
    const alpha = gl.getContextAttributes()?.alpha !== false;
    const make = (format: number, w: number, h: number) => {
      const rb = gl.createRenderbuffer() as WebGLRenderbuffer;
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, format, w, h);
      const fb = gl.createFramebuffer() as WebGLFramebuffer;
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fb);
      gl.framebufferRenderbuffer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
      return { fb, rb };
    };
    // A resolve blit needs the same format as the default framebuffer.
    const full = msaa ? make(alpha ? gl.RGBA8 : gl.RGB8, sw, sh) : null;
    const small = make(gl.RGBA8, width, height);
    this.targets = {
      sourceWidth: sw,
      sourceHeight: sh,
      width,
      height,
      msaa,
      fullFb: full?.fb ?? null,
      fullRb: full?.rb ?? null,
      smallFb: small.fb,
      smallRb: small.rb,
    };
    return this.targets;
  }

  private dropTargets(): void {
    const t = this.targets;
    this.targets = null;
    if (!t || this.gl.isContextLost()) return;
    const gl = this.gl;
    if (t.fullFb) gl.deleteFramebuffer(t.fullFb);
    if (t.fullRb) gl.deleteRenderbuffer(t.fullRb);
    gl.deleteFramebuffer(t.smallFb);
    gl.deleteRenderbuffer(t.smallRb);
  }

  private releaseGl(): void {
    const gl = this.gl;
    try {
      this.dropTargets();
      for (const slot of this.slots) {
        if (slot.sync) gl.deleteSync(slot.sync);
        gl.deleteBuffer(slot.buffer);
      }
    } catch {
      // A broken context: the objects go away with it.
    }
  }

  private save(): SavedState {
    const gl = this.gl;
    return {
      read: gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
      draw: gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
      renderbuffer: gl.getParameter(gl.RENDERBUFFER_BINDING) as WebGLRenderbuffer | null,
      pack: gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING) as WebGLBuffer | null,
      scissor: gl.isEnabled(gl.SCISSOR_TEST),
      discard: gl.isEnabled(gl.RASTERIZER_DISCARD),
      alignment: gl.getParameter(gl.PACK_ALIGNMENT) as number,
      rowLength: gl.getParameter(gl.PACK_ROW_LENGTH) as number,
      skipRows: gl.getParameter(gl.PACK_SKIP_ROWS) as number,
      skipPixels: gl.getParameter(gl.PACK_SKIP_PIXELS) as number,
    };
  }

  private safeRestore(s: SavedState | null): void {
    if (!s) return;
    try {
      this.restore(s);
    } catch {
      // Nothing more can be done on a broken context.
    }
  }

  private restore(s: SavedState): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, s.read);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, s.draw);
    gl.bindRenderbuffer(gl.RENDERBUFFER, s.renderbuffer);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, s.pack);
    if (s.scissor) gl.enable(gl.SCISSOR_TEST);
    else gl.disable(gl.SCISSOR_TEST);
    if (s.discard) gl.enable(gl.RASTERIZER_DISCARD);
    else gl.disable(gl.RASTERIZER_DISCARD);
    gl.pixelStorei(gl.PACK_ALIGNMENT, s.alignment);
    gl.pixelStorei(gl.PACK_ROW_LENGTH, s.rowLength);
    gl.pixelStorei(gl.PACK_SKIP_ROWS, s.skipRows);
    gl.pixelStorei(gl.PACK_SKIP_PIXELS, s.skipPixels);
  }
}
