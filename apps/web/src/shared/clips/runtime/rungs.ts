/**
 * Display rate and capture rungs (plan 6.2).
 *
 * The display refresh is estimated from rAF intervals and snapped to a
 * standard rate. The capture stride is k = ceil(Hz / target), so the capture
 * rate never exceeds the target. The rung table lists fps = Hz / k for
 * successive k, down to a floor of 15 fps.
 *
 * Measuring under load. A game that misses vsyncs makes rAF intervals of 2,
 * 3 or more vsyncs. A 33 fps game on a 60 Hz screen has only about 18% of its
 * intervals at one vsync; the median of the shorter half then reads 30 Hz.
 * So the estimator takes the SHORTEST CLUSTER of intervals (at least 3
 * intervals within 15% of each other) as one vsync. Rules for callers:
 * - Measure while the game loop is idle when you can (the start card).
 * - Keep the highest reliable rate per session and screen
 *   (rememberDisplayHz): a reading under load never lowers it. A rate that is
 *   too high only makes the slot grid finer, which is harmless; a rate that
 *   is too low makes the grid and the governor thresholds wrong.
 * - Infer iOS Low Power Mode only from an IDLE sample (inferLowPowerMode):
 *   under load, a slow game on a 60 Hz screen has the same 33 ms intervals.
 */

/**
 * Standard display rates. The plan lists 50 to 165 Hz. Three more values are
 * added: 30 Hz (iOS Low Power Mode and battery savers run rAF at 30 Hz, plan 7),
 * 100 Hz and 240 Hz (common desktop panels). Without them, the slot grid would
 * not sit on the real vsync of those displays.
 */
export const STANDARD_RATES = [30, 50, 60, 75, 90, 100, 120, 144, 165, 240] as const;

/** Lowest capture rate of any rung. */
export const RUNG_FLOOR_FPS = 15;

/** Intervals up to this ratio above the shortest one of a cluster are the same vsync. */
export const VSYNC_CLUSTER_SPAN = 1.15;
/** A cluster needs at least this many intervals to count as the vsync. */
export const MIN_VSYNC_CLUSTER = 3;

/** An idle sample needs at least this many intervals to infer Low Power Mode. */
export const LOW_POWER_MIN_INTERVALS = 30;
/** Any interval shorter than this means rAF runs faster than 30 Hz. */
export const LOW_POWER_SHORTEST_MS = 25;

/** Snap a measured rate (Hz) to the nearest standard rate, by ratio. */
export function snapHz(measuredHz: number): number {
  if (!Number.isFinite(measuredHz) || measuredHz <= 0) return 60;
  let best: number = STANDARD_RATES[0];
  let bestErr = Infinity;
  for (const rate of STANDARD_RATES) {
    const err = Math.abs(Math.log(measuredHz / rate));
    if (err < bestErr) {
      bestErr = err;
      best = rate;
    }
  }
  return best;
}

function usableIntervals(intervalsMs: readonly number[]): number[] {
  return intervalsMs.filter((d) => Number.isFinite(d) && d > 1).sort((a, b) => a - b);
}

function median(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The vsync period (ms) from rAF intervals: the median of the shortest
 * cluster of at least MIN_VSYNC_CLUSTER intervals within VSYNC_CLUSTER_SPAN.
 * Long intervals (missed vsyncs, stalls) never lower the rate, and a lone
 * short outlier never raises it. Null when no cluster exists.
 */
export function estimateVsyncMs(intervalsMs: readonly number[]): number | null {
  const usable = usableIntervals(intervalsMs);
  for (let i = 0; i + MIN_VSYNC_CLUSTER <= usable.length; i++) {
    const limit = usable[i] * VSYNC_CLUSTER_SPAN;
    let j = i;
    while (j < usable.length && usable[j] <= limit) j++;
    if (j - i >= MIN_VSYNC_CLUSTER) return median(usable.slice(i, j));
  }
  return null;
}

/**
 * Estimate the display rate from rAF intervals (ms) and snap it.
 * Returns 60 when the intervals have no vsync cluster (too few samples).
 */
export function estimateDisplayHz(intervalsMs: readonly number[]): number {
  const vsync = estimateVsyncMs(intervalsMs);
  return vsync === null ? 60 : snapHz(1000 / vsync);
}

/**
 * True when an IDLE rAF sample shows iOS Low Power Mode (plan 7: rAF at
 * 30 Hz on a faster screen). It needs LOW_POWER_MIN_INTERVALS intervals,
 * none shorter than LOW_POWER_SHORTEST_MS, and at least 80% of them within
 * 15% of 33.3 ms. Never call it with a sample taken while a game runs.
 */
export function inferLowPowerMode(idleIntervalsMs: readonly number[]): boolean {
  const usable = usableIntervals(idleIntervalsMs);
  if (usable.length < LOW_POWER_MIN_INTERVALS) return false;
  if (usable[0] < LOW_POWER_SHORTEST_MS) return false;
  const period = 1000 / 30;
  const near = usable.filter((d) => Math.abs(d - period) <= period * 0.15).length;
  return near >= usable.length * 0.8;
}

/** Capture stride for a target: k = ceil(Hz / target), at least 1. */
export function strideFor(displayHz: number, targetFps: number): number {
  return Math.max(1, Math.ceil(displayHz / targetFps - 1e-9));
}

/** One capture rung: every k-th vsync. */
export interface Rung {
  k: number;
  fps: number;
}

/** The rung table: fps = Hz / k for k from ceil(Hz / target), with fps >= 15. */
export function rungTable(displayHz: number, targetFps: number): Rung[] {
  const rungs: Rung[] = [];
  for (let k = strideFor(displayHz, targetFps); ; k++) {
    const fps = displayHz / k;
    if (fps < RUNG_FLOOR_FPS - 1e-9) break;
    rungs.push({ k, fps });
  }
  // A display under 15 Hz still gets one rung, so capture never has zero rungs.
  if (rungs.length === 0) rungs.push({ k: 1, fps: displayHz });
  return rungs;
}

/** Collect `frames` rAF intervals with the realm's own rAF. */
export function measureRafIntervals(
  realm: { requestAnimationFrame(cb: FrameRequestCallback): number },
  frames = 40,
): Promise<number[]> {
  return new Promise((resolve) => {
    const intervals: number[] = [];
    let last: number | null = null;
    const step = (t: number) => {
      if (last !== null) intervals.push(t - last);
      last = t;
      if (intervals.length >= frames) {
        resolve(intervals);
        return;
      }
      realm.requestAnimationFrame(step);
    };
    realm.requestAnimationFrame(step);
  });
}

/**
 * Measure the display rate with the realm's own rAF. It collects `frames`
 * intervals (default 40, about 0.7 s at 60 Hz) and snaps the result.
 * The caller must not run it while the page is hidden (rAF does not run then).
 */
export async function measureDisplayHz(
  realm: { requestAnimationFrame(cb: FrameRequestCallback): number },
  frames = 40,
): Promise<number> {
  return estimateDisplayHz(await measureRafIntervals(realm, frames));
}

/** A measured display rate. */
export interface DisplayRate {
  hz: number;
  /** Low Power Mode, inferred only when the caller said the sample was idle. */
  lowPowerMode: boolean;
}

/**
 * Measure the display rate and, for an idle sample, Low Power Mode. Pass
 * idle: true only while no game loop runs (for example on the start card).
 */
export async function measureDisplayRate(
  realm: { requestAnimationFrame(cb: FrameRequestCallback): number },
  options: { idle: boolean; frames?: number },
): Promise<DisplayRate> {
  const frames = Math.max(options.frames ?? 40, options.idle ? LOW_POWER_MIN_INTERVALS : 0);
  const intervals = await measureRafIntervals(realm, frames);
  return { hz: estimateDisplayHz(intervals), lowPowerMode: options.idle && inferLowPowerMode(intervals) };
}

// ---------------------------------------------------------------------------
// Session memo of the display rate, per screen
// ---------------------------------------------------------------------------

const sessionRates = new Map<string, number>();

/** A key for the current screen: its size and pixel ratio. */
export function screenKey(g: { screen?: { width?: number; height?: number }; devicePixelRatio?: number }): string {
  const s = g.screen;
  if (!s || typeof s.width !== "number" || typeof s.height !== "number") return "screen";
  return `${s.width}x${s.height}@${g.devicePixelRatio ?? 1}`;
}

/**
 * Keep the highest rate measured this session on a screen and return it.
 * A lower reading (a game under load) never lowers the kept rate.
 */
export function rememberDisplayHz(key: string, measuredHz: number): number {
  const best = Math.max(sessionRates.get(key) ?? 0, measuredHz);
  sessionRates.set(key, best);
  return best;
}

/** The kept rate for a screen, or undefined before the first measurement. */
export function rememberedDisplayHz(key: string): number | undefined {
  return sessionRates.get(key);
}

/** Forget every kept rate (tests). */
export function forgetDisplayRates(): void {
  sessionRates.clear();
}
