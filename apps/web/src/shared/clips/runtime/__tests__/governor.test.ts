import { describe, expect, it } from "vitest";
import {
  buildLadder,
  CLEAN_WINDOWS_TO_STEP_UP,
  Governor,
  type GovernorLevel,
  MAX_STEP_UPS,
  WINDOW_MS,
} from "../governor";

interface Trace {
  startMs: number;
  durationMs: number;
  hz?: number;
  /** Game work per frame, ms. */
  workMs: number;
  /** Capture cost of a capture frame at this level, ms. */
  costMs: (level: GovernorLevel) => number;
  encoder?: (t: number) => { queue: number; latencyMs: number };
}

/**
 * A synthetic game: each frame takes workMs plus the capture cost, and the
 * next frame starts on the next vsync after that work ends. A capture runs
 * every k-th frame of the current level.
 */
function simulate(gov: Governor, trace: Trace): number {
  const v = 1000 / (trace.hz ?? 60);
  let t = trace.startMs;
  let n = 0;
  while (t < trace.startMs + trace.durationMs) {
    gov.gameFrame(t);
    const level = gov.level;
    let cost = 0;
    if (level.k > 0 && n % level.k === 0) {
      cost = trace.costMs(level);
      gov.captureCost(t, cost);
    }
    if (trace.encoder) gov.encoder(t, trace.encoder(t));
    t += Math.max(1, Math.ceil((trace.workMs + cost) / v - 1e-9)) * v;
    n++;
  }
  gov.tick(t);
  return t;
}

const light = () => 2.5; // path P, measured 2-3 ms on the iPhone SE
const heavyD = () => 25; // path D on WebGL, measured 23-30 ms

describe("buildLadder", () => {
  it("lists the rungs, then scaled content, then low-power, then resting", () => {
    const ladder = buildLadder(60, 30);
    expect(ladder.map((l) => [l.kind, l.k, Math.round(l.fps * 10) / 10, l.scale])).toEqual([
      ["rung", 2, 30, 1],
      ["rung", 3, 20, 1],
      ["rung", 4, 15, 1],
      ["scaled", 4, 15, 0.75],
      ["scaled", 4, 15, 0.5],
      ["low-power", 4, 15, 0.5],
      ["resting", 0, 0, 0.5],
    ]);
    expect(ladder[5].keepSeconds).toBe(15);
  });
});

describe("Governor", () => {
  it("stays at the top rung when capture is cheap (path P, 2.5 ms)", () => {
    const gov = new Governor({ displayHz: 60, targetFps: 30, baselineFps: 60 });
    simulate(gov, { startMs: 0, durationMs: 60_000, workMs: 8, costMs: light });
    expect(gov.levelIndex).toBe(0);
    expect(gov.history).toEqual([]);
    const judged = gov.windowReports.filter((r) => r.judged);
    expect(judged.length).toBeGreaterThan(20);
    for (const r of judged) {
      expect(r.violations).toEqual([]);
      expect(r.captureShare).toBeLessThan(0.1);
    }
  });

  it("steps down after two violating windows, through every level to resting (path D, 25 ms)", () => {
    const gov = new Governor({ displayHz: 60, targetFps: 30 });
    simulate(gov, { startMs: 0, durationMs: 40_000, workMs: 8, costMs: heavyD });
    expect(gov.resting).toBe(true);
    const steps = gov.history.map((d) => [d.from, d.to, d.reason]);
    expect(steps).toEqual([
      [0, 1, "violations"],
      [1, 2, "violations"],
      [2, 3, "violations"],
      [3, 4, "violations"],
      [4, 5, "violations"],
      [5, 6, "violations"],
    ]);
    // Each step needs two full 2 s windows of evidence.
    for (let i = 1; i < gov.history.length; i++) {
      expect(gov.history[i].atMs - gov.history[i - 1].atMs).toBeGreaterThanOrEqual(2 * WINDOW_MS);
    }
    expect(gov.history[0].report?.violations).toContain("capture-share");
    expect(gov.history[0].report?.violations).toContain("capture-p95");
  });

  it("does not step down on one violating window", () => {
    const gov = new Governor({ displayHz: 60, targetFps: 30 });
    let t = simulate(gov, { startMs: 0, durationMs: 2_000, workMs: 8, costMs: heavyD });
    t = simulate(gov, { startMs: t, durationMs: 2_000, workMs: 8, costMs: light });
    t = simulate(gov, { startMs: t, durationMs: 2_000, workMs: 8, costMs: heavyD });
    simulate(gov, { startMs: t, durationMs: 2_000, workMs: 8, costMs: light });
    expect(gov.levelIndex).toBe(0);
  });

  it("steps up after 30 s clean, at most twice per session", () => {
    const gov = new Governor({ displayHz: 60, targetFps: 30, startLevel: 4 });
    expect(gov.level.kind).toBe("scaled");
    simulate(gov, { startMs: 0, durationMs: 200_000, workMs: 8, costMs: light });
    expect(gov.history.map((d) => [d.from, d.to, d.reason])).toEqual([
      [4, 3, "clean"],
      [3, 2, "clean"],
    ]);
    expect(gov.stepUpsUsed).toBe(MAX_STEP_UPS);
    const gap = gov.history[1].atMs - gov.history[0].atMs;
    expect(gap).toBeGreaterThanOrEqual(CLEAN_WINDOWS_TO_STEP_UP * WINDOW_MS);
  });

  it("flags frames that only capture pushed past a vsync", () => {
    const gov = new Governor({ displayHz: 60, targetFps: 30 });
    // 14 ms of game work fits a 16.7 ms frame; 3 ms of capture pushes it over.
    simulate(gov, { startMs: 0, durationMs: 4_100, workMs: 14, costMs: () => 3 });
    expect(gov.history[0]?.report?.violations).toEqual(["missed-frames"]);
    expect(gov.levelIndex).toBe(1);
  });

  it("does not blame capture for a game that misses vsyncs on its own", () => {
    const gov = new Governor({ displayHz: 60, targetFps: 30 });
    const v = 1000 / 60;
    let t = 0;
    let n = 0;
    let seed = 7;
    while (t < 20_000) {
      gov.gameFrame(t);
      if (n % 2 === 0) gov.captureCost(t, 1);
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      // A 41 fps game: one or two vsyncs per frame, whatever capture does.
      t += (seed / 2 ** 31 < 0.537 ? 1 : 2) * v;
      n++;
    }
    gov.tick(t);
    expect(gov.history).toEqual([]);
    for (const r of gov.windowReports.filter((w) => w.judged)) {
      expect(r.missedByCapture).toBeLessThan(0.1);
    }
  });

  it("flags an encoder that falls behind", () => {
    const gov = new Governor({ displayHz: 60, targetFps: 30 });
    simulate(gov, {
      startMs: 0,
      durationMs: 4_100,
      workMs: 8,
      costMs: light,
      encoder: () => ({ queue: 3, latencyMs: 400 }),
    });
    expect(gov.history[0]?.report?.violations).toEqual(["encoder-behind"]);
  });

  it("flags backpressure drops from the pump", () => {
    const gov = new Governor({ displayHz: 60, targetFps: 30 });
    let offered = 0;
    let drops = 0;
    for (let t = 0; t < 4_100; t += 1000 / 60) {
      gov.gameFrame(t);
      offered += 1;
      if (Math.floor(t / 100) % 3 === 0) drops += 1;
      gov.pumpStats(t, { offered, dropsBackpressure: drops });
    }
    gov.tick(4_200);
    expect(gov.history[0]?.report?.violations).toEqual(["backpressure"]);
  });

  it("counts long animation frames attributed to capture", () => {
    const gov = new Governor({ displayHz: 60, targetFps: 30 });
    for (let t = 0; t < 4_100; t += 1000 / 60) {
      gov.gameFrame(t);
      if (Math.round(t) % 50 < 17) gov.longFrame(t, { durationMs: 30, captureMs: 20 });
    }
    gov.tick(4_200);
    expect(gov.history[0]?.report?.violations).toEqual(["missed-frames"]);
  });

  it("goes straight to resting on two severe windows against the baseline", () => {
    const gov = new Governor({ displayHz: 60, targetFps: 30, baselineFps: 60 });
    simulate(gov, { startMs: 0, durationMs: 4_100, workMs: 8, costMs: heavyD });
    expect(gov.resting).toBe(true);
    expect(gov.history.map((d) => d.reason)).toEqual(["severe"]);
  });

  it("does not judge windows with too few frames (a hidden tab)", () => {
    const gov = new Governor({ displayHz: 60, targetFps: 30 });
    gov.gameFrame(0);
    gov.captureCost(0, 30);
    gov.gameFrame(10_000);
    gov.captureCost(10_000, 30);
    gov.tick(20_000);
    expect(gov.history).toEqual([]);
    expect(gov.windowReports.every((r) => !r.judged)).toBe(true);
  });

  it("applies Compute Pressure: serious steps once, critical rests, relief returns", () => {
    const gov = new Governor({ displayHz: 60, targetFps: 30 });
    gov.setPower(0, { pressure: "serious" });
    expect(gov.levelIndex).toBe(1);
    gov.setPower(10, { pressure: "serious" });
    expect(gov.levelIndex).toBe(1);
    // No step up while serious, however clean.
    simulate(gov, { startMs: 20, durationMs: 70_000, workMs: 8, costMs: light });
    expect(gov.levelIndex).toBe(1);
    gov.setPower(80_000, { pressure: "critical" });
    expect(gov.resting).toBe(true);
    gov.setPower(81_000, { pressure: "nominal" });
    expect(gov.levelIndex).toBe(1);
    expect(gov.history.map((d) => d.reason)).toEqual(["pressure", "pressure", "power-cleared"]);
  });

  it("rests on a low, discharging battery with hysteresis", () => {
    const gov = new Governor({ displayHz: 60, targetFps: 30 });
    gov.setPower(0, { batteryLevel: 0.5, charging: false });
    expect(gov.levelIndex).toBe(0);
    gov.setPower(1, { batteryLevel: 0.19 });
    expect(gov.resting).toBe(true);
    gov.setPower(2, { batteryLevel: 0.22 });
    expect(gov.resting).toBe(true);
    gov.setPower(3, { charging: true });
    expect(gov.levelIndex).toBe(0);
    gov.setPower(4, { charging: false, batteryLevel: 0.24 });
    expect(gov.levelIndex).toBe(0);
  });

  it("keeps Low Power Mode at the low-power level or lower", () => {
    const gov = new Governor({ displayHz: 30, targetFps: 30 });
    gov.setPower(0, { lowPowerMode: true });
    expect(gov.level.kind).toBe("low-power");
    expect(gov.level.keepSeconds).toBe(15);
    simulate(gov, { startMs: 0, durationMs: 100_000, hz: 30, workMs: 8, costMs: light });
    expect(gov.level.kind).toBe("low-power");
  });

  it("leaves a performance rest only through resume(), to low-power", () => {
    const gov = new Governor({ displayHz: 60, targetFps: 30, baselineFps: 60 });
    simulate(gov, { startMs: 0, durationMs: 4_100, workMs: 8, costMs: heavyD });
    expect(gov.resting).toBe(true);
    // Resting windows are never judged, so no step up happens by itself.
    simulate(gov, { startMs: 5_000, durationMs: 100_000, workMs: 8, costMs: light });
    expect(gov.resting).toBe(true);
    expect(gov.resume(200_000)).toBe(true);
    expect(gov.level.kind).toBe("low-power");
    expect(gov.resume(200_001)).toBe(false);
  });

  it("refuses resume() while a power gate holds", () => {
    const gov = new Governor({ displayHz: 60, targetFps: 30 });
    gov.setPower(0, { pressure: "critical" });
    expect(gov.resume(1)).toBe(false);
    expect(gov.resting).toBe(true);
  });

  it("reports every change through onChange", () => {
    const changes: string[] = [];
    const gov = new Governor({
      displayHz: 60,
      targetFps: 30,
      onChange: (level, d) => changes.push(`${d.reason}:${level.kind}:${level.k}`),
    });
    simulate(gov, { startMs: 0, durationMs: 4_100, workMs: 8, costMs: heavyD });
    expect(changes).toEqual(["violations:rung:3"]);
  });

  it("clamps an out-of-range start level", () => {
    expect(new Governor({ displayHz: 60, targetFps: 30, startLevel: 99 }).resting).toBe(true);
    expect(new Governor({ displayHz: 60, targetFps: 30, startLevel: -3 }).levelIndex).toBe(0);
  });
});
