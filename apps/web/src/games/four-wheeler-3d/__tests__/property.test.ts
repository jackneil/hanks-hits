import { describe, expect, it } from "vitest";
import {
  createAdventureProgress,
  type AdventurePosition,
  type AdventureProgress,
} from "../lib/adventureTypes";
import { LAND_PLOTS } from "../lib/landmarks";
import {
  buildingDimensions,
  canBoardPropertyVehicle,
  canEnterProperty,
  canManageProperty,
  nearbyPropertyInteraction,
  parkPropertyVehicle,
  propertyCommerce,
  propertyDoor,
  propertyElevation,
  propertyGarageForVehicle,
  propertySize,
  propertySlot,
  removePropertyParking,
  retrievePropertyVehicle,
  togglePropertyDoor,
} from "../lib/property";

const id = "plot-1";
function garage(slot: 0 | 1 = 0) {
  const a = createAdventureProgress();
  a.plots[id].owned = true;
  a.plots[id].buildings = [
    { slot, type: "garage", doorOpen: true, parkedVehicleIds: [] },
  ];
  return a;
}
function atDoor(a: AdventureProgress, slot = 0): AdventurePosition {
  return { ...propertyDoor(a, id, slot)!, y: propertyElevation(a, id, slot) };
}
function parked(a = garage(), slot = 0) {
  const result = parkPropertyVehicle(
    a,
    id,
    slot,
    atDoor(a, slot),
    "vehicle",
    0,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result;
}

describe("purchased land and buildings", () => {
  it("has all six source plots with all five physical size levels", () => {
    const a = createAdventureProgress();
    expect(Object.keys(a.plots)).toHaveLength(6);
    for (const plot of LAND_PLOTS)
      for (const [level, scale] of [1, 1.35, 1.8, 2.3, 2.8].entries()) {
        a.plots[plot.id].sizeLevel = level;
        expect(propertySize(a, plot.id)).toBeCloseTo(89 * scale);
        expect(propertySlot(a, plot.id, 1)?.x).toBeCloseTo(
          plot.x + 89 * scale * 0.55,
        );
      }
  });
  it("preserves one, two and three bedroom house classes", () => {
    expect(buildingDimensions("house-small").rooms).toBe(1);
    expect(buildingDimensions("house-medium").rooms).toBe(2);
    expect(buildingDimensions("house-huge").rooms).toBe(3);
    expect(buildingDimensions("house-huge").width).toBeGreaterThan(
      buildingDimensions("house-small").width,
    );
  });
  it("rejects remote commerce, locked second slots and insufficient funds", () => {
    const a = createAdventureProgress(),
      plot = LAND_PLOTS[0],
      p = { money: 6000, totalEarned: 0, ownedVehicles: ["atv"], adventure: a },
      position = { ...plot, y: 0 };
    expect(
      propertyCommerce(p, id, "buy", { x: 0, y: 0, z: 0 }, "foot").ok,
    ).toBe(false);
    expect(propertyCommerce(p, id, "buy", position, "vehicle").ok).toBe(false);
    expect(
      propertyCommerce({ ...p, money: 5999 }, id, "buy", position, "foot").ok,
    ).toBe(false);
    const buy = propertyCommerce(p, id, "buy", position, "foot");
    expect(buy.ok).toBe(true);
    if (!buy.ok) return;
    expect(buy.patch.money).toBe(0);
    expect(buy.patch.adventure.plots[id].owned).toBe(true);
    expect(a.plots[id].owned).toBe(false);
    expect(
      propertyCommerce(
        { ...p, ...buy.patch, money: 3000 },
        id,
        "build",
        position,
        "foot",
        1,
        "garage",
      ).ok,
    ).toBe(false);
  });
  it("keeps upgraded markers and second buildings reachable beyond the starter radius", () => {
    const a = garage(1);
    a.plots[id].sizeLevel = 4;
    a.plots[id].buildings.push({
      slot: 0,
      type: "house-small",
      doorOpen: false,
      parkedVehicleIds: [],
    });
    const door = atDoor(a, 1);
    expect(canManageProperty(a, id, door)).toBe(true);
    expect(nearbyPropertyInteraction(a, door, "foot")?.id).toBe(
      `property:manage:${id}:1`,
    );
  });
  it("gates property entry by ownership, mode, door and actual proximity", () => {
    const a = garage(),
      p = atDoor(a);
    expect(canEnterProperty(a, id, 0, p, "foot")).toBe(true);
    expect(canEnterProperty(a, id, 0, p, "vehicle")).toBe(false);
    expect(canEnterProperty(a, id, 0, { ...p, x: p.x + 20 }, "foot")).toBe(
      false,
    );
    a.plots[id].buildings[0].doorOpen = false;
    expect(canEnterProperty(a, id, 0, p, "foot")).toBe(false);
    a.plots[id].owned = false;
    expect(canEnterProperty(a, id, 0, p, "foot")).toBe(false);
  });
  it("requires foot proximity and a clear doorway to toggle the persisted physical door", () => {
    const a = garage(),
      p = atDoor(a);
    expect(togglePropertyDoor(a, id, 0, p, "vehicle").ok).toBe(false);
    expect(togglePropertyDoor(a, id, 0, p, "foot").ok).toBe(false);
    const close = togglePropertyDoor(a, id, 0, { ...p, x: p.x + 6 }, "foot");
    expect(close.ok).toBe(true);
    if (close.ok) {
      expect(close.adventure.plots[id].buildings[0].doorOpen).toBe(false);
      expect(a.plots[id].buildings[0].doorOpen).toBe(true);
    }
  });
  it("parks atomically with stable membership, paint, upgrades, mud and cargo retained", () => {
    const a = garage(),
      vehicle = a.fleet["starter-atv"];
    vehicle.paint = "#123456";
    vehicle.speedUpgrade = 100;
    vehicle.mud = 0.8;
    vehicle.cargo = ["gear-box"];
    vehicle.hitch = "starter-trailer";
    const result = parked(a);
    expect(result.adventure.activeVehicleId).toBeNull();
    expect(result.adventure.plots[id].buildings[0].parkedVehicleIds).toEqual([
      vehicle.id,
    ]);
    expect(result.adventure.fleet[vehicle.id]).toMatchObject({
      paint: "#123456",
      speedUpgrade: 100,
      mud: 0.8,
      cargo: ["gear-box"],
      hitch: null,
      parked: true,
    });
    expect(a.activeVehicleId).toBe("starter-atv");
    expect(a.plots[id].buildings[0].parkedVehicleIds).toEqual([]);
    expect(result.position?.y).toBeLessThan(100);
    expect(propertyGarageForVehicle(result.adventure, vehicle.id)?.plotId).toBe(
      id,
    );
    expect(
      nearbyPropertyInteraction(
        a,
        { ...propertySlot(a, id, 0)!, y: 0 },
        "vehicle",
      )?.id,
    ).toBe(`property:park:${id}:0`);
  });
  it("rejects fast, remote, closed-door and water vehicle parking", () => {
    const a = garage(),
      p = atDoor(a);
    expect(parkPropertyVehicle(a, id, 0, p, "vehicle", 4).ok).toBe(false);
    expect(
      parkPropertyVehicle(a, id, 0, { x: 0, y: 0, z: 0 }, "vehicle", 0).ok,
    ).toBe(false);
    a.plots[id].buildings[0].doorOpen = false;
    expect(parkPropertyVehicle(a, id, 0, p, "vehicle", 0).ok).toBe(false);
    a.plots[id].buildings[0].doorOpen = true;
    a.fleet["starter-atv"].type = "boat";
    expect(parkPropertyVehicle(a, id, 0, p, "boat", 0).ok).toBe(false);
  });
  it("assigns six distinct bays and reports when the garage is full", () => {
    let a = garage();
    const positions = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const vehicleId = `test-${i}`;
      a.fleet[vehicleId] = { ...a.fleet["starter-atv"], id: vehicleId };
      a.activeVehicleId = vehicleId;
      const result = parked(a);
      a = result.adventure;
      const p = a.fleet[vehicleId].position;
      positions.add(`${p.x}:${p.z}`);
    }
    expect(positions.size).toBe(6);
    a.activeVehicleId = "starter-atv";
    expect(parkPropertyVehicle(a, id, 0, atDoor(a), "vehicle", 0).ok).toBe(
      false,
    );
  });
  it("closed property garages prevent generic boarding until opened", () => {
    const a = parked().adventure;
    a.plots[id].buildings[0].doorOpen = false;
    expect(canBoardPropertyVehicle(a, "starter-atv")).toBe(false);
    a.plots[id].buildings[0].doorOpen = true;
    expect(canBoardPropertyVehicle(a, "starter-atv")).toBe(true);
    expect(
      removePropertyParking(a, "starter-atv").plots[id].buildings[0]
        .parkedVehicleIds,
    ).toEqual([]);
    expect(a.plots[id].buildings[0].parkedVehicleIds).toEqual(["starter-atv"]);
  });
  it("retrieves only the correct garage's stored ride and exits at ground level", () => {
    const a = parked().adventure,
      interior = { x: 0, y: 2000, z: 0 };
    expect(
      retrievePropertyVehicle(
        a,
        id,
        0,
        "starter-atv",
        interior,
        "interior",
        "plot-2:0",
      ).ok,
    ).toBe(false);
    const result = retrievePropertyVehicle(
      a,
      id,
      0,
      "starter-atv",
      interior,
      "interior",
      `${id}:0`,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.position?.y).toBeLessThan(100);
      expect(result.adventure.activeVehicleId).toBe("starter-atv");
      expect(result.adventure.plots[id].buildings[0].parkedVehicleIds).toEqual(
        [],
      );
      expect(result.adventure.fleet["starter-atv"].parked).toBe(false);
    }
  });
  it("moves stored vehicles with an upgraded second-slot garage without losing membership", () => {
    const original = garage(1);
    original.plots[id].buildings.push({
      slot: 0,
      type: "house-small",
      doorOpen: false,
      parkedVehicleIds: [],
    });
    const a = parked(original, 1).adventure,
      before = a.fleet["starter-atv"].position,
      position = { ...LAND_PLOTS[0], y: 0 };
    const result = propertyCommerce(
      { money: 8000, totalEarned: 0, ownedVehicles: ["atv"], adventure: a },
      id,
      "upgrade",
      position,
      "foot",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.patch.money).toBe(0);
      expect(
        result.patch.adventure.fleet["starter-atv"].position.x - before.x,
      ).toBeCloseTo(89 * 0.35 * 0.55);
      expect(
        result.patch.adventure.plots[id].buildings.find((b) => b.slot === 1)
          ?.parkedVehicleIds,
      ).toEqual(["starter-atv"]);
    }
  });
});
