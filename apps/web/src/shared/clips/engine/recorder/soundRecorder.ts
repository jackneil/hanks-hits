/**
 * The game sound recorder of tiers M and V (plan 5, 6.3).
 *
 * The rotating recorders record video only. The game sound goes to one
 * audio-only MediaRecorder that does not restart while capture runs: a sound
 * "run". Its timeslice chunks go to the io worker in order ("audioAppend"),
 * where the sound store reads the packets from them as they arrive
 * (engine/io/soundStore.ts). So the sound of a clip never has a splice at a
 * video hand-off: two encoder streams joined packet by packet give a click
 * or a drop-out at each join.
 *
 * - A run starts with capture and ends when capture stops (a pause: capture
 *   time stands still then) or when the sound track changes (a new bus).
 * - The run's first packet is at the capture time of its recorder's start()
 *   call: the sound starts to flow into the recorder then.
 * - Every message to the io worker goes through one ordered chain (a chunk
 *   is a Blob, and its bytes come later), so the io worker gets each run's
 *   start, its chunks and its end in order, and every byte of a run before
 *   the next run starts.
 * - flush() asks the recorder for its newest bytes now (requestData), just
 *   before a clip, so the clip has its sound up to its end.
 * - A recorder that fails is tried again after a wait. After
 *   SOUND_FAILURE_LIMIT failures in a row, this session records no game
 *   sound (the video goes on).
 */

import type { SegmentContainer } from "../../protocol";
import { HANDOFF_RETRY_MS, RECORDER_AUDIO_BITRATE, SOUND_FAILURE_LIMIT, SOUND_TIMESLICE_MS } from "./constants";
import type { MediaRecorderLike } from "./rotator";

/** The io worker calls of the sound runs. IoClient fits it. */
export interface SoundIo {
  audioRun(runId: number, timeline: number, container: SegmentContainer, startUs: number, keepSeconds: number): void;
  audioAppend(runId: number, bytes: ArrayBuffer): void;
  audioEnd(runId: number): void;
}

export interface SoundRecorderOptions {
  createRecorder(stream: MediaStream, options: { mimeType: string; audioBitsPerSecond: number }): MediaRecorderLike;
  createStream(tracks: MediaStreamTrack[]): MediaStream;
  /** MediaRecorder.isTypeSupported. */
  isTypeSupported(mimeType: string): boolean;
  /** The types to try, in order (constants SOUND_TYPES). */
  types: readonly string[];
  container: SegmentContainer;
  /** The capture timeline (the engine session). */
  timeline: number;
  /** How much sound the io worker keeps (the ring length). */
  keepSeconds: number;
  /** Capture time now, in microseconds. */
  captureUs(): number;
  io: SoundIo;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  log(message: string): void;
}

interface Run {
  id: number;
  recorder: MediaRecorderLike;
  /** stop() was called: its end is not a failure. */
  stopping: boolean;
  failed: boolean;
  ended: boolean;
}

/** Run ids are unique in the page: the io worker is one per page. */
let nextRunId = 1;

function nameOf(error: unknown): string {
  return (error as { name?: string } | null)?.name ?? "Error";
}

export class SoundRecorder {
  private run: Run | null = null;
  private wanted: MediaStreamTrack | null = null;
  private failures = 0;
  private gaveUp = false;
  private disposed = false;
  private retryTimer: unknown = null;
  private chain: Promise<void> = Promise.resolve();
  /** The type that worked, tried first from then on. */
  private type: string | null = null;

  constructor(private readonly options: SoundRecorderOptions) {}

  /** True while a sound recorder records. */
  get running(): boolean {
    return this.run !== null;
  }

  /** True after SOUND_FAILURE_LIMIT failures in a row: no game sound for this session. */
  get off(): boolean {
    return this.gaveUp;
  }

  /** Starts a run on `track`. Does nothing while one runs. */
  start(track: MediaStreamTrack): void {
    this.wanted = track;
    if (this.run || this.disposed || this.gaveUp) return;
    this.open(track);
  }

  /** Ends the run: its last bytes and its end go to the io worker. */
  stop(): void {
    this.wanted = null;
    this.clearRetry();
    const run = this.run;
    if (!run) return;
    run.stopping = true;
    try {
      run.recorder.stop();
    } catch {
      this.endRun(run);
    }
  }

  /** Asks the recorder for its newest bytes now (before a clip). */
  flush(): void {
    const run = this.run;
    if (!run || run.recorder.state !== "recording") return;
    try {
      run.recorder.requestData?.();
    } catch {
      // Not recording any more: its stop gives the last bytes.
    }
  }

  /** Settles when every message so far is sent to the io worker. */
  sent(): Promise<void> {
    return this.chain;
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
  }

  // ---------------------------------------------------------------------------

  private open(track: MediaStreamTrack): void {
    const o = this.options;
    const types = this.type ? [this.type] : o.types.filter((t) => {
      try {
        return o.isTypeSupported(t);
      } catch {
        return false;
      }
    });
    for (const mimeType of types) {
      let recorder: MediaRecorderLike;
      try {
        recorder = o.createRecorder(o.createStream([track]), { mimeType, audioBitsPerSecond: RECORDER_AUDIO_BITRATE });
      } catch {
        continue;
      }
      const run: Run = { id: nextRunId++, recorder, stopping: false, failed: false, ended: false };
      const startUs = o.captureUs();
      this.send(() => o.io.audioRun(run.id, o.timeline, o.container, startUs, o.keepSeconds));
      recorder.ondataavailable = (event) => {
        const data = event?.data;
        if (!data || data.size === 0) return;
        this.failures = 0;
        this.send(async () => {
          const bytes = await data.arrayBuffer();
          o.io.audioAppend(run.id, bytes);
        });
      };
      recorder.onerror = () => {
        run.failed = true;
        try {
          recorder.stop();
        } catch {
          // Already stopped: its stop event ends the run.
        }
      };
      recorder.onstop = () => this.endRun(run);
      try {
        recorder.start(SOUND_TIMESLICE_MS);
      } catch (error) {
        o.log(`[clips] the game sound recorder could not start (${nameOf(error)})`);
        recorder.ondataavailable = null;
        recorder.onerror = null;
        recorder.onstop = null;
        this.send(() => o.io.audioEnd(run.id));
        continue;
      }
      this.type = mimeType;
      this.run = run;
      return;
    }
    this.failed("no sound recorder could start");
  }

  private endRun(run: Run): void {
    if (run.ended) return;
    run.ended = true;
    run.recorder.ondataavailable = null;
    run.recorder.onerror = null;
    run.recorder.onstop = null;
    this.send(() => this.options.io.audioEnd(run.id));
    if (this.run === run) this.run = null;
    // The browser ended it (an error, or the track ended): try again while sound is wanted.
    if (run.failed || !run.stopping) this.failed(run.failed ? "the game sound recorder failed" : "the game sound recorder stopped");
  }

  private failed(why: string): void {
    this.failures++;
    if (this.failures >= SOUND_FAILURE_LIMIT) {
      this.gaveUp = true;
      this.options.log(`[clips] ${why} too many times; clips have no game sound for now`);
      return;
    }
    this.options.log(`[clips] ${why}; it starts again`);
    this.clearRetry();
    if (this.disposed) return;
    this.retryTimer = this.options.setTimeout(
      () => {
        this.retryTimer = null;
        const track = this.wanted;
        if (!track || this.run || this.disposed || track.readyState === "ended") return;
        this.open(track);
      },
      HANDOFF_RETRY_MS * 2 ** Math.max(0, this.failures - 1),
    );
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) this.options.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /** Sends in order: each message waits for the ones before it. */
  private send(task: () => void | Promise<void>): void {
    this.chain = this.chain.then(task).catch((error) => {
      this.options.log(`[clips] game sound bytes could not be sent (${nameOf(error)})`);
    });
  }
}
