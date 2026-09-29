/**
 * The ring of finished MediaRecorder segments, and the clip plan (tiers M
 * and V, plan 5, 6.5, 6.6). Pure: no timers, no browser APIs except Blob.
 *
 * A segment is one recorder's whole file. Its span on the capture timeline
 * runs from its first frame (startUs) to the moment it was stopped (endUs).
 * Neighbor segments overlap across a hand-off: the newer one starts before
 * the older one ends.
 *
 * Eviction keeps the newest segments that cover the ring length back from the
 * newest end, so a clip of the ring length can always start at a segment
 * start (a keyframe). Record keeps its own references to its segments, so
 * eviction never takes footage from a recording.
 */

import type { RecorderSegmentRef, SegmentIndex } from "../../protocol";

export interface RingSegment {
  readonly id: number;
  readonly blob: Blob;
  /** Capture time of the segment's first frame. */
  readonly startUs: number;
  /** Capture time at which the recorder was stopped. */
  readonly endUs: number;
  /** The io worker's index (keyframes and configs), or null until it comes. */
  index: SegmentIndex | null;
  /** The index failed: the segment does not parse, so no clip uses it. */
  broken: boolean;
}

/**
 * A gap between two segments on the capture timeline that is longer than
 * this cuts a clip (a segment that failed is missing there). A new recorder
 * after a pause starts a little after the capture time of the pause (its
 * start-up); that small gap is not a missing segment.
 */
export const SEGMENT_GAP_US = 500_000;

export class SegmentRing {
  private list: RingSegment[] = [];
  private ringUs: number;

  constructor(ringSeconds: number) {
    this.ringUs = Math.max(1, ringSeconds) * 1e6;
  }

  get segments(): readonly RingSegment[] {
    return this.list;
  }

  get ringSeconds(): number {
    return this.ringUs / 1e6;
  }

  /** A new ring length (the governor's low-power level keeps less). Eviction applies at the next evict(). */
  setRingSeconds(seconds: number): void {
    this.ringUs = Math.max(1, seconds) * 1e6;
  }

  /** Adds a finished segment, in start order. */
  add(segment: RingSegment): void {
    this.list.push(segment);
    this.list.sort((a, b) => a.startUs - b.startUs || a.id - b.id);
  }

  /**
   * Removes the oldest segments that the ring does not need: while the
   * segment after the oldest one starts at or before (newest end - ring),
   * the oldest one adds nothing. liveEndUs: the capture time now, when a
   * recorder still records (its footage counts for the ring). Returns the
   * removed segments.
   */
  evict(liveEndUs = 0): RingSegment[] {
    const removed: RingSegment[] = [];
    const newest = Math.max(liveEndUs, ...this.list.map((s) => s.endUs));
    while (this.list.length > 1 && this.list[1].startUs <= newest - this.ringUs) {
      removed.push(this.list.shift()!);
    }
    // With a live recorder, even the newest finished segment can be too old.
    if (this.list.length === 1 && liveEndUs > 0 && this.list[0].endUs <= liveEndUs - this.ringUs) {
      removed.push(this.list.shift()!);
    }
    return removed;
  }

  /** Removes every segment. Returns them. */
  clear(): RingSegment[] {
    const removed = this.list;
    this.list = [];
    return removed;
  }

  /** Seconds of footage from the oldest segment's start to endUs (the capture time now). */
  coveredSec(endUs: number): number {
    const oldest = this.list.find((s) => !s.broken);
    if (!oldest) return 0;
    return Math.max(0, (endUs - oldest.startUs) / 1e6);
  }

  /**
   * The segments that a clip of [fromUs, toUs) needs, in start order, before
   * any index check: the newest segment that starts at or before fromUs (or
   * the oldest one, when the ring does not reach back that far), and every
   * later one that starts before toUs.
   */
  needed(fromUs: number, toUs: number): RingSegment[] {
    let first = 0;
    for (let i = 0; i < this.list.length; i++) if (this.list[i].startUs <= fromUs) first = i;
    return this.list.slice(first).filter((s) => s.startUs < toUs && s.endUs > fromUs);
  }
}

function usableIndex(segment: RingSegment): SegmentIndex | null {
  return !segment.broken && segment.index && segment.index.firstIsKey ? segment.index : null;
}

export interface ClipPlan {
  segments: RecorderSegmentRef[];
  /** Capture time of the clip's first frame: the last keyframe at or before the asked start (or the oldest footage). */
  startUs: number;
  /** Capture time of the clip's end. */
  endUs: number;
  /**
   * True when the clip was cut to its newest segments (plan 6.6): an older
   * segment has another decoder config, does not parse, or is missing (a
   * gap). The clip is then shorter than asked, and says so.
   */
  cut: boolean;
}

/**
 * The plan of a clip of [fromUs, toUs) from indexed segments (in start
 * order, from SegmentRing.needed()). Every segment must have its index.
 * Returns null when no segment covers the span.
 *
 * - The clip keeps only the newest run of segments that can share a track:
 *   the same video config, and one audio config (a segment with no audio
 *   fits any), with no gap between them. An older segment with another
 *   config, one that does not parse, or a gap cuts the clip there (never
 *   silent: `cut`).
 * - It starts at the last keyframe at or before fromUs in the first segment,
 *   or at that segment's first frame when the ring does not reach back to
 *   fromUs. Plan 6.6: a clip starts at a keyframe, at most one keyframe gap
 *   early.
 * - Each segment is used up to the next segment's first frame.
 */
export function planClip(segments: readonly RingSegment[], fromUs: number, toUs: number): ClipPlan | null {
  let first = segments.length;
  let video: string | null = null;
  let audio: string | null = null;
  for (let i = segments.length - 1; i >= 0; i--) {
    const index = usableIndex(segments[i]);
    if (!index) break;
    video ??= index.videoConfigKey;
    if (index.videoConfigKey !== video) break;
    if (index.audioConfigKey !== null && audio !== null && index.audioConfigKey !== audio) break;
    const later = segments[i + 1];
    if (later && segments[i].endUs < later.startUs - SEGMENT_GAP_US) break;
    audio ??= index.audioConfigKey;
    first = i;
  }
  if (first >= segments.length) return null;
  const cut = first > 0;
  const run = segments.slice(first);
  const head = run[0];
  let startUs = head.startUs;
  if (fromUs > head.startUs) {
    for (const k of head.index!.keyframesUs) {
      const at = head.startUs + k;
      if (at <= fromUs) startUs = at;
      else break;
    }
  }
  const last = run[run.length - 1];
  const endUs = Math.min(toUs, last.endUs);
  // No footage inside the asked span: nothing to clip.
  if (!(endUs > startUs) || !(endUs > fromUs)) return null;
  const out: RecorderSegmentRef[] = [];
  for (let i = 0; i < run.length; i++) {
    const s = run[i];
    const from = i === 0 ? startUs : s.startUs;
    const to = i < run.length - 1 ? run[i + 1].startUs : endUs;
    if (!(to > from)) continue;
    out.push({ blob: s.blob, startUs: s.startUs, fromUs: from, toUs: to });
  }
  if (out.length === 0) return null;
  return { segments: out, startUs: out[0].fromUs, endUs, cut };
}

/**
 * The longest time between two keyframes in a segment, with spanUs as the
 * last boundary: the time from the segment's first frame to the next
 * segment's first frame (a keyframe), or the segment's own length for the
 * newest one. This is the most that a clip can start early (plan 5, "replay
 * granularity").
 */
export function keyframeGapUs(index: Pick<SegmentIndex, "keyframesUs" | "durationUs">, spanUs = index.durationUs): number {
  const keys = index.keyframesUs.filter((k) => k < spanUs);
  if (keys.length === 0) return spanUs;
  let gap = keys[0];
  for (let i = 1; i < keys.length; i++) gap = Math.max(gap, keys[i] - keys[i - 1]);
  return Math.max(gap, spanUs - keys[keys.length - 1]);
}
