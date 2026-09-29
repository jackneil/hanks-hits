/**
 * The capture timeline of the MediaRecorder engine (plan 6.2).
 *
 * Capture time is page time with the paused spans taken out, the same rule as
 * the frame pump of tiers W and W+:
 *
 *   capture time of a page instant T = T - epoch - (paused time before T)
 *
 * The epoch is the page time of the first run(). While the clock is paused,
 * capture time stands still. Times are page-realm performance.now()
 * milliseconds in, microseconds out. Pure: no timers, no browser APIs.
 */

export class CaptureClock {
  private epochMs: number | null = null;
  private pausedAtMs: number | null = null;
  private removedMs = 0;

  /** True after the first run(). */
  get started(): boolean {
    return this.epochMs !== null;
  }

  /** True while capture time stands still (also before the first run). */
  get paused(): boolean {
    return this.epochMs === null || this.pausedAtMs !== null;
  }

  /** Capture time runs from nowMs. The first call sets the epoch. */
  run(nowMs: number): void {
    if (this.epochMs === null) {
      this.epochMs = nowMs;
      return;
    }
    if (this.pausedAtMs === null) return;
    this.removedMs += Math.max(0, nowMs - this.pausedAtMs);
    this.pausedAtMs = null;
  }

  /** Capture time stands still from nowMs. */
  pause(nowMs: number): void {
    if (this.epochMs === null || this.pausedAtMs !== null) return;
    this.pausedAtMs = Math.max(nowMs, this.epochMs);
  }

  /** Capture time of the page instant nowMs, in microseconds (0 before the first run). */
  nowUs(nowMs: number): number {
    if (this.epochMs === null) return 0;
    const at = this.pausedAtMs ?? nowMs;
    return Math.max(0, Math.round((at - this.epochMs - this.removedMs) * 1000));
  }

  /** Back to the state before the first run (a new capture timeline). */
  reset(): void {
    this.epochMs = null;
    this.pausedAtMs = null;
    this.removedMs = 0;
  }
}
