import { describe, expect, it } from "vitest";

import { startRun } from "../runBest";

describe("startRun: higher is better", () => {
  it("calls a strictly higher score a new best", () => {
    const run = startRun(100);
    expect(run.best()).toBe(100);
    expect(run.isNewBest(101)).toBe(true);
    expect(run.brokeRecord(101)).toBe(true);
  });

  it("never calls a tie a new best", () => {
    const run = startRun(100);
    expect(run.isNewBest(100)).toBe(false);
    expect(run.brokeRecord(100)).toBe(false);
  });

  it("calls a lower score not a new best", () => {
    expect(startRun(100).isNewBest(99)).toBe(false);
  });

  it("a first-ever score is a new best, but not a broken record", () => {
    const run = startRun(0);
    expect(run.hasBest()).toBe(false);
    expect(run.isNewBest(5)).toBe(true);
    expect(run.brokeRecord(5)).toBe(false);
  });

  it("a first-ever score of zero is not a new best", () => {
    expect(startRun(0).isNewBest(0)).toBe(false);
  });

  it("compares against the snapshot, not a best the game saved mid-run", () => {
    // Breakout and Blitz Bomber raise progress.highScore during the run.
    const progress = { highScore: 100 };
    const run = startRun(progress.highScore);
    progress.highScore = 150; // the game saved a record at level 2
    // The run ends at 150: against the saved value it looks like a tie,
    // but against the snapshot it IS a new best.
    expect(run.isNewBest(150)).toBe(true);
  });

  it("raises the score to beat when a better cloud best arrives mid-run", () => {
    const run = startRun(100);
    run.noteCloudBest(200);
    expect(run.best()).toBe(200);
    expect(run.isNewBest(150)).toBe(false);
    expect(run.isNewBest(200)).toBe(false);
    expect(run.isNewBest(201)).toBe(true);
  });

  it("never lowers the score to beat with an older cloud best", () => {
    const run = startRun(100);
    run.noteCloudBest(50);
    expect(run.best()).toBe(100);
  });

  it("a cloud best turns a first-ever run into a real record to break", () => {
    const run = startRun(0);
    run.noteCloudBest(40);
    expect(run.isNewBest(30)).toBe(false);
    expect(run.brokeRecord(41)).toBe(true);
  });

  it("treats bad saved or synced values as no best", () => {
    for (const bad of [undefined, null, Number.NaN, -5, Number.POSITIVE_INFINITY]) {
      const run = startRun(bad as number);
      expect(run.best()).toBe(0);
      run.noteCloudBest(bad as number);
      expect(run.best()).toBe(0);
    }
  });

  it("never calls a bad score a new best", () => {
    const run = startRun(0);
    expect(run.isNewBest(Number.NaN)).toBe(false);
    expect(run.isNewBest(Number.POSITIVE_INFINITY)).toBe(false);
    expect(run.isNewBest(-3)).toBe(false);
  });

  it("keeps each run separate", () => {
    const first = startRun(10);
    first.noteCloudBest(99);
    const second = startRun(10);
    expect(second.best()).toBe(10);
  });
});

describe("startRun: lower is better (race times)", () => {
  it("calls a strictly faster time a new best, and a tie not", () => {
    const run = startRun(30_000, { lowerIsBetter: true });
    expect(run.isNewBest(29_999)).toBe(true);
    expect(run.isNewBest(30_000)).toBe(false);
    expect(run.isNewBest(30_001)).toBe(false);
  });

  it("a first-ever time is a new best, but not a broken record", () => {
    const run = startRun(0, { lowerIsBetter: true });
    expect(run.isNewBest(45_000)).toBe(true);
    expect(run.brokeRecord(45_000)).toBe(false);
  });

  it("keeps the faster of the snapshot and a cloud best", () => {
    const run = startRun(30_000, { lowerIsBetter: true });
    run.noteCloudBest(40_000);
    expect(run.best()).toBe(30_000);
    run.noteCloudBest(25_000);
    expect(run.best()).toBe(25_000);
    expect(run.brokeRecord(24_000)).toBe(true);
  });

  it("never calls a zero time a new best", () => {
    expect(startRun(0, { lowerIsBetter: true }).isNewBest(0)).toBe(false);
  });
});
