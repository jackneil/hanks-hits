// @vitest-environment node
/**
 * The first frame of a segment on the capture timeline (anchor.ts). Pure
 * logic: paint times in, the capture time of the segment's first frame out,
 * for the two ways browsers start a recording.
 */
import { describe, expect, it } from "vitest";
import { anchorSegment } from "../anchor";
import { ANCHOR_MATCH_US } from "../constants";

const FRAME = 33_333;

/** Paints at an even pace from `from`, every `step` microseconds. */
function even(from: number, count: number, step = FRAME): number[] {
  return Array.from({ length: count }, (_, i) => Math.round(from + i * step));
}

/** Paints with the uneven pace of a real game: steps of 1 or 2 frames and some jitter. */
function uneven(from: number, count: number, seed = 7): number[] {
  const out: number[] = [];
  let t = from;
  let x = seed;
  for (let i = 0; i < count; i++) {
    out.push(Math.round(t));
    x = (x * 1103515245 + 12345) % 2 ** 31;
    const r = x / 2 ** 31;
    t += (r < 0.3 ? 2 : 1) * FRAME + (r - 0.5) * 4000;
  }
  return out;
}

/** The packet times of a file whose frames are `frames` (from the first one). */
function packets(frames: number[]): number[] {
  return frames.map((f) => f - frames[0]);
}

describe("anchorSegment", () => {
  it("Chromium: the first frame is the first paint after start(), found even when the start event is late", () => {
    const paints = uneven(0, 300);
    const startCallUs = paints[100] + 5000;
    // The recorder's frames: every paint from the first one after start().
    const frames = paints.slice(101, 250);
    const startEventUs = frames[0] + 140_000;
    const found = anchorSegment({ paintsUs: paints, startCallUs, startEventUs, packetTimesUs: packets(frames) });
    expect(found).toMatchObject({ startUs: frames[0], matched: true });
    expect(found.errorUs).toBe(0);
  });

  it("Gecko: the held frame is at the start() call; the next frames are the paints after it", () => {
    const paints = uneven(0, 300, 11);
    const startCallUs = paints[100] + 9000;
    const frames = [startCallUs, ...paints.slice(101, 250)];
    const found = anchorSegment({ paintsUs: paints, startCallUs, startEventUs: startCallUs + 60_000, packetTimesUs: packets(frames) });
    expect(found).toMatchObject({ startUs: startCallUs, matched: true });
  });

  it("an even pace fits several paints: the order of preference picks the first paint after start() (Chromium)", () => {
    const paints = even(0, 300);
    const startCallUs = paints[100] + 12_000;
    const frames = paints.slice(101, 250);
    const found = anchorSegment({ paintsUs: paints, startCallUs, startEventUs: frames[0] + 90_000, packetTimesUs: packets(frames) });
    // The paint before start() and the ones after the first fit as well; the preferred one wins.
    expect(found.startUs).toBe(paints[101]);
    expect(found.matched).toBe(true);
  });

  it("an even pace with the Gecko held frame: the start() call fits exactly and comes first", () => {
    const paints = even(0, 300);
    const startCallUs = paints[100] + 12_000;
    const frames = [startCallUs, ...paints.slice(101, 250)];
    const found = anchorSegment({ paintsUs: paints, startCallUs, startEventUs: startCallUs + 30_000, packetTimesUs: packets(frames) });
    expect(found.startUs).toBe(startCallUs);
  });

  it("a frame can never be later than the start event: a later paint is no candidate", () => {
    const paints = even(0, 300);
    const startCallUs = paints[100] + 1000;
    // The file really starts at paints[103] (a skipped start), but the event came right after paints[101].
    const frames = paints.slice(103, 250);
    const found = anchorSegment({ paintsUs: paints, startCallUs, startEventUs: paints[101] + 2000, packetTimesUs: packets(frames) });
    expect(found.startUs).toBeLessThanOrEqual(paints[101] + 2000 + ANCHOR_MATCH_US);
  });

  it("with no close fit, it uses the first paint after start() and says so", () => {
    const paints = even(0, 300);
    const startCallUs = paints[100] + 1000;
    // Packet times that fit no paint grid (a recorder that timestamps on its own clock).
    const odd = Array.from({ length: 60 }, (_, i) => i * 21_111);
    const found = anchorSegment({ paintsUs: paints, startCallUs, startEventUs: paints[102], packetTimesUs: odd });
    expect(found.matched).toBe(false);
    expect(found.startUs).toBe(paints[101]);
    expect(found.errorUs).toBeGreaterThan(ANCHOR_MATCH_US);
  });

  it("a one-frame segment has nothing to compare: the start() call", () => {
    const paints = even(0, 30);
    const found = anchorSegment({ paintsUs: paints, startCallUs: paints[10] + 3000, startEventUs: paints[12], packetTimesUs: [0] });
    expect(found).toMatchObject({ startUs: paints[10] + 3000, matched: true });
  });

  it("no paint at all: the start() call (the fallback of the fallback)", () => {
    const found = anchorSegment({ paintsUs: [], startCallUs: 5000, startEventUs: 90_000, packetTimesUs: [0, FRAME, 2 * FRAME] });
    expect(found.startUs).toBe(5000);
  });
});
