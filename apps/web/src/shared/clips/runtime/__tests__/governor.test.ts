import { describe, expect, it } from "vitest";
import {
  buildLadder,
  CLEAN_WINDOWS_TO_STEP_UP,
  Governor,
  type GovernorLevel,
  MAX_STEP_UPS,
  MIN_BASELINE_INTERVALS,
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
const moderate = () => 9; // over half a vsync, under a whole one
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

  it("steps down after two violating windows, through every level to resting (9 ms captures)", () => {
    const gov = new Governor({ displayHz: 60, targetFps: 30 });
    simulate(gov, { startMs: 0, durationMs: 40_000, workMs: 5, costMs: moderate });
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
    expect(gov.history[0].report?.violations).toContain("capture-p95");
    expect(gov.history[0].report?.violations).not.toContain("capture-over-frame");
  });

  it("a capture that costs a whole frame (path D on WebGL, 25 ms) goes to low-power at once, then rests", () => {
    const gov = new Governor({ displayHz: 60, targetFps: 30 });
    simulate(gov, { startMs: 0, durationMs: 8_000, workMs: 8, costMs: heavyD });
    expect(gov.resting).toBe(true);
    expect(gov.history.map((d) => [d.from, d.to, d.reason])).toEqual([
      [0, 5, "capture-over-frame"],
      [5, 6, "capture-over-frame"],
    ]);
    // About 4 s of lag instead of 12 windows (24 s) through every rung.
    expect(gov.history[1].atMs).toBeLessThanOrEqual(4 * WINDOW_MS);
    expect(gov.history[0].report?.violations).toContain("capture-over-frame");
  });

  it("does not step down on one violating window", () => {
    const gov = new Governor({ displayHz: 60, targetFps: 30 });
    let t = simulate(gov, { startMs: 0, durationMs: 2_000, workMs: 5, costMs: moderate });
    t = simulate(gov, { startMs: t, durationMs: 2_000, workMs: 5, costMs: light });
    t = simulate(gov, { startMs: t, durationMs: 2_000, workMs: 5, costMs: moderate });
    simulate(gov, { startMs: t, durationMs: 2_000, workMs: 5, costMs: light });
    expect(gov.levelIndex).toBe(0);
    expect(gov.windowReports.filter((r) => r.violations.length > 0)).toHaveLength(2);
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
    // 8 ms of game work plus 12 ms of capture: capture frames take two vsyncs (40 fps).
    simulate(gov, { startMs: 0, durationMs: 4_100, workMs: 8, costMs: () => 12 });
    expect(gov.resting).toBe(true);
    expect(gov.history.map((d) => d.reason)).toEqual(["severe"]);
    expect(gov.history[0].report?.violations).toContain("severe-fps-loss");
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
    simulate(gov, { startMs: 0, durationMs: 4_100, workMs: 5, costMs: moderate });
    expect(changes).toEqual(["violations:rung:3"]);
  });

  it("clamps an out-of-range start level", () => {
    expect(new Governor({ displayHz: 60, targetFps: 30, startLevel: 99 }).resting).toBe(true);
    expect(new Governor({ displayHz: 60, targetFps: 30, startLevel: -3 }).levelIndex).toBe(0);
  });
});

describe("Governor: path E and the baseline", () => {
  const v = 1000 / 60;

  /**
   * A path E game. Kick frames (every k-th) add gpuMs of GPU time to their
   * frame, or every frame gets its share (spreadGpu). Main-thread costs are
   * whole milliseconds (0 or 1), as Safari's timer gives them.
   */
  function pathE(
    gov: Governor,
    opts: { startMs: number; durationMs: number; workMs: number; gpuMs: number; spreadGpu?: boolean },
  ): number {
    let t = opts.startMs;
    let n = 0;
    let seed = 3;
    while (t < opts.startMs + opts.durationMs) {
      gov.gameFrame(t);
      const k = gov.level.k;
      const kick = k > 0 && n % k === 0;
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      const cpu = Math.round((seed / 2 ** 31) * 0.9);
      if (k > 0) {
        gov.captureCost(t, cpu, { ticket: kick, path: "E" });
        if (kick) gov.readback(t + v, 1);
      }
      const extra = opts.spreadGpu ? opts.gpuMs : kick ? opts.gpuMs : 0;
      t += Math.max(1, Math.ceil((opts.workMs + extra) / v - 1e-9)) * v;
      n++;
    }
    gov.tick(t);
    return t;
  }

  /** Live play with no capture, marked as baseline frames (the source's warmup). */
  function warmup(gov: Governor, startMs: number, frames: number, periodMs = v): number {
    let t = startMs;
    for (let i = 0; i < frames; i++) {
      gov.gameFrame(t, { baseline: true });
      t += periodMs;
    }
    return t;
  }

  it("learns the baseline from warmup frames, and a gap starts a new run", () => {
    const gov = new Governor({ displayHz: 60, targetFps: 30 });
    expect(gov.baselineFps).toBeNull();
    let t = warmup(gov, 0, MIN_BASELINE_INTERVALS);
    expect(gov.baselineFps).toBeNull();
    t = warmup(gov, t, 40);
    expect(gov.baselineFps).toBeCloseTo(60, 5);
    // After a hidden tab, a new run replaces it.
    warmup(gov, t + 5000, 40, 1000 / 40);
    expect(gov.baselineFps).toBeCloseTo(40, 5);
    gov.setBaseline(55);
    expect(gov.baselineFps).toBe(55);
    gov.setBaseline(Number.NaN);
    expect(gov.baselineFps).toBe(55);
  });

  it("classifies capture frames by ticket, so 0 ms captures (a 1 ms timer) still count", () => {
    // A 30 fps target on 60 Hz: a kick every other frame. 12 ms of game work
    // plus 8 ms of GPU time pushes each kick frame past a vsync, while the
    // main-thread cost reads 0 or 1 ms.
    const gov = new Governor({ displayHz: 60, targetFps: 30 });
    pathE(gov, { startMs: 0, durationMs: 4_100, workMs: 12, gpuMs: 8 });
    const report = gov.windowReports.find((r) => r.judged)!;
    expect(report.captureP95Ms).toBeLessThanOrEqual(1);
    expect(report.captures).toBeGreaterThan(10);
    expect(report.violations).toContain("missed-frames");
    expect(gov.levelIndex).toBe(1);
  });

  it("a severe path E loss with no control group rests after two windows", () => {
    const gov = new Governor({ displayHz: 60, targetFps: 60 });
    // One full window of warmup (not judged), then capture from 2 s.
    const t = warmup(gov, 0, 120);
    expect(t).toBeCloseTo(2000, 6);
    // Readback GPU work on every frame: 10 ms of work plus 10 ms of GPU time
    // takes two vsyncs, a 50% loss against the 60 fps baseline.
    pathE(gov, { startMs: t, durationMs: 4_100, workMs: 10, gpuMs: 10, spreadGpu: true });
    const judged = gov.windowReports.filter((r) => r.judged);
    expect(judged.length).toBeGreaterThanOrEqual(2);
    expect(judged[0].baselineFps).toBeCloseTo(60, 5);
    expect(judged[0].violations).toContain("severe-fps-loss");
    expect(gov.resting).toBe(true);
  });

  it("an 18-20% path E loss with no control group breaks the 10% guarantee", () => {
    const gov = new Governor({ displayHz: 60, targetFps: 60 });
    // Baseline: a steady 50 fps game (every fifth frame takes two vsyncs), for 2 s.
    let t = 0;
    for (let i = 0; t < 2000 - 1e-6; i++) {
      gov.gameFrame(t, { baseline: true });
      t += i % 5 === 4 ? 2 * v : v;
    }
    expect(gov.baselineFps).toBeCloseTo(50, 0);
    // Capture on every frame: every other frame now misses (40 fps, a 20%
    // loss), while the main-thread cost reads 0 or 1 ms.
    const end = t + 4_100;
    for (let i = 0; t < end; i++) {
      gov.gameFrame(t);
      gov.captureCost(t, i % 7 === 0 ? 1 : 0, { ticket: true, path: "E" });
      gov.readback(t, 1);
      t += i % 2 === 1 ? 2 * v : v;
    }
    gov.tick(t);
    const judged = gov.windowReports.filter((r) => r.judged);
    expect(judged[0].gameFps).toBeLessThan(0.9 * gov.baselineFps!);
    expect(judged[0].violations).toEqual(["fps-loss"]);
    expect(judged[0].severe).toBe(false);
    expect(gov.levelIndex).toBe(1);
  });

  it("with a control group, does not blame capture for the game's own slowdown", () => {
    const gov = new Governor({ displayHz: 60, targetFps: 30, baselineFps: 60 });
    // A heavier scene: every frame, captured or not, takes two vsyncs (a 50% drop).
    pathE(gov, { startMs: 0, durationMs: 20_000, workMs: 20, gpuMs: 0 });
    const judged = gov.windowReports.filter((w) => w.judged);
    expect(judged.length).toBeGreaterThan(5);
    for (const r of judged) {
      expect(r.gameFps).toBeLessThan(31);
      expect(r.violations).toEqual([]);
    }
    expect(gov.history).toEqual([]);
  });

  it("flags a GPU that cannot keep up: busy readback slots or a long readback latency", () => {
    const run = (feed: (gov: Governor, t: number, n: number) => void) => {
      const gov = new Governor({ displayHz: 60, targetFps: 30 });
      let n = 0;
      for (let t = 0; t < 4_100; t += v, n++) {
        gov.gameFrame(t);
        if (n % 2 === 0) feed(gov, t, n);
      }
      gov.tick(4_200);
      return gov;
    };
    const busy = run((gov, t, n) => {
      if (n % 6 === 0) gov.readbackBusy(t);
      else gov.captureCost(t, 0, { ticket: true, path: "E" });
    });
    expect(busy.history[0]?.report?.violations).toEqual(["gpu-behind"]);
    const slow = run((gov, t) => {
      gov.captureCost(t, 0, { ticket: true, path: "E" });
      gov.readback(t, 3);
    });
    expect(slow.history[0]?.report?.violations).toEqual(["gpu-behind"]);
    expect(slow.history[0]?.report?.readbackLatency).toBe(3);
    // Two frames of latency is normal (Chromium reports fences a frame late).
    const ok = run((gov, t) => {
      gov.captureCost(t, 0, { ticket: true, path: "E" });
      gov.readback(t, 2);
    });
    expect(ok.history).toEqual([]);
  });

  it("counts late drops (read, then no room) as backpressure", () => {
    const gov = new Governor({ displayHz: 60, targetFps: 30 });
    let offered = 0;
    let late = 0;
    for (let t = 0; t < 4_100; t += v) {
      gov.gameFrame(t);
      offered += 1;
      if (Math.floor(t / 100) % 3 === 0) late += 1;
      gov.pumpStats(t, { offered, dropsBackpressure: 0, dropsLate: late });
    }
    gov.tick(4_200);
    expect(gov.history[0]?.report?.violations).toEqual(["backpressure"]);
  });

  it("does not judge windows with no capture activity (a pause or a warmup)", () => {
    const gov = new Governor({ displayHz: 60, targetFps: 30, startLevel: 2 });
    for (let t = 0; t < 70_000; t += v) gov.gameFrame(t);
    gov.tick(70_100);
    expect(gov.windowReports.every((r) => !r.judged)).toBe(true);
    // No clean evidence either: no step up.
    expect(gov.levelIndex).toBe(2);
  });
});
