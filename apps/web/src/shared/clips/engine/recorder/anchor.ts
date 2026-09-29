/**
 * The capture time of a segment's first frame (tiers M and V, plan 5, 6.2).
 *
 * A MediaRecorder file gives packet times from its own first frame. The
 * engine must put that first frame on the capture timeline, and neither
 * recorder event says when it was:
 * - Chromium fires "start" at the muxer's first write, after the first frame
 *   is encoded; the first frame is the first canvas paint after start().
 * - Gecko fires "start" when its encoders started; the first frame is the
 *   frame that the canvas track holds at start() (painted before it), and
 *   the file puts it at the start() time.
 * Encoder start-up differs from one recorder to the next (tens of
 * milliseconds, more under load or at a hardware encoder's first open), so
 * two neighbor segments placed by their "start" events can be off by
 * different amounts: a repeated or skipped slice at the hand-off.
 *
 * So the engine keeps the capture time of each compositor paint, and this
 * module finds the paint (or the start() call) that best explains the
 * segment's packet times: packet i must land on a paint when the first
 * packet is at the candidate. The candidates are the start() call and the
 * paints from just before it up to the "start" event (the first frame cannot
 * be later than that event). The fit is the median distance from each packet
 * to its nearest paint, over the first packets. Fits that tie (a game that
 * paints at an even pace fits several candidates) go to the preferred one:
 * the start() call, then the paints after it in time order, then the paints
 * before it. Without a close fit, the first paint after the start() call is
 * used, and the result says so.
 *
 * Pure: no timers, no browser APIs.
 */

import { ANCHOR_MATCH_US, ANCHOR_TIE_US } from "./constants";

export interface AnchorInput {
  /** Capture times of the compositor paints, sorted. */
  paintsUs: readonly number[];
  /** Capture time of the recorder's start() call. */
  startCallUs: number;
  /** Capture time of the recorder's "start" event. */
  startEventUs: number;
  /** The segment's packet times from its first packet, sorted (the index). */
  packetTimesUs: readonly number[];
  /** How many packets after the first to compare. Default 30 (1 s at 30 fps). */
  compare?: number;
}

export interface Anchor {
  /** Capture time of the segment's first frame. */
  startUs: number;
  /** True when the packet times fit the paints (within ANCHOR_MATCH_US). */
  matched: boolean;
  /** The fit of the chosen candidate (the median distance), in microseconds. */
  errorUs: number;
}

/** Paints that a frame can come from before the start() call: the held frame, and a paint in the same task. */
const PAINTS_BEFORE_START = 2;

/** Index of the first value >= x in a sorted list. */
function lowerBound(list: readonly number[], x: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function nearest(list: readonly number[], x: number): number {
  const i = lowerBound(list, x);
  let best = Infinity;
  if (i < list.length) best = list[i] - x;
  if (i > 0) best = Math.min(best, x - list[i - 1]);
  return best;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The candidates, in the order of preference. */
function candidates(input: AnchorInput): number[] {
  const { paintsUs, startCallUs, startEventUs } = input;
  const out = [startCallUs];
  const after = lowerBound(paintsUs, startCallUs);
  for (let i = after; i < paintsUs.length && paintsUs[i] <= startEventUs + ANCHOR_MATCH_US; i++) {
    if (paintsUs[i] !== startCallUs) out.push(paintsUs[i]);
  }
  for (let i = after - 1; i >= 0 && i >= after - PAINTS_BEFORE_START; i--) out.push(paintsUs[i]);
  return out;
}

/** The fit of a candidate: the median distance from each compared packet to its nearest paint. */
function fitOf(input: AnchorInput, at: number): number {
  const { paintsUs, packetTimesUs } = input;
  const compare = Math.min(packetTimesUs.length - 1, input.compare ?? 30);
  if (compare <= 0 || paintsUs.length === 0) return 0;
  const first = packetTimesUs[0];
  const errors: number[] = [];
  for (let i = 1; i <= compare; i++) errors.push(nearest(paintsUs, at + (packetTimesUs[i] - first)));
  return median(errors);
}

export function anchorSegment(input: AnchorInput): Anchor {
  const list = candidates(input);
  const fits = list.map((at) => fitOf(input, at));
  const best = Math.min(...fits);
  if (best <= ANCHOR_MATCH_US) {
    const chosen = fits.findIndex((fit) => fit <= best + ANCHOR_TIE_US);
    return { startUs: list[chosen], matched: true, errorUs: fits[chosen] };
  }
  const i = lowerBound(input.paintsUs, input.startCallUs);
  const firstPaint = i < input.paintsUs.length && input.paintsUs[i] <= input.startEventUs ? input.paintsUs[i] : input.startCallUs;
  return { startUs: firstPaint, matched: false, errorUs: best };
}
