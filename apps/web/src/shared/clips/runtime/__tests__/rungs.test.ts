import { describe, expect, it } from "vitest";
import {
  estimateDisplayHz,
  isLowPowerRate,
  measureDisplayHz,
  rungTable,
  snapHz,
  STANDARD_RATES,
  strideFor,
} from "../rungs";
import { FakeRealm } from "./fakeRealm";

// Plan 6.2 table, verbatim (one decimal).
const PLAN_TABLE: Record<number, { 30: number[]; 60: number[] }> = {
  50: { 30: [25, 16.7], 60: [50, 25, 16.7] },
  60: { 30: [30, 20, 15], 60: [60, 30, 20, 15] },
  75: { 30: [25, 18.8, 15], 60: [37.5, 25, 18.8, 15] },
  90: { 30: [30, 22.5, 18, 15], 60: [45, 30, 22.5, 18, 15] },
  120: { 30: [30, 24, 20, 17.1, 15], 60: [60, 40, 30, 24, 20, 17.1, 15] },
  144: { 30: [28.8, 24, 20.6, 18, 16], 60: [48, 36, 28.8, 24, 20.6, 18, 16] },
  165: {
    30: [27.5, 23.6, 20.6, 18.3, 16.5, 15],
    60: [55, 41.2, 33, 27.5, 23.6, 20.6, 18.3, 16.5, 15],
  },
};

describe("rungTable", () => {
  for (const [hz, byTarget] of Object.entries(PLAN_TABLE)) {
    for (const target of [30, 60] as const) {
      it(`matches the plan at ${hz} Hz, ${target} fps target`, () => {
        const rungs = rungTable(Number(hz), target);
        const expected = byTarget[target];
        expect(rungs.map((r) => r.fps)).toHaveLength(expected.length);
        rungs.forEach((r, i) => {
          // The plan rounds to one decimal; 41.25 is written 41.2.
          expect(Math.abs(r.fps - expected[i])).toBeLessThanOrEqual(0.051);
          expect(r.fps).toBeCloseTo(Number(hz) / r.k, 9);
        });
        // Strides are successive integers from ceil(Hz / target).
        rungs.forEach((r, i) => expect(r.k).toBe(strideFor(Number(hz), target) + i));
      });
    }
  }

  it("never exceeds the target and never goes under the 15 fps floor", () => {
    for (const hz of STANDARD_RATES) {
      for (const target of [30, 60]) {
        const rungs = rungTable(hz, target);
        expect(rungs.length).toBeGreaterThan(0);
        for (const r of rungs) {
          expect(r.fps).toBeLessThanOrEqual(target + 1e-9);
          expect(r.fps).toBeGreaterThanOrEqual(15 - 1e-9);
        }
      }
    }
  });

  it("gives Low Power Mode (30 Hz) a 30 and a 15 fps rung", () => {
    expect(rungTable(30, 30).map((r) => r.fps)).toEqual([30, 15]);
    expect(rungTable(30, 60).map((r) => r.fps)).toEqual([30, 15]);
  });

  it("keeps one rung for a display under the floor", () => {
    expect(rungTable(12, 30)).toEqual([{ k: 1, fps: 12 }]);
  });
});

describe("snapHz and estimateDisplayHz", () => {
  it("snaps near values to standard rates", () => {
    expect(snapHz(59.94)).toBe(60);
    expect(snapHz(60.2)).toBe(60);
    expect(snapHz(119.6)).toBe(120);
    expect(snapHz(143.9)).toBe(144);
    expect(snapHz(164.8)).toBe(165);
    expect(snapHz(49.9)).toBe(50);
    expect(snapHz(74.6)).toBe(75);
    expect(snapHz(89.1)).toBe(90);
    expect(snapHz(30.1)).toBe(30);
    expect(snapHz(239)).toBe(240);
    expect(snapHz(0)).toBe(60);
    expect(snapHz(Number.NaN)).toBe(60);
  });

  it("uses the median of the shortest intervals, so stalls do not lower it", () => {
    const intervals = [16.7, 16.6, 33.4, 16.7, 50.1, 16.8, 16.6, 250, 33.3, 16.7];
    expect(estimateDisplayHz(intervals)).toBe(60);
  });

  it("measures 120 Hz with jitter and a game that misses frames", () => {
    const intervals: number[] = [];
    for (let i = 0; i < 60; i++) intervals.push(i % 3 === 0 ? 16.67 : 8.33 + (i % 2 ? 0.3 : -0.3));
    expect(estimateDisplayHz(intervals)).toBe(120);
  });

  it("returns 60 with too few intervals and flags 30 Hz as low power", () => {
    expect(estimateDisplayHz([16.7])).toBe(60);
    expect(estimateDisplayHz([33.3, 33.4, 33.3, 33.2])).toBe(30);
    expect(isLowPowerRate(30)).toBe(true);
    expect(isLowPowerRate(60)).toBe(false);
  });

  it("measureDisplayHz reads rAF timestamps from the realm", async () => {
    const realm = new FakeRealm();
    const p = measureDisplayHz(realm, 20);
    realm.run(1000, 144, 25);
    await expect(p).resolves.toBe(144);
  });
});
