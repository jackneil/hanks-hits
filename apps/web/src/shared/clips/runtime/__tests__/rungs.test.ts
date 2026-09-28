import { describe, expect, it } from "vitest";
import {
  estimateDisplayHz,
  estimateVsyncMs,
  forgetDisplayRates,
  inferLowPowerMode,
  measureDisplayHz,
  measureDisplayRate,
  rememberDisplayHz,
  rememberedDisplayHz,
  rungTable,
  screenKey,
  snapHz,
  STANDARD_RATES,
  strideFor,
} from "../rungs";
import { FakeRealm } from "@/__tests__/canvas-mock";

/** Deterministic pseudo-random numbers in [0, 1). */
function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

/**
 * rAF intervals of a game at `fps` on a `hz` display: each frame takes
 * floor or ceil of hz / fps vsyncs, so the mean rate is fps; 0.3 ms jitter.
 */
function gameTrace(hz: number, fps: number, count: number, seed: number): number[] {
  const rnd = lcg(seed);
  const v = 1000 / hz;
  const m = hz / fps;
  const low = Math.max(1, Math.floor(m));
  const p = m - Math.floor(m);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push((rnd() < p ? low + 1 : low) * v + (rnd() - 0.5) * 0.6);
  return out;
}

/** rAF intervals with the given shares of 1, 2, 3, ... vsyncs; 0.3 ms jitter. */
function mixTrace(hz: number, shares: number[], count: number, seed: number): number[] {
  const rnd = lcg(seed);
  const v = 1000 / hz;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    let r = rnd();
    let k = 1;
    for (const share of shares) {
      if (r < share) break;
      r -= share;
      k++;
    }
    out.push(Math.min(k, shares.length) * v + (rnd() - 0.5) * 0.6);
  }
  return out;
}

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

  it("returns 60 with too few intervals, and 30 for a real 30 Hz rAF", () => {
    expect(estimateDisplayHz([16.7])).toBe(60);
    expect(estimateVsyncMs([16.7, 16.6])).toBeNull();
    expect(estimateDisplayHz([33.3, 33.4, 33.3, 33.2])).toBe(30);
    expect(estimateDisplayHz(gameTrace(30, 30, 40, 3))).toBe(30);
  });

  // Games slower than half the display rate: few intervals are one vsync long.
  for (const [hz, fps] of [
    [60, 32],
    [60, 33],
    [60, 36],
  ] as const) {
    it(`reads ${hz} Hz under a ${fps} fps game (not a lower rate)`, () => {
      for (const seed of [1, 2, 3, 4, 5]) expect(estimateDisplayHz(gameTrace(hz, fps, 40, seed))).toBe(hz);
    });
  }

  it("reads 120 Hz under a 55 fps game that sometimes makes a frame in one vsync", () => {
    // 15% one vsync, 52% two, 33% three: 55 fps on a 120 Hz screen.
    for (const seed of [1, 2, 3, 4, 5]) {
      const trace = mixTrace(120, [0.15, 0.52, 0.33], 40, seed);
      const fps = 1000 / (trace.reduce((a, b) => a + b, 0) / trace.length);
      expect(fps).toBeGreaterThan(50);
      expect(fps).toBeLessThan(60);
      expect(estimateDisplayHz(trace)).toBe(120);
    }
  });

  it("cannot see a rate the game never reaches under load; the session memo keeps the idle rate", () => {
    forgetDisplayRates();
    // Every frame takes 2 or 3 vsyncs of a 120 Hz screen: the samples look like 60 Hz.
    const busy = estimateDisplayHz(mixTrace(120, [0, 0.8, 0.2], 40, 1));
    expect(busy).toBe(60);
    const key = "phone";
    rememberDisplayHz(key, 120); // measured on the start card
    expect(rememberDisplayHz(key, busy)).toBe(120);
    forgetDisplayRates();
  });

  it("ignores a lone short outlier", () => {
    const intervals = [16.7, 16.6, 16.7, 16.8, 8.1, 33.3, 16.7, 16.6];
    expect(estimateDisplayHz(intervals)).toBe(60);
  });

  it("measureDisplayHz reads rAF timestamps from the realm", async () => {
    const realm = new FakeRealm();
    const p = measureDisplayHz(realm, 20);
    realm.run(1000, 144, 25);
    await expect(p).resolves.toBe(144);
  });
});

describe("Low Power Mode and the session memo", () => {
  it("infers Low Power Mode only from a long, regular 30 Hz idle sample", () => {
    expect(inferLowPowerMode(gameTrace(30, 30, 40, 1))).toBe(true);
    expect(inferLowPowerMode(gameTrace(60, 60, 40, 1))).toBe(false);
    // Too short to tell.
    expect(inferLowPowerMode(gameTrace(30, 30, 20, 1))).toBe(false);
    // One interval under 25 ms means rAF can run faster than 30 Hz.
    expect(inferLowPowerMode([...gameTrace(30, 30, 40, 1), 16.7])).toBe(false);
    // A 24 fps game on a 60 Hz screen: 33 and 50 ms intervals, not regular.
    expect(inferLowPowerMode(gameTrace(60, 24, 60, 2))).toBe(false);
    // A 29 fps game looks just like Low Power Mode: this is why callers pass
    // only samples taken while no game runs.
    expect(inferLowPowerMode(gameTrace(60, 29, 60, 2))).toBe(true);
  });

  it("measureDisplayRate infers Low Power Mode only when the caller says the sample is idle", async () => {
    const realm = new FakeRealm();
    const idle = measureDisplayRate(realm, { idle: true });
    realm.run(0, 30, 45);
    await expect(idle).resolves.toEqual({ hz: 30, lowPowerMode: true });
    const busy = measureDisplayRate(realm, { idle: false });
    realm.run(2000, 30, 45);
    await expect(busy).resolves.toEqual({ hz: 30, lowPowerMode: false });
  });

  it("keeps the highest rate per screen, so a reading under load never lowers it", () => {
    forgetDisplayRates();
    const key = screenKey({ screen: { width: 390, height: 844 }, devicePixelRatio: 3 });
    expect(key).toBe("390x844@3");
    expect(screenKey({})).toBe("screen");
    expect(rememberedDisplayHz(key)).toBeUndefined();
    expect(rememberDisplayHz(key, 60)).toBe(60);
    expect(rememberDisplayHz(key, 30)).toBe(60);
    expect(rememberDisplayHz(key, 120)).toBe(120);
    expect(rememberDisplayHz("other", 60)).toBe(60);
    expect(rememberedDisplayHz(key)).toBe(120);
    forgetDisplayRates();
    expect(rememberedDisplayHz(key)).toBeUndefined();
  });
});
