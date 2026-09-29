/**
 * MediaRecorder double for the tier M and V tests (single copy). The clips
 * recorder tests import it from here.
 *
 * It follows the MediaRecorder event order that the engine depends on:
 * - start(): the state becomes "recording" at once; the "start" event comes
 *   later, in a task (FakeRecorderEnv.schedule) or after a delay, like a
 *   browser's queued event. start() on a recorder that is not inactive throws
 *   InvalidStateError.
 * - stop(): the state becomes "inactive" at once; then "dataavailable" with
 *   the whole file (FakeRecorderEnv.segment gives it), then "stop". A stop()
 *   on an inactive recorder does nothing.
 * - fail(): "error", then the final "dataavailable" and "stop", like a
 *   recorder that the browser stops on an error.
 *
 * Frames (video recorders): a recorder gets the frames that its video track
 * delivers (FakeTrack.deliver: the page compositor was painted), the way
 * canvas capture works. `firstFrame` says where a recording starts:
 * - "event" (the default): "start" comes one task after start(), with or
 *   without frames (for the rotator's own tests).
 * - "next-frame" (Chromium, media_recorder.cc): the first frame is the first
 *   one delivered after start(); "start" comes `startDelayMs()` after it (the
 *   first encode), so a recorder with no frame never fires "start".
 * - "held" (Gecko, MediaRecorder.cpp): the first frame is the frame the track
 *   holds at start() (painted before it), put at the start() time; "start"
 *   comes `startDelayMs()` after start().
 * Each recorder keeps its frames (atUs: the frame's time in the file, from
 * the capture clock; code: the picture), so a test can make a real file of
 * exactly those frames.
 *
 * Sound recorders: start(timeslice) gives a chunk every timeslice
 * (FakeRecorderEnv.chunk), requestData() gives one now, and stop() gives the
 * last one before "stop".
 *
 * Behaviors make a recorder fail the ways real ones do: no "start" event, an
 * "error" at start with no "start" (errorAtStart), "start" and then "error",
 * an empty "dataavailable" and "stop" in one task (errorAfterStart: Chromium
 * with an encoder that cannot open), no data at stop, or a throw in the
 * constructor. maxRecording makes a device with a limit of encoder sessions:
 * a recorder that starts while that many others hold a session fails like
 * errorAfterStart. A recorder holds its session from start() until its last
 * "stop" event (its encoder is released then), not only while "recording".
 */

export interface FakeRecorderBehavior {
  /** start() fires no "start" event (the rotator's start timeout must catch it). */
  noStartEvent?: boolean;
  /** start() fires "error" and "stop" instead of "start". */
  errorAtStart?: boolean;
  /** "start", then "error", an empty "dataavailable" and "stop", in one task (Chromium). */
  errorAfterStart?: boolean;
  /** stop() gives no data. */
  noData?: boolean;
  /** The constructor throws NotSupportedError. */
  throwOnCreate?: boolean;
}

/** One frame that a video recorder got. */
export interface FakeFrame {
  /** Capture time of the frame in the file (the first frame's is the recording's start). */
  atUs: number;
  /** The picture (a test's code for what was painted). */
  code: number;
}

export interface FakeRecorderEnv {
  /** Runs `fn` later (a queued browser task). */
  schedule(fn: () => void): void;
  /** Runs `fn` after `ms` (a browser timer). Needed for startDelayMs and timeslices. */
  setTimeout?(fn: () => void, ms: number): unknown;
  clearTimeout?(handle: unknown): void;
  /** Capture time now, in microseconds. */
  captureUs(): number;
  /** The file this video recorder made (called at stop). */
  segment(recorder: FakeMediaRecorder): Blob | Promise<Blob>;
  /** Sound recorders: the bytes since the last chunk (null: none). final: the stop. */
  chunk?(recorder: FakeMediaRecorder, final: boolean): Blob | null;
  /** The behavior of the next recorders, in order. Missing: a working recorder. */
  behaviors?: FakeRecorderBehavior[];
  /**
   * The most recorders that may hold an encoder session at the same time (a
   * phone with one hardware encoder session has 1). A start() past it fails
   * like errorAfterStart. Missing: no limit.
   */
  maxRecording?: number;
  /** The recorders made so far (fakeRecorderFactory sets it), for maxRecording. */
  peers?: () => FakeMediaRecorder[];
  /** Where a video recording starts (see the file comment). Default "event". */
  firstFrame?: "event" | "next-frame" | "held";
  /** The first encode's delay before "start", in ms ("next-frame" and "held"). Default 0. */
  startDelayMs?: () => number;
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
  /** Capture time of the start() call, or null. */
  startCalledUs: number | null = null;
  /** Capture time of the "start" event, or null. */
  startedUs: number | null = null;
  /** Capture time of the stop() call (or of the error), or null. */
  stoppedUs: number | null = null;
  /** The frames this recorder got, in order. */
  readonly frames: FakeFrame[] = [];
  /** The timeslice of start(), or null. */
  timeslice: number | null = null;
  /** True from start() until the last "stop" event: the encoder session is held. */
  holdsSession = false;
  readonly behavior: FakeRecorderBehavior;
  private unsubscribe: (() => void) | null = null;
  private sliceTimer: unknown = null;
  private startTimerSet = false;
  /** Fails like Chromium: "error", the empty "dataavailable" and "stop" in one task. */
  private failInTask = false;

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

  private get videoTrack(): FakeTrack | null {
    return (this.stream.getTracks().find((t) => (t as FakeTrack).kind === "video") as FakeTrack | undefined) ?? null;
  }

  start(timeslice?: number): void {
    if (this.state !== "inactive") throw new DOMException("already started", "InvalidStateError");
    const busy = (this.env.peers?.() ?? []).filter((r) => r !== this && r.holdsSession).length;
    this.state = "recording";
    this.holdsSession = true;
    this.startCalledUs = this.env.captureUs();
    this.timeslice = timeslice ?? null;
    if (this.behavior.noStartEvent) return;
    if (this.behavior.errorAtStart) {
      this.env.schedule(() => this.fail());
      return;
    }
    if (this.behavior.errorAfterStart || (this.env.maxRecording !== undefined && busy >= this.env.maxRecording)) {
      this.failInTask = true;
      this.env.schedule(() => {
        if (this.state !== "recording") return;
        this.startedUs = this.env.captureUs();
        this.onstart?.({ type: "start" });
        this.fail();
      });
      return;
    }
    const video = this.videoTrack;
    const mode = video ? (this.env.firstFrame ?? "event") : "event";
    if (video && mode !== "event") {
      if (mode === "held" && video.lastFrame) this.frames.push({ atUs: this.startCalledUs, code: video.lastFrame.code });
      this.unsubscribe = video.addSink((frame) => this.onFrame(frame));
      if (mode === "held") this.fireStartLater();
      return;
    }
    if (video) this.unsubscribe = video.addSink((frame) => this.onFrame(frame));
    this.env.schedule(() => this.fireStart());
    if (this.timeslice !== null) this.scheduleSlice();
  }

  stop(): void {
    if (this.state === "inactive") return;
    this.state = "inactive";
    this.stoppedUs = this.env.captureUs();
    this.endInput();
    this.env.schedule(() => void this.finish(false));
  }

  requestData(): void {
    if (this.state !== "recording") throw new DOMException("not recording", "InvalidStateError");
    this.env.schedule(() => this.giveChunk(false));
  }

  /** The browser stops this recorder on an error. */
  fail(): void {
    if (this.stoppedUs === null) this.stoppedUs = this.env.captureUs();
    this.state = "inactive";
    this.endInput();
    this.onerror?.({ type: "error", error: new DOMException("encoder failed", "UnknownError") });
    if (this.failInTask) {
      // Chromium: the empty "dataavailable" and "stop" come in the same task.
      this.ondataavailable?.({ data: new Blob([]) });
      this.holdsSession = false;
      this.onstop?.({ type: "stop" });
      return;
    }
    this.env.schedule(() => void this.finish(true));
  }

  private onFrame(frame: { atUs: number; code: number }): void {
    if (this.state !== "recording") return;
    // A frame of the same moment as the one before it replaces it: Gecko's held frame at start() lasts no time
    // when the canvas was painted in the task that called start().
    const last = this.frames[this.frames.length - 1];
    if (last && frame.atUs <= last.atUs) this.frames.pop();
    this.frames.push({ atUs: frame.atUs, code: frame.code });
    if ((this.env.firstFrame ?? "event") === "next-frame" && this.frames.length === 1) this.fireStartLater();
  }

  private fireStartLater(): void {
    if (this.startTimerSet) return;
    this.startTimerSet = true;
    const delay = this.env.startDelayMs?.() ?? 0;
    if (delay > 0 && this.env.setTimeout) this.env.setTimeout(() => this.fireStart(), delay);
    else this.env.schedule(() => this.fireStart());
  }

  private fireStart(): void {
    if (this.state !== "recording" || this.startedUs !== null) return;
    this.startedUs = this.env.captureUs();
    this.onstart?.({ type: "start" });
  }

  private scheduleSlice(): void {
    if (this.timeslice === null || !this.env.setTimeout) return;
    this.sliceTimer = this.env.setTimeout(() => {
      this.sliceTimer = null;
      if (this.state !== "recording") return;
      this.giveChunk(false);
      this.scheduleSlice();
    }, this.timeslice);
  }

  private giveChunk(final: boolean): void {
    const blob = this.env.chunk?.(this, final) ?? null;
    if (blob && blob.size > 0) this.ondataavailable?.({ data: blob });
  }

  private endInput(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.sliceTimer !== null) this.env.clearTimeout?.(this.sliceTimer);
    this.sliceTimer = null;
  }

  private async finish(failed: boolean): Promise<void> {
    if (this.timeslice !== null) {
      // A sound recorder: its last chunk.
      if (!failed && !this.behavior.noData && this.startedUs !== null) this.giveChunk(true);
    } else if (!this.behavior.noData && this.startedUs !== null && (this.frames.length > 0 || (this.env.firstFrame ?? "event") === "event")) {
      const blob = await this.env.segment(this);
      this.ondataavailable?.({ data: blob });
    }
    this.holdsSession = false;
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

/**
 * A MediaStreamTrack double. A video track delivers frames to its sinks (the
 * recorders) when the page compositor is painted, and holds the last one.
 * With `schedule`, a frame reaches the track after the task that painted it
 * (canvas capture takes the canvas at the next rendering update): a recorder
 * started in that task, after the paint, still gets the frame.
 */
export class FakeTrack {
  readyState: "live" | "ended" = "live";
  lastFrame: { atUs: number; code: number } | null = null;
  private readonly sinks = new Set<(frame: { atUs: number; code: number }) => void>();
  constructor(
    readonly kind: "video" | "audio",
    private readonly schedule?: (fn: () => void) => void,
  ) {}
  stop(): void {
    this.readyState = "ended";
  }
  /** A new frame (the canvas was painted at capture time atUs). */
  deliver(frame: { atUs: number; code: number }): void {
    const give = () => {
      if (this.readyState === "ended") return;
      this.lastFrame = frame;
      for (const sink of [...this.sinks]) sink(frame);
    };
    if (this.schedule) this.schedule(give);
    else give();
  }
  addSink(sink: (frame: { atUs: number; code: number }) => void): () => void {
    this.sinks.add(sink);
    return () => this.sinks.delete(sink);
  }
}
