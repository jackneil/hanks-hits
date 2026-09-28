/**
 * Browser realm doubles for canvas capture tests (single copy).
 * The clips runtime and sources tests import them from here.
 *
 * - FakeRealm: a requestAnimationFrame realm. Native ids count up from 1,
 *   callbacks queued during a frame run in the next frame, and a frame runs
 *   every callback that was queued before it started. It has a document
 *   whose defaultView is the realm, and simulateNavigation() gives it a new
 *   document the way an iframe's WindowProxy gets one.
 * - CanvasRealm: a FakeRealm with its OWN canvas classes (HTMLCanvasElement,
 *   CanvasRenderingContext2D, WebGLRenderingContext, WebGL2RenderingContext),
 *   so each realm has its own prototypes, as in a browser. Code under test
 *   can wrap those prototypes.
 *   - getContext works like the real one: the first call CREATES a context of
 *     the asked type; a later call of another type returns null. Every call
 *     is logged on the canvas, so a test can prove that capture code never
 *     called it.
 *   - Draws go through the context objects, so prototype wrappers see them.
 *   - After each frame, every WebGL context composites. Without
 *     preserveDrawingBuffer the drawing buffer is then cleared (WebGL 1.0
 *     spec, section 2.2): a read after a frame with no draw gives picture 0,
 *     which is black.
 * - FakeVideoFrame: new VideoFrame(canvas) records the canvas picture. It
 *   throws like the real constructor for a tainted canvas (SecurityError)
 *   and for an empty one (InvalidStateError).
 * - installCanvasContexts(win): gives a jsdom window the same context classes
 *   and a real-semantics getContext (jsdom has no canvas contexts).
 *
 * Picture model: a canvas shows a picture number. 0 is the cleared picture.
 * 2D pictures stay until the game draws again; WebGL pictures stay only
 * until the frame composites (unless preserveDrawingBuffer is true).
 */
import { WebGL2Mock, type WebGL2MockOptions } from "./webgl2-mock";

// ---------------------------------------------------------------------------
// requestAnimationFrame realm
// ---------------------------------------------------------------------------

export class FakeRealm {
  private nextNativeId = 1;
  private queue = new Map<number, FrameRequestCallback>();
  readonly errors: unknown[] = [];
  /** Timestamps of the frames that ran. */
  readonly frames: number[] = [];
  /** The native functions, kept so tests can check that uninstall restores them. */
  nativeRaf: (cb: FrameRequestCallback) => number;
  nativeCaf: (id: number) => void;
  requestAnimationFrame: (cb: FrameRequestCallback) => number;
  cancelAnimationFrame: (id: number) => void;
  reportError = (error: unknown): void => {
    this.errors.push(error);
  };
  performance = { timeOrigin: 0, now: () => 0 };
  /** The realm's current document. Its defaultView is the realm while it is active. */
  document: { defaultView: unknown };

  constructor(timeOrigin = 0) {
    this.performance.timeOrigin = timeOrigin;
    this.document = { defaultView: this };
    this.nativeRaf = (cb) => {
      const id = this.nextNativeId++;
      this.queue.set(id, cb);
      return id;
    };
    this.nativeCaf = (id) => {
      this.queue.delete(id);
    };
    this.requestAnimationFrame = this.nativeRaf;
    this.cancelAnimationFrame = this.nativeCaf;
  }

  /** Number of native callbacks waiting for the next frame. */
  get pendingNative(): number {
    return this.queue.size;
  }

  /** Run one display frame at time t (ms). */
  frame(t: number): void {
    this.frames.push(t);
    const batch = this.queue;
    this.queue = new Map();
    for (const cb of batch.values()) cb(t);
  }

  /** Run frames at a fixed rate from t0, count frames. */
  run(t0: number, hz: number, count: number): number {
    const period = 1000 / hz;
    let t = t0;
    for (let i = 0; i < count; i++) {
      t = t0 + i * period;
      this.frame(t);
    }
    return t;
  }

  /**
   * The iframe loaded a new document, and this object is its WindowProxy.
   * The old document loses its window. The new window has fresh native rAF
   * functions and none of the old window's own symbol properties. Callbacks
   * queued in the old document never run.
   */
  simulateNavigation(): { oldDocument: { defaultView: unknown } } {
    const oldDocument = this.document;
    oldDocument.defaultView = null;
    this.document = { defaultView: this };
    for (const key of Object.getOwnPropertySymbols(this)) delete (this as unknown as Record<symbol, unknown>)[key];
    this.queue = new Map();
    this.nativeRaf = (cb) => {
      const id = this.nextNativeId++;
      this.queue.set(id, cb);
      return id;
    };
    this.nativeCaf = (id) => {
      this.queue.delete(id);
    };
    this.requestAnimationFrame = this.nativeRaf;
    this.cancelAnimationFrame = this.nativeCaf;
    return { oldDocument };
  }
}

// ---------------------------------------------------------------------------
// Canvas and contexts
// ---------------------------------------------------------------------------

export type FakeContextType = "2d" | "webgl" | "webgl2" | "bitmaprenderer";

/** The fields every fake canvas has. */
export interface PictureCanvas {
  width: number;
  height: number;
  /** The picture the canvas shows now (2D and bitmap contexts). */
  content: number;
  tainted?: boolean;
}

function normalType(type: string): FakeContextType | null {
  if (type === "experimental-webgl") return "webgl";
  if (type === "2d" || type === "webgl" || type === "webgl2" || type === "bitmaprenderer") return type;
  return null;
}

/** A 2D context. Every draw sets the canvas picture to nextPicture; clearRect sets 0. */
export class FakeContext2D {
  nextPicture = 0;
  constructor(readonly canvas: PictureCanvas) {}
  /** The game draws picture n with real calls (clear, then fill). */
  drawPicture(n: number): void {
    this.nextPicture = n;
    this.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }
  clearRect(...args: number[]): void {
    void args;
    this.canvas.content = 0;
  }
  fillRect(...args: number[]): void {
    void args;
    this.canvas.content = this.nextPicture;
  }
  strokeRect(...args: number[]): void {
    void args;
    this.canvas.content = this.nextPicture;
  }
  fill(): void {
    this.canvas.content = this.nextPicture;
  }
  stroke(): void {
    this.canvas.content = this.nextPicture;
  }
  fillText(...args: unknown[]): void {
    void args;
    this.canvas.content = this.nextPicture;
  }
  strokeText(...args: unknown[]): void {
    void args;
    this.canvas.content = this.nextPicture;
  }
  drawImage(...args: unknown[]): void {
    void args;
    this.canvas.content = this.nextPicture;
  }
  putImageData(...args: unknown[]): void {
    void args;
    this.canvas.content = this.nextPicture;
  }
}

const GL_FRAMEBUFFER = 0x8d40;
const GL_DRAW_FRAMEBUFFER = 0x8ca9;
const GL_FRAMEBUFFER_BINDING = 0x8ca6;

/** A minimal WebGL 1 context: bindings, draws, compositing. */
export class FakeWebGLContext {
  nextPicture = 0;
  /** The picture in the drawing buffer. */
  picture = 0;
  drawFb: object | null = null;
  lost = false;
  readonly FRAMEBUFFER = GL_FRAMEBUFFER;
  readonly COLOR_BUFFER_BIT = 0x4000;
  constructor(
    readonly canvas: PictureCanvas,
    private readonly attrs: { preserveDrawingBuffer?: boolean } = {},
  ) {}
  /** The game draws picture n with real calls, then puts its binding back. */
  drawPicture(n: number): void {
    const saved = this.drawFb;
    this.nextPicture = n;
    this.bindFramebuffer(GL_FRAMEBUFFER, null);
    this.clear(0x4000);
    this.drawArrays(4, 0, 3);
    this.bindFramebuffer(GL_FRAMEBUFFER, saved);
  }
  bindFramebuffer(target: number, fb: object | null): void {
    if (target === GL_FRAMEBUFFER || target === GL_DRAW_FRAMEBUFFER) this.drawFb = fb;
  }
  createFramebuffer(): object {
    return {};
  }
  deleteFramebuffer(fb: object | null): void {
    if (fb && this.drawFb === fb) this.drawFb = null;
  }
  getParameter(pname: number): unknown {
    return pname === GL_FRAMEBUFFER_BINDING ? this.drawFb : null;
  }
  getExtension(): null {
    return null;
  }
  getContextAttributes(): { preserveDrawingBuffer: boolean } {
    return { preserveDrawingBuffer: Boolean(this.attrs.preserveDrawingBuffer) };
  }
  isContextLost(): boolean {
    return this.lost;
  }
  clear(mask: number): void {
    void mask;
    if (this.drawFb === null) this.picture = this.nextPicture;
  }
  drawArrays(...args: number[]): void {
    void args;
    if (this.drawFb === null) this.picture = this.nextPicture;
  }
  drawElements(...args: number[]): void {
    void args;
    if (this.drawFb === null) this.picture = this.nextPicture;
  }
  /** End of the frame. */
  composite(): void {
    if (!this.attrs.preserveDrawingBuffer) this.picture = 0;
  }
}

export class FakeBitmapContext {
  constructor(readonly canvas: PictureCanvas) {}
  transferFromImageBitmap(bitmap: { picture: number } | null): void {
    this.canvas.content = bitmap?.picture ?? 0;
  }
}

/** The picture that new VideoFrame(canvas) would read now. */
export function canvasPicture(canvas: object): number {
  const c = canvas as { __context?: unknown; content?: number };
  const context = c.__context;
  if (context instanceof WebGL2Mock) return context.frameId;
  if (context instanceof FakeWebGLContext) return context.picture;
  return c.content ?? 0;
}

type ContextClass<T> = new (canvas: PictureCanvas, attrs?: Record<string, unknown>) => T;

interface ContextClasses {
  CanvasRenderingContext2D: ContextClass<FakeContext2D>;
  WebGLRenderingContext: ContextClass<FakeWebGLContext>;
  WebGL2RenderingContext: new (options?: WebGL2MockOptions) => WebGL2Mock;
  ImageBitmapRenderingContext: ContextClass<FakeBitmapContext>;
}

/** getContext with real semantics, shared by FakeCanvas and the jsdom installer. */
function realGetContext(
  canvas: PictureCanvas & { __context?: unknown; __contextType?: FakeContextType | null; getContextCalls?: string[]; transferred?: boolean },
  classes: ContextClasses,
  type: string,
  attrs: Record<string, unknown> | undefined,
  onCreate: (context: unknown) => void,
): unknown {
  (canvas.getContextCalls ??= []).push(type);
  if (canvas.transferred) throw new DOMException("The canvas was transferred", "InvalidStateError");
  const wanted = normalType(type);
  if (!wanted) return null;
  if (canvas.__contextType) return canvas.__contextType === wanted ? canvas.__context : null;
  let context: unknown;
  if (wanted === "2d") context = new classes.CanvasRenderingContext2D(canvas, attrs);
  else if (wanted === "webgl") context = new classes.WebGLRenderingContext(canvas, attrs);
  else if (wanted === "webgl2") {
    context = new classes.WebGL2RenderingContext({
      canvas,
      preserveDrawingBuffer: Boolean(attrs?.preserveDrawingBuffer),
      antialias: attrs?.antialias === undefined ? true : Boolean(attrs.antialias),
      ...(attrs?.mock as WebGL2MockOptions | undefined),
    });
  } else context = new classes.ImageBitmapRenderingContext(canvas, attrs);
  Object.defineProperty(canvas, "__context", { value: context, configurable: true, writable: true, enumerable: false });
  Object.defineProperty(canvas, "__contextType", { value: wanted, configurable: true, writable: true, enumerable: false });
  onCreate(context);
  return context;
}

/** Composite a GL context at the end of a frame. */
function compositeContext(context: unknown): void {
  if (context instanceof WebGL2Mock) context.nextFrame();
  else if (context instanceof FakeWebGLContext) context.composite();
}

/**
 * A realm with its own canvas classes. Frames composite every WebGL context
 * that the realm made.
 */
export class CanvasRealm extends FakeRealm implements ContextClasses {
  readonly HTMLCanvasElement: new (width?: number, height?: number) => FakeCanvas;
  readonly CanvasRenderingContext2D: ContextClass<FakeContext2D>;
  readonly WebGLRenderingContext: ContextClass<FakeWebGLContext>;
  readonly WebGL2RenderingContext: new (options?: WebGL2MockOptions) => WebGL2Mock;
  readonly ImageBitmapRenderingContext: ContextClass<FakeBitmapContext>;
  /** Every GL context made in this realm, composited after each frame. */
  readonly glContexts: unknown[] = [];

  constructor(timeOrigin = 0) {
    super(timeOrigin);
    this.CanvasRenderingContext2D = class extends FakeContext2D {};
    this.WebGLRenderingContext = class extends FakeWebGLContext {};
    this.WebGL2RenderingContext = class extends WebGL2Mock {};
    this.ImageBitmapRenderingContext = class extends FakeBitmapContext {};
    this.HTMLCanvasElement = canvasClassFor(this);
  }

  /** A new canvas of this realm. */
  createCanvas(width = 480, height = 640): FakeCanvas {
    return new this.HTMLCanvasElement(width, height);
  }

  /** Run one display frame, then composite every WebGL context. */
  override frame(t: number): void {
    super.frame(t);
    for (const context of this.glContexts) compositeContext(context);
  }
}

/** A canvas of a CanvasRealm. Create it with realm.createCanvas(). */
export class FakeCanvas extends EventTarget implements PictureCanvas {
  width: number;
  height: number;
  content = 0;
  /** Set to make new VideoFrame(canvas) throw a SecurityError. */
  tainted = false;
  /** Set to make getContext throw (a canvas moved to an OffscreenCanvas). */
  transferred = false;
  /** Every getContext call, by anyone, in order. */
  readonly getContextCalls: string[] = [];
  readonly ownerDocument: { defaultView: unknown };

  constructor(
    readonly realm: CanvasRealm,
    width = 480,
    height = 640,
  ) {
    super();
    this.width = width;
    this.height = height;
    this.ownerDocument = realm.document;
  }

  getContext(type: string, attrs?: Record<string, unknown>): unknown {
    return realGetContext(this, this.realm, type, attrs, (context) => {
      if (context instanceof WebGL2Mock || context instanceof FakeWebGLContext) this.realm.glContexts.push(context);
    });
  }

  /** The context the canvas has, without calling getContext. */
  get context(): unknown {
    return (this as { __context?: unknown }).__context ?? null;
  }

  /** The picture that new VideoFrame(canvas) would read now. */
  get picture(): number {
    return canvasPicture(this);
  }

  get asElement(): HTMLCanvasElement {
    return this as unknown as HTMLCanvasElement;
  }
}

/** A canvas class with its own prototype, bound to one realm. */
function canvasClassFor(realm: CanvasRealm): new (width?: number, height?: number) => FakeCanvas {
  return class extends FakeCanvas {
    constructor(width = 480, height = 640) {
      super(realm, width, height);
    }
  };
}

// ---------------------------------------------------------------------------
// VideoFrame
// ---------------------------------------------------------------------------

export class FakeVideoFrame {
  static made: FakeVideoFrame[] = [];
  closed = false;
  /** The picture read from the canvas. 0 is black. */
  readonly content: number;
  constructor(
    readonly source: unknown,
    readonly init: VideoFrameInit,
  ) {
    const canvas = source as PictureCanvas;
    if (canvas.tainted) throw new DOMException("tainted", "SecurityError");
    if (canvas.width === 0 || canvas.height === 0) throw new DOMException("empty", "InvalidStateError");
    this.content = canvasPicture(canvas);
    FakeVideoFrame.made.push(this);
  }
  close(): void {
    this.closed = true;
  }
}

// ---------------------------------------------------------------------------
// jsdom
// ---------------------------------------------------------------------------

export interface InstalledContexts {
  /** Composite every WebGL context made since the install (the end of a frame). */
  composite(): void;
  restore(): void;
}

/**
 * Give a jsdom window fake context classes and a real-semantics getContext.
 * jsdom canvases then get a `content` picture and a getContextCalls log.
 */
export function installCanvasContexts(win: Window): InstalledContexts {
  const w = win as unknown as Record<string, unknown> & { HTMLCanvasElement: { prototype: object } };
  const names = ["CanvasRenderingContext2D", "WebGLRenderingContext", "WebGL2RenderingContext", "ImageBitmapRenderingContext"];
  const saved = new Map<string, PropertyDescriptor | undefined>(names.map((n) => [n, Object.getOwnPropertyDescriptor(w, n)]));
  const classes: ContextClasses = {
    CanvasRenderingContext2D: class extends FakeContext2D {},
    WebGLRenderingContext: class extends FakeWebGLContext {},
    WebGL2RenderingContext: class extends WebGL2Mock {},
    ImageBitmapRenderingContext: class extends FakeBitmapContext {},
  };
  for (const name of names) {
    Object.defineProperty(w, name, {
      value: classes[name as keyof ContextClasses],
      configurable: true,
      writable: true,
      enumerable: false,
    });
  }
  const proto = w.HTMLCanvasElement.prototype;
  const savedGetContext = Object.getOwnPropertyDescriptor(proto, "getContext");
  const gl: unknown[] = [];
  Object.defineProperty(proto, "getContext", {
    configurable: true,
    writable: true,
    enumerable: true,
    value: function getContext(this: PictureCanvas, type: string, attrs?: Record<string, unknown>) {
      if (typeof (this as { content?: unknown }).content !== "number") (this as { content: number }).content = 0;
      return realGetContext(this, classes, type, attrs, (context) => {
        if (context instanceof WebGL2Mock || context instanceof FakeWebGLContext) gl.push(context);
      });
    },
  });
  return {
    composite() {
      for (const context of gl) compositeContext(context);
    },
    restore() {
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(w, name, descriptor);
        else delete w[name];
      }
      if (savedGetContext) Object.defineProperty(proto, "getContext", savedGetContext);
      else delete (proto as Record<string, unknown>).getContext;
    },
  };
}
