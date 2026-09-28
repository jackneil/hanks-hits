/**
 * Capture time for the encode worker.
 *
 * Video timestamps come from the capture clock on the main thread (plan 6.2):
 *   tsUs = (rafTs - epochStart - removedPauseTime) in microseconds.
 * The worker rebuilds the same clock from the "timeline" commands:
 * - The first "live" command sets epochStart (capture time 0).
 * - Each "paused" then "live" pair removes the paused span.
 * Audio uses the same clock, so audio and video stay in sync across pauses.
 *
 * All page times are page-realm performance.now() values in milliseconds.
 * The span list grows by one entry per pause. That is a few kilobytes for
 * hours of play, so the list is never pruned.
 */

/** One live span of the capture timeline. */
interface Span {
  startPerfMs: number;
  startCaptureUs: number;
  /** Page time when the span ended (a pause), or null while it is live. */
  endPerfMs: number | null;
}

export class CaptureTimeline {
  private spans: Span[] = [];

  /** True after the first "live" command. */
  get started(): boolean {
    return this.spans.length > 0;
  }

  /** True while the newest span is live. */
  get live(): boolean {
    const last = this.spans[this.spans.length - 1];
    return !!last && last.endPerfMs === null;
  }

  /** Page time of capture time 0, or null before the first "live". */
  get originPerfMs(): number | null {
    return this.spans[0]?.startPerfMs ?? null;
  }

  /** Number of spans (for tests). */
  get spanCount(): number {
    return this.spans.length;
  }

  /**
   * Applies a timeline command. Returns true when the state changed.
   * A repeat of the current state is ignored. A time before the last change
   * is moved up to the last change, so a span is never negative.
   */
  set(state: "live" | "paused", atPerfMs: number): boolean {
    const last = this.spans[this.spans.length - 1];
    if (state === "live") {
      if (last && last.endPerfMs === null) return false;
      if (!last) {
        this.spans.push({ startPerfMs: atPerfMs, startCaptureUs: 0, endPerfMs: null });
        return true;
      }
      const at = Math.max(atPerfMs, last.endPerfMs!);
      this.spans.push({ startPerfMs: at, startCaptureUs: spanEndCaptureUs(last), endPerfMs: null });
      return true;
    }
    if (!last || last.endPerfMs !== null) return false;
    last.endPerfMs = Math.max(atPerfMs, last.startPerfMs);
    return true;
  }

  /**
   * Capture time (microseconds) for a page time. Inside a pause, the result
   * stays at the pause point. Before the origin, the result is negative.
   */
  captureUsAtPerf(perfMs: number): number {
    const origin = this.originPerfMs;
    if (origin === null) return 0;
    if (perfMs < origin) return (perfMs - origin) * 1000;
    const s = this.spans[this.lastIndex((sp) => sp.startPerfMs <= perfMs)];
    const end = s.endPerfMs === null ? perfMs : Math.min(perfMs, s.endPerfMs);
    return s.startCaptureUs + (end - s.startPerfMs) * 1000;
  }

  /**
   * Page time for a capture time. A capture time on a seam (a removed pause)
   * belongs to the later span. After the end of a closed last span, the
   * result stays at the pause point.
   */
  perfAtCaptureUs(captureUs: number): number {
    const origin = this.originPerfMs;
    if (origin === null) return 0;
    if (captureUs < 0) return origin + captureUs / 1000;
    const s = this.spans[this.lastIndex((sp) => sp.startCaptureUs <= captureUs)];
    const perf = s.startPerfMs + (captureUs - s.startCaptureUs) / 1000;
    return s.endPerfMs === null ? perf : Math.min(perf, s.endPerfMs);
  }

  /**
   * Capture times of the pause points in [fromUs, toUs]. A pause point is
   * the end of a closed span: a seam after a resume, or the pending pause
   * while paused. Audio fades out before it and fades in after it.
   */
  pausePointsBetween(fromUs: number, toUs: number): number[] {
    const out: number[] = [];
    // Span ends increase with the index. The span before the one that holds
    // fromUs can end exactly at fromUs, so start one span earlier.
    let i = Math.max(0, this.lastIndex((sp) => sp.startCaptureUs <= fromUs) - 1);
    for (; i < this.spans.length; i++) {
      const s = this.spans[i];
      if (s.startCaptureUs > toUs) break;
      if (s.endPerfMs === null) continue;
      const at = spanEndCaptureUs(s);
      if (at >= fromUs && at <= toUs) out.push(at);
    }
    return out;
  }

  /** The largest index whose span passes the (monotonic) test. Returns 0 when none passes. */
  private lastIndex(test: (s: Span) => boolean): number {
    let lo = 0;
    let hi = this.spans.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (test(this.spans[mid])) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
}

function spanEndCaptureUs(s: Span): number {
  return s.startCaptureUs + ((s.endPerfMs ?? s.startPerfMs) - s.startPerfMs) * 1000;
}

/**
 * Estimates page-realm performance.now() inside the worker.
 *
 * Both realms read the same monotonic clock, so they differ by a constant.
 * Each anchor and timeline command carries a page time, which gives an upper
 * bound on that constant: the message cannot arrive before it was sent. The
 * sender must never stamp a future time. The smallest bound seen is
 * the estimate. It errs early by the fastest message latency (well under
 * 1 ms), so the mixer never reads audio from the future.
 */
export class PageClock {
  private offsetMs = Infinity;

  /** Records a page time that a message carried, with the local time it arrived. */
  observe(pagePerfMs: number, localNowMs: number): void {
    const d = localNowMs - pagePerfMs;
    if (Number.isFinite(d) && d < this.offsetMs) this.offsetMs = d;
  }

  get known(): boolean {
    return Number.isFinite(this.offsetMs);
  }

  /** Page time now, or null before the first observation. */
  pageNow(localNowMs: number): number | null {
    return this.known ? localNowMs - this.offsetMs : null;
  }

  reset(): void {
    this.offsetMs = Infinity;
  }
}
