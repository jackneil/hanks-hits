/**
 * Rotating MediaRecorders (tiers M and V, plan 5).
 *
 * One recorder makes one segment: a whole file with its own header, and a
 * keyframe first (every encoder starts with one). Every ROTATION_MS a new
 * recorder starts; when it has started, the old one records on for the
 * hand-off overlap and then stops. So two recorders run together only across
 * a hand-off, and the segments cover the capture timeline with no gap.
 *
 * Times: a segment starts at the capture time of its recorder's "start"
 * event and ends at the capture time of its stop() call. The io worker puts
 * each segment's first frame at its start time (engine/io/concat.ts).
 *
 * Hand-off on demand: a clip calls handOff(), so the newest footage is in a
 * finished segment. A hand-off that runs already is shared.
 *
 * Failures: a recorder that cannot be made, does not start in time, fires
 * "error", or gives no data after stop(), is a failure (onFailure). Its
 * segment is dropped. A failed new recorder in a hand-off leaves the old
 * one recording, and the hand-off is tried again later. A failed current
 * recorder leaves the rotator stopped: the engine decides what comes next.
 *
 * No browser API is read here: the engine gives the recorder factory, the
 * clocks and the timers, so tests drive it with a fake recorder.
 */

/** The parts of a MediaRecorder that the rotator uses. */
export interface MediaRecorderLike {
  readonly state: "inactive" | "recording" | "paused";
  readonly mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstart: ((event: unknown) => void) | null;
  onstop: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  start(timeslice?: number): void;
  stop(): void;
}

/** One finished recorder. */
export interface FinishedSegment {
  blob: Blob;
  startUs: number;
  endUs: number;
  mimeType: string;
  /**
   * The start of the recorder that took over in the hand-off (the next
   * segment's first frame), or null when this recorder stopped with no
   * successor (a pause, a stop, or the browser stopped it).
   */
  nextStartUs: number | null;
}

export type RotatorFailure = "create" | "start" | "record" | "stop";

export interface RotatorOptions {
  /** Makes a recorder for the current tracks. It throws when the browser refuses. */
  createRecorder(): MediaRecorderLike;
  /** Page time, in milliseconds. */
  now(): number;
  /** Capture time now, in microseconds. */
  captureUs(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  rotationMs: number;
  overlapMs: number;
  startTimeoutMs: number;
  stopTimeoutMs: number;
  /** Wait before a failed hand-off is tried again. */
  retryMs: number;
  /**
   * Hand-offs in a row whose new recorder failed while the old one recorded.
   * After this many, hand-offs stop the old recorder first (no overlap).
   */
  sequentialAfterFailures: number;
  onSegment(segment: FinishedSegment): void;
  /** A recorder fired "start" (capture runs). */
  onStarted?(): void;
  /** A recorder failed. current: it was the recorder that carries the footage. */
  onFailure(kind: RotatorFailure, info: { current: boolean }): void;
  log?(message: string): void;
}

type LiveState = "starting" | "recording" | "stopping" | "done" | "failed";

interface Live {
  recorder: MediaRecorderLike;
  chunks: Blob[];
  startUs: number | null;
  startedAtMs: number | null;
  endUs: number | null;
  nextStartUs: number | null;
  state: LiveState;
  started: Promise<boolean>;
  finished: Promise<void>;
  settleStarted(ok: boolean): void;
  settleFinished(): void;
  timer: unknown;
}

function nameOf(error: unknown): string {
  return (error as { name?: string } | null)?.name ?? "Error";
}

export class Rotator {
  private current: Live | null = null;
  private handing: Promise<void> | null = null;
  private rotationTimer: unknown = null;
  /** The overlap wait of a running hand-off: stop() and dispose() end it at once. */
  private overlap: { timer: unknown; end: () => void } | null = null;
  private disposed = false;
  private readonly all = new Set<Live>();
  /** Hand-offs in a row whose new recorder failed next to the old one. */
  private overlapFailures = 0;
  private noOverlap = false;

  constructor(private readonly options: RotatorOptions) {}

  /** True while a recorder records or starts (capture runs). */
  get running(): boolean {
    return this.current !== null && (this.current.state === "starting" || this.current.state === "recording");
  }

  /**
   * True after SEQUENTIAL_AFTER_FAILURES hand-offs could not run a second
   * recorder: from then on a hand-off stops the old recorder first.
   */
  get sequential(): boolean {
    return this.noOverlap;
  }

  /** Recorders that exist now (1, or 2 across a hand-off). */
  get liveCount(): number {
    let n = 0;
    for (const live of this.all) if (live.state === "starting" || live.state === "recording" || live.state === "stopping") n++;
    return n;
  }

  /** Starts the first recorder. Does nothing while one runs. */
  start(): void {
    if (this.disposed || this.running) return;
    const live = this.open();
    if (!live) return;
    this.current = live;
    void live.started.then((ok) => {
      if (ok && this.current === live) this.scheduleRotation(live);
    });
  }

  /**
   * Starts a new recorder and stops the current one after the overlap.
   * Settles when the old segment is out (or failed). A hand-off that runs
   * already is shared. Without a current recorder, it only starts one.
   */
  handOff(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.handing) return this.handing;
    const old = this.current;
    if (!old || !this.running) {
      this.start();
      return Promise.resolve();
    }
    const run = this.runHandOff(old).finally(() => {
      if (this.handing === run) this.handing = null;
    });
    this.handing = run;
    return run;
  }

  /**
   * Settles when every recorder that is stopping now has given its segment
   * (or failed). A running recorder is not waited for.
   */
  async drained(): Promise<void> {
    await Promise.all([...this.all].filter((live) => live.state === "stopping").map((live) => live.finished));
  }

  /** Stops every recorder. Settles when their segments are out (or failed). */
  async stop(): Promise<void> {
    this.clearRotation();
    const waits: Promise<void>[] = [];
    for (const live of [...this.all]) {
      if (live.state === "starting" || live.state === "recording") this.stopLive(live);
      waits.push(live.finished);
    }
    this.current = null;
    // A hand-off in its overlap has nothing more to do: both recorders are stopping.
    this.endOverlap();
    await Promise.all(waits);
    if (this.handing) await this.handing.catch(() => undefined);
  }

  /** Stops every recorder and drops their data: no segment comes after this. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearRotation();
    this.endOverlap();
    for (const live of [...this.all]) {
      if (live.state === "starting" || live.state === "recording") {
        try {
          live.recorder.stop();
        } catch {
          // Already stopped.
        }
      }
      this.finish(live, "failed");
    }
    this.current = null;
  }

  // ---------------------------------------------------------------------------

  private async runHandOff(old: Live): Promise<void> {
    this.clearRotation();
    if (this.noOverlap) {
      await this.runSequentialHandOff(old);
      return;
    }
    const next = this.open();
    if (!next) {
      this.overlapFailed();
      this.retryLater(old);
      return;
    }
    const ok = await next.started;
    if (this.disposed) return;
    if (!ok) {
      // The old recorder records on; try again later.
      this.overlapFailed();
      this.retryLater(old);
      return;
    }
    this.overlapFailures = 0;
    if (this.current !== old || old.state !== "recording") {
      // The old recorder failed meanwhile: the new one carries the footage now.
      // After stop() (a pause) the new one is stopped too, and nothing changes.
      if ((this.current === null || this.current === old) && next.state === "recording") {
        this.current = next;
        this.scheduleRotation(next);
      }
      return;
    }
    // Both record now. The old one records on for the overlap, then stops.
    await new Promise<void>((resolve) => {
      const timer = this.options.setTimeout(() => {
        this.overlap = null;
        resolve();
      }, this.options.overlapMs);
      this.overlap = { timer, end: resolve };
    });
    if (this.disposed) return;
    if (this.current === old) this.current = next;
    if (old.state === "recording") {
      // The old segment is used up to the new segment's first frame.
      if (next.state === "recording") old.nextStartUs = next.startUs;
      this.stopLive(old);
    }
    if (this.current === next && next.state === "recording") this.scheduleRotation(next);
    await old.finished;
  }

  /** A second recorder could not run next to the old one. */
  private overlapFailed(): void {
    this.overlapFailures++;
    if (!this.noOverlap && this.overlapFailures >= this.options.sequentialAfterFailures) {
      this.noOverlap = true;
      this.options.log?.("[clips] this device runs one recorder at a time; hand-offs stop the old recorder first");
    }
  }

  /**
   * A hand-off with no overlap: the old recorder stops now, then the new one
   * starts. The footage misses only the new recorder's start-up.
   */
  private async runSequentialHandOff(old: Live): Promise<void> {
    if (this.current !== old || old.state !== "recording") return;
    this.stopLive(old);
    this.current = null;
    // A failure of the new recorder is reported by open(); nothing records then,
    // and the engine starts a recorder again later.
    const next = this.open();
    if (!next) {
      await old.finished;
      return;
    }
    this.current = next;
    void next.started.then((ok) => {
      if (ok && this.current === next) this.scheduleRotation(next);
    });
    await old.finished;
  }

  private retryLater(old: Live): void {
    if (this.current !== old || old.state !== "recording") return;
    this.clearRotation();
    this.rotationTimer = this.options.setTimeout(() => {
      this.rotationTimer = null;
      void this.handOff();
    }, this.options.retryMs);
  }

  private scheduleRotation(live: Live): void {
    this.clearRotation();
    const ranMs = live.startedAtMs === null ? 0 : this.options.now() - live.startedAtMs;
    this.rotationTimer = this.options.setTimeout(() => {
      this.rotationTimer = null;
      if (this.current === live) void this.handOff();
    }, Math.max(0, this.options.rotationMs - ranMs));
  }

  private clearRotation(): void {
    if (this.rotationTimer !== null) this.options.clearTimeout(this.rotationTimer);
    this.rotationTimer = null;
  }

  /** Ends the overlap wait of a running hand-off now. */
  private endOverlap(): void {
    const overlap = this.overlap;
    this.overlap = null;
    if (!overlap) return;
    this.options.clearTimeout(overlap.timer);
    overlap.end();
  }

  /** Makes and starts one recorder. Null when the browser refused (reported). */
  private open(): Live | null {
    let recorder: MediaRecorderLike;
    try {
      recorder = this.options.createRecorder();
    } catch (error) {
      this.options.log?.(`[clips] a recorder could not be made (${nameOf(error)})`);
      this.options.onFailure("create", { current: false });
      return null;
    }
    let settleStarted: (ok: boolean) => void = () => undefined;
    let settleFinished: () => void = () => undefined;
    const started = new Promise<boolean>((resolve) => {
      settleStarted = resolve;
    });
    const finished = new Promise<void>((resolve) => {
      settleFinished = resolve;
    });
    const live: Live = {
      recorder,
      chunks: [],
      startUs: null,
      startedAtMs: null,
      endUs: null,
      nextStartUs: null,
      state: "starting",
      started,
      finished,
      settleStarted,
      settleFinished,
      timer: null,
    };
    this.all.add(live);
    recorder.ondataavailable = (event) => {
      if (event?.data && event.data.size > 0) live.chunks.push(event.data);
    };
    recorder.onstart = () => {
      if (live.state !== "starting") return;
      this.clearTimer(live);
      live.state = "recording";
      live.startUs = this.options.captureUs();
      live.startedAtMs = this.options.now();
      live.settleStarted(true);
      this.options.onStarted?.();
    };
    recorder.onerror = () => {
      if (live.state === "done" || live.state === "failed") return;
      const kind: RotatorFailure = live.state === "starting" ? "start" : live.state === "stopping" ? "stop" : "record";
      this.fail(live, kind);
    };
    recorder.onstop = () => {
      if (live.state === "done" || live.state === "failed") return;
      if (live.state === "starting") {
        this.fail(live, "start");
        return;
      }
      this.clearTimer(live);
      // "recording": the browser stopped it (for example, a track ended). Its footage is still good.
      const byItself = live.state === "recording";
      if (live.endUs === null) live.endUs = this.options.captureUs();
      if (live.startUs === null || live.chunks.length === 0) {
        this.fail(live, "stop");
        return;
      }
      const blob = new Blob(live.chunks, { type: recorder.mimeType });
      live.chunks = [];
      const segment: FinishedSegment = {
        blob,
        startUs: live.startUs,
        endUs: live.endUs,
        mimeType: recorder.mimeType,
        nextStartUs: live.nextStartUs,
      };
      const wasCurrent = this.current === live;
      this.finish(live, "done");
      if (this.disposed) return;
      this.options.onSegment(segment);
      if (byItself && wasCurrent) {
        this.current = null;
        this.clearRotation();
        this.options.onFailure("record", { current: true });
      }
    };
    live.timer = this.options.setTimeout(() => {
      live.timer = null;
      if (live.state === "starting") this.fail(live, "start");
    }, this.options.startTimeoutMs);
    try {
      recorder.start();
    } catch (error) {
      this.options.log?.(`[clips] a recorder could not start (${nameOf(error)})`);
      this.fail(live, "start");
      return live.state === "failed" ? null : live;
    }
    return live;
  }

  /** Stops one recorder: its segment ends now on the capture timeline. */
  private stopLive(live: Live): void {
    if (live.state !== "starting" && live.state !== "recording") return;
    const wasStarting = live.state === "starting";
    live.endUs = this.options.captureUs();
    live.state = "stopping";
    this.clearTimer(live);
    if (wasStarting) {
      // Never started: nothing to keep. A late "start" event is ignored.
      try {
        live.recorder.stop();
      } catch {
        // Not started.
      }
      live.settleStarted(false);
      this.finish(live, "failed");
      return;
    }
    live.timer = this.options.setTimeout(() => {
      live.timer = null;
      if (live.state === "stopping") this.fail(live, "stop");
    }, this.options.stopTimeoutMs);
    try {
      live.recorder.stop();
    } catch (error) {
      this.options.log?.(`[clips] a recorder could not stop (${nameOf(error)})`);
      this.fail(live, "stop");
    }
  }

  private fail(live: Live, kind: RotatorFailure): void {
    if (live.state === "done" || live.state === "failed") return;
    const wasCurrent = this.current === live;
    if (live.state === "starting" || live.state === "recording") {
      try {
        live.recorder.stop();
      } catch {
        // Already stopped.
      }
    }
    this.finish(live, "failed");
    if (wasCurrent) {
      this.current = null;
      this.clearRotation();
    }
    if (!this.disposed) this.options.onFailure(kind, { current: wasCurrent });
  }

  private finish(live: Live, state: "done" | "failed"): void {
    this.clearTimer(live);
    live.state = state;
    live.chunks = [];
    live.recorder.ondataavailable = null;
    live.recorder.onstart = null;
    live.recorder.onstop = null;
    live.recorder.onerror = null;
    this.all.delete(live);
    live.settleStarted(state === "done");
    live.settleFinished();
  }

  private clearTimer(live: Live): void {
    if (live.timer !== null) this.options.clearTimeout(live.timer);
    live.timer = null;
  }
}
