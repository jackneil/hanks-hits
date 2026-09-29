import { describe, expect, it } from "vitest";

import { STANDARD_RATES, rungTable } from "../../runtime/rungs";
import {
  BEAT_MARKS,
  BEAT_MARK_PERIOD,
  INTERVAL_WINDOW,
  LATE_BEAT_LIMIT_SEC,
  LabMetronome,
  MAX_VSYNC_INTERVAL_MS,
  TRUTH_LIMIT,
  beatFrames,
  beatMark,
  type LabTickResult,
} from "../labSchedule";

const running = (time: number) => ({ time, state: "running" as const });

interface Frame {
  rafTs: number;
  time: number;
  result: LabTickResult;
}

/**
 * Ticks the metronome at a steady display rate. The audio clock is the page
 * clock in seconds plus `audioAt0`, as for a context that runs from the start.
 */
function simulate(metronome: LabMetronome, options: { hz: number; seconds: number; audioAt0?: number; t0?: number }): Frame[] {
  const period = 1000 / options.hz;
  const t0 = options.t0 ?? 1000;
  const frames: Frame[] = [];
  const count = Math.round(options.seconds * options.hz);
  for (let i = 0; i < count; i++) {
    const rafTs = t0 + i * period;
    const time = (options.audioAt0 ?? 0) + (rafTs - t0) / 1000;
    frames.push({ rafTs, time, result: metronome.tick({ rafTs, perfNow: rafTs + 2, audio: running(time) }) });
  }
  return frames;
}

describe("LabMetronome", () => {
  it("makes no beat and no flash before start", () => {
    const metronome = new LabMetronome({ targetFps: 60 });
    const frames = simulate(metronome, { hz: 60, seconds: 3 });
    expect(frames.every((f) => !f.result.flash && f.result.beat === null)).toBe(true);
    expect(metronome.beatCount).toBe(0);
    expect(metronome.truth).toEqual([]);
  });

  it("makes no beat while there is no audio clock, and none while the clock is not running", () => {
    const metronome = new LabMetronome({ targetFps: 60 });
    metronome.start();
    expect(metronome.tick({ rafTs: 0, perfNow: 0, audio: null })).toEqual({ flash: false, beat: null });
    for (const state of ["suspended", "interrupted", "closed"] as const) {
      expect(metronome.tick({ rafTs: 16, perfNow: 16, audio: { time: 5, state } })).toEqual({ flash: false, beat: null });
    }
    expect(metronome.tick({ rafTs: 32, perfNow: 32, audio: { time: Number.NaN, state: "running" } })).toEqual({ flash: false, beat: null });
    expect(metronome.beatCount).toBe(0);
  });

  it("plays the first beat at the next whole second of context time, in the frame that reaches it", () => {
    const metronome = new LabMetronome({ targetFps: 60 });
    metronome.start();
    expect(metronome.tick({ rafTs: 0, perfNow: 1, audio: running(0.3) }).beat).toBeNull();
    expect(metronome.tick({ rafTs: 16.7, perfNow: 17, audio: running(0.999) }).beat).toBeNull();
    const due = metronome.tick({ rafTs: 33.3, perfNow: 34, audio: running(1.004) });
    expect(due).toEqual({ flash: true, beat: { index: 0, ctxTime: 1.004, mark: BEAT_MARKS[0] } });
    // Too few intervals for a rate yet: 60 Hz, so the lowest rung (15 fps) is 4 frames.
    expect(metronome.truth).toEqual([{ index: 0, ctxTime: 1.004, rafTs: 33.3, perfNow: 34, holdFrames: 4, mark: BEAT_MARKS[0] }]);
  });

  it("flashes in the same tick that starts the beep, about once per second, at 60 Hz", () => {
    const metronome = new LabMetronome({ targetFps: 60 });
    metronome.start();
    const frames = simulate(metronome, { hz: 60, seconds: 10.2, audioAt0: 0.25 });
    const beats = frames.filter((f) => f.result.beat);
    // Context time runs 0.25 .. 10.43: beats at 1, then each 1 s + 1 frame later (the last at 1 + 9 * 61 / 60 = 10.15).
    expect(beats).toHaveLength(10);
    expect(metronome.beatFrames).toBe(61);
    expect(metronome.beatIntervalSec).toBeCloseTo(61 / 60, 12);
    beats.forEach((f, i) => {
      expect(f.result.flash).toBe(true);
      expect(f.result.beat?.index).toBe(i);
      expect(f.result.beat?.ctxTime).toBe(f.time);
      // The frame that reaches the beat time, never later.
      const due = 1 + i * (61 / 60);
      expect(f.time).toBeGreaterThanOrEqual(due - 1e-9);
      expect(f.time - due).toBeLessThan(1 / 60 + 1e-9);
    });
    // At 60 Hz the rungs are 60, 30, 20 and 15 fps: the flash lasts 4 frames, one run per beat.
    const beatAt = frames.map((f, i) => (f.result.beat ? i : -1)).filter((i) => i >= 0);
    const white = frames.map((f, i) => (f.result.flash ? i : -1)).filter((i) => i >= 0);
    expect(white).toEqual(beatAt.flatMap((i) => [i, i + 1, i + 2, i + 3]));
    expect(metronome.holdFrames).toBe(4);
    expect(metronome.displayHz).toBe(60);
  });

  it("holds the flash for the stride of the lowest rung, so every rung captures it", () => {
    // Plan 6.2 rung tables: the last rung is the one nearest 15 fps.
    for (const [hz, target, hold] of [
      [60, 60, 4], // 60, 30, 20, 15
      [60, 30, 4], // 30, 20, 15
      [120, 60, 8], // 60 .. 15
      [144, 60, 9], // 48 .. 16
      [90, 30, 6], // 30, 22.5, 18, 15
      [165, 60, 11], // 55 .. 15
    ] as const) {
      const metronome = new LabMetronome({ targetFps: target });
      simulate(metronome, { hz, seconds: 0.5 }); // warm up the rate estimate
      metronome.start();
      const frames = simulate(metronome, { hz, seconds: 3, audioAt0: 0.5, t0: 5000 });
      expect(metronome.holdFrames).toBe(hold);
      const first = frames.findIndex((f) => f.result.beat);
      expect(first).toBeGreaterThan(0);
      const flashRun = frames.slice(first, first + hold + 1).map((f) => f.result.flash);
      expect(flashRun).toEqual([...Array(hold).fill(true), false]);
    }
  });

  it("picks the beat spacing nearest the display rate that has no common factor with any rung's stride", () => {
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    // The values that the file comment names (Hz + 1 is not enough at 50, 75, 144 and 165 Hz).
    expect([60, 50, 75, 144, 165].map((hz) => beatFrames(hz, 60))).toEqual([61, 49, 77, 143, 167]);
    for (const hz of STANDARD_RATES) {
      for (const target of [30, 60] as const) {
        const n = beatFrames(hz, target);
        const strides = rungTable(hz, target).map((r) => r.k);
        for (const k of strides) expect(gcd(n, k), `${hz} Hz, target ${target}, stride ${k}`).toBe(1);
        // Nearest first (Hz + 1, Hz - 1, Hz + 2, ...): every spacing that comes before n in that order fails.
        const order = Array.from({ length: Math.abs(n - hz) }, (_, i) => [hz + i + 1, hz - i - 1]).flat();
        for (const m of order.slice(0, order.indexOf(n))) {
          expect(strides.some((k) => gcd(m, k) !== 1), `${m} frames at ${hz} Hz`).toBe(true);
        }
        expect(order).toContain(n);
      }
    }
  });

  /** Places (0 .. k-1) in a k-frame capture slot that `count` beats in a row meet, `spacing` frames apart. */
  function placesMet(spacing: number, k: number, count = k): number {
    return new Set(Array.from({ length: count }, (_, j) => (j * spacing) % k)).size;
  }

  it("proves the sweep check can fail: one frame more than a second misses places at 50, 75, 144 and 165 Hz", () => {
    // The spacing of the first sweep (Hz + 1) against the rung that it missed.
    expect(placesMet(51, 3)).toBe(1); // 50 Hz, the 16.7 fps rung
    expect(placesMet(76, 4)).toBe(1); // 75 Hz, the 18.8 fps rung
    expect(placesMet(145, 5)).toBe(1); // 144 Hz, the 28.8 fps rung
    expect(placesMet(166, 6)).toBe(3); // 165 Hz, the 27.5 fps rung
  });

  it("sweeps the beats over every place of the capture slot, at EVERY rung, at every standard display rate", () => {
    for (const hz of STANDARD_RATES) {
      for (const target of [30, 60] as const) {
        const rungs = rungTable(hz, target);
        const lowest = rungs[rungs.length - 1].k;
        const metronome = new LabMetronome({ targetFps: target });
        simulate(metronome, { hz, seconds: 0.5 }); // warm up the rate estimate
        metronome.start();
        // Half a frame of audio offset: no beat time falls on a frame time, so the frame of each beat is exact.
        const frames = simulate(metronome, { hz, seconds: lowest + 3, audioAt0: 0.5 / hz, t0: 5000 });
        const beatAt = frames.map((f, i) => (f.result.beat ? i : -1)).filter((i) => i >= 0);
        const label = `${hz} Hz, target ${target}`;
        expect(metronome.displayHz, label).toBe(hz);
        expect(beatAt.length, label).toBeGreaterThanOrEqual(lowest);
        for (let i = 1; i < beatAt.length; i++) expect(beatAt[i] - beatAt[i - 1], label).toBe(beatFrames(hz, target));
        // Any k beats in a row meet every place of a k-frame slot, for each rung k.
        for (const { k } of rungs) {
          for (let from = 0; from + k <= beatAt.length; from++) {
            const places = new Set(beatAt.slice(from, from + k).map((i) => i % k));
            expect(places.size, `${label}, stride ${k}, beats ${from}..${from + k - 1}`).toBe(k);
          }
        }
        expect(metronome.holdFrames, label).toBe(lowest);
        expect(metronome.lowestStride, label).toBe(lowest);
      }
    }
  });

  it("gives every beat a mark from a 7-bit maximal-length sequence, so any 7 beats in a row name their place", () => {
    expect(BEAT_MARKS).toHaveLength(BEAT_MARK_PERIOD);
    expect(BEAT_MARK_PERIOD).toBe(127);
    expect(BEAT_MARKS.filter((m) => m === 1)).toHaveLength(64);
    const windows = new Set<number>();
    for (let i = 0; i < BEAT_MARK_PERIOD; i++) {
      let w = 0;
      for (let j = 0; j < 7; j++) w = (w << 1) | BEAT_MARKS[(i + j) % BEAT_MARK_PERIOD];
      windows.add(w);
    }
    // Every 7-bit window but 0000000 appears once in a period: 7 marks name one place.
    expect(windows.size).toBe(127);
    expect(windows.has(0)).toBe(false);
    expect(beatMark(0)).toBe(BEAT_MARKS[0]);
    expect(beatMark(BEAT_MARK_PERIOD + 5)).toBe(BEAT_MARKS[5]);
    expect(beatMark(-1)).toBe(BEAT_MARKS[BEAT_MARK_PERIOD - 1]);
    expect(Object.isFrozen(BEAT_MARKS)).toBe(true);
  });

  it("puts each beat's mark on the beat and in the ground truth", () => {
    const metronome = new LabMetronome({ targetFps: 60 });
    metronome.start();
    const frames = simulate(metronome, { hz: 60, seconds: 12, audioAt0: 0.25 });
    const beats = frames.flatMap((f) => (f.result.beat ? [f.result.beat] : []));
    expect(beats.length).toBeGreaterThanOrEqual(10);
    beats.forEach((beat, i) => expect(beat.mark).toBe(BEAT_MARKS[i]));
    expect(metronome.truth.map((t) => t.mark)).toEqual(beats.map((b) => b.mark));
    // The sequence starts with seven 1 bits, then has 0 bits: both marks are in a 12 s run.
    expect(new Set(beats.map((b) => b.mark))).toEqual(new Set([0, 1]));
  });

  it("uses a fixed hold when one is given", () => {
    const metronome = new LabMetronome({ targetFps: 60, hold: 4 });
    metronome.start();
    const frames = simulate(metronome, { hz: 60, seconds: 2, audioAt0: 0.5 });
    const first = frames.findIndex((f) => f.result.beat);
    expect(frames.slice(first, first + 5).map((f) => f.result.flash)).toEqual([true, true, true, true, false]);
    expect(metronome.truth[0].holdFrames).toBe(4);
  });

  it("skips a beat that is due by more than LATE_BEAT_LIMIT_SEC, so a flash and a beep never come apart", () => {
    const metronome = new LabMetronome({ targetFps: 60 });
    metronome.start();
    metronome.tick({ rafTs: 0, perfNow: 0, audio: running(0.9) });
    // A stalled tab: the next frame comes 0.7 s later, 0.6 s after the beat.
    const late = metronome.tick({ rafTs: 700, perfNow: 700, audio: running(1 + LATE_BEAT_LIMIT_SEC + 0.1) });
    expect(late).toEqual({ flash: false, beat: null });
    expect(metronome.skipped).toBe(1);
    // The next beat is the next whole second.
    expect(metronome.tick({ rafTs: 716, perfNow: 716, audio: running(1.99) }).beat).toBeNull();
    expect(metronome.tick({ rafTs: 733, perfNow: 733, audio: running(2.001) }).beat).toEqual({ index: 0, ctxTime: 2.001, mark: BEAT_MARKS[0] });
  });

  it("plays a beat that is late by less than the limit, at the current time", () => {
    const metronome = new LabMetronome({ targetFps: 60 });
    metronome.start();
    metronome.tick({ rafTs: 0, perfNow: 0, audio: running(0.95) });
    const late = metronome.tick({ rafTs: 400, perfNow: 400, audio: running(1 + LATE_BEAT_LIMIT_SEC - 0.1) });
    expect(late.beat).toEqual({ index: 0, ctxTime: 1 + LATE_BEAT_LIMIT_SEC - 0.1, mark: BEAT_MARKS[0] });
    expect(metronome.skipped).toBe(0);
    // The next beat stays on the beat grid: 61 frames at 60 Hz (beatFrames) after the planned beat, not after the late one.
    expect(metronome.tick({ rafTs: 416, perfNow: 416, audio: running(2.0) }).beat).toBeNull();
    expect(metronome.tick({ rafTs: 433, perfNow: 433, audio: running(2.017) }).beat?.index).toBe(1);
  });

  it("stops the beats at stop(), but lets a flash on screen end at its planned frame", () => {
    const metronome = new LabMetronome({ targetFps: 60, hold: 3 });
    metronome.start();
    metronome.tick({ rafTs: 0, perfNow: 0, audio: running(0.99) });
    expect(metronome.tick({ rafTs: 16, perfNow: 16, audio: running(1.0) }).flash).toBe(true);
    metronome.stop();
    expect(metronome.running).toBe(false);
    expect(metronome.tick({ rafTs: 33, perfNow: 33, audio: running(1.02) }).flash).toBe(true);
    expect(metronome.tick({ rafTs: 50, perfNow: 50, audio: running(1.03) }).flash).toBe(true);
    expect(metronome.tick({ rafTs: 66, perfNow: 66, audio: running(1.05) }).flash).toBe(false);
    expect(metronome.tick({ rafTs: 83, perfNow: 83, audio: running(2.5) })).toEqual({ flash: false, beat: null });
    expect(metronome.beatCount).toBe(1);
  });

  it("starts again at the next whole second after a restart or a suspended clock, and keeps counting beats", () => {
    const metronome = new LabMetronome({ targetFps: 60 });
    metronome.start();
    metronome.tick({ rafTs: 0, perfNow: 0, audio: running(0.9) });
    expect(metronome.tick({ rafTs: 16, perfNow: 16, audio: running(1.0) }).beat?.index).toBe(0);
    metronome.tick({ rafTs: 33, perfNow: 33, audio: { time: 1.4, state: "suspended" } });
    // Running again at 3.7: the next beat is at 4, not at the old 2.
    expect(metronome.tick({ rafTs: 50, perfNow: 50, audio: running(3.7) }).beat).toBeNull();
    expect(metronome.tick({ rafTs: 66, perfNow: 66, audio: running(4.0) }).beat?.index).toBe(1);
    metronome.stop();
    metronome.start();
    expect(metronome.tick({ rafTs: 83, perfNow: 83, audio: running(4.5) }).beat).toBeNull();
    expect(metronome.tick({ rafTs: 100, perfNow: 100, audio: running(5.0) }).beat?.index).toBe(2);
    expect(metronome.beatCount).toBe(3);
  });

  it("keeps at most TRUTH_LIMIT beats of ground truth, oldest first out", () => {
    const metronome = new LabMetronome({ targetFps: 60 });
    metronome.start();
    // The first tick puts the first beat at 1 s; each next tick is on the next beat.
    metronome.tick({ rafTs: 0, perfNow: 0, audio: running(0.5) });
    const interval = metronome.beatIntervalSec;
    for (let i = 0; i <= TRUTH_LIMIT + 5; i++) {
      metronome.tick({ rafTs: (i + 1) * 1000, perfNow: (i + 1) * 1000, audio: running(1 + i * interval + 0.001) });
    }
    expect(metronome.beatCount).toBe(TRUTH_LIMIT + 6);
    expect(metronome.truth).toHaveLength(TRUTH_LIMIT);
    expect(metronome.truth[0].index).toBe(metronome.beatCount - TRUTH_LIMIT);
    expect(metronome.truth[TRUTH_LIMIT - 1].index).toBe(metronome.beatCount - 1);
  });

  it("estimates the display rate from vsync intervals and ignores stalls", () => {
    const metronome = new LabMetronome({ targetFps: 60 });
    expect(metronome.displayHz).toBe(60); // no samples yet
    let t = 0;
    for (let i = 0; i < 40; i++) {
      metronome.tick({ rafTs: t, perfNow: t, audio: null });
      t += i % 10 === 9 ? MAX_VSYNC_INTERVAL_MS + 50 : 1000 / 120;
    }
    expect(metronome.displayHz).toBe(120);
  });

  it("keeps only the newest INTERVAL_WINDOW intervals, so the rate follows a new display", () => {
    const metronome = new LabMetronome({ targetFps: 60 });
    let t = 0;
    for (let i = 0; i < INTERVAL_WINDOW; i++) {
      metronome.tick({ rafTs: t, perfNow: t, audio: null });
      t += 1000 / 120;
    }
    expect(metronome.displayHz).toBe(120);
    for (let i = 0; i < INTERVAL_WINDOW + 1; i++) {
      metronome.tick({ rafTs: t, perfNow: t, audio: null });
      t += 1000 / 60;
    }
    expect(metronome.displayHz).toBe(60);
  });
});
