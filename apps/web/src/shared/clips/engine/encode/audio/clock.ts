/**
 * Clock mapping for one audio stream (plan 6.4 and 6.4.1).
 *
 * A ClockAnchor pairs the stream's AudioContext time with performance.now(),
 * read in one task. The pair gives a line:
 *   pagePerfMs = p0 + (ctxSec - c0) * 1000 * rate
 * rate is page milliseconds per context millisecond. It is 1 minus the
 * hardware clock drift (typically 50-100 ppm).
 *
 * What the line means: a game that starts a sound at page time p gets the
 * frame currentTime(p), the next frame to render. So the line maps a frame to
 * the mean page time of the reads that return it. That is where the sounds
 * that start on that frame were started, and where their video frames are.
 *
 * Each anchor has jitter. currentTime moves in whole render bursts: 128
 * frames (2.7 ms) on most desktops, but 480-1920 frames (10-40 ms) on
 * Windows WASAPI and on Android. The two reads are also not atomic. An
 * alpha-beta filter takes the mean and learns the rate, so the jitter does
 * not reach the resampler:
 * - After a reset, the first anchors are averaged (gain 1/n), so the line
 *   starts at the mean, not at one read.
 * - The reset threshold grows with the observed spread of the anchors, so a
 *   40 ms burst is not taken for a jump.
 * - A jump must show on two anchors in a row, with the same sign. One late
 *   read (a main-thread pause between the two reads) is not a jump.
 * - The filter gains fall as the spread grows (alpha by NOISE_REF_MS /
 *   spread, beta by its square), so a 40 ms burst clock gives a line as
 *   steady as a 2.7 ms one, at the cost of slower tracking. The rate filter
 *   still removes drift.
 * A context that goes back resets the line at once (a new context), and so
 * does the first anchor after unlock() (a suspend and resume).
 */

/** Largest rate error the filter accepts: 0.5%. Real audio clocks drift far less. */
export const MAX_RATE_ERROR = 0.005;

export interface StreamClockOptions {
  /** Share of each residual that moves the offset, once the start average is done. */
  alpha?: number;
  /** Share of each residual (per millisecond of context time) that moves the rate. */
  beta?: number;
  /** Smallest residual (ms) that can reset the line. */
  resyncMs?: number;
  /** Spread (ms) up to which the filter uses its full gains. Default NOISE_REF_MS. */
  noiseRefMs?: number;
}

/** The reset threshold is at least this many times the mean absolute residual. */
const SPREAD_FACTOR = 4;
/** Starting mean absolute residual (ms): allows 40 ms bursts before the spread is known. */
const INITIAL_SPREAD_MS = 10;
/** Share of each residual that moves the spread estimate. */
const SPREAD_GAIN = 0.05;
/** Spread (ms) up to which the filter uses its full gains. A 128-frame clock sits near 0.7 ms. */
const NOISE_REF_MS = 2;

export class StreamClock {
  private readonly alpha: number;
  private readonly beta: number;
  private readonly resyncMs: number;
  private readonly noiseRefMs: number;
  private p0 = 0;
  private c0 = 0;
  private r = 1;
  private hasLine = false;
  /** Anchors on the current line, the reset anchor included. */
  private n = 0;
  /** Mean absolute residual (ms), learned over the whole stream. */
  private spread = INITIAL_SPREAD_MS;
  /** Sign of the previous anchor when it was beyond the threshold, else 0. */
  private outlierSign = 0;
  /** Times the line was reset (the first anchor counts as one). */
  resyncs = 0;
  /** Single anchors beyond the threshold that were not taken as a jump. */
  outliers = 0;

  constructor(options: StreamClockOptions = {}) {
    this.alpha = options.alpha ?? 0.06;
    this.beta = options.beta ?? 0.0018;
    this.resyncMs = options.resyncMs ?? 40;
    this.noiseRefMs = options.noiseRefMs ?? NOISE_REF_MS;
  }

  get locked(): boolean {
    return this.hasLine;
  }

  /** Page milliseconds per context millisecond. */
  get rate(): number {
    return this.r;
  }

  /** The residual (ms) above which an anchor can reset the line. */
  get threshold(): number {
    return Math.max(this.resyncMs, SPREAD_FACTOR * this.spread);
  }

  /** Adds an anchor. pagePerfMs is already in the page realm (offset applied). */
  anchor(pagePerfMs: number, ctxSec: number): void {
    if (!Number.isFinite(pagePerfMs) || !Number.isFinite(ctxSec)) return;
    if (!this.hasLine) {
      this.reset(pagePerfMs, ctxSec);
      return;
    }
    const dtMs = (ctxSec - this.c0) * 1000;
    if (dtMs < 0) {
      // A clock that went back is a new context.
      this.reset(pagePerfMs, ctxSec);
      return;
    }
    if (dtMs === 0) {
      // The context did not move. When page time moved on, the context stopped (a suspend with no
      // state message): the line is wrong from the next move, so the next anchor starts a new one.
      // A repeat of the same read changes nothing.
      if (pagePerfMs - this.p0 > this.threshold) this.hasLine = false;
      return;
    }
    const predicted = this.p0 + dtMs * this.r;
    const residual = pagePerfMs - predicted;
    const limit = this.threshold;
    if (Math.abs(residual) > limit) {
      const sign = Math.sign(residual);
      if (this.outlierSign === sign) {
        // Two anchors in a row moved the same way: the clock jumped.
        this.reset(pagePerfMs, ctxSec);
        return;
      }
      this.outlierSign = sign;
      this.outliers++;
      this.spread += SPREAD_GAIN * (limit - this.spread);
      return;
    }
    this.outlierSign = 0;
    this.spread += SPREAD_GAIN * (Math.abs(residual) - this.spread);
    this.n++;
    // Noisier anchors get smaller gains, so the line stays steady.
    const f = Math.min(1, this.noiseRefMs / this.spread);
    const alpha = this.alpha * f;
    const gain = Math.max(alpha, 1 / this.n);
    this.p0 = predicted + gain * residual;
    this.c0 = ctxSec;
    // The start average moves only the offset. The rate learns once the line has settled.
    if (gain === alpha) this.r = clamp(this.r + (this.beta * f * f * residual) / dtMs, 1 - MAX_RATE_ERROR, 1 + MAX_RATE_ERROR);
  }

  /** Forgets the line but keeps the learned rate and spread (the hardware clock does not change). */
  unlock(): void {
    this.hasLine = false;
  }

  perfAtCtx(ctxSec: number): number {
    return this.p0 + (ctxSec - this.c0) * 1000 * this.r;
  }

  ctxAtPerf(pagePerfMs: number): number {
    return this.c0 + (pagePerfMs - this.p0) / (1000 * this.r);
  }

  private reset(pagePerfMs: number, ctxSec: number): void {
    this.p0 = pagePerfMs;
    this.c0 = ctxSec;
    this.hasLine = true;
    this.n = 1;
    this.outlierSign = 0;
    this.resyncs++;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
