import { describe, expect, it } from "vitest";

import { RungTimeline, rowFps } from "../rungTimeline";

const S = 1_000_000;

describe("RungTimeline", () => {
  it("one rung: every span gives that rung", () => {
    const t = new RungTimeline(30);
    expect(t.weighted(0, 10 * S)).toBe(30);
    expect(t.weighted(-5 * S, 5 * S)).toBe(30);
    expect(t.at(123)).toBe(30);
  });

  it("weights each rung by the media time it covers inside the span", () => {
    const t = new RungTimeline(60);
    t.note(10 * S, 30);
    t.note(20 * S, 15);
    // 10 s at 60, 10 s at 30, 10 s at 15.
    expect(t.weighted(0, 30 * S)).toBeCloseTo(35, 10);
    // 5 s at 60 then 5 s at 30.
    expect(t.weighted(5 * S, 15 * S)).toBeCloseTo(45, 10);
    // Inside one rung.
    expect(t.weighted(21 * S, 29 * S)).toBe(15);
    // After the last note, the last rung goes on.
    expect(t.weighted(25 * S, 40 * S)).toBe(15);
  });

  it("the lab's case: a Record that stepped from 60 to 30 fps early reads about 31 fps, not 60", () => {
    const t = new RungTimeline(60);
    t.note(0.5 * S, 30);
    expect(t.weighted(0, 20 * S)).toBeCloseTo(30.75, 10);
    expect(rowFps(t.weighted(0, 20 * S))).toBe(30.8);
  });

  it("a note at a time that has a step replaces it; notes out of order still sort", () => {
    const t = new RungTimeline(60);
    t.note(10 * S, 0);
    t.note(10 * S, 30);
    expect(t.size).toBe(2);
    expect(t.at(10 * S)).toBe(30);
    t.note(5 * S, 20);
    expect(t.at(7 * S)).toBe(20);
    expect(t.at(12 * S)).toBe(30);
    expect(t.weighted(0, 20 * S)).toBeCloseTo((5 * 60 + 5 * 20 + 10 * 30) / 20, 10);
  });

  it("a 0 rung (capture rests) counts as no frames", () => {
    const t = new RungTimeline(30);
    t.note(4 * S, 0);
    t.note(6 * S, 30);
    expect(t.weighted(0, 10 * S)).toBeCloseTo(24, 10);
  });

  it("ignores notes that are not numbers, and an empty span gives the rung at its start", () => {
    const t = new RungTimeline(30);
    t.note(Number.NaN, 15);
    t.note(3 * S, Number.POSITIVE_INFINITY);
    t.note(3 * S, -1);
    expect(t.size).toBe(1);
    t.note(3 * S, 15);
    expect(t.weighted(5 * S, 5 * S)).toBe(15);
    expect(t.weighted(1 * S, 1 * S)).toBe(30);
    expect(t.weighted(Number.NaN, 1)).toBe(30);
  });

  it("forgetBefore keeps the rung that covers the cut, and the weights stay the same after it", () => {
    const t = new RungTimeline(60);
    t.note(10 * S, 30);
    t.note(20 * S, 15);
    const before = t.weighted(12 * S, 25 * S);
    t.forgetBefore(12 * S);
    expect(t.size).toBe(2);
    expect(t.weighted(12 * S, 25 * S)).toBeCloseTo(before, 10);
    // A span that reaches before the oldest kept step uses that step's rung.
    expect(t.weighted(8 * S, 12 * S)).toBe(30);
  });

  it("rowFps keeps one decimal and gives 0 for no rung", () => {
    expect(rowFps(30)).toBe(30);
    expect(rowFps(40.14)).toBe(40.1);
    expect(rowFps(0)).toBe(0);
    expect(rowFps(Number.NaN)).toBe(0);
  });
});
