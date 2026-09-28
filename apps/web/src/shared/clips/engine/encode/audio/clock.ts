/**
 * Clock mapping for one audio stream (plan 6.4 and 6.4.1).
 *
 * A ClockAnchor pairs the stream's AudioContext time with performance.now(),
 * read in one task. The pair gives a line:
 *   pagePerfMs = p0 + (ctxSec - c0) * 1000 * rate
 * rate is page milliseconds per context millisecond. It is 1 minus the
 * hardware clock drift (typically 50-100 ppm).
 *
 * Each anchor has jitter: currentTime moves in 128-frame render quanta
 * (2.7 ms at 48 kHz) and the two reads are not atomic. An alpha-beta filter
 * smooths the offset and learns the rate, so the jitter does not reach the
 * resampler. A large step (a suspend and resume, a realm reload) resets the
 * line at once.
 */

/** Largest rate error the filter accepts: 0.5%. Real audio clocks drift far less. */
export const MAX_RATE_ERROR = 0.005;

export interface StreamClockOptions {
  /** Share of each residual that moves the offset. */
  alpha?: number;
  /** Share of each residual (per millisecond of context time) that moves the rate. */
  beta?: number;
  /** A residual larger than this (ms) resets the line. */
  resyncMs?: number;
}

export class StreamClock {
  private readonly alpha: number;
  private readonly beta: number;
  private readonly resyncMs: number;
  private p0 = 0;
  private c0 = 0;
  private r = 1;
  private hasLine = false;
  /** Times the line was reset (the first anchor counts as one). */
  resyncs = 0;

  constructor(options: StreamClockOptions = {}) {
    this.alpha = options.alpha ?? 0.06;
    this.beta = options.beta ?? 0.0018;
    this.resyncMs = options.resyncMs ?? 40;
  }

  get locked(): boolean {
    return this.hasLine;
  }

  /** Page milliseconds per context millisecond. */
  get rate(): number {
    return this.r;
  }

  /** Adds an anchor. pagePerfMs is already in the page realm (offset applied). */
  anchor(pagePerfMs: number, ctxSec: number): void {
    if (!Number.isFinite(pagePerfMs) || !Number.isFinite(ctxSec)) return;
    if (!this.hasLine) {
      this.reset(pagePerfMs, ctxSec);
      return;
    }
    const dtMs = (ctxSec - this.c0) * 1000;
    if (dtMs <= 0) {
      // The context did not move (suspended or a repeat). A clock that went back is a new context.
      if (dtMs < 0) this.reset(pagePerfMs, ctxSec);
      return;
    }
    const predicted = this.p0 + dtMs * this.r;
    const residual = pagePerfMs - predicted;
    if (Math.abs(residual) > this.resyncMs) {
      this.reset(pagePerfMs, ctxSec);
      return;
    }
    this.p0 = predicted + this.alpha * residual;
    this.c0 = ctxSec;
    this.r = clamp(this.r + (this.beta * residual) / dtMs, 1 - MAX_RATE_ERROR, 1 + MAX_RATE_ERROR);
  }

  /** Forgets the line but keeps the learned rate (the hardware clock does not change). */
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
    this.resyncs++;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
