/**
 * The lab metronome: one flash and one beep each second (plan 15.1 lab pattern).
 *
 * The lab calls tick() once in each requestAnimationFrame callback. The beat
 * follows the AudioContext clock: a beat is due when currentTime reaches the
 * next whole second of context time. In the frame where a beat is due, the
 * lab draws the flash AND starts the beep at currentTime, in the same task.
 * That is how a game makes a sound for a picture, and it is the pipeline's
 * definition of "the same instant" (encode/audio/clock.ts: a sound started at
 * page time p gets the frame currentTime(p), and its picture is the frame
 * drawn in that task). So the intended audio-minus-video offset is 0 ms.
 *
 * Flash length: the frame pump takes only the first frame of each capture
 * slot (k display frames, plan 6.2), and the governor can move capture to a
 * lower rung (a larger k) at any time. A flash that is shorter than k
 * display frames can fall between two captured frames and be lost, and the
 * beep then has no flash in the clip. So the flash stays white for the
 * stride of the LOWEST rung of the rung table (4 frames at 60 Hz: 60, 30, 20
 * and 15 fps). At every rung, at least one captured frame is white. The
 * analyzer uses the flash ONSET (the first white frame), so a longer flash
 * does not move the measured time. At rung k the first captured white frame
 * is at most k - 1 display frames after the real onset: that is the time
 * resolution of a video at that rung, the same for any flash length.
 *
 * Ground truth: every beat is logged with its context time, the rAF time of
 * its flash frame and performance.now() in that task.
 */
import { estimateDisplayHz, rungTable } from "../runtime/rungs";

/** Context seconds between two beats. */
export const BEAT_INTERVAL_SEC = 1;
/** A beat that is due by more than this (a hidden or stalled tab) is skipped, not played late. */
export const LATE_BEAT_LIMIT_SEC = 0.5;
/** rAF intervals kept for the display-rate estimate. */
export const INTERVAL_WINDOW = 120;
/** A rAF interval longer than this (ms) is a stall or a hidden tab, not a vsync. */
export const MAX_VSYNC_INTERVAL_MS = 250;
/** Beats kept in the ground-truth log. */
export const TRUTH_LIMIT = 600;

export interface LabAudioClock {
  /** AudioContext.currentTime. */
  time: number;
  state: AudioContextState | "interrupted";
}

export interface LabTickInput {
  /** The rAF timestamp of this frame (page ms). */
  rafTs: number;
  /** performance.now() in this task (page ms). */
  perfNow: number;
  /** The game-audio clock, or null when the page has no sound bus. */
  audio: LabAudioClock | null;
}

export interface LabBeat {
  index: number;
  /** Start the beep at this context time (the currentTime of this task). */
  ctxTime: number;
}

export interface LabTickResult {
  /** Draw this frame white. */
  flash: boolean;
  /** A beat is due in this frame: start the beep now. */
  beat: LabBeat | null;
}

/** One beat of ground truth. */
export interface BeatTruth {
  index: number;
  /** The context time that the beep started at. */
  ctxTime: number;
  /** The rAF timestamp of the first white frame. */
  rafTs: number;
  /** performance.now() in the task that started the beep. */
  perfNow: number;
  /** Display frames that the flash stays white. */
  holdFrames: number;
}

export interface LabMetronomeOptions {
  targetFps: 30 | 60;
  /** A fixed flash length in display frames; null for the stride of the lowest rung. */
  hold?: number | null;
}

export class LabMetronome {
  private readonly targetFps: 30 | 60;
  private readonly holdOverride: number | null;
  private readonly intervals: number[] = [];
  private lastRafTs: number | null = null;
  private nextBeatAt: number | null = null;
  private flashLeft = 0;
  private beats = 0;
  private isRunning = false;
  /** Ground truth, oldest first, at most TRUTH_LIMIT beats. */
  readonly truth: BeatTruth[] = [];
  /** Beats skipped because they were due too late (a stalled tab). */
  skipped = 0;

  constructor(options: LabMetronomeOptions) {
    this.targetFps = options.targetFps;
    this.holdOverride = options.hold ?? null;
  }

  get running(): boolean {
    return this.isRunning;
  }

  /** Beats played since the first start. */
  get beatCount(): number {
    return this.beats;
  }

  /** The display rate from the rAF intervals so far (60 until there are enough). */
  get displayHz(): number {
    return estimateDisplayHz(this.intervals);
  }

  /** Display frames that each flash stays white: the stride of the lowest rung, unless a hold was given. */
  get holdFrames(): number {
    if (this.holdOverride !== null) return this.holdOverride;
    const rungs = rungTable(this.displayHz, this.targetFps);
    return rungs[rungs.length - 1].k;
  }

  /** Start the beats. The first beat is at the next whole second of context time. */
  start(): void {
    this.isRunning = true;
    this.nextBeatAt = null;
  }

  /** Stop the beats. A flash that is on screen ends at its planned frame. */
  stop(): void {
    this.isRunning = false;
    this.nextBeatAt = null;
  }

  tick(input: LabTickInput): LabTickResult {
    if (this.lastRafTs !== null) {
      const interval = input.rafTs - this.lastRafTs;
      if (interval > 0 && interval <= MAX_VSYNC_INTERVAL_MS) {
        this.intervals.push(interval);
        if (this.intervals.length > INTERVAL_WINDOW) this.intervals.shift();
      }
    }
    this.lastRafTs = input.rafTs;

    let flash = false;
    if (this.flashLeft > 0) {
      flash = true;
      this.flashLeft--;
    }

    const audio = input.audio;
    if (!this.isRunning || !audio || audio.state !== "running" || !Number.isFinite(audio.time)) {
      // No running clock: no beat. A clock that comes back starts at its next whole second.
      this.nextBeatAt = null;
      return { flash, beat: null };
    }
    if (this.nextBeatAt === null) this.nextBeatAt = Math.floor(audio.time / BEAT_INTERVAL_SEC) * BEAT_INTERVAL_SEC + BEAT_INTERVAL_SEC;
    if (audio.time < this.nextBeatAt) return { flash, beat: null };

    if (audio.time - this.nextBeatAt > LATE_BEAT_LIMIT_SEC) {
      // The tab stalled past the beat: skip it, so no flash and no beep are ever apart.
      this.skipped++;
      this.nextBeatAt = Math.floor(audio.time / BEAT_INTERVAL_SEC) * BEAT_INTERVAL_SEC + BEAT_INTERVAL_SEC;
      return { flash, beat: null };
    }

    const holdFrames = this.holdFrames;
    const beat: LabBeat = { index: this.beats, ctxTime: audio.time };
    this.beats++;
    this.flashLeft = holdFrames - 1;
    this.nextBeatAt += BEAT_INTERVAL_SEC;
    while (this.nextBeatAt <= audio.time) this.nextBeatAt += BEAT_INTERVAL_SEC;
    this.truth.push({ index: beat.index, ctxTime: audio.time, rafTs: input.rafTs, perfNow: input.perfNow, holdFrames });
    if (this.truth.length > TRUTH_LIMIT) this.truth.shift();
    return { flash: true, beat };
  }
}
