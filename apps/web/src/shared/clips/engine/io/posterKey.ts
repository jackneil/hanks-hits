/**
 * Which keyframe becomes a clip's poster (plan 8.1 tiles, the viewer cover).
 *
 * A "last 30 seconds" clip starts 30 s before the moment the kid tapped, and
 * its first frame is often dim (a fade, a start card, the first frame of a
 * run). So the poster never comes from the first keyframe when a better one
 * exists:
 * - a clip with a featured moment in it (a new best, a win) takes the
 *   keyframe nearest that moment;
 * - any other video takes the last keyframe at least POSTER_END_GAP_SEC
 *   before its end (the moment the kid clipped), else its last keyframe.
 *
 * Times are seconds from the file's first video packet. Pure: no media APIs.
 */

import type { MomentMark } from "../../protocol";

/** A poster keyframe keeps at least this much video after it. */
export const POSTER_END_GAP_SEC = 1;

/** A keyframe on the file's timeline. */
export interface TimedKey<T> {
  /** Seconds from the file's first video packet. */
  atSec: number;
  key: T;
}

/**
 * The newest featured moment in the file, in seconds from its start, or null.
 * `moments` use the file's own offsets (MomentMark.offsetSec from the start).
 */
export function featuredMomentSec(moments: readonly MomentMark[] | undefined, durationSec: number): number | null {
  let best: number | null = null;
  for (const moment of moments ?? []) {
    if (moment.priority !== "featured") continue;
    const at = moment.offsetSec;
    if (!Number.isFinite(at) || at < 0 || !(at <= durationSec)) continue;
    if (best === null || at > best) best = at;
  }
  return best;
}

/** The poster keyframe (see the file comment), or null when there is no keyframe. */
export function pickPosterKey<T>(keys: readonly TimedKey<T>[], durationSec: number, featuredSec: number | null): T | null {
  if (keys.length === 0) return null;
  if (featuredSec !== null && Number.isFinite(featuredSec)) {
    let nearest = keys[0];
    for (const candidate of keys) {
      // A tie goes to the later keyframe: it shows the moment, not the lead-in.
      if (Math.abs(candidate.atSec - featuredSec) <= Math.abs(nearest.atSec - featuredSec)) nearest = candidate;
    }
    return nearest.key;
  }
  let chosen: TimedKey<T> | null = null;
  const latest = Number.isFinite(durationSec) ? durationSec - POSTER_END_GAP_SEC : Number.POSITIVE_INFINITY;
  for (const candidate of keys) if (candidate.atSec <= latest) chosen = candidate;
  return (chosen ?? keys[keys.length - 1]).key;
}
