import { describe, it, expect } from "vitest";
import { exhaustSamples, engineTargets } from "../lib/engineAudio";
describe("ATV exhaust", () => {
  it("has headroom, no DC offset and a bounded loop seam", () => {
    const pcm = exhaustSamples(22050);
    // One expect per property, not per sample: 44,100 expect() calls took
    // 3-6 s under load and timed the test out.
    let sum = 0,
      energy = 0,
      peak = 0,
      nonFinite = 0;
    for (const n of pcm) {
      if (!Number.isFinite(n)) nonFinite++;
      sum += n;
      energy += n * n;
      peak = Math.max(peak, Math.abs(n));
    }
    expect(nonFinite).toBe(0);
    expect(peak).toBeLessThanOrEqual(0.801);
    expect(Math.abs(sum / pcm.length)).toBeLessThan(0.00001);
    expect(Math.sqrt(energy / pcm.length)).toBeGreaterThan(0.07);
    expect(Math.abs(pcm[0] - pcm.at(-1)!)).toBeLessThan(0.12);
  });
  it("responds to throttle at a standstill and relaxes while coasting", () => {
    expect(engineTargets(0, 1).rpm).toBeGreaterThan(engineTargets(0, 0).rpm);
    expect(engineTargets(0.6, 0).rpm).toBeLessThan(engineTargets(0.6, 1).rpm);
    expect(engineTargets(1, 1).rpm).toBeLessThan(5500);
    expect(engineTargets(NaN, Infinity)).toEqual(engineTargets(0, 0));
  });
});
