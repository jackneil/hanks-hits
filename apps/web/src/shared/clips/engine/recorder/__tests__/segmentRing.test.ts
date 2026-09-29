// @vitest-environment node
/**
 * The segment ring, the clip plan and the keyframe gap (tiers M and V, plan
 * 5, 6.5, 6.6), and the capture clock (plan 6.2). Pure logic.
 */
import { describe, expect, it } from "vitest";
import type { SegmentIndex } from "../../../protocol";
import { CaptureClock } from "../captureClock";
import { SEGMENT_GAP_US, SegmentRing, keyframeGapUs, planClip, type RingSegment } from "../segmentRing";

const S = 1_000_000;

function index(overrides: Partial<SegmentIndex> = {}): SegmentIndex {
  return {
    container: "webm",
    videoCodec: "vp8",
    videoConfigKey: "vp8|960x544|",
    keyframesUs: [0, S, 2 * S, 3 * S, 4 * S, 5 * S],
    packetTimesUs: Array.from({ length: 158 }, (_, i) => Math.round((i * S) / 30)),
    durationUs: 5.25 * S,
    videoPackets: 158,
    firstIsKey: true,
    ...overrides,
  };
}

let ids = 0;
function seg(startSec: number, endSec: number, idx: SegmentIndex | null = index()): RingSegment {
  return {
    id: ++ids,
    blob: new Blob([`s${ids}`]),
    startUs: startSec * S,
    startCallUs: startSec * S,
    startEventUs: startSec * S,
    endUs: endSec * S,
    nextStartUs: null,
    index: idx,
    broken: false,
  };
}

/** The rotation: [0, 5.25), [5, 10.25), [10, 15.25), ... */
function rotation(count: number, idx?: (i: number) => SegmentIndex | null): RingSegment[] {
  return Array.from({ length: count }, (_, i) => seg(i * 5, i * 5 + 5.25, idx ? idx(i) : index()));
}

describe("SegmentRing", () => {
  it("keeps segments in start order", () => {
    const ring = new SegmentRing(60);
    const [a, b, c] = rotation(3);
    ring.add(c);
    ring.add(a);
    ring.add(b);
    expect(ring.segments.map((s) => s.startUs)).toEqual([0, 5 * S, 10 * S]);
  });

  it("evicts the oldest segments that the ring length no longer needs, and keeps enough for a whole ring", () => {
    const ring = new SegmentRing(30);
    for (const s of rotation(10)) ring.add(s);
    // Newest end 50.25 s: the ring needs [20.25, 50.25]. The segment that starts at 20 covers 20.25.
    const removed = ring.evict();
    expect(removed.map((s) => s.startUs / S)).toEqual([0, 5, 10, 15]);
    expect(ring.segments[0].startUs).toBe(20 * S);
    expect(ring.segments[0].startUs).toBeLessThanOrEqual(ring.segments.at(-1)!.endUs - 30 * S);
    // A second evict removes nothing.
    expect(ring.evict()).toEqual([]);
  });

  it("counts the live recorder's footage (liveEndUs), and a shorter ring (low power) evicts more", () => {
    const ring = new SegmentRing(30);
    for (const s of rotation(4)) ring.add(s);
    // Footage runs on in the live recorder to 45 s: [15, 45] is needed.
    expect(ring.evict(45 * S).map((s) => s.startUs / S)).toEqual([0, 5, 10]);
    ring.setRingSeconds(15);
    expect(ring.ringSeconds).toBe(15);
    // Newest finished segment [15, 20.25] ends before 45 - 15 = 30: it goes too.
    expect(ring.evict(45 * S).map((s) => s.startUs / S)).toEqual([15]);
    expect(ring.segments).toEqual([]);
  });

  it("clear() removes every segment", () => {
    const ring = new SegmentRing(60);
    for (const s of rotation(3)) ring.add(s);
    expect(ring.clear()).toHaveLength(3);
    expect(ring.segments).toEqual([]);
    expect(ring.coveredSec(30 * S)).toBe(0);
  });

  it("coveredSec is the footage from the oldest usable segment to the time given", () => {
    const ring = new SegmentRing(60);
    const list = rotation(3);
    list[0].broken = true;
    for (const s of list) ring.add(s);
    expect(ring.coveredSec(12 * S)).toBe(7);
  });

  it("needed(): the newest segment that starts at or before the clip start, and the later ones before its end", () => {
    const ring = new SegmentRing(60);
    for (const s of rotation(5)) ring.add(s);
    expect(ring.needed(12 * S, 21 * S).map((s) => s.startUs / S)).toEqual([10, 15, 20]);
    // A start on a segment start needs no older segment.
    expect(ring.needed(15 * S, 18 * S).map((s) => s.startUs / S)).toEqual([15]);
    // The ring does not reach back: the oldest segment.
    expect(ring.needed(-30 * S, 3 * S).map((s) => s.startUs / S)).toEqual([0]);
  });
});

describe("planClip", () => {
  it("starts at the last keyframe at or before the start, and uses each segment up to the next one's first frame", () => {
    const list = rotation(3);
    const plan = planClip(list, 3.4 * S, 11 * S)!;
    expect(plan.startUs).toBe(3 * S);
    expect(plan.endUs).toBe(11 * S);
    expect(plan.cut).toBe(false);
    expect(plan.segments.map((s) => [s.startUs / S, s.fromUs / S, s.toUs / S])).toEqual([
      [0, 3, 5],
      [5, 5, 10],
      [10, 10, 11],
    ]);
    // The windows never overlap: each frame of a hand-off is used once.
    for (let i = 1; i < plan.segments.length; i++) expect(plan.segments[i].fromUs).toBe(plan.segments[i - 1].toUs);
  });

  it("with one keyframe per segment (Firefox VP8), the clip starts at the segment start", () => {
    const list = rotation(3, () => index({ keyframesUs: [0] }));
    expect(planClip(list, 3.4 * S, 11 * S)!.startUs).toBe(0);
  });

  it("ends at the newest footage when the asked end is later", () => {
    const list = rotation(2);
    expect(planClip(list, 2 * S, 30 * S)!.endUs).toBe(10.25 * S);
  });

  it("cuts to the newest segments at another video config (plan 6.6), and says so", () => {
    const list = rotation(3, (i) => index({ videoConfigKey: i === 0 ? "vp8|640x352|" : "vp8|960x544|" }));
    const plan = planClip(list, 3 * S, 14 * S)!;
    expect(plan.cut).toBe(true);
    expect(plan.startUs).toBe(5 * S);
    expect(plan.segments.map((s) => s.startUs / S)).toEqual([5, 10]);
  });

  it("re-sorts when a segment's start moves to its first frame (the anchor)", () => {
    const ring = new SegmentRing(60);
    const [a, b] = rotation(2);
    ring.add(b);
    ring.add(a);
    // b's anchor moves before a's start (a test value: the order must follow the start).
    b.startUs = -1;
    ring.resort();
    expect(ring.segments.map((s) => s.id)).toEqual([b.id, a.id]);
  });

  it("cuts at a segment that does not parse, one with no keyframe first, or a gap", () => {
    const broken = rotation(3);
    broken[1].broken = true;
    expect(planClip(broken, 3 * S, 14 * S)!.segments.map((s) => s.startUs / S)).toEqual([10]);
    const noKey = rotation(3, (i) => index({ firstIsKey: i !== 1 }));
    expect(planClip(noKey, 3 * S, 14 * S)!.segments.map((s) => s.startUs / S)).toEqual([10]);
    // A recorder failed: nothing covers [5.25, 6.5).
    const gap = [seg(0, 5.25), seg(6.5, 11.75), seg(11.5, 16.75)];
    expect(6.5 * S - 5.25 * S).toBeGreaterThan(SEGMENT_GAP_US);
    const plan = planClip(gap, 3 * S, 14 * S)!;
    expect(plan.cut).toBe(true);
    expect(plan.startUs).toBe(6.5 * S);
    // A small gap (a recorder's start-up after a pause) does not cut.
    const small = [seg(0, 5), seg(5.2, 10.2)];
    expect(planClip(small, 3 * S, 9 * S)!.cut).toBe(false);
  });

  it("never starts before notBeforeUs (the run's start): the first keyframe at or after it", () => {
    const list = rotation(3);
    // The run started at 3.4 s. Asked from 2 s, the clip still starts at the 4 s keyframe.
    const plan = planClip(list, 2 * S, 11 * S, 3.4 * S)!;
    expect(plan.startUs).toBe(4 * S);
    expect(plan.segments[0]).toMatchObject({ startUs: 0, fromUs: 4 * S, toUs: 5 * S });
    // A bound on a keyframe starts there; no bound keeps the old start.
    expect(planClip(list, 2 * S, 11 * S, 3 * S)!.startUs).toBe(3 * S);
    expect(planClip(list, 2 * S, 11 * S)!.startUs).toBe(2 * S);
    // A bound before the asked start changes nothing.
    expect(planClip(list, 3.4 * S, 11 * S, S)!.startUs).toBe(3 * S);
  });

  it("with one keyframe per segment, a bound starts the clip at the next segment and leaves the older one out", () => {
    const list = rotation(3, () => index({ keyframesUs: [0] }));
    const plan = planClip(list, 0, 14 * S, 3.4 * S)!;
    expect(plan.startUs).toBe(5 * S);
    expect(plan.segments.map((s) => [s.startUs / S, s.fromUs / S])).toEqual([
      [5, 5],
      [10, 10],
    ]);
    // A keyframe in a segment's overlap with the next one is not used: the next segment takes over there.
    const overlap = rotation(2, (i) => index({ keyframesUs: i === 0 ? [0, 5.1 * S] : [0] }));
    expect(planClip(overlap, 0, 9 * S, 4.9 * S)!.startUs).toBe(5 * S);
  });

  it("returns null when no keyframe at or after the bound comes before the end", () => {
    const list = rotation(1, () => index({ keyframesUs: [0] }));
    expect(planClip(list, 0, 5 * S, 2 * S)).toBeNull();
  });

  it("returns null with no usable segment, or no footage in the span", () => {
    expect(planClip([], 0, S)).toBeNull();
    expect(planClip([seg(0, 5.25, null)], 0, 3 * S)).toBeNull();
    expect(planClip(rotation(1), 6 * S, 6 * S)).toBeNull();
  });
});

describe("keyframeGapUs", () => {
  it("is the longest gap between keyframes, with the next segment's start as the last boundary", () => {
    expect(keyframeGapUs(index())).toBe(S);
    expect(keyframeGapUs(index({ keyframesUs: [0] }), 5 * S)).toBe(5 * S);
    expect(keyframeGapUs(index({ keyframesUs: [0, 3 * S] }), 5 * S)).toBe(3 * S);
    // Chromium VP8 (a keyframe about every 100 frames): the gap inside the segment.
    expect(keyframeGapUs(index({ keyframesUs: [0, 3.3 * S], durationUs: 5.25 * S }), 5 * S)).toBe(3.3 * S);
    // Keyframes after the span do not count.
    expect(keyframeGapUs(index({ keyframesUs: [0, 5.1 * S] }), 5 * S)).toBe(5 * S);
    expect(keyframeGapUs(index({ keyframesUs: [] }), 4 * S)).toBe(4 * S);
  });
});

describe("CaptureClock", () => {
  it("is 0 before the first run, then page time with the paused spans removed", () => {
    const clock = new CaptureClock();
    expect(clock.started).toBe(false);
    expect(clock.paused).toBe(true);
    expect(clock.nowUs(5000)).toBe(0);
    clock.run(1000);
    expect(clock.nowUs(1500)).toBe(500_000);
    clock.pause(2000);
    expect(clock.paused).toBe(true);
    // Stands still while paused.
    expect(clock.nowUs(9000)).toBe(1_000_000);
    clock.run(10_000);
    expect(clock.nowUs(10_250)).toBe(1_250_000);
    // Repeated calls change nothing.
    clock.run(11_000);
    clock.pause(12_000);
    clock.pause(13_000);
    expect(clock.nowUs(20_000)).toBe(3_000_000);
    clock.reset();
    expect(clock.started).toBe(false);
    expect(clock.nowUs(30_000)).toBe(0);
  });
});
