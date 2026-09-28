/**
 * Canvas activity tracker for one realm (plan 3a, 6.1).
 *
 * The capture code must never call getContext on a game canvas: on a canvas
 * with no context yet, getContext CREATES a context, and the game's own
 * getContext of another type then returns null (the game goes blank). So the
 * tracker learns the context type by observation only:
 *
 * - It wraps HTMLCanvasElement.prototype.getContext of the realm. When the
 *   GAME creates or gets a context, the tracker records the canvas, the
 *   context object and its type.
 * - It wraps the draw calls of the 2D, WebGL, WebGL2 and bitmap-renderer
 *   prototypes. A context that existed before the install is recorded at its
 *   first draw after the install (the context's canvas property gives the
 *   canvas).
 *
 * For each recorded canvas it counts:
 * - drawSeq: draw calls that change the shown picture. For WebGL, only draws
 *   while the DEFAULT framebuffer is bound for drawing count (draws into a
 *   game's render target are not on screen). The tracker follows
 *   bindFramebuffer for this, and asks getParameter once for a context whose
 *   binding it did not see.
 * - drawFrames: rAF frames with at least one such draw. A frame is one
 *   dispatch of the realm's rAF dispatcher.
 *
 * Why the counts matter:
 * - A WebGL canvas with preserveDrawingBuffer false is cleared after each
 *   composite (WebGL 1.0 spec, section 2.2). A read in a rAF dispatch where
 *   the game did not draw gives a black frame. Paths E and D read only after
 *   a dispatch in which drawSeq changed.
 * - Auto-discovery picks only canvases that the game really draws on.
 *
 * Draws through extension objects (instanced and multi-draw extensions) are
 * counted when the game gets the extension after the install. Engines that
 * got an extension earlier still clear the default framebuffer each frame
 * (three.js and R3F do by default), and clear is counted. A game that keeps
 * its own bound copies of the draw methods from before the install is not
 * seen at all: its canvas gets no record and no capture, and the
 * game-contract test fails on zero captured frames.
 *
 * Install and uninstall are reference counted per realm, like the rAF
 * dispatcher. Uninstall restores every wrapped method with its original
 * property descriptor. When another script wrapped a method after us, our
 * wrapper stays in its chain as a pass-through. A dead realm (a removed or
 * reloaded iframe) is handled like in the dispatcher.
 *
 * The wrappers never throw into the game. The cost per draw call is one
 * WeakMap lookup and a counter.
 */
import type { CapturePath } from "../protocol";
import { installRafDispatcher, isRealmDead, type RafDispatcher, type RafRealm } from "../runtime/rafDispatcher";

export type ContextType = "2d" | "webgl" | "webgl2" | "bitmaprenderer" | "other";

/** What the tracker knows about one canvas. The counters are live. */
export interface CanvasRecord {
  /** The canvas element (or an OffscreenCanvas, for a context made on one). */
  readonly canvas: object;
  readonly type: ContextType;
  /** The context object that the game uses. */
  readonly context: unknown;
  /** Draw calls that changed the shown picture. */
  readonly drawSeq: number;
  /** rAF frames with at least one such draw. */
  readonly drawFrames: number;
}

/** The realm globals that the tracker wraps. A Window satisfies it. */
export interface ActivityRealm extends RafRealm {
  HTMLCanvasElement?: unknown;
  CanvasRenderingContext2D?: unknown;
  WebGLRenderingContext?: unknown;
  WebGL2RenderingContext?: unknown;
  ImageBitmapRenderingContext?: unknown;
  reportError?: (error: unknown) => void;
}

export interface CanvasActivity {
  readonly realm: ActivityRealm;
  /** False after uninstall() of this handle. */
  readonly active: boolean;
  /** The record of a canvas, or undefined while the game has no context on it. */
  record(canvas: object): CanvasRecord | undefined;
  /**
   * Called on the first counted draw of each canvas in each frame. It runs
   * inside the game's draw call: keep it short and never draw from it.
   * Returns a remover.
   */
  onFrameDrawn(listener: (record: CanvasRecord) => void): () => void;
  /**
   * Called when a canvas gets its record (the game's getContext, or the
   * first draw of a context made before the install). It runs inside the
   * game's call: keep it short. Returns a remover.
   */
  onContext(listener: (record: CanvasRecord) => void): () => void;
  /** Remove this handle; restore the methods after the last handle. */
  uninstall(): void;
}

// WebGL enum values (identical in WebGL 1 and 2).
const GL_FRAMEBUFFER = 0x8d40;
const GL_DRAW_FRAMEBUFFER = 0x8ca9;
/** FRAMEBUFFER_BINDING in WebGL 1, DRAW_FRAMEBUFFER_BINDING in WebGL 2 (same value). */
const GL_DRAW_FRAMEBUFFER_BINDING = 0x8ca6;

/** 2D calls that change pixels. */
export const DRAW_CALLS_2D = [
  "fillRect",
  "strokeRect",
  "clearRect",
  "fill",
  "stroke",
  "fillText",
  "strokeText",
  "drawImage",
  "putImageData",
] as const;
/** WebGL 1 and 2 calls that write the draw framebuffer. */
export const DRAW_CALLS_GL = ["drawArrays", "drawElements", "clear"] as const;
/** WebGL 2 only. */
export const DRAW_CALLS_GL2 = ["drawArraysInstanced", "drawElementsInstanced", "drawRangeElements", "blitFramebuffer"] as const;
/** Draw calls on extension objects. */
export const DRAW_CALLS_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  ANGLE_instanced_arrays: ["drawArraysInstancedANGLE", "drawElementsInstancedANGLE"],
  WEBGL_multi_draw: [
    "multiDrawArraysWEBGL",
    "multiDrawElementsWEBGL",
    "multiDrawArraysInstancedWEBGL",
    "multiDrawElementsInstancedWEBGL",
  ],
  WEBGL_draw_instanced_base_vertex_base_instance: [
    "drawArraysInstancedBaseInstanceWEBGL",
    "drawElementsInstancedBaseVertexBaseInstanceWEBGL",
  ],
  WEBGL_multi_draw_instanced_base_vertex_base_instance: [
    "multiDrawArraysInstancedBaseInstanceWEBGL",
    "multiDrawElementsInstancedBaseVertexBaseInstanceWEBGL",
  ],
};

const ACTIVITY_KEY = Symbol.for("hankshits.clips.canvasActivity");

type AnyFn = (this: unknown, ...args: unknown[]) => unknown;

interface MutableRecord {
  canvas: object;
  type: ContextType;
  context: unknown;
  drawSeq: number;
  drawFrames: number;
  lastTick: number;
}

interface ContextState {
  record: MutableRecord | null;
  /** True, false, or null when unknown (ask getParameter at the next draw). */
  defaultFb: boolean | null;
}

interface Patch {
  target: object;
  name: string;
  wrapper: AnyFn;
  /** The own descriptor before the patch; undefined when the method was inherited. */
  descriptor: PropertyDescriptor | undefined;
}

interface Core {
  realm: ActivityRealm;
  doc: unknown;
  handles: number;
  active: boolean;
  tick: number;
  records: WeakMap<object, MutableRecord>;
  contexts: WeakMap<object, ContextState>;
  patchedExtensions: WeakSet<object>;
  listeners: Set<(record: CanvasRecord) => void>;
  contextListeners: Set<(record: CanvasRecord) => void>;
  patches: Patch[];
  dispatcher: RafDispatcher;
  removeTick: () => void;
  report: (error: unknown) => void;
}

type RealmWithKey = ActivityRealm & { [ACTIVITY_KEY]?: Core };

function prototypeOf(ctor: unknown): object | null {
  if (typeof ctor !== "function") return null;
  const proto = (ctor as { prototype?: unknown }).prototype;
  return typeof proto === "object" && proto !== null ? proto : null;
}

function isInstance(value: object, ctor: unknown): boolean {
  if (typeof ctor !== "function") return false;
  try {
    return value instanceof (ctor as abstract new (...args: never[]) => unknown);
  } catch {
    return false;
  }
}

function typeOfContext(realm: ActivityRealm, context: object, requested: unknown): ContextType {
  if (isInstance(context, realm.WebGL2RenderingContext)) return "webgl2";
  if (isInstance(context, realm.WebGLRenderingContext)) return "webgl";
  if (isInstance(context, realm.CanvasRenderingContext2D)) return "2d";
  if (isInstance(context, realm.ImageBitmapRenderingContext)) return "bitmaprenderer";
  switch (String(requested)) {
    case "webgl2":
      return "webgl2";
    case "webgl":
    case "experimental-webgl":
      return "webgl";
    case "2d":
      return "2d";
    case "bitmaprenderer":
      return "bitmaprenderer";
    default:
      return "other";
  }
}

function reporter(realm: ActivityRealm): (error: unknown) => void {
  return (error) => {
    try {
      if (typeof realm.reportError === "function") {
        realm.reportError(error);
        return;
      }
    } catch {
      // Fall through to the rethrow.
    }
    setTimeout(() => {
      throw error;
    }, 0);
  };
}

function stateOf(core: Core, context: object): ContextState {
  let state = core.contexts.get(context);
  if (!state) {
    state = { record: null, defaultFb: null };
    core.contexts.set(context, state);
  }
  return state;
}

function noteContext(core: Core, canvas: object, context: object, requested: unknown): MutableRecord {
  const existing = core.records.get(canvas);
  if (existing && existing.context === context) {
    stateOf(core, context).record = existing;
    return existing;
  }
  const type = typeOfContext(core.realm, context, requested);
  const record: MutableRecord = { canvas, type, context, drawSeq: 0, drawFrames: 0, lastTick: -1 };
  core.records.set(canvas, record);
  const state = stateOf(core, context);
  state.record = record;
  if (type === "webgl" || type === "webgl2") {
    // After a context loss and restore the binding is the default again.
    const forget = () => {
      state.defaultFb = null;
    };
    const target = canvas as { addEventListener?: (type: string, fn: () => void) => void };
    try {
      target.addEventListener?.("webglcontextlost", forget);
      target.addEventListener?.("webglcontextrestored", forget);
    } catch {
      // Not an event target: nothing to follow.
    }
  }
  notify(core, core.contextListeners, record);
  return record;
}

/** Call listeners without ever throwing into the game's call. */
function notify(core: Core, listeners: Set<(record: CanvasRecord) => void>, record: CanvasRecord): void {
  if (listeners.size === 0) return;
  for (const listener of Array.from(listeners)) {
    try {
      listener(record);
    } catch (error) {
      core.report(error);
    }
  }
}

/** The record for a context that the tracker first sees in a draw call. */
function recordFromDraw(core: Core, context: object, state: ContextState): MutableRecord | null {
  if (state.record) return state.record;
  let canvas: unknown;
  try {
    canvas = (context as { canvas?: unknown }).canvas;
  } catch {
    return null;
  }
  if (typeof canvas !== "object" || canvas === null) return null;
  return noteContext(core, canvas, context, undefined);
}

function bump(core: Core, record: MutableRecord): void {
  record.drawSeq++;
  if (record.lastTick === core.tick) return;
  record.lastTick = core.tick;
  record.drawFrames++;
  notify(core, core.listeners, record);
}

function drew2d(core: Core, context: unknown): void {
  if (typeof context !== "object" || context === null) return;
  const record = recordFromDraw(core, context, stateOf(core, context));
  if (record) bump(core, record);
}

function drewGl(core: Core, gl: unknown): void {
  if (typeof gl !== "object" || gl === null) return;
  const state = stateOf(core, gl);
  if (state.defaultFb === null) {
    try {
      state.defaultFb = (gl as WebGLRenderingContext).getParameter(GL_DRAW_FRAMEBUFFER_BINDING) === null;
    } catch {
      state.defaultFb = true;
    }
  }
  if (!state.defaultFb) return;
  const record = recordFromDraw(core, gl, state);
  if (record) bump(core, record);
}

function patch(core: Core, target: object, name: string, make: (original: AnyFn) => AnyFn): void {
  let original: unknown;
  try {
    original = (target as Record<string, unknown>)[name];
  } catch {
    return;
  }
  if (typeof original !== "function") return;
  const descriptor = Object.getOwnPropertyDescriptor(target, name);
  if (descriptor && descriptor.configurable === false) return;
  const wrapper = make(original as AnyFn);
  try {
    Object.defineProperty(target, name, {
      value: wrapper,
      writable: true,
      configurable: true,
      enumerable: descriptor?.enumerable ?? false,
    });
  } catch {
    return;
  }
  core.patches.push({ target, name, wrapper, descriptor });
}

function patchExtension(core: Core, gl: object, name: string, extension: object): void {
  const calls = DRAW_CALLS_EXTENSIONS[name];
  if (!calls || core.patchedExtensions.has(extension)) return;
  core.patchedExtensions.add(extension);
  for (const call of calls) {
    patch(core, extension, call, (original) =>
      function (this: unknown, ...args: unknown[]) {
        const result = original.apply(this, args);
        if (core.active) drewGl(core, gl);
        return result;
      },
    );
  }
}

function patchRealm(core: Core): void {
  const realm = core.realm;
  const canvasProto = prototypeOf(realm.HTMLCanvasElement);
  if (canvasProto) {
    patch(core, canvasProto, "getContext", (original) =>
      function (this: unknown, ...args: unknown[]) {
        const context = original.apply(this, args);
        if (core.active && typeof context === "object" && context !== null && typeof this === "object" && this !== null) {
          noteContext(core, this, context, args[0]);
        }
        return context;
      },
    );
  }
  const draw2d = (original: AnyFn): AnyFn =>
    function (this: unknown, ...args: unknown[]) {
      const result = original.apply(this, args);
      if (core.active) drew2d(core, this);
      return result;
    };
  const proto2d = prototypeOf(realm.CanvasRenderingContext2D);
  if (proto2d) for (const name of DRAW_CALLS_2D) patch(core, proto2d, name, draw2d);
  const protoBitmap = prototypeOf(realm.ImageBitmapRenderingContext);
  if (protoBitmap) patch(core, protoBitmap, "transferFromImageBitmap", draw2d);

  const glProtos: Array<[object | null, readonly string[]]> = [
    [prototypeOf(realm.WebGLRenderingContext), DRAW_CALLS_GL],
    [prototypeOf(realm.WebGL2RenderingContext), [...DRAW_CALLS_GL, ...DRAW_CALLS_GL2]],
  ];
  for (const [proto, calls] of glProtos) {
    if (!proto) continue;
    for (const name of calls) {
      patch(core, proto, name, (original) =>
        function (this: unknown, ...args: unknown[]) {
          const result = original.apply(this, args);
          if (core.active) drewGl(core, this);
          return result;
        },
      );
    }
    patch(core, proto, "bindFramebuffer", (original) =>
      function (this: unknown, ...args: unknown[]) {
        const result = original.apply(this, args);
        const target = args[0];
        if (core.active && typeof this === "object" && this !== null && (target === GL_FRAMEBUFFER || target === GL_DRAW_FRAMEBUFFER)) {
          stateOf(core, this).defaultFb = args[1] === null || args[1] === undefined;
        }
        return result;
      },
    );
    // Deleting the bound framebuffer binds the default one again (WebGL spec).
    patch(core, proto, "deleteFramebuffer", (original) =>
      function (this: unknown, ...args: unknown[]) {
        const result = original.apply(this, args);
        if (core.active && typeof this === "object" && this !== null) {
          const state = core.contexts.get(this);
          if (state) state.defaultFb = null;
        }
        return result;
      },
    );
    patch(core, proto, "getExtension", (original) =>
      function (this: unknown, ...args: unknown[]) {
        const extension = original.apply(this, args);
        if (core.active && typeof extension === "object" && extension !== null && typeof this === "object" && this !== null) {
          patchExtension(core, this, String(args[0]), extension);
        }
        return extension;
      },
    );
  }
}

function createCore(realm: ActivityRealm): Core {
  const core: Core = {
    realm,
    doc: realm.document,
    handles: 0,
    active: true,
    tick: 0,
    records: new WeakMap(),
    contexts: new WeakMap(),
    patchedExtensions: new WeakSet(),
    listeners: new Set(),
    contextListeners: new Set(),
    patches: [],
    dispatcher: installRafDispatcher(realm),
    removeTick: () => undefined,
    report: reporter(realm),
  };
  core.removeTick = core.dispatcher.addPreHook(() => {
    core.tick++;
  });
  patchRealm(core);
  return core;
}

function teardown(core: Core): void {
  core.active = false;
  core.listeners.clear();
  core.contextListeners.clear();
  core.removeTick();
  core.dispatcher.uninstall();
  // The patched objects were captured at install, so this is safe for a
  // dead realm too: it only touches that realm's own prototypes.
  for (const p of core.patches.reverse()) {
    let current: unknown;
    try {
      current = (p.target as Record<string, unknown>)[p.name];
    } catch {
      continue;
    }
    // Wrapped again after us: leave the chain; ours is a pass-through now.
    if (current !== p.wrapper) continue;
    try {
      if (p.descriptor) Object.defineProperty(p.target, p.name, p.descriptor);
      else delete (p.target as Record<string, unknown>)[p.name];
    } catch {
      // A frozen object: the pass-through stays.
    }
  }
  core.patches = [];
  const keyed = core.realm as RealmWithKey;
  if (!isRealmDead(core.realm, core.doc) && keyed[ACTIVITY_KEY] === core) delete keyed[ACTIVITY_KEY];
}

/** Install (or join) the activity tracker of a realm. */
export function installCanvasActivity(realm: ActivityRealm): CanvasActivity {
  const keyed = realm as RealmWithKey;
  let core = keyed[ACTIVITY_KEY];
  if (core && (!core.active || isRealmDead(realm, core.doc))) core = undefined;
  if (!core) {
    core = createCore(realm);
    Object.defineProperty(keyed, ACTIVITY_KEY, { value: core, configurable: true, enumerable: false, writable: true });
  }
  const c = core;
  c.handles++;
  let active = true;
  const own = new Set<{ set: Set<(record: CanvasRecord) => void>; fn: (record: CanvasRecord) => void }>();
  const listen = (set: Set<(record: CanvasRecord) => void>, listener: (record: CanvasRecord) => void) => {
    if (!active) return () => undefined;
    // Wrap so the same function added twice runs twice and removes once.
    const entry = { set, fn: (record: CanvasRecord) => listener(record) };
    set.add(entry.fn);
    own.add(entry);
    return () => {
      set.delete(entry.fn);
      own.delete(entry);
    };
  };

  return {
    realm,
    get active() {
      return active;
    },
    record(canvas: object): CanvasRecord | undefined {
      return c.records.get(canvas);
    },
    onFrameDrawn: (listener) => listen(c.listeners, listener),
    onContext: (listener) => listen(c.contextListeners, listener),
    uninstall() {
      if (!active) return;
      active = false;
      for (const entry of own) entry.set.delete(entry.fn);
      own.clear();
      c.handles--;
      if (c.handles <= 0) teardown(c);
    },
  };
}

/** The capture path for a context type (plan 3a). */
export function pathForContextType(type: ContextType): CapturePath {
  if (type === "2d") return "P";
  if (type === "webgl2") return "E";
  return "D";
}
