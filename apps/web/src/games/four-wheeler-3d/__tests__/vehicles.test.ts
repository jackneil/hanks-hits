import { describe, it, expect } from "vitest";

import { SCALE } from "../lib/constants";
import {
  FOOT_SPEEDS,
  VEHICLE_IDS,
  VEHICLE_TUNING,
  mphFromMs,
  topSpeedMph,
  tuningFor,
} from "../lib/vehicles";

/** Every ground vehicle the 2D game can drive. */
const TWO_D_IDS = [
  "atv", "utv", "truck", "moto", "lambo", "semi",
  "firetruck", "monster", "racecar", "muscle", "tractor", "rv",
];

describe("vehicle tuning", () => {
  it("carries every ground vehicle from the 2D game, plus foot and bikes", () => {
    for (const id of TWO_D_IDS) {
      expect(VEHICLE_TUNING[id as keyof typeof VEHICLE_TUNING]).toBeDefined();
    }
    expect(VEHICLE_TUNING.foot).toBeDefined();
    expect(VEHICLE_TUNING.bike).toBeDefined();
    expect(VEHICLE_IDS.length).toBe(TWO_D_IDS.length + 2);
  });

  it("puts the ATV at the speed the design doc derived", () => {
    // 57.6 units per frame * SCALE.SPEED
    expect(VEHICLE_TUNING.atv.maxSpeed).toBeCloseTo(21.888, 2);
    expect(Math.abs(VEHICLE_TUNING.atv.maxSpeed - 21.888)).toBeLessThan(0.01);
    expect(VEHICLE_TUNING.atv.maxSpeed).toBeCloseTo(57.6 * SCALE.SPEED, 6);
  });

  it("keeps the 2D speed order across the whole roster", () => {
    const order = [
      "racecar", "lambo", "muscle", "moto", "utv", "atv",
      "monster", "truck", "rv", "firetruck", "semi", "tractor",
    ] as const;
    for (let i = 1; i < order.length; i += 1) {
      expect(VEHICLE_TUNING[order[i - 1]].maxSpeed).toBeGreaterThan(
        VEHICLE_TUNING[order[i]].maxSpeed
      );
    }
  });

  it("steers the way the 2D turn column does", () => {
    expect(VEHICLE_TUNING.atv.maxSteer).toBeCloseTo(0.55, 6);
    expect(VEHICLE_TUNING.semi.maxSteer).toBeGreaterThan(0.28);
    expect(VEHICLE_TUNING.semi.maxSteer).toBeLessThan(0.35);
    // A quad turns tighter than an 18-wheeler.
    expect(VEHICLE_TUNING.atv.maxSteer).toBeGreaterThan(
      VEHICLE_TUNING.semi.maxSteer
    );
  });

  it("prices every vehicle the way the 2D dealers do", () => {
    expect(VEHICLE_TUNING.atv.price).toBe(20000);
    expect(VEHICLE_TUNING.utv.price).toBe(20000);
    expect(VEHICLE_TUNING.truck.price).toBe(20000);
    expect(VEHICLE_TUNING.moto.price).toBe(20000);
    expect(VEHICLE_TUNING.semi.price).toBe(20000);
    expect(VEHICLE_TUNING.lambo.price).toBe(50000);
    expect(VEHICLE_TUNING.firetruck.price).toBe(150000);
    expect(VEHICLE_TUNING.monster.price).toBe(40000);
    expect(VEHICLE_TUNING.racecar.price).toBe(80000);
    expect(VEHICLE_TUNING.muscle.price).toBe(45000);
    expect(VEHICLE_TUNING.tractor.price).toBe(25000);
    expect(VEHICLE_TUNING.rv.price).toBe(45000);
  });

  it("gives every vehicle four wheels and a body to hang them on", () => {
    for (const id of VEHICLE_IDS) {
      const tuning = VEHICLE_TUNING[id];
      expect(tuning.wheelPositions).toHaveLength(4);
      expect(tuning.wheelRadius).toBeGreaterThan(0);
      expect(tuning.mass).toBeGreaterThan(0);
      expect(tuning.chassis.length).toBeGreaterThan(0);
      expect(tuning.chassis.width).toBeGreaterThan(0);
      expect(tuning.chassis.height).toBeGreaterThan(0);
      // Front wheels ahead of the back wheels, one on each side.
      expect(tuning.wheelPositions[0][2]).toBeGreaterThan(
        tuning.wheelPositions[2][2]
      );
      expect(tuning.wheelPositions[0][0]).toBeGreaterThan(
        tuning.wheelPositions[1][0]
      );
    }
  });
});

describe("vehicle helpers", () => {
  it("walks and runs at the speeds the design doc fixed, not the 2D one", () => {
    expect(FOOT_SPEEDS.walk).toBe(3);
    expect(FOOT_SPEEDS.run).toBe(5);
    expect(VEHICLE_TUNING.foot.maxSpeed).toBeCloseTo(3, 6);
  });

  it("never lets reverse become a crawl", () => {
    for (const id of VEHICLE_IDS) {
      expect(VEHICLE_TUNING[id].reverseFactor).toBeGreaterThanOrEqual(0.25);
      expect(VEHICLE_TUNING[id].reverseFactor).toBeLessThanOrEqual(1);
    }
  });

  it("settles the suspension instead of bouncing it", () => {
    for (const id of VEHICLE_IDS) {
      const { stiffness, compression, relaxation } =
        VEHICLE_TUNING[id].suspension;
      const critical = 2 * Math.sqrt(stiffness);
      expect(compression).toBeLessThan(critical);
      expect(relaxation).toBeLessThan(critical);
      expect(relaxation).toBeGreaterThan(compression);
    }
  });

  it("turns meters per second into miles per hour", () => {
    expect(mphFromMs(0)).toBe(0);
    expect(mphFromMs(10)).toBeCloseTo(22.37, 2);
    expect(topSpeedMph("atv")).toBeCloseTo(21.888 * 2.237, 1);
  });

  it("falls back to the quad for an id it does not know", () => {
    expect(tuningFor("spaceship").id).toBe("atv");
    expect(tuningFor("racecar").id).toBe("racecar");
  });
});
