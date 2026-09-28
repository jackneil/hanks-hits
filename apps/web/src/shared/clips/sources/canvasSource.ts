/**
 * Canvas source: takes game frames from one canvas and gives them to the pump.
 *
 * The source NEVER calls getContext on the canvas. On a canvas with no
 * context yet, getContext would CREATE one, and the game's own getContext of
 * another type would then return null. Instead the source reads the context
 * type from the realm's canvas activity tracker (canvasActivity.ts), which
 * sees the game's own getContext and draw calls. Until the game has a
 * context on the canvas, the source waits, path is null and nothing is
 * taken. So it is safe to register a canvas before the game made its context.
 *
 * Paths (plan 3a). All run from the realm's rAF dispatcher, in the game's
 * frame task:
 * - 2D canvas, path P: in a PRE hook, before the game draws, take
 *   new VideoFrame(canvas) of the frame that is already on screen. Its content
 *   time is the previous dispatch. A read after the draw would force Safari to
 *   finish the pending drawing on the spot (11-15 ms for a big canvas). 2D
 *   canvases keep their pixels, so the read is correct in any dispatch.
 * - WebGL2, path E: in a POST hook, collect finished readbacks, then queue a
 *   new readback (pathE.ts) ONLY when the game drew to the default
 *   framebuffer in this dispatch. With preserveDrawingBuffer false (the
 *   three.js default) the drawing buffer is cleared after each composite, so
 *   a read in any other dispatch is black. While readbacks are pending, the
 *   source asks the dispatcher for one more dispatch (wake). A dispatch from
 *   wake() alone has no game draw, so it only collects: when the game stops,
 *   the chain ends as soon as the last readback is in.
 * - WebGL1, or another context type, path D: in a POST hook, take
 *   new VideoFrame(canvas) in the same task as the draw. On a WebGL canvas
 *   only after a dispatch in which the game drew (same reason as path E); on
 *   other types after a dispatch in which game callbacks ran.
 * Every frame goes to the pump with alpha "discard". Path E takes a ticket
 * only when a readback slot is free, so no ticket is ever taken for a frame
 * that cannot be read.
 *
 * When path E cannot read on this context, the source falls back to path D
 * and calls onPathChange("D", "readback-failed"). On WebKit, path D on a
 * WebGL canvas costs 23-30 ms per frame (plan 3a): the caller must tell the
 * governor, which then goes straight to its low-power level.
 *
 * Warmup (the governor's baseline): when the pump has not started yet, the
 * source first lets warmupMs of LIVE game time pass (the pump is not paused)
 * with no capture. It reports those game frames with baseline: true, so the
 * governor learns the game's frame rate without capture. A pause during the
 * warmup starts it again, so the baseline is one run of real play.
 *
 * Time: rAF timestamps of an iframe realm are converted to page time with
 * the difference of the two performance.timeOrigin values.
 */
import type { CapturePath, HudState } from "../protocol";
import type { CaptureTicket, FramePump } from "../runtime/framePump";
import { installRafDispatcher, type RafDispatcher } from "../runtime/rafDispatcher";
import {
  installCanvasActivity,
  pathForContextType,
  type ActivityRealm,
  type CanvasActivity,
  type CanvasRecord,
} from "./canvasActivity";
import { PathEReader } from "./pathE";

/** Main-thread cost of the capture work in one dispatch (a governor input). */
export interface CaptureCostSample {
  /** Page time of the frame whose task paid for it. */
  frameMs: number;
  ms: number;
  path: CapturePath;
  /**
   * True when this dispatch took a capture ticket (a frame read, or a path E
   * readback queued). False for a dispatch that only collected readbacks.
   */
  ticket: boolean;
}

/** Path E GPU signals (a governor input). */
export type ReadbackSignal =
  /** A readback came in, latencyFrames after its kick (1 = the next frame). */
  | { kind: "done"; frameMs: number; latencyFrames: number }
  /** The game drew, but every readback slot was still in flight: no capture. */
  | { kind: "busy"; frameMs: number };

export interface CanvasSourceOptions {
  canvas: HTMLCanvasElement;
  /** Game values for the band above the picture. Read at capture time. */
  hud: () => HudState;
  /**
   * Capture target. Registration sets it on the pump. The same target as
   * before keeps the pump's stride (a governor rung); a new target resets
   * the pump to the top rung, so apply the governor's rung after that.
   */
  targetFps: 30 | 60;
  pump: FramePump;
  /** Main-thread capture cost of each dispatch that did capture work. */
  onCaptureCost?: (sample: CaptureCostSample) => void;
  /** Page time of each frame in which game callbacks ran (a governor input). */
  onGameFrame?: (pageMs: number, info: { baseline: boolean }) => void;
  /** Path E GPU signals (a governor input). */
  onReadback?: (signal: ReadbackSignal) => void;
  /**
   * The path was chosen ("context": the game's context became known) or
   * changed ("readback-failed": path E fell back to path D).
   */
  onPathChange?: (path: CapturePath, reason: "context" | "readback-failed") => void;
  /** A fatal capture error (for example a cross-origin, tainted canvas). Capture stops. */
  onError?: (error: unknown) => void;
  /**
   * Force a path. "P" and "D" need no context. "E" waits for a WebGL2
   * context and uses path D on any other context. Default: from the context type.
   */
  path?: CapturePath;
  /** Readback width for path E. Default 640. */
  readbackWidth?: number;
  /**
   * Live game time with no capture before the first frame, for the
   * governor's baseline. Default BASELINE_WARMUP_MS when the pump has not
   * started yet, else 0 (a canvas that registers again after a restart).
   */
  warmupMs?: number;
  /** Page realm for time conversion. Default: the global window. */
  pageRealm?: { performance: { timeOrigin: number } };
  /** Clock for cost measurement. Default: performance.now. */
  now?: () => number;
}

export interface CanvasSource {
  /** The current path, or null while the game has no context on the canvas. */
  readonly path: CapturePath | null;
  /** Change the path E readback width (a governor content step). */
  setReadbackWidth(width: number): void;
  /** Stop capture, flush the pump's held frame and remove every hook. */
  unregister(): void;
}

/** Consecutive capture errors after which capture stops. */
export const MAX_CONSECUTIVE_ERRORS = 30;

/** Default warmup: one second of live play without capture. */
export const BASELINE_WARMUP_MS = 1000;

type Realm = ActivityRealm & { performance: { timeOrigin: number } };

function realmOf(canvas: HTMLCanvasElement): Realm {
  const view = canvas.ownerDocument?.defaultView;
  if (!view) throw new Error("registerCanvasSource: the canvas is not in a document with a window");
  return view as unknown as Realm;
}

function isSecurityError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: string }).name === "SecurityError";
}

function isGl(record: CanvasRecord | undefined): boolean {
  return record?.type === "webgl" || record?.type === "webgl2";
}

export function registerCanvasSource(options: CanvasSourceOptions): CanvasSource {
  const { canvas, pump, hud } = options;
  const now = options.now ?? (() => performance.now());
  const realm = realmOf(canvas);
  const page = options.pageRealm ?? (globalThis as unknown as { performance: { timeOrigin: number } });
  const offsetMs = realm.performance.timeOrigin - page.performance.timeOrigin;
  const activity: CanvasActivity = installCanvasActivity(realm);

  let record: CanvasRecord | undefined = activity.record(canvas);
  let path: CapturePath | null = null;
  let gl2: WebGL2RenderingContext | null = null;

  /** Choose the path when enough is known. Returns false while waiting for the game's context. */
  const choosePath = (): boolean => {
    if (path) return true;
    record ??= activity.record(canvas);
    const forced = options.path;
    if (forced === "P" || forced === "D") {
      path = forced;
      return true;
    }
    if (!record) return false;
    if (record.type === "webgl2") {
      path = "E";
      gl2 = record.context as WebGL2RenderingContext;
    } else {
      path = forced === "E" ? "D" : pathForContextType(record.type);
    }
    return true;
  };

  // Choose now when the context is known, so a missing VideoFrame is an
  // error at registration.
  if (choosePath() && path !== "E" && typeof VideoFrame === "undefined") {
    activity.uninstall();
    throw new Error("registerCanvasSource: VideoFrame is not available for capture path " + path);
  }

  pump.configure({ targetFps: options.targetFps });
  const dispatcher: RafDispatcher = installRafDispatcher(realm);
  const removers: Array<() => void> = [];
  let stopped = false;
  let consecutiveErrors = 0;
  let readbackWidth = options.readbackWidth ?? 640;
  let reader: PathEReader<{ ticket: CaptureTicket; hud: HudState }> | null = null;

  const warmupMs = options.warmupMs ?? (pump.started ? 0 : BASELINE_WARMUP_MS);
  let warm = warmupMs <= 0;
  let warmupStart: number | null = null;
  const advanceWarmup = (pageMs: number) => {
    if (warm) return;
    if (pump.paused) {
      warmupStart = null;
      return;
    }
    warmupStart ??= pageMs;
    if (pageMs - warmupStart >= warmupMs) warm = true;
  };

  const cost = (ms: number, frameMs: number, ticket: boolean) => {
    if (path) options.onCaptureCost?.({ frameMs, ms, path, ticket });
  };

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
    cost(now() - t0, framePageMs, true);
  };

  /** The GPU path does not work on this context: use the plain read. */
  const fallBackToD = () => {
    if (reader) for (const tag of reader.dispose()) pump.abandon(tag.ticket);
    reader = null;
    if (typeof VideoFrame === "undefined") {
      fail(new Error("path E failed and VideoFrame is not available"), true);
      return;
    }
    path = "D";
    options.onPathChange?.("D", "readback-failed");
  };

  /** Collect finished readbacks. Returns true when there was work. */
  const collectE = (framePageMs: number): boolean => {
    if (!reader) return false;
    const polled = reader.poll();
    for (const r of polled.ready) {
      pump.submit(r.tag.ticket, { t: "pixels", data: r.data, width: r.width, height: r.height }, r.tag.hud);
      options.onReadback?.({ kind: "done", frameMs: framePageMs, latencyFrames: r.latencyFrames });
    }
    for (const tag of polled.dropped) pump.abandon(tag.ticket);
    if (reader.state === "lost") reader = null;
    else if (reader.state === "failed") fallBackToD();
    return polled.ready.length > 0 || polled.dropped.length > 0;
  };

  /** Queue a readback of the frame the game just drew. Returns true when a ticket was taken. */
  const kickE = (framePageMs: number): boolean => {
    if (!reader || !hasPixels()) return false;
    if (!reader.canKick()) {
      if (reader.busy) options.onReadback?.({ kind: "busy", frameMs: framePageMs });
      return false;
    }
    const ticket = pump.offer(framePageMs);
    if (!ticket) return false;
    const result = reader.kick({ ticket, hud: readHud() });
    if (result === "ok") {
      consecutiveErrors = 0;
      return true;
    }
    pump.abandon(ticket);
    if (result === "lost") reader = null;
    else if (result === "failed") fallBackToD();
    return true;
  };

  // ---- context loss (path E) ----------------------------------------------

  const onLost = () => {
    if (!reader) return;
    for (const tag of reader.markLost()) pump.abandon(tag.ticket);
    reader = null;
  };
  const onRestored = () => {
    // A restored context is the same object with fresh state.
    if (stopped || path !== "E" || !gl2) return;
    reader = new PathEReader(gl2, { targetWidth: readbackWidth });
  };

  /** The path became known: set up what it needs. */
  const onPathChosen = () => {
    if (path !== "E" && typeof VideoFrame === "undefined") {
      fail(new Error("registerCanvasSource: VideoFrame is not available for capture path " + path), true);
      return;
    }
    if (path === "E" && gl2) {
      reader = new PathEReader(gl2, { targetWidth: readbackWidth });
      canvas.addEventListener("webglcontextlost", onLost);
      canvas.addEventListener("webglcontextrestored", onRestored);
      removers.push(() => {
        canvas.removeEventListener("webglcontextlost", onLost);
        canvas.removeEventListener("webglcontextrestored", onRestored);
      });
    }
    if (path) options.onPathChange?.(path, "context");
  };

  // ---- hooks ---------------------------------------------------------------

  let previousTs: number | null = null;
  let seqAtPre = 0;
  let framesAtPre = dispatcher.gameFrames();

  // The path is chosen the moment the game's context becomes known: in the
  // game's getContext call, or at its first draw.
  const resolveNow = () => {
    if (!stopped && !path && choosePath()) onPathChosen();
  };
  removers.push(
    activity.onContext((r) => {
      if (r.canvas === canvas) resolveNow();
    }),
  );
  removers.push(
    dispatcher.addPreHook((t) => {
      if (stopped) return;
      resolveNow();
      if (stopped) return;
      record ??= activity.record(canvas);
      seqAtPre = record?.drawSeq ?? 0;
      framesAtPre = dispatcher.gameFrames();
      if (path === "P" && warm && previousTs !== null) readCanvas(previousTs + offsetMs, t + offsetMs);
      previousTs = t;
    }),
  );
  removers.push(
    dispatcher.addPostHook((t) => {
      if (stopped) return;
      const pageMs = t + offsetMs;
      if (dispatcher.gameFrames() !== framesAtPre) {
        const baseline = !warm && !pump.paused;
        advanceWarmup(pageMs);
        options.onGameFrame?.(pageMs, { baseline });
      }
      if (!path) return;
      record ??= activity.record(canvas);
      const drew = record !== undefined && record.drawSeq !== seqAtPre;
      if (path === "D") {
        const ran = dispatcher.gameFrames() !== framesAtPre;
        if (warm && (isGl(record) ? drew : ran)) readCanvas(pageMs, pageMs);
      } else if (path === "E") {
        const t0 = now();
        const collected = collectE(pageMs);
        const ticket = warm && drew && path === "E" ? kickE(pageMs) : false;
        if (collected || ticket) cost(now() - t0, pageMs, ticket);
        if (reader && reader.pending > 0) dispatcher.wake();
      }
    }),
  );

  if (path) onPathChosen();

  function stop(): void {
    if (stopped) return;
    stopped = true;
    for (const remove of removers.splice(0)) remove();
    if (reader) {
      for (const tag of reader.dispose()) pump.abandon(tag.ticket);
      reader = null;
    }
    dispatcher.uninstall();
    activity.uninstall();
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
