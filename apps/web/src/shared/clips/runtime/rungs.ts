/**
 * Display rate and capture rungs (plan 6.2).
 *
 * The display refresh is measured as the median of the shortest rAF intervals
 * and snapped to a standard rate. The capture stride is k = ceil(Hz / target),
 * so the capture rate never exceeds the target. The rung table lists
 * fps = Hz / k for successive k, down to a floor of 15 fps.
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

/**
 * Estimate the display rate from rAF intervals (ms): the median of the
 * shortest half. Long intervals (missed vsyncs, stalls) never lower the result.
 * Returns the snapped rate. With fewer than 3 usable intervals it returns 60.
 */
export function estimateDisplayHz(intervalsMs: readonly number[]): number {
  const usable = intervalsMs.filter((d) => Number.isFinite(d) && d > 1).sort((a, b) => a - b);
  if (usable.length < 3) return 60;
  const shortest = usable.slice(0, Math.max(3, Math.ceil(usable.length / 2)));
  const mid = Math.floor(shortest.length / 2);
  const median =
    shortest.length % 2 === 1 ? shortest[mid] : (shortest[mid - 1] + shortest[mid]) / 2;
  return snapHz(1000 / median);
}

/** True when the snapped rate means rAF runs at 30 Hz (Low Power Mode on iOS). */
export function isLowPowerRate(displayHz: number): boolean {
  return displayHz <= 30;
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

/**
 * Measure the display rate with the realm's own rAF. It runs `frames` frames
 * (default 40, about 0.7 s at 60 Hz) and snaps the result.
 * The caller must not run it while the page is hidden (rAF does not run then).
 */
export function measureDisplayHz(
  realm: { requestAnimationFrame(cb: FrameRequestCallback): number },
  frames = 40,
): Promise<number> {
  return new Promise((resolve) => {
    const intervals: number[] = [];
    let last: number | null = null;
    const step = (t: number) => {
      if (last !== null) intervals.push(t - last);
      last = t;
      if (intervals.length >= frames) {
        resolve(estimateDisplayHz(intervals));
        return;
      }
      realm.requestAnimationFrame(step);
    };
    realm.requestAnimationFrame(step);
  });
}
