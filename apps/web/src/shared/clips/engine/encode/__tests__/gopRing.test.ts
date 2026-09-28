import { describe, expect, it } from "vitest";
import { GopRing, VIDEO_RING_BYTE_CEILING, type RingTrim } from "../gopRing";
import type { VideoPacket } from "../videoSession";

const F = 33_333;

function pkt(tsUs: number, type: "key" | "delta", bytes = 1000, epoch = 0, durUs = F): VideoPacket {
  return { type, tsUs, durUs, data: new ArrayBuffer(bytes), epoch };
}

/** Pushes `seconds` of 30 fps video with a keyframe every `gop` frames. */
function feed(ring: GopRing, fromFrame: number, frames: number, gop = 30, bytes = 1000, epoch = 0): void {
  for (let i = fromFrame; i < fromFrame + frames; i++) ring.push(pkt(i * F, i % gop === 0 ? "key" : "delta", bytes, epoch));
}

describe("GopRing", () => {
  it("groups packets into GOPs that start at keyframes", () => {
    const r = new GopRing({ ringSeconds: 60, byteBudget: 1e9 });
    feed(r, 0, 95);
    expect(r.gops.map((g) => g.packets.length)).toEqual([30, 30, 30, 5]);
    expect(r.gops.map((g) => g.startUs)).toEqual([0, 30 * F, 60 * F, 90 * F]);
    expect(r.coverage).toEqual({ startUs: 0, endUs: 95 * F, seconds: (95 * F) / 1e6 });
    expect(r.bytes).toBe(95_000);
    expect(r.newest!.startUs).toBe(90 * F);
  });

  it("drops a delta that has no GOP to join", () => {
    const r = new GopRing({ ringSeconds: 60, byteBudget: 1e9 });
    r.push(pkt(0, "delta"));
    expect(r.empty).toBe(true);
    feed(r, 1, 10, 30, 1000, 0); // frame 1..10 are deltas: no key yet
    r.push(pkt(11 * F, "key"));
    r.push(pkt(12 * F, "delta", 1000, 1)); // a delta of a new epoch before its key
    expect(r.gops).toHaveLength(1);
    expect(r.orphanDeltas).toBe(12);
  });

  it("keeps the fewest GOPs that still cover ringSeconds, and reports the exact coverage", () => {
    const r = new GopRing({ ringSeconds: 5, byteBudget: 1e9 });
    const trims: RingTrim[] = [];
    const r2 = new GopRing({ ringSeconds: 5, byteBudget: 1e9, onTrim: (t) => trims.push(t) });
    feed(r, 0, 30 * 20); // 20 s
    feed(r2, 0, 30 * 20);
    const c = r.coverage!;
    expect(c.seconds).toBeGreaterThanOrEqual(5);
    expect(c.seconds).toBeLessThan(6);
    // Removing one more GOP would drop below 5 s.
    expect(c.endUs - r.gops[1].startUs).toBeLessThan(5e6);
    expect(trims.length).toBeGreaterThan(0);
    expect(trims.every((t) => t.reason === "time")).toBe(true);
    expect(r2.byteTrims).toBe(0);
    expect(r.limitedByBytes).toBe(false);
  });

  it("trims for bytes, counts it, and says coverage is short because of bytes", () => {
    const trims: RingTrim[] = [];
    const r = new GopRing({ ringSeconds: 60, byteBudget: 90 * 1000, onTrim: (t) => trims.push(t) });
    feed(r, 0, 150); // 5 GOPs of 30 KB; three fit the budget exactly
    expect(r.bytes).toBe(90_000);
    expect(r.gops.map((g) => g.startUs)).toEqual([60 * F, 90 * F, 120 * F]);
    expect(r.byteTrims).toBe(2);
    expect(r.limitedByBytes).toBe(true);
    expect(trims.map((t) => t.reason)).toEqual(["bytes", "bytes"]);
    expect(trims[0]).toMatchObject({ epoch: 0, startUs: 0, endUs: 30 * F, bytes: 30_000 });
    expect(r.coverage!.seconds).toBeCloseTo((90 * F) / 1e6, 9);
  });

  it("never drops the newest GOP, even when it alone is over the budget", () => {
    const r = new GopRing({ ringSeconds: 60, byteBudget: 5_000 });
    feed(r, 0, 30, 3000); // one GOP (a starved encoder), 30 KB
    expect(r.gops).toHaveLength(1);
    expect(r.bytes).toBe(30_000);
    r.push(pkt(30 * F, "key"));
    expect(r.gops).toHaveLength(1);
    expect(r.gops[0].startUs).toBe(30 * F);
  });

  it("uses the latest packet end, also when packets arrive out of order", () => {
    const r = new GopRing({ ringSeconds: 60, byteBudget: 1e9 });
    r.push(pkt(0, "key"));
    r.push(pkt(2 * F, "delta"));
    r.push(pkt(1 * F, "delta"));
    expect(r.endUs).toBe(3 * F);
  });

  it("tracks epochs in use and clears", () => {
    const r = new GopRing({ ringSeconds: 60, byteBudget: 1e9 });
    feed(r, 0, 30, 30, 1000, 0);
    feed(r, 30, 30, 30, 1000, 1);
    expect([...r.epochsInUse()]).toEqual([0, 1]);
    r.clear();
    expect(r.empty).toBe(true);
    expect(r.coverage).toBeNull();
    expect(r.endUs).toBe(-Infinity);
    expect(r.bytes).toBe(0);
  });

  it("has class ceilings that hold the nominal ring at the highest planned bitrate with 2x headroom", () => {
    const worstBitrate = 3_500_000; // plan 5.1: 60 fps 2D
    expect(VIDEO_RING_BYTE_CEILING.low).toBeGreaterThanOrEqual(2 * ((30 * worstBitrate) / 8));
    expect(VIDEO_RING_BYTE_CEILING.mid).toBeGreaterThanOrEqual(2 * ((60 * worstBitrate) / 8));
    expect(VIDEO_RING_BYTE_CEILING.high).toBeGreaterThanOrEqual(2 * ((60 * worstBitrate) / 8));
  });
});
