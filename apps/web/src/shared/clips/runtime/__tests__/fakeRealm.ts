/**
 * Fake requestAnimationFrame realm for the clips runtime and sources tests.
 * Single copy: the dispatcher, pump, source and auto-discovery tests use it.
 *
 * It behaves like a browser realm: native ids count up from 1, callbacks
 * queued during a frame run in the next frame, and a frame runs every
 * callback that was queued before it started.
 */
export class FakeRealm {
  private nextNativeId = 1;
  private queue = new Map<number, FrameRequestCallback>();
  readonly errors: unknown[] = [];
  /** Timestamps of the frames that ran. */
  readonly frames: number[] = [];
  /** The native functions, kept so tests can check that uninstall restores them. */
  readonly nativeRaf: (cb: FrameRequestCallback) => number;
  readonly nativeCaf: (id: number) => void;
  requestAnimationFrame: (cb: FrameRequestCallback) => number;
  cancelAnimationFrame: (id: number) => void;
  reportError = (error: unknown): void => {
    this.errors.push(error);
  };
  performance = { timeOrigin: 0, now: () => 0 };

  constructor(timeOrigin = 0) {
    this.performance.timeOrigin = timeOrigin;
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
}
