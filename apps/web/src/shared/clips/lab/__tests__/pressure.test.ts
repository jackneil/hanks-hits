// @vitest-environment node
/**
 * The Compute Pressure timeline of the clips harness (scripts/clips/lib/pressure.mjs).
 * The E2E spec prints it next to the file's frame rate over time, so a
 * governor rung step (plan 7) has its cause in the report.
 */
import { describe, expect, it } from "vitest";

import { PRESSURE_STATES, pressureTimeline } from "../../../../../../../scripts/clips/lib/pressure.mjs";

describe("pressureTimeline", () => {
  it("lists each change in order, with seconds from the Start click", () => {
    // Readings arrive out of order, repeat a state, and start before Start.
    const readings = [
      { atMs: 13_100, state: "serious" },
      { atMs: 900, state: "fair" },
      { atMs: 3_000, state: "fair" },
      { atMs: 23_050, state: "serious" },
      { atMs: 17_000, state: "fair" },
    ];
    const timeline = pressureTimeline(readings, 3_000);
    expect(timeline.changes).toEqual([
      { atSec: -2.1, state: "fair" },
      { atSec: 10.1, state: "serious" },
      { atSec: 14, state: "fair" },
      { atSec: 20.1, state: "serious" },
    ]);
    expect(timeline.all).toBe("fair at -2.1 s, serious at +10.1 s, fair at +14.0 s, serious at +20.1 s");
    expect(timeline.worst).toBe("serious");
  });

  it("gives the changes that the governor acts on: serious from below (a step down), and critical (a rest)", () => {
    const timeline = pressureTimeline(
      [
        { atMs: 0, state: "nominal" },
        { atMs: 1_000, state: "fair" },
        { atMs: 2_000, state: "serious" },
        { atMs: 3_000, state: "critical" },
        // Critical back to serious is not a new step (governor.ts setPower).
        { atMs: 4_000, state: "serious" },
        { atMs: 5_000, state: "fair" },
        { atMs: 6_000, state: "serious" },
      ],
      0,
    );
    expect(timeline.steps).toEqual([
      { atSec: 2, state: "serious" },
      { atSec: 3, state: "critical" },
      { atSec: 6, state: "serious" },
    ]);
    expect(timeline.value).toBe("serious at +2.0 s, critical at +3.0 s, serious at +6.0 s");
    expect(timeline.worst).toBe("critical");
  });

  it("counts a first reading of serious as a step (the governor starts at nominal), and reads Start as +0.0 s", () => {
    const timeline = pressureTimeline([{ atMs: 1_960, state: "serious" }], 2_000);
    expect(timeline.steps).toEqual([{ atSec: 0, state: "serious" }]);
    expect(Object.is(timeline.steps[0].atSec, -0)).toBe(false);
    expect(timeline.value).toBe("serious at +0.0 s");
  });

  it("says never serious when the governor had no pressure step, with the highest state", () => {
    // Many nominal/fair flips: noise for the governor.
    const readings = [0, 1, 2, 3, 4, 5].map((i) => ({ atMs: i * 1_000, state: i % 2 ? "fair" : "nominal" }));
    const timeline = pressureTimeline(readings, 0);
    expect(timeline.steps).toEqual([]);
    expect(timeline.value).toBe("never serious (highest fair)");
    expect(timeline.all).toBe("nominal at +0.0 s, fair at +1.0 s, nominal at +2.0 s, fair at +3.0 s, nominal at +4.0 s, fair at +5.0 s");
  });

  it("says so when there is no reading, and ignores readings it cannot use", () => {
    expect(pressureTimeline([], 0)).toEqual({ value: "no reading", all: "no reading", changes: [], steps: [], worst: null });
    const odd = pressureTimeline(
      [
        { atMs: Number.NaN, state: "serious" },
        { atMs: 100, state: "hot" },
        { atMs: 200, state: "nominal" },
      ],
      0,
    );
    expect(odd).toEqual({
      value: "never serious (highest nominal)",
      all: "nominal at +0.2 s",
      changes: [{ atSec: 0.2, state: "nominal" }],
      steps: [],
      worst: "nominal",
    });
  });

  it("knows the four Compute Pressure states, lowest first", () => {
    expect(PRESSURE_STATES).toEqual(["nominal", "fair", "serious", "critical"]);
  });
});
