import { describe, expect, it } from "vitest";
import { CaptureTimeline, PageClock } from "../timeline";

describe("CaptureTimeline", () => {
  it("starts at the first live command", () => {
    const t = new CaptureTimeline();
    expect(t.started).toBe(false);
    expect(t.captureUsAtPerf(5000)).toBe(0);
    expect(t.perfAtCaptureUs(0)).toBe(0);
    expect(t.set("paused", 900)).toBe(false);
    expect(t.set("live", 1000)).toBe(true);
    expect(t.started).toBe(true);
    expect(t.live).toBe(true);
    expect(t.originPerfMs).toBe(1000);
    expect(t.captureUsAtPerf(1000)).toBe(0);
    expect(t.captureUsAtPerf(1250.5)).toBe(250_500);
    expect(t.perfAtCaptureUs(250_500)).toBe(1250.5);
  });

  it("gives negative capture time before the origin, and back", () => {
    const t = new CaptureTimeline();
    t.set("live", 1000);
    expect(t.captureUsAtPerf(900)).toBe(-100_000);
    expect(t.perfAtCaptureUs(-100_000)).toBe(900);
  });

  it("removes paused spans (plan 6.2)", () => {
    const t = new CaptureTimeline();
    t.set("live", 1000);
    t.set("paused", 3000);
    expect(t.live).toBe(false);
    // Inside the pause, capture time stays at the pause point.
    expect(t.captureUsAtPerf(3500)).toBe(2_000_000);
    expect(t.perfAtCaptureUs(2_500_000)).toBe(3000);
    t.set("live", 5000);
    expect(t.captureUsAtPerf(5000)).toBe(2_000_000);
    expect(t.captureUsAtPerf(6000)).toBe(3_000_000);
    // A capture time on the seam belongs to the later span.
    expect(t.perfAtCaptureUs(2_000_000)).toBe(5000);
    expect(t.perfAtCaptureUs(1_999_000)).toBe(2999);
    expect(t.perfAtCaptureUs(3_000_000)).toBe(6000);
  });

  it("maps many pauses in both directions", () => {
    const t = new CaptureTimeline();
    t.set("live", 0);
    let perf = 0;
    let live = 0;
    const samples: Array<[number, number]> = [];
    for (let i = 0; i < 50; i++) {
      perf += 100 + i;
      live += 100 + i;
      samples.push([perf - 10, (live - 10) * 1000]);
      t.set("paused", perf);
      perf += 37;
      t.set("live", perf);
    }
    expect(t.spanCount).toBe(51);
    for (const [p, c] of samples) {
      expect(t.captureUsAtPerf(p)).toBeCloseTo(c, 6);
      expect(t.perfAtCaptureUs(c)).toBeCloseTo(p, 6);
    }
  });

  it("ignores repeats and clamps times that go back", () => {
    const t = new CaptureTimeline();
    t.set("live", 1000);
    expect(t.set("live", 1200)).toBe(false);
    t.set("paused", 2000);
    expect(t.set("paused", 2100)).toBe(false);
    // A resume stamped before the pause is moved up to the pause.
    t.set("live", 1500);
    expect(t.captureUsAtPerf(2000)).toBe(1_000_000);
    expect(t.captureUsAtPerf(2500)).toBe(1_500_000);
    // A pause stamped before its span began is moved up to the span start.
    t.set("paused", 100);
    expect(t.captureUsAtPerf(9999)).toBe(1_000_000);
  });

  it("lists pause points, including a pending pause and a seam exactly at the range start", () => {
    const t = new CaptureTimeline();
    t.set("live", 0);
    t.set("paused", 1000);
    t.set("live", 2000);
    t.set("paused", 2500);
    expect(t.pausePointsBetween(0, 10_000_000)).toEqual([1_000_000, 1_500_000]);
    expect(t.pausePointsBetween(1_000_000, 1_000_000)).toEqual([1_000_000]);
    expect(t.pausePointsBetween(1_000_001, 1_499_999)).toEqual([]);
    expect(t.pausePointsBetween(1_500_000, 2_000_000)).toEqual([1_500_000]);
  });
});

describe("PageClock", () => {
  it("keeps the smallest delay seen and estimates page time", () => {
    const c = new PageClock();
    expect(c.known).toBe(false);
    expect(c.pageNow(10)).toBeNull();
    c.observe(1000, 5003); // arrived 3 ms late
    c.observe(1100, 5100.4); // arrived 0.4 ms late: the better bound
    c.observe(1200, 5210); // slow message: ignored
    expect(c.known).toBe(true);
    expect(c.pageNow(5300)).toBeCloseTo(1299.6, 9);
    c.observe(Number.NaN, 1);
    expect(c.pageNow(5300)).toBeCloseTo(1299.6, 9);
    c.reset();
    expect(c.known).toBe(false);
  });
});
