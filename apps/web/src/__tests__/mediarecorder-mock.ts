/**
 * MediaRecorder double for the tier M and V tests (single copy). The clips
 * recorder tests import it from here.
 *
 * It follows the MediaRecorder event order that the engine depends on:
 * - start(): the state becomes "recording" at once; the "start" event comes
 *   later, in a task the test schedules (FakeRecorderEnv.schedule), like a
 *   browser's queued event. start() on a recorder that is not inactive throws
 *   InvalidStateError.
 * - stop(): the state becomes "inactive" at once; then "dataavailable" with
 *   the whole file (FakeRecorderEnv.segment gives it), then "stop". A stop()
 *   on an inactive recorder does nothing.
 * - fail(): "error", then the final "dataavailable" and "stop", like a
 *   recorder that the browser stops on an error.
 *
 * Behaviors make a recorder fail the ways real ones do: no "start" event, an
 * "error" at start, no data at stop, or a throw in the constructor.
 * maxRecording makes a device with a limit of encoder sessions: a recorder
 * that starts while that many others record fails at start.
 *
 * Each recorder notes the capture time of its "start" event and of its
 * stop() call (FakeRecorderEnv.captureUs), so a test can give it a real
 * segment file of exactly that span.
 */

export interface FakeRecorderBehavior {
  /** start() fires no "start" event (the rotator's start timeout must catch it). */
  noStartEvent?: boolean;
  /** start() fires "error" and "stop" instead of "start". */
  errorAtStart?: boolean;
  /** stop() gives no data. */
  noData?: boolean;
  /** The constructor throws NotSupportedError. */
  throwOnCreate?: boolean;
}

export interface FakeRecorderEnv {
  /** Runs `fn` later (a queued browser task). */
  schedule(fn: () => void): void;
  /** Capture time now, in microseconds. */
  captureUs(): number;
  /** The file this recorder made (called at stop). */
  segment(recorder: FakeMediaRecorder): Blob | Promise<Blob>;
  /** The behavior of the next recorders, in order. Missing: a working recorder. */
  behaviors?: FakeRecorderBehavior[];
  /**
   * The most recorders that may record at the same time (a phone with one
   * hardware encoder session has 1). A start() past it fails like
   * errorAtStart. Missing: no limit.
   */
  maxRecording?: number;
  /** The recorders made so far (fakeRecorderFactory sets it), for maxRecording. */
  peers?: () => FakeMediaRecorder[];
}

let nextId = 0;

export class FakeMediaRecorder {
  readonly id = ++nextId;
  state: "inactive" | "recording" | "paused" = "inactive";
  readonly mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstart: ((event: unknown) => void) | null = null;
  onstop: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  /** Capture time of the "start" event, or null. */
  startedUs: number | null = null;
  /** Capture time of the stop() call (or of the error), or null. */
  stoppedUs: number | null = null;
  readonly behavior: FakeRecorderBehavior;

  constructor(
    readonly stream: { getTracks(): unknown[] },
    readonly options: Record<string, unknown> & { mimeType: string },
    private readonly env: FakeRecorderEnv,
    behavior: FakeRecorderBehavior = {},
  ) {
    this.behavior = behavior;
    if (behavior.throwOnCreate) throw new DOMException("not supported", "NotSupportedError");
    this.mimeType = options.mimeType;
  }

  start(timeslice?: number): void {
    void timeslice;
    if (this.state !== "inactive") throw new DOMException("already started", "InvalidStateError");
    const busy = (this.env.peers?.() ?? []).filter((r) => r !== this && r.state === "recording").length;
    this.state = "recording";
    if (this.behavior.noStartEvent) return;
    if (this.behavior.errorAtStart || (this.env.maxRecording !== undefined && busy >= this.env.maxRecording)) {
      this.env.schedule(() => this.fail());
      return;
    }
    this.env.schedule(() => {
      if (this.state !== "recording") return;
      this.startedUs = this.env.captureUs();
      this.onstart?.({ type: "start" });
    });
  }

  stop(): void {
    if (this.state === "inactive") return;
    this.state = "inactive";
    this.stoppedUs = this.env.captureUs();
    this.env.schedule(() => void this.finish());
  }

  /** The browser stops this recorder on an error. */
  fail(): void {
    if (this.stoppedUs === null) this.stoppedUs = this.env.captureUs();
    this.state = "inactive";
    this.onerror?.({ type: "error", error: new DOMException("encoder failed", "UnknownError") });
    this.env.schedule(() => void this.finish());
  }

  private async finish(): Promise<void> {
    if (!this.behavior.noData && this.startedUs !== null) {
      const blob = await this.env.segment(this);
      this.ondataavailable?.({ data: blob });
    }
    this.onstop?.({ type: "stop" });
  }
}

/** A factory for the engine (RecorderEngineDeps.createRecorder) that keeps every recorder it made. */
export function fakeRecorderFactory(env: FakeRecorderEnv): {
  create: (stream: { getTracks(): unknown[] }, options: Record<string, unknown> & { mimeType: string }) => FakeMediaRecorder;
  made: FakeMediaRecorder[];
} {
  const made: FakeMediaRecorder[] = [];
  let count = 0;
  const shared: FakeRecorderEnv = { ...env, peers: () => made };
  return {
    made,
    create: (stream, options) => {
      const behavior = env.behaviors?.[count] ?? {};
      count++;
      const recorder = new FakeMediaRecorder(stream, options, shared, behavior);
      made.push(recorder);
      return recorder;
    },
  };
}

/** A MediaStream double: it keeps its tracks. */
export class FakeMediaStream {
  constructor(private readonly tracks: unknown[]) {}
  getTracks(): unknown[] {
    return this.tracks.slice();
  }
  getVideoTracks(): unknown[] {
    return this.tracks.filter((t) => (t as { kind?: string }).kind === "video");
  }
  getAudioTracks(): unknown[] {
    return this.tracks.filter((t) => (t as { kind?: string }).kind === "audio");
  }
}

/** A MediaStreamTrack double. */
export class FakeTrack {
  readyState: "live" | "ended" = "live";
  constructor(readonly kind: "video" | "audio") {}
  stop(): void {
    this.readyState = "ended";
  }
}
