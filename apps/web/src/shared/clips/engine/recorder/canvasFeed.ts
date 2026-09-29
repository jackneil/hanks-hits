/**
 * The canvas feed of the MediaRecorder engine (tiers M and V, plan 3a, 5,
 * 6.1): it takes game frames from one canvas and paints them into the
 * page compositor, whose captureStream() the recorders take.
 *
 * Tier V browsers can have no VideoFrame (Firefox desktop before 130), so the
 * feed never makes one: it draws the game canvas straight into the
 * compositor canvas with drawImage. It uses the same timing rules as the
 * canvas source of tiers W and W+ (sources/canvasSource.ts), from the realm's
 * rAF dispatcher:
 * - a 2D (or bitmap) canvas is drawn in a PRE hook, before the game draws:
 *   the frame that is on screen (plan 3a path P: a read after the draw makes
 *   Safari finish the game's drawing on the spot);
 * - a WebGL canvas is drawn in a POST hook, only in a dispatch in which the
 *   game drew on it: with preserveDrawingBuffer false, the buffer is clear
 *   in every other dispatch;
 * - any other context is drawn in a POST hook after game callbacks ran.
 *
 * The feed never calls getContext on the game canvas: the realm's canvas
 * activity tracker tells it the context type. Until the game has a context,
 * nothing is drawn.
 *
 * Pace: the engine's Pacer says when a frame is due (the governor's stride
 * on the display's vsync grid). Warmup: the first BASELINE_WARMUP_MS of live
 * play are not captured, and those game frames are reported as the
 * governor's baseline. The engine starts its recorders at the first paint
 * after the warmup, so no recorder records the empty canvas.
 *
 * Touch: a recorder gets a frame only when the compositor canvas is painted.
 * requestTouch() asks for one more display frame (the dispatcher's wake(),
 * which runs even when the game queues no frame), and in its POST hook the
 * feed calls `touch` when nothing was painted in that frame: the engine
 * paints the last picture again there. A touch runs in the display frame, so
 * its paint time is the time of the frame that the recorder gets.
 *
 * Pictures: snapshotPng() reads the game canvas with the same timing.
 */

import type { CapturePath, HudState } from "../../protocol";
import { installRafDispatcher, type RafDispatcher } from "../../runtime/rafDispatcher";
import { installCanvasActivity, type ActivityRealm, type CanvasActivity, type CanvasRecord, type ContextType } from "../../sources/canvasActivity";
import { BASELINE_WARMUP_MS, MAX_CONSECUTIVE_ERRORS } from "../../sources/canvasSource";

/**
 * When a frame is due: the first frame, then each frame at least `stride`
 * vsyncs after the last one taken. Vsync indexes are rounded from page time,
 * so jitter under half a vsync never moves a frame (plan 6.2).
 */
export class Pacer {
  private readonly vsyncMs: number;
  private stride = 1;
  private lastIndex: number | null = null;

  constructor(displayHz: number, stride = 1) {
    this.vsyncMs = 1000 / Math.max(1, displayHz);
    this.setStride(stride);
  }

  /** Frames between captures (the governor rung). */
  setStride(stride: number): void {
    this.stride = Math.max(1, Math.round(stride));
  }

  get currentStride(): number {
    return this.stride;
  }

  due(pageMs: number): boolean {
    if (this.lastIndex === null) return true;
    return Math.round(pageMs / this.vsyncMs) - this.lastIndex >= this.stride;
  }

  /** A frame was taken at pageMs. */
  mark(pageMs: number): void {
    this.lastIndex = Math.round(pageMs / this.vsyncMs);
  }

  /** The next frame is due at once (after a pause). */
  reset(): void {
    this.lastIndex = null;
  }
}

export interface CanvasFeedOptions {
  canvas: HTMLCanvasElement;
  /** Paints the game canvas into the compositor, in the display frame at pageMs. Throws what drawImage throws. */
  draw(canvas: HTMLCanvasElement, hud: HudState, pageMs: number): void;
  /** Paints the last picture again, in the display frame at pageMs (see requestTouch). */
  touch?(pageMs: number): void;
  /** Runs at the end of every display frame that the feed sees (a POST hook). */
  onFrame?(pageMs: number): void;
  /** Game values for the band. Read at capture time. */
  hud(): HudState;
  pacer: Pacer;
  /** True while capture runs (a recorder records). */
  live(): boolean;
  /** Main-thread cost of each captured frame (a governor input). */
  onCaptureCost?(sample: { frameMs: number; ms: number; path: CapturePath }): void;
  /** Page time of each frame in which game callbacks ran (a governor input). */
  onGameFrame?(pageMs: number, info: { baseline: boolean }): void;
  /** Capture cannot read this canvas (a tainted canvas). The feed stops. */
  onError?(error: unknown): void;
  /** Live play before the first capture, for the governor's baseline. Default BASELINE_WARMUP_MS. */
  warmupMs?: number;
  /** Page realm for time conversion. Default: the global window. */
  pageRealm?: { performance: { timeOrigin: number } };
  now?: () => number;
}

export interface CanvasFeed {
  readonly canvas: HTMLCanvasElement;
  /** The game's context type, or null while the game has none on this canvas. */
  readonly contextType: ContextType | null;
  /** Frames painted since the start. */
  readonly frames: number;
  /** True after stop(), also when the feed stopped itself (a canvas it cannot read). */
  readonly stopped: boolean;
  /**
   * The game picture as PNG, read with the capture timing. "no-draw": a
   * WebGL game that did not draw within timeoutMs (it is paused), so its
   * buffer is clear. null: the canvas cannot be read.
   */
  snapshotPng(timeoutMs: number, timers: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void }): Promise<{ png: ArrayBuffer; width: number; height: number } | "no-draw" | null>;
  /** Asks for a touch in the next display frame (see the file comment). */
  requestTouch(): void;
  stop(): void;
}

type Realm = ActivityRealm & { performance: { timeOrigin: number } };

function realmOf(canvas: HTMLCanvasElement): Realm {
  const view = canvas.ownerDocument?.defaultView;
  if (!view) throw new Error("the canvas is not in a document with a window");
  return view as unknown as Realm;
}

function isSecurityError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: string }).name === "SecurityError";
}

function isGl(type: ContextType | undefined): boolean {
  return type === "webgl" || type === "webgl2";
}

/** A canvas that keeps its pixels between frames can be read at any time. */
function keepsPixels(type: ContextType | undefined): boolean {
  return type === "2d" || type === "bitmaprenderer";
}

export function startCanvasFeed(options: CanvasFeedOptions): CanvasFeed {
  const { canvas, pacer } = options;
  const now = options.now ?? (() => performance.now());
  const realm = realmOf(canvas);
  const page = options.pageRealm ?? (globalThis as unknown as { performance: { timeOrigin: number } });
  const offsetMs = realm.performance.timeOrigin - page.performance.timeOrigin;
  const activity: CanvasActivity = installCanvasActivity(realm);
  const dispatcher: RafDispatcher = installRafDispatcher(realm);
  const warmupMs = options.warmupMs ?? BASELINE_WARMUP_MS;
  let warm = warmupMs <= 0;
  let warmupStart: number | null = null;
  let stopped = false;
  let errors = 0;
  let frames = 0;
  let seqAtPre: number | null = null;
  let gameFramesAtPre = 0;
  let lastHud: HudState = { gameName: "", emoji: "" };
  let touchWanted = false;
  let paintedThisFrame = false;
  const snapshots = new Set<{ pre: (record: CanvasRecord | undefined) => void; post: (record: CanvasRecord | undefined, drew: boolean) => void }>();

  const record = (): CanvasRecord | undefined => activity.record(canvas);
  const hasPixels = () => canvas.width > 0 && canvas.height > 0;

  const readHud = (): HudState => {
    try {
      lastHud = options.hud();
    } catch {
      // Game code: keep the last good values.
    }
    return lastHud;
  };

  const advanceWarmup = (pageMs: number) => {
    if (warm) return;
    if (!options.live()) {
      warmupStart = null;
      return;
    }
    warmupStart ??= pageMs;
    if (pageMs - warmupStart >= warmupMs) warm = true;
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    removePre();
    removePost();
    dispatcher.uninstall();
    activity.uninstall();
    for (const s of [...snapshots]) s.post(undefined, false);
  };

  const capture = (pageMs: number, path: CapturePath) => {
    if (!warm || !options.live() || !hasPixels() || !pacer.due(pageMs)) return;
    const t0 = now();
    try {
      options.draw(canvas, readHud(), pageMs);
      pacer.mark(pageMs);
      frames++;
      errors = 0;
      paintedThisFrame = true;
    } catch (error) {
      errors++;
      if (isSecurityError(error) || errors >= MAX_CONSECUTIVE_ERRORS) {
        stop();
        options.onError?.(error);
        return;
      }
    }
    options.onCaptureCost?.({ frameMs: pageMs, ms: now() - t0, path });
  };

  const removePre = dispatcher.addPreHook((ts) => {
    if (stopped) return;
    paintedThisFrame = false;
    const r = record();
    seqAtPre = r?.drawSeq ?? null;
    gameFramesAtPre = dispatcher.gameFrames();
    for (const s of [...snapshots]) s.pre(r);
    if (keepsPixels(r?.type)) capture(ts + offsetMs, "P");
  });

  const removePost = dispatcher.addPostHook((ts) => {
    if (stopped) return;
    const pageMs = ts + offsetMs;
    const ran = dispatcher.gameFrames() > gameFramesAtPre;
    if (ran) {
      options.onGameFrame?.(pageMs, { baseline: !warm && options.live() });
      advanceWarmup(pageMs);
    }
    const r = record();
    const drew = !!r && r.drawSeq !== seqAtPre;
    for (const s of [...snapshots]) s.post(r, drew);
    if (r && !keepsPixels(r.type) && (isGl(r.type) ? drew : ran)) capture(pageMs, "D");
    if (touchWanted) {
      touchWanted = false;
      if (!paintedThisFrame && options.live()) options.touch?.(pageMs);
    }
    options.onFrame?.(pageMs);
  });

  const snapshotPng: CanvasFeed["snapshotPng"] = (timeoutMs, timers) =>
    new Promise((resolve) => {
      if (stopped || typeof canvas.toBlob !== "function") {
        resolve(null);
        return;
      }
      let done = false;
      let timer: unknown = null;
      const read = () => {
        const width = canvas.width;
        const height = canvas.height;
        try {
          // toBlob copies the pixels now, in this task.
          canvas.toBlob((blob) => {
            if (!blob) {
              resolve(null);
              return;
            }
            blob.arrayBuffer().then(
              (png) => resolve({ png, width, height }),
              () => resolve(null),
            );
          }, "image/png");
        } catch {
          resolve(null);
        }
      };
      const entry = {
        pre: (r: CanvasRecord | undefined) => {
          if (done || !keepsPixels(r?.type)) return;
          finish();
          read();
        },
        post: (r: CanvasRecord | undefined, drew: boolean) => {
          if (done) return;
          if (stopped) {
            finish();
            resolve(null);
            return;
          }
          if (!r || keepsPixels(r.type) || !drew) return;
          finish();
          read();
        },
      };
      const finish = () => {
        done = true;
        snapshots.delete(entry);
        if (timer !== null) timers.clear(timer);
      };
      snapshots.add(entry);
      timer = timers.set(() => {
        if (done) return;
        const type = record()?.type;
        finish();
        if (keepsPixels(type)) read();
        else resolve("no-draw");
      }, timeoutMs);
      dispatcher.wake();
    });

  return {
    canvas,
    get contextType() {
      return record()?.type ?? null;
    },
    get frames() {
      return frames;
    },
    get stopped() {
      return stopped;
    },
    snapshotPng,
    requestTouch() {
      if (stopped || touchWanted) return;
      touchWanted = true;
      dispatcher.wake();
    },
    stop,
  };
}
