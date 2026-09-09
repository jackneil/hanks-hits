import { describe, it, expect } from "vitest";
import { createAdventureProgress } from "../lib/adventureTypes";
import {
  advanceTrailer,
  mergeActivitiesSnapshot,
  hitchPosition,
  loadOrUnload,
  mowSwath,
  regrowGrass,
  scrapeSnow,
  surfaceFactorAt,
  toggleHitch,
  trailerLength,
  MUD_PATCHES,
  cutGrassCount,
  isGrassCut,
} from "../lib/activities";
import type { FleetVehicle } from "../lib/adventureTypes";
const vehicle = (
  id: string,
  type: string,
  x = 0,
  z = 0,
  capacity = 0,
): FleetVehicle => ({
  id,
  type,
  position: { x, y: 0, z },
  heading: 0,
  paint: "#fff",
  speedUpgrade: 0,
  mud: 0,
  cargo: [],
  hitch: null,
  parked: true,
  purchasePrice: 5000,
  capacity,
  cornLoad: 0,
});
function setup() {
  const a = createAdventureProgress();
  a.fleet = {
    car: vehicle("car", "truck"),
    trailer: vehicle("trailer", "trailer", 0, -9, 4),
  };
  a.activeVehicleId = "car";
  return a;
}
describe("equipment preserves ownership and physical trailer constraints", () => {
  it("hitches by either end of a mega trailer and preserves exact hitch length through a turn", () => {
    const a = setup();
    a.fleet.trailer = vehicle("trailer", "megatrailer", 0, -20, 12);
    const hitched = toggleHitch(a, "car");
    expect(hitched.adventure.fleet.car.hitch).toBe("trailer");
    const car = { ...hitched.adventure.fleet.car, heading: Math.PI / 2 };
    const next = advanceTrailer(car, hitched.adventure.fleet.trailer, 0.1),
      ball = hitchPosition(car);
    expect(
      Math.hypot(next.position.x - ball.x, next.position.z - ball.z),
    ).toBeCloseTo(trailerLength(next) / 2 + 0.35);
    expect(Number.isFinite(next.heading)).toBe(true);
  });
  it("detaches without deleting cargo or the trailer", () => {
    const a = setup();
    a.fleet.car.hitch = "trailer";
    a.fleet.trailer.cargo = ["boat"];
    const next = toggleHitch(a, "car").adventure;
    expect(next.fleet.car.hitch).toBeNull();
    expect(next.fleet.trailer.cargo).toEqual(["boat"]);
  });
  it("rejects wrong trailer kinds, full trailers and towing a trailer while loading", () => {
    const a = setup();
    a.fleet.trailer.position.z = -3;
    a.fleet.trailer.type = "boattrailer";
    expect(loadOrUnload(a, { x: 0, y: 0, z: 0 }, "car").adventure).toBe(a);
    a.fleet.trailer.type = "trailer";
    a.fleet.trailer.capacity = 1;
    a.fleet.trailer.cargo = ["other"];
    expect(loadOrUnload(a, { x: 0, y: 0, z: 0 }, "car").message).toContain(
      "full",
    );
    a.fleet.trailer.cargo = [];
    a.fleet.car.hitch = "trailer";
    expect(loadOrUnload(a, { x: 0, y: 0, z: 0 }, "car").message).toContain(
      "Detach",
    );
  });
  it("loads one vehicle, exits, then unloads last cargo alongside without losing ownership", () => {
    const a = setup();
    a.fleet.trailer.position.z = -3;
    const loaded = loadOrUnload(a, { x: 0, y: 0, z: 0 }, "car");
    expect(loaded.exitVehicle).toBe(true);
    expect(loaded.adventure.activeVehicleId).toBeNull();
    expect(loaded.adventure.fleet.trailer.cargo).toEqual(["car"]);
    const next = loadOrUnload(
      loaded.adventure,
      { x: 0, y: 0, z: 0 },
      null,
    ).adventure;
    expect(next.fleet.trailer.cargo).toEqual([]);
    expect(next.fleet.car.position.x).toBeCloseTo(5.12);
    expect(Object.keys(next.fleet)).toHaveLength(2);
  });
  it("never steals a trailer already attached to another car", () => {
    const a = setup();
    a.fleet.trailer.position.z = -3;
    a.fleet.other = vehicle("other", "truck");
    a.fleet.other.hitch = "trailer";
    expect(toggleHitch(a, "car").adventure).toBe(a);
  });
});
describe("land work persists meaningful world changes", () => {
  it("cuts a swath outside the lake and regrows cells at exactly four game days", () => {
    const mower = vehicle("m", "mower", 500, 0);
    const cut = mowSwath({}, mower, 12);
    expect(cutGrassCount(cut)).toBeGreaterThan(1);
    expect(isGrassCut(cut, 500, 0)).toBe(true);
    expect(regrowGrass(cut, 95.99)).toEqual(cut);
    expect(regrowGrass(cut, 96)).toEqual({});
    expect(cutGrassCount(mowSwath({}, vehicle("m", "mower", 0, 0), 0))).toBe(0);
  });
  it("delayed equipment saves preserve concurrent air impacts and scored goals", () => {
    const a = setup().activities;
    const pending = { ...a, plowLoad: 3, brokenProps: ["old"] };
    const latest = { ...a, goals: 4, brokenProps: ["old", "air-impact"] };
    expect(mergeActivitiesSnapshot(latest, pending)).toMatchObject({
      plowLoad: 3,
      goals: 4,
      brokenProps: ["old", "air-impact"],
    });
  });
  it("compact grass masks preserve high bits and negative world coordinates through JSON saves", () => {
    let cells: Record<string, number> = {};
    for (const [x, z] of [
      [581.2, 397.9],
      [-600, -500],
      [501, 502],
    ])
      cells = mowSwath(cells, vehicle("m", "mower", x, z), 13);
    const restored = JSON.parse(JSON.stringify(cells));
    for (const [x, z] of [
      [581.2, 397.9],
      [-600, -500],
      [501, 502],
    ])
      expect(isGrassCut(restored, x, z)).toBe(true);
    expect(cutGrassCount(restored)).toBe(cutGrassCount(cells));
    expect(Object.keys(cells).length).toBeLessThan(cutGrassCount(cells));
  });
  it("plow load caps at five and stops the attached active vehicle until raised", () => {
    const a = setup();
    a.activities.plowVehicleId = "car";
    a.activities.plowDown = true;
    a.activities = scrapeSnow(a.activities, { x: 500, y: 0, z: 500 }, 0, 10, 1);
    expect(a.activities.plowLoad).toBe(5);
    expect(surfaceFactorAt(500, 500, a)).toBe(0);
    a.activities.plowDown = false;
    expect(surfaceFactorAt(500, 500, a)).toBeGreaterThan(0);
  });
  it("caps physical snow piles and applies drag only to the correct active plow vehicle", () => {
    const a = setup();
    a.activities.snowPiles = Array.from({ length: 150 }, (_, i) => ({
      x: i * 10,
      z: 0,
      size: 1,
    }));
    a.activities = scrapeSnow(
      a.activities,
      { x: -500, y: 0, z: -500 },
      0,
      1,
      1,
    );
    expect(a.activities.snowPiles).toHaveLength(150);
    a.activities.plowVehicleId = "other";
    a.activities.plowDown = true;
    a.activities.plowLoad = 5;
    expect(surfaceFactorAt(500, 500, a)).toBeGreaterThan(0);
  });
  it("mud slows driving at its actual visible patch center", () => {
    const a = setup(),
      m = MUD_PATCHES[0];
    expect(surfaceFactorAt(m.x, m.z, a)).toBe(0.55);
  });
});
