import { describe, expect, it } from "vitest";
import {
  advanceRace,
  createRace,
  ITEM_CHECKPOINTS,
  RACE_CHECKPOINTS,
  RACE_LENGTH,
  racePoint,
  trackDistance,
  stepRival,
  type RaceEvents,
} from "../lib/race";

const events = (): RaceEvents => ({ boost: false, finished: false });

describe("race progression", () => {
  it("holds a 3.2 second countdown before starting the rival and timer", () => {
    const run = createRace("atv", 22),
      result = events();
    advanceRace(run, run.lastPosition, 3, result);
    expect(run.session.phase).toBe("countdown");
    expect(run.session.elapsed).toBe(0);
    expect(run.session.rivalProgress).toBe(0);
    advanceRace(run, run.lastPosition, 0.3, result);
    expect(run.session.phase).toBe("racing");
  });
  it("rejects skipped gates and teleporting onto the expected gate", () => {
    const run = createRace("atv", 22),
      result = events();
    run.session.phase = "racing";
    advanceRace(run, RACE_CHECKPOINTS[20], 1 / 60, result);
    expect(run.session.checkpoint).toBe(0);
    expect(run.needsReturn).toBe(true);
    advanceRace(run, RACE_CHECKPOINTS[1], 1 / 60, result);
    advanceRace(run, RACE_CHECKPOINTS[1], 1 / 60, result);
    expect(run.session.checkpoint).toBe(0);
  });
  it("slows off-track driving and records strikes without a reset or time penalty", () => {
    const run = createRace("atv", 22),
      result = events();
    run.session.phase = "racing";
    run.lastPosition = { x: 0, z: 1950 };
    for (let i = 0; i < 80; i++) {
      advanceRace(run, { x: 0, z: 1950 }, 0.1, result);
    }
    expect(run.session.offTrack).toBe(true);
    expect(run.session.speedFactor).toBe(0.55);
    expect(run.session.strikes).toBe(3);
    expect(run.session.elapsed).toBeCloseTo(8);
    expect(run.lastPosition).toEqual({ x: 0, z: 1950 });
  });
  it("completes all gates in order, claims four NOS boxes, and emits one finish", () => {
    const run = createRace("racecar", 40),
      result = events();
    run.session.phase = "racing";
    const point = { x: 0, z: 0, heading: 0 };
    let boosts = 0,
      finishes = 0;
    for (let distance = 0; distance <= RACE_LENGTH + 20; distance += 4) {
      racePoint(distance, point);
      advanceRace(run, point, 0.1, result);
      if (result.boost) boosts++;
      if (result.finished) finishes++;
    }
    expect(run.session.checkpoint).toBe(RACE_CHECKPOINTS.length);
    expect(run.session.winner).toBe("player");
    expect(boosts).toBe(4);
    expect(finishes).toBe(1);
    expect(run.session.nosBoxes.every(Boolean)).toBe(true);
  });
  it("lets the same-type rival win if the player stays on the grid", () => {
    const run = createRace("atv", 22),
      result = events();
    run.session.phase = "racing";
    for (let i = 0; i < 12000; i++) {
      advanceRace(run, run.lastPosition, 0.1, result);
      if (run.session.winner) break;
    }
    expect(run.session.vehicleType).toBe("atv");
    expect(run.session.winner).toBe("rival");
  });
  it("places four boxes on the road at the original lap fractions", () => {
    expect(ITEM_CHECKPOINTS).toHaveLength(4);
    for (const index of ITEM_CHECKPOINTS)
      expect(
        trackDistance(RACE_CHECKPOINTS[index].x, RACE_CHECKPOINTS[index].z),
      ).toBeLessThan(0.5);
    expect(trackDistance(0, 0)).toBeGreaterThan(1000);
  });
});

describe("physical rival pursuit", () => {
  it("turns gradually rather than snapping to a path heading", () => {
    const run = createRace("atv", 22);
    run.rival.heading = -Math.PI / 2;
    run.rivalSpeed = 12;
    const previous = run.rival.heading;
    stepRival(run, 1 / 60, () => false);
    const turn = Math.abs(
      Math.atan2(
        Math.sin(run.rival.heading - previous),
        Math.cos(run.rival.heading - previous),
      ),
    );
    expect(turn).toBeLessThanOrEqual(3 / 60 + 1e-8);
    expect(turn).toBeGreaterThan(0);
  });
  it("loses speed in mud compared with the same pose on dry ground", () => {
    const dry = createRace("atv", 22),
      mud = createRace("atv", 22);
    dry.rivalSpeed = mud.rivalSpeed = 17.6;
    for (let i = 0; i < 60; i++) {
      stepRival(dry, 1 / 60, () => false);
      stepRival(mud, 1 / 60, () => true);
    }
    expect(mud.rivalSpeed).toBeLessThan(dry.rivalSpeed * 0.7);
    expect(mud.session.rivalProgress).toBeLessThan(dry.session.rivalProgress);
  });
  it("slows ahead of a tight corner and completes it within road width", () => {
    const run = createRace("atv", 22),
      p = { x: 0, z: 0, heading: 0 };
    // First corner is approximately one eighth of the full lap away.
    let best = 0,
      bend = 0;
    for (let d = 0; d < RACE_LENGTH / 4; d += 2) {
      const a = { x: 0, z: 0, heading: 0 },
        b = { x: 0, z: 0, heading: 0 };
      racePoint(d, a);
      racePoint(d + 30, b);
      const angle = Math.abs(
        Math.atan2(
          Math.sin(b.heading - a.heading),
          Math.cos(b.heading - a.heading),
        ),
      );
      if (angle > best) {
        best = angle;
        bend = d;
      }
    }
    run.session.rivalProgress = bend;
    racePoint(bend, p);
    run.rival = { ...p };
    run.rivalSpeed = 17.6;
    stepRival(run, 0.1, () => false);
    expect(run.rivalSpeed).toBeLessThan(17.6);
    for (let i = 0; i < 360; i++) stepRival(run, 1 / 60, () => false);
    expect(run.session.rivalProgress).toBeGreaterThan(bend + 30);
    expect(trackDistance(run.rival.x, run.rival.z)).toBeLessThan(8);
  });
});
