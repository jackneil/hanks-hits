/**
 * requestAnimationFrame dispatcher for one realm (plan 3a, 6.1).
 *
 * The dispatcher wraps requestAnimationFrame and cancelAnimationFrame of one
 * realm (the page window or a same-origin iframe window). Each display frame
 * then runs in ONE task, in this order:
 *
 *   1. pre hooks(t)      path P takes the already-presented frame here
 *   2. game callbacks(t) in the order the game queued them
 *   3. post hooks(t)     paths D and E take the new frame here
 *
 * Capture code that runs in the same task as the game's draw sees the drawing
 * buffer before the browser composites it. That is why no game code changes.
 *
 * Rules:
 * - One dispatcher per realm. A second install on the same realm returns a new
 *   handle to the same dispatcher (reference counted, also across bundles,
 *   because the key is a global symbol on the realm).
 * - A game callback that throws never stops the other callbacks or the hooks.
 *   The error goes to reportError (the same path a native callback error takes).
 * - A callback queued during a frame runs in the next frame, and a cancel
 *   during a frame stops a later callback of the same frame (native semantics).
 * - Ids never collide with native ids, because each wrapped request also makes
 *   one native request (a trampoline) and returns ITS id. While the dispatcher
 *   is installed, the trampoline does nothing. cancelAnimationFrame always
 *   reaches the native cancel too, so callbacks that the game queued natively
 *   before the install keep working and stay cancelable.
 * - uninstall() of the last handle restores the natives. Pending callbacks
 *   then run from their trampolines in the next frame, under the ids the game
 *   already has, so the game loop keeps running and a later native cancel
 *   still stops them.
 * - A game that keeps a reference to the native function from before the
 *   install bypasses the dispatcher. The game-contract test catches this
 *   (zero captured frames).
 * - A realm can die while the dispatcher is installed: its iframe is removed,
 *   or the iframe loads a new document. The iframe's WindowProxy then points
 *   at the NEW document's window, so a teardown through it would change the
 *   wrong realm. The dispatcher keeps the document it found at install. When
 *   that document no longer has this realm as its window (or the realm is
 *   closed), uninstall() only drops the hooks and touches nothing else.
 */

/** The part of a Window that the dispatcher uses. A Window satisfies it. */
export interface RafRealm {
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(handle: number): void;
  reportError?: (error: unknown) => void;
  /** The realm's document. Used only to see that the realm died. */
  document?: unknown;
  /** True after the realm's browsing context is gone. */
  closed?: boolean;
}

/** A pre or post hook. It receives the rAF timestamp of the frame. */
export type FrameHook = (rafTs: number) => void;

/** The handle that installRafDispatcher returns. */
export interface RafDispatcher {
  /** The realm this dispatcher wraps. */
  readonly realm: RafRealm;
  /** False after uninstall() of this handle. */
  readonly active: boolean;
  /** Add a hook that runs before the game callbacks. Returns a remover. */
  addPreHook(hook: FrameHook): () => void;
  /** Add a hook that runs after the game callbacks. Returns a remover. */
  addPostHook(hook: FrameHook): () => void;
  /**
   * Ask for one more dispatch even when the game queues no callback.
   * Path E uses it to collect a readback after the game loop stopped.
   */
  wake(): void;
  /** Frames that ran at least one game callback, since the install. */
  gameFrames(): number;
  /** rAF timestamp of the last dispatch, or null before the first one. */
  lastFrameTs(): number | null;
  /** Remove the hooks of this handle; restore the natives after the last handle. */
  uninstall(): void;
}

export interface InstallOptions {
  /**
   * Receives errors from game callbacks and hooks. The default is the realm's
   * reportError, or a rethrow in a new task when reportError does not exist.
   */
  onError?: (error: unknown) => void;
}

const REALM_KEY = Symbol.for("hankshits.clips.rafDispatcher");

interface Core {
  realm: RafRealm;
  nativeRaf: (cb: FrameRequestCallback) => number;
  nativeCaf: (id: number) => void;
  /** The exact functions found at install, restored at uninstall. */
  originalRaf: RafRealm["requestAnimationFrame"];
  originalCaf: RafRealm["cancelAnimationFrame"];
  /**
   * True when the functions were own properties of the realm. On a real
   * Window they are ([Global] interface). False when they came from a
   * prototype (some test doubles).
   */
  ownRaf: boolean;
  ownCaf: boolean;
  /** The realm's document at install, or undefined for a realm with none. */
  doc: unknown;
  wrappedRaf: (cb: FrameRequestCallback) => number;
  wrappedCaf: (id: number) => void;
  pending: Map<number, FrameRequestCallback>;
  /** The batch the current dispatch runs, so a cancel can reach it. */
  running: Map<number, FrameRequestCallback> | null;
  /** Callbacks that were pending at teardown; their trampolines run them. */
  orphans: Map<number, FrameRequestCallback>;
  torn: boolean;
  scheduledNativeId: number | null;
  pre: Set<FrameHook>;
  post: Set<FrameHook>;
  handles: number;
  gameFrames: number;
  lastTs: number | null;
  onError: (error: unknown) => void;
  passThrough: boolean;
}

type RealmWithKey = RafRealm & { [REALM_KEY]?: Core };

function defaultReporter(realm: RafRealm): (error: unknown) => void {
  return (error) => {
    if (typeof realm.reportError === "function") {
      realm.reportError(error);
      return;
    }
    setTimeout(() => {
      throw error;
    }, 0);
  };
}

function schedule(core: Core): void {
  if (core.scheduledNativeId !== null || core.passThrough) return;
  core.scheduledNativeId = core.nativeRaf((t) => dispatch(core, t));
}

function runHooks(core: Core, hooks: Set<FrameHook>, t: number): void {
  // Copy first: a hook can remove itself or add another hook.
  for (const hook of Array.from(hooks)) {
    try {
      hook(t);
    } catch (error) {
      core.onError(error);
    }
  }
}

function dispatch(core: Core, t: number): void {
  core.scheduledNativeId = null;
  core.lastTs = t;
  // Swap the queue first, so that a callback queued now runs next frame.
  const batch = core.pending;
  core.pending = new Map();
  runHooks(core, core.pre, t);
  let ran = 0;
  core.running = batch;
  for (const [id, cb] of Array.from(batch)) {
    // A cancel earlier in this frame removed it.
    if (!batch.delete(id)) continue;
    ran++;
    try {
      cb(t);
    } catch (error) {
      core.onError(error);
    }
  }
  core.running = null;
  if (ran > 0) core.gameFrames++;
  runHooks(core, core.post, t);
}

function createCore(realm: RafRealm, options: InstallOptions): Core {
  const originalRaf = realm.requestAnimationFrame;
  const originalCaf = realm.cancelAnimationFrame;
  const nativeRaf = (cb: FrameRequestCallback): number => originalRaf.call(realm, cb);
  const nativeCaf = (id: number): void => originalCaf.call(realm, id);
  const own = (name: string) => Object.prototype.hasOwnProperty.call(realm, name);
  const core: Core = {
    realm,
    nativeRaf,
    nativeCaf,
    originalRaf,
    originalCaf,
    ownRaf: own("requestAnimationFrame"),
    ownCaf: own("cancelAnimationFrame"),
    doc: realm.document,
    wrappedRaf: () => 0,
    wrappedCaf: () => undefined,
    pending: new Map(),
    running: null,
    orphans: new Map(),
    torn: false,
    scheduledNativeId: null,
    pre: new Set(),
    post: new Set(),
    handles: 0,
    gameFrames: 0,
    lastTs: null,
    onError: options.onError ?? defaultReporter(realm),
    passThrough: false,
  };
  core.wrappedRaf = (cb: FrameRequestCallback): number => {
    if (core.passThrough) return core.nativeRaf(cb);
    // The trampoline's native id is the id the game gets. It runs the
    // callback only after a teardown; until then the dispatch runs it.
    const id: number = core.nativeRaf((t) => {
      if (!core.torn) return;
      const orphan = core.orphans.get(id);
      if (!orphan) return;
      core.orphans.delete(id);
      orphan(t);
    });
    core.pending.set(id, cb);
    schedule(core);
    return id;
  };
  core.wrappedCaf = (id: number): void => {
    if (!core.pending.delete(id)) core.running?.delete(id);
    core.orphans.delete(id);
    core.nativeCaf(id);
  };
  return core;
}

/**
 * True when the realm died after the install: its browsing context is closed,
 * or its document from the install is no longer its active document.
 */
export function isRealmDead(realm: RafRealm, installDoc: unknown): boolean {
  try {
    if (realm.closed === true) return true;
    if (installDoc === undefined || installDoc === null) return false;
    return (installDoc as { defaultView?: unknown }).defaultView !== realm;
  } catch {
    // A dead cross-context object can throw on access.
    return true;
  }
}

function teardown(core: Core): void {
  const realm = core.realm as RealmWithKey;
  core.pre.clear();
  core.post.clear();
  core.torn = true;
  if (isRealmDead(realm, core.doc)) {
    // The realm is gone. Its WindowProxy can now point at a new document's
    // window: do not cancel, restore or delete anything through it. The
    // pending callbacks die with the old document.
    core.passThrough = true;
    core.scheduledNativeId = null;
    core.pending = new Map();
    core.orphans = new Map();
    return;
  }
  if (core.scheduledNativeId !== null) {
    core.nativeCaf(core.scheduledNativeId);
    core.scheduledNativeId = null;
  }
  const stillOurs =
    realm.requestAnimationFrame === core.wrappedRaf &&
    realm.cancelAnimationFrame === core.wrappedCaf;
  if (stillOurs) {
    // Put back the exact originals: assign them when they were own
    // properties (a real Window), or delete ours so the prototype's show again.
    if (core.ownRaf) realm.requestAnimationFrame = core.originalRaf;
    else delete (realm as Partial<RafRealm>).requestAnimationFrame;
    if (core.ownCaf) realm.cancelAnimationFrame = core.originalCaf;
    else delete (realm as Partial<RafRealm>).cancelAnimationFrame;
  } else {
    // Another script wrapped the functions after us. Do not remove its wrapper;
    // make ours a transparent pass-through instead.
    core.passThrough = true;
  }
  // The trampolines of pending callbacks are still queued natively: they run
  // the callbacks next frame, under the ids the game already holds.
  core.orphans = core.pending;
  core.pending = new Map();
  if (realm[REALM_KEY] === core) delete realm[REALM_KEY];
}

/**
 * Install (or join) the dispatcher of a realm.
 * Call it before the game starts its loop when you can; a later install also
 * works, because the game re-queues its callback every frame.
 */
export function installRafDispatcher(realm: RafRealm, options: InstallOptions = {}): RafDispatcher {
  const keyed = realm as RealmWithKey;
  let core = keyed[REALM_KEY];
  // A core from a document that is gone cannot be joined (the realm object
  // is a WindowProxy that now shows a new document).
  if (core && isRealmDead(realm, core.doc)) core = undefined;
  if (!core) {
    core = createCore(realm, options);
    Object.defineProperty(keyed, REALM_KEY, {
      value: core,
      configurable: true,
      enumerable: false,
      writable: true,
    });
    realm.requestAnimationFrame = core.wrappedRaf;
    realm.cancelAnimationFrame = core.wrappedCaf;
  }
  const c = core;
  c.handles++;
  const own = new Set<{ set: Set<FrameHook>; hook: FrameHook }>();
  let active = true;

  const add = (set: Set<FrameHook>, hook: FrameHook): (() => void) => {
    if (!active) return () => undefined;
    // Wrap so the same function added twice runs twice and removes once.
    const entry = { set, hook: (t: number) => hook(t) };
    set.add(entry.hook);
    own.add(entry);
    return () => {
      set.delete(entry.hook);
      own.delete(entry);
    };
  };

  return {
    realm,
    get active() {
      return active;
    },
    addPreHook: (hook) => add(c.pre, hook),
    addPostHook: (hook) => add(c.post, hook),
    wake() {
      if (!active || c.passThrough) return;
      schedule(c);
    },
    gameFrames: () => c.gameFrames,
    lastFrameTs: () => c.lastTs,
    uninstall() {
      if (!active) return;
      active = false;
      for (const entry of own) entry.set.delete(entry.hook);
      own.clear();
      c.handles--;
      if (c.handles <= 0) teardown(c);
    },
  };
}

/** True when a dispatcher is installed on the realm. For tests and diagnostics. */
export function hasRafDispatcher(realm: RafRealm): boolean {
  return Boolean((realm as RealmWithKey)[REALM_KEY]);
}
