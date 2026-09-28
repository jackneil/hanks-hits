/**
 * Shared fake requestAnimationFrame driver.
 *
 * jsdom runs requestAnimationFrame on its own timer, so a test cannot pick
 * the screen refresh rate or the frame times. This double keeps the frame
 * callbacks in a queue and runs them only when the test tells it to, with
 * exact timestamps for a 60, 90, 120 or 144 Hz screen. Keep this the single
 * copy: every game-loop test uses it.
 *
 * Use it with React's act(), because a frame callback can set state:
 *
 *   const raf = installRafMock();
 *   act(() => { raf.runFor(1000, 120); });
 *   uninstallRafMock();
 */

type FrameCallback = (timestamp: number) => void;

export type RafMock = {
  /** Run one frame at this timestamp (ms). Returns the number of callbacks that ran. */
  frame(timestamp: number): number;
  /** Run the next frame, one refresh interval after the clock. Returns the callbacks that ran. */
  nextFrame(hz: number): number;
  /**
   * Run every frame of a `hz` screen for `ms` of screen time after the clock:
   * round(ms * hz / 1000) frames, one refresh interval apart. When `ms` is a
   * whole number of intervals, the last frame lands exactly on clock + ms.
   * `wrap` runs around EACH frame: pass React's act so that React renders
   * between frames, like a real browser. Returns the number of frames.
   */
  runFor(ms: number, hz: number, wrap?: (runFrame: () => void) => unknown): number;
  /** Move the clock forward with no frames (a stalled page or a hidden tab). */
  stall(ms: number): void;
  /** The fake clock: the timestamp of the last frame, plus any stall. */
  now(): number;
  /** Callbacks that wait for the next frame. */
  pending(): number;
  /** Total calls to requestAnimationFrame since install. */
  requestCount(): number;
  /** Total calls to cancelAnimationFrame since install. */
  cancelCount(): number;
};

type SavedGlobals = {
  windowRaf: typeof window.requestAnimationFrame | undefined;
  windowCaf: typeof window.cancelAnimationFrame | undefined;
  globalRaf: typeof globalThis.requestAnimationFrame | undefined;
  globalCaf: typeof globalThis.cancelAnimationFrame | undefined;
};

let saved: SavedGlobals | null = null;

/** Install the fake on window and globalThis. The clock starts at `startMs`. */
export function installRafMock(startMs = 1000): RafMock {
  if (saved === null) {
    saved = {
      windowRaf: window.requestAnimationFrame,
      windowCaf: window.cancelAnimationFrame,
      globalRaf: globalThis.requestAnimationFrame,
      globalCaf: globalThis.cancelAnimationFrame,
    };
  }

  let queue = new Map<number, FrameCallback>();
  let nextId = 1;
  let clock = startMs;
  let requests = 0;
  let cancels = 0;

  const request = (callback: FrameCallback): number => {
    requests += 1;
    const id = nextId;
    nextId += 1;
    queue.set(id, callback);
    return id;
  };

  const cancel = (id: number): void => {
    cancels += 1;
    queue.delete(id);
  };

  const frame = (timestamp: number): number => {
    clock = timestamp;
    // Callbacks that a frame schedules wait for the NEXT frame, like a browser.
    const due = queue;
    queue = new Map();
    for (const callback of due.values()) callback(timestamp);
    return due.size;
  };

  const define = (target: object, name: string, value: unknown) => {
    Object.defineProperty(target, name, { configurable: true, writable: true, value });
  };
  define(window, "requestAnimationFrame", request);
  define(window, "cancelAnimationFrame", cancel);
  define(globalThis, "requestAnimationFrame", request);
  define(globalThis, "cancelAnimationFrame", cancel);

  return {
    frame,
    nextFrame(hz: number): number {
      return frame(clock + 1000 / hz);
    },
    runFor(ms: number, hz: number, wrap = (runFrame: () => void): unknown => runFrame()): number {
      const start = clock;
      const count = Math.round((ms * hz) / 1000);
      // Compute each timestamp from the start, never by adding intervals,
      // so rounding errors do not build up over a long run.
      for (let k = 1; k <= count; k += 1) {
        const timestamp = start + (k * 1000) / hz;
        wrap(() => {
          frame(timestamp);
        });
      }
      return count;
    },
    stall(ms: number): void {
      clock += ms;
    },
    now: () => clock,
    pending: () => queue.size,
    requestCount: () => requests,
    cancelCount: () => cancels,
  };
}

/** Put the real requestAnimationFrame back, for test teardown. */
export function uninstallRafMock(): void {
  if (saved === null) return;
  const define = (target: object, name: string, value: unknown) => {
    Object.defineProperty(target, name, { configurable: true, writable: true, value });
  };
  define(window, "requestAnimationFrame", saved.windowRaf);
  define(window, "cancelAnimationFrame", saved.windowCaf);
  define(globalThis, "requestAnimationFrame", saved.globalRaf);
  define(globalThis, "cancelAnimationFrame", saved.globalCaf);
  saved = null;
}
