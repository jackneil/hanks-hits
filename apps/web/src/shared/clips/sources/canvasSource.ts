/**
 * Canvas source: takes game frames from one canvas and gives them to the pump.
 *
 * IMPORTANT: call registerCanvasSource AFTER the game created its drawing
 * context. The capture path comes from the canvas's EXISTING context type
 * (plan 3a), found with getContext probes that return null when the canvas
 * has a different context type. On a canvas with no context yet, the first
 * probe would CREATE a WebGL2 context and take the canvas away from the game.
 * autoDiscover waits for game frames before it registers, for this reason.
 *
 * Paths (all run from the realm's rAF dispatcher, in the game's frame task):
 * - 2D canvas, path P: in a PRE hook, before the game draws, take
 *   new VideoFrame(canvas) of the frame that is already on screen. Its content
 *   time is the previous dispatch. A read after the draw would force Safari to
 *   finish the pending drawing on the spot (11-15 ms for a big canvas).
 * - WebGL2, path E: in a POST hook, queue an async readback (pathE.ts) and
 *   collect finished readbacks. Frames arrive one frame or more later.
 * - WebGL1 or unknown, path D: in a POST hook, new VideoFrame(canvas) in the
 *   same task as the draw. The governor watches its cost.
 * Every frame goes to the pump with alpha "discard".
 *
 * Time: rAF timestamps of an iframe realm are converted to page time with
 * the difference of the two performance.timeOrigin values.
 */
import type { CapturePath, HudState } from "../protocol";
import type { CaptureTicket, FramePump } from "../runtime/framePump";
import { installRafDispatcher, type RafDispatcher, type RafRealm } from "../runtime/rafDispatcher";
import { PathEReader } from "./pathE";

export interface CanvasSourceOptions {
  canvas: HTMLCanvasElement;
  /** Game values for the band above the picture. Read at capture time. */
  hud: () => HudState;
  /**
   * Capture target. Registration sets it on the pump, which also resets the
   * pump to the top rung. Apply the governor's rung after registration.
   */
  targetFps: 30 | 60;
  pump: FramePump;
  /**
   * Main-thread cost of each capture step, in ms (a governor input), with the
   * page time of the frame whose task paid for it.
   */
  onCaptureCost?: (ms: number, path: CapturePath, frameMs: number) => void;
  /** Page time of each frame in which game callbacks ran (a governor input). */
  onGameFrame?: (pageMs: number) => void;
  /** A fatal capture error (for example a cross-origin, tainted canvas). Capture stops. */
  onError?: (error: unknown) => void;
  /** Force a path (Retro Arcade and tests). Default: from the context type. */
  path?: CapturePath;
  /** Readback width for path E. Default 640. */
  readbackWidth?: number;
  /** Page realm for time conversion. Default: the global window. */
  pageRealm?: { performance: { timeOrigin: number } };
  /** Clock for cost measurement. Default: performance.now. */
  now?: () => number;
}

export interface CanvasSource {
  /** The current path. Path E falls back to D when its first readback fails. */
  readonly path: CapturePath;
  /** Change the path E readback width (a governor content step). */
  setReadbackWidth(width: number): void;
  /** Stop capture, flush the pump's held frame and remove every hook. */
  unregister(): void;
}

/** Consecutive capture errors after which capture stops. */
export const MAX_CONSECUTIVE_ERRORS = 30;

interface Realm extends RafRealm {
  performance: { timeOrigin: number };
}

/**
 * Find the capture path from the canvas's EXISTING context.
 * Each probe returns null when the canvas has a context of another type.
 */
export function detectCapturePath(canvas: HTMLCanvasElement): { path: CapturePath; gl2: WebGL2RenderingContext | null } {
  const probe = (type: string): unknown => {
    try {
      return canvas.getContext(type);
    } catch {
      // A canvas moved to an OffscreenCanvas throws InvalidStateError.
      return null;
    }
  };
  const gl2 = probe("webgl2") as WebGL2RenderingContext | null;
  if (gl2) return { path: "E", gl2 };
  if (probe("webgl") || probe("experimental-webgl")) return { path: "D", gl2: null };
  if (probe("2d")) return { path: "P", gl2: null };
  // bitmaprenderer, a transferred canvas, or an unknown type: the plain read.
  return { path: "D", gl2: null };
}

function realmOf(canvas: HTMLCanvasElement): Realm {
  const view = canvas.ownerDocument?.defaultView;
  if (!view) throw new Error("registerCanvasSource: the canvas is not in a document with a window");
  return view as unknown as Realm;
}

function isSecurityError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: string }).name === "SecurityError";
}

export function registerCanvasSource(options: CanvasSourceOptions): CanvasSource {
  const { canvas, pump, hud } = options;
  const now = options.now ?? (() => performance.now());
  const realm = realmOf(canvas);
  const page = options.pageRealm ?? (globalThis as unknown as { performance: { timeOrigin: number } });
  const offsetMs = realm.performance.timeOrigin - page.performance.timeOrigin;
  let path: CapturePath;
  let gl2: WebGL2RenderingContext | null = null;
  if (options.path) {
    // A forced path probes nothing, except that path E needs the WebGL2 context.
    path = options.path;
    if (path === "E") {
      gl2 = detectCapturePath(canvas).gl2;
      if (!gl2) path = "D";
    }
  } else {
    ({ path, gl2 } = detectCapturePath(canvas));
  }
  if (path !== "E" && typeof VideoFrame === "undefined") {
    throw new Error("registerCanvasSource: VideoFrame is not available for capture path " + path);
  }

  pump.configure({ targetFps: options.targetFps });
  const dispatcher: RafDispatcher = installRafDispatcher(realm);
  const removers: Array<() => void> = [];
  let stopped = false;
  let consecutiveErrors = 0;
  let readbackWidth = options.readbackWidth ?? 640;
  let reader: PathEReader<{ ticket: CaptureTicket; hud: HudState }> | null =
    path === "E" && gl2 ? new PathEReader(gl2, { targetWidth: readbackWidth }) : null;

  const cost = (ms: number, frameMs: number) => options.onCaptureCost?.(ms, path, frameMs);

  const fail = (error: unknown, fatal = false) => {
    consecutiveErrors++;
    if (fatal || isSecurityError(error) || consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      stop();
      options.onError?.(error);
    }
  };

  const hasPixels = () => canvas.width > 0 && canvas.height > 0;

  // The HUD callback is game code. A throw must not lose or leak a frame:
  // keep the last good value.
  let lastHud: HudState = { gameName: "", emoji: "" };
  const readHud = (): HudState => {
    try {
      lastHud = hud();
    } catch {
      // Keep the last good HUD.
    }
    return lastHud;
  };

  /** Paths P and D: one VideoFrame of the canvas as it is now. */
  const readCanvas = (contentPageMs: number, framePageMs: number) => {
    if (!hasPixels()) return;
    const ticket = pump.offer(contentPageMs);
    if (!ticket) return;
    const hudState = readHud();
    const t0 = now();
    try {
      const frame = new VideoFrame(canvas, { timestamp: ticket.tsUs, alpha: "discard" });
      pump.submit(ticket, { t: "frame", frame }, hudState);
      consecutiveErrors = 0;
    } catch (error) {
      pump.abandon(ticket);
      fail(error);
    }
    cost(now() - t0, framePageMs);
  };

  const collectE = () => {
    if (!reader) return;
    const polled = reader.poll();
    for (const r of polled.ready) {
      pump.submit(r.tag.ticket, { t: "pixels", data: r.data, width: r.width, height: r.height }, r.tag.hud);
    }
    for (const tag of polled.dropped) pump.abandon(tag.ticket);
    if (reader.state === "lost") reader = null;
    else if (reader.state === "failed") fallBackToD();
  };

  /** The GPU path does not work on this context: use the plain read. */
  const fallBackToD = () => {
    if (reader) for (const tag of reader.dispose()) pump.abandon(tag.ticket);
    reader = null;
    if (typeof VideoFrame !== "undefined") path = "D";
    else fail(new Error("path E failed and VideoFrame is not available"), true);
  };

  const kickE = (contentPageMs: number) => {
    if (!reader || !hasPixels()) return;
    const ticket = pump.offer(contentPageMs);
    if (!ticket) return;
    const result = reader.kick({ ticket, hud: readHud() });
    if (result === "ok") {
      consecutiveErrors = 0;
      return;
    }
    pump.abandon(ticket);
    if (result === "lost") {
      reader = null;
    } else if (result === "failed") {
      fallBackToD();
    }
  };

  // ---- hooks ---------------------------------------------------------------

  let previousTs: number | null = null;
  let gameFramesSeen = dispatcher.gameFrames();

  removers.push(
    dispatcher.addPreHook((t) => {
      if (stopped) return;
      if (path === "P" && previousTs !== null) readCanvas(previousTs + offsetMs, t + offsetMs);
      previousTs = t;
    }),
  );
  removers.push(
    dispatcher.addPostHook((t) => {
      if (stopped) return;
      const frames = dispatcher.gameFrames();
      if (frames !== gameFramesSeen) {
        gameFramesSeen = frames;
        options.onGameFrame?.(t + offsetMs);
      }
      if (path === "D") {
        readCanvas(t + offsetMs, t + offsetMs);
      } else if (path === "E") {
        const t0 = now();
        collectE();
        kickE(t + offsetMs);
        if (reader && reader.pending > 0) dispatcher.wake();
        cost(now() - t0, t + offsetMs);
      }
    }),
  );

  // ---- context loss (path E) ----------------------------------------------

  const onLost = () => {
    if (!reader) return;
    for (const tag of reader.markLost()) pump.abandon(tag.ticket);
    reader = null;
  };
  const onRestored = () => {
    if (stopped || path !== "E") return;
    const restored = detectCapturePath(canvas).gl2;
    if (restored) reader = new PathEReader(restored, { targetWidth: readbackWidth });
  };
  if (path === "E") {
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    removers.push(() => {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
    });
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    for (const remove of removers.splice(0)) remove();
    if (reader) {
      for (const tag of reader.dispose()) pump.abandon(tag.ticket);
      reader = null;
    }
    dispatcher.uninstall();
    pump.flush();
  }

  return {
    get path() {
      return path;
    },
    setReadbackWidth(width: number) {
      readbackWidth = width;
      reader?.setTargetWidth(width);
    },
    unregister: stop,
  };
}
