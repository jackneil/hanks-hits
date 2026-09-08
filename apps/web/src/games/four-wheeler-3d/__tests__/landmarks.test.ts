import { describe, it, expect } from "vitest";

import {
  CABINS,
  HALF_WORLD,
  LAKE,
  LANDMARKS,
  LAND_PLOTS,
  LAND_RADIUS,
  RACE_START,
  TRAIN_STATIONS,
  TREESTANDS,
  hubBounds,
  hubEdgeToward,
  insideHub,
  raceLoopPoints,
  trainLoopPoints,
  trainSpurPoints,
} from "../lib/landmarks";

function inWorld(point: { x: number; z: number }): boolean {
  return Math.abs(point.x) <= HALF_WORLD && Math.abs(point.z) <= HALF_WORLD;
}

describe("four-wheeler-3d landmarks", () => {
  it("keeps every landmark inside the world", () => {
    const everything = [
      ...Object.values(LANDMARKS),
      ...TREESTANDS,
      ...LAND_PLOTS,
      ...CABINS,
      ...TRAIN_STATIONS,
      RACE_START,
    ];
    const outside = everything.filter((point) => !inWorld(point));
    expect(outside).toEqual([]);
  });

  it("puts the six plots on a ring 889 m from the lake", () => {
    expect(LAND_PLOTS).toHaveLength(6);
    for (const plot of LAND_PLOTS) {
      const radius = Math.hypot(plot.x - LAKE.x, plot.z - LAKE.z);
      expect(Math.abs(radius - LAND_RADIUS)).toBeLessThanOrEqual(1);
    }
    const ids = new Set(LAND_PLOTS.map((plot) => plot.id));
    expect(ids.size).toBe(6);
  });

  it("keeps the race loop inside the world edge", () => {
    const points = raceLoopPoints(400);
    expect(points).toHaveLength(400);
    for (const point of points) {
      expect(Math.abs(point.x)).toBeLessThanOrEqual(1980);
      expect(Math.abs(point.z)).toBeLessThanOrEqual(1980);
    }
    expect(points[0].x).toBeCloseTo(RACE_START.x, 6);
    expect(points[0].z).toBeCloseTo(RACE_START.z, 6);
  });

  it("never runs the race loop within 12 m of the train loop", () => {
    const race = raceLoopPoints(400);
    const train = trainLoopPoints(1200);
    let closest = Infinity;
    for (const r of race) {
      for (const t of train) {
        closest = Math.min(closest, Math.hypot(r.x - t.x, r.z - t.z));
      }
    }
    expect(closest).toBeGreaterThan(12);
  });

  it("runs the train spur from the west station in to the hub", () => {
    const spur = trainSpurPoints(320);
    expect(spur).toHaveLength(321);
    expect(spur[0].x).toBeCloseTo(TRAIN_STATIONS[3].x, 6);
    expect(insideHub(spur[spur.length - 1].x, spur[spur.length - 1].z)).toBe(true);
  });

  it("spreads the cabins away from the lake and from each other", () => {
    expect(CABINS).toHaveLength(8);
    for (const cabin of CABINS) {
      expect(Math.hypot(cabin.x, cabin.z) - LAKE.r).toBeGreaterThan(300);
      expect(insideHub(cabin.x, cabin.z)).toBe(false);
    }
    for (let i = 0; i < CABINS.length; i++) {
      for (let j = i + 1; j < CABINS.length; j++) {
        const gap = Math.hypot(
          CABINS[i].x - CABINS[j].x,
          CABINS[i].z - CABINS[j].z
        );
        expect(gap).toBeGreaterThan(300);
      }
    }
  });

  it("clamps a road start onto the hub edge", () => {
    const edge = hubEdgeToward({ x: 900, z: 900 });
    expect(edge.x).toBe(hubBounds.maxX);
    expect(edge.z).toBe(hubBounds.maxZ);
    expect(insideHub(LANDMARKS.garage.x, LANDMARKS.garage.z)).toBe(true);
  });
});
