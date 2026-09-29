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
    expect(timeline.value).toBe("fair at -2.1 s, serious at +10.1 s, fair at +14.0 s, serious at +20.1 s");
    expect(timeline.worst).toBe("serious");
  });

  it("names the highest state seen, and reads the time of Start as +0.0 s", () => {
    const timeline = pressureTimeline(
      [
        { atMs: 1_000, state: "nominal" },
        { atMs: 1_960, state: "critical" },
        { atMs: 5_000, state: "nominal" },
      ],
      2_000,
    );
    expect(timeline.value).toBe("nominal at -1.0 s, critical at +0.0 s, nominal at +3.0 s");
    expect(timeline.worst).toBe("critical");
  });

  it("says so when there is no reading, and ignores readings it can not use", () => {
    expect(pressureTimeline([], 0)).toEqual({ value: "no reading", changes: [], worst: null });
    const odd = pressureTimeline(
      [
        { atMs: Number.NaN, state: "serious" },
        { atMs: 100, state: "hot" },
        { atMs: 200, state: "nominal" },
      ],
      0,
    );
    expect(odd).toEqual({ value: "nominal at +0.2 s", changes: [{ atSec: 0.2, state: "nominal" }], worst: "nominal" });
  });

  it("knows the four Compute Pressure states, lowest first", () => {
    expect(PRESSURE_STATES).toEqual(["nominal", "fair", "serious", "critical"]);
  });
});
