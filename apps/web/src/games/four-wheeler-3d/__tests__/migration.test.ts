import { beforeEach, describe, expect, it } from "vitest";
import { createAdventureProgress } from "../lib/adventureTypes";
import {
  adventureSchema,
  MAX_FLEET_VEHICLES,
  MAX_SPEED_UPGRADE,
} from "../lib/adventureSchema";
import {
  migrateAdventure,
  migrateProgress,
  savedRider,
} from "../lib/migration";
import {
  advanceDelivery,
  buyOffer,
  customizeVehicle,
  orderDelivery,
} from "../lib/economy";
import { useAdventureSession } from "../lib/adventureSession";
import { defaultProgress, useFourWheeler3dStore } from "../lib/store";

const fresh = () => ({
  ...defaultProgress,
  adventure: createAdventureProgress(),
  money: 2_000_000,
});
const at = { x: -400, y: 2, z: 14 };
function fleetAt(count: number) {
  const p = fresh(),
    template = p.adventure.fleet["starter-atv"];
  p.adventure.fleet = Object.fromEntries(
    Array.from({ length: count }, (_, i) => {
      const id = i === 0 ? "starter-atv" : `saved-${i}`;
      return [id, { ...template, id, cargo: [], position: { ...at } }];
    }),
  );
  return p;
}

describe("legacy ownership and startup", () => {
  beforeEach(() =>
    useFourWheeler3dStore.setState({
      hasStarted: false,
      mode: "vehicle",
      progress: fresh(),
    }),
  );
  it("translates bought rides, selected paint and both land slots without changing cash or time", () => {
    const legacy = {
      ...defaultProgress,
      adventure: undefined,
      money: 123456,
      day: 19,
      timeOfDay: 17.5,
      currentVehicle: "semi",
      ownedVehicles: ["atv", "semi", "jet"],
      paint: "#123456",
      land: { "plot-2": { size: 3, slots: ["garage", "house_huge"] } },
    };
    const next = migrateProgress(legacy);
    expect(next.money).toBe(123456);
    expect(next.day).toBe(19);
    expect(next.timeOfDay).toBe(17.5);
    expect(next.adventure.fleet[next.adventure.activeVehicleId!]).toMatchObject(
      { type: "semi", paint: "#123456" },
    );
    expect(
      Object.values(next.adventure.fleet).some((v) => v.type === "jet"),
    ).toBe(true);
    expect(next.adventure.aircraftOwned).toBe(true);
    expect(next.adventure.plots["plot-2"]).toMatchObject({
      owned: true,
      sizeLevel: 3,
      buildings: [
        { slot: 0, type: "garage" },
        { slot: 1, type: "house-huge" },
      ],
    });
    expect(adventureSchema.safeParse(next.adventure).success).toBe(true);
  });
  it.each([
    ["starter-boat", "boat"],
    ["starter-plane", "aircraft"],
    ["starter-atv", "vehicle"],
  ] as const)("hydrates %s with its matching controller", (id, mode) => {
    const p = fresh();
    p.adventure.activeVehicleId = id;
    p.timeOfDay = 16;
    useFourWheeler3dStore.getState().setProgress(p);
    expect(useFourWheeler3dStore.getState().mode).toBe(mode);
    expect(useFourWheeler3dStore.getState().clock).toBe(16);
    expect(savedRider(p.adventure).position).toEqual(
      p.adventure.fleet[id].position,
    );
  });
  it("restores saved foot position even while a parked active boat exists", () => {
    const p = fresh();
    p.adventure.activeVehicleId = "starter-boat";
    p.adventure.rider = {
      mode: "foot",
      position: { x: 550, y: 4, z: 700 },
      heading: 1.2,
    };
    useFourWheeler3dStore.getState().setProgress(p);
    expect(useFourWheeler3dStore.getState().mode).toBe("foot");
    expect(savedRider(p.adventure)).toEqual(p.adventure.rider);
    expect(useAdventureSession.getState().relocation).toMatchObject({
      position: p.adventure.rider.position,
      heading: 1.2,
    });
  });
  it("starts on foot when the active vehicle was sold", () => {
    const p = fresh();
    p.adventure.activeVehicleId = null;
    useFourWheeler3dStore.getState().setProgress(p);
    expect(useFourWheeler3dStore.getState().mode).toBe("foot");
  });
  it("uses the same mode and legacy migration during localStorage hydration", async () => {
    const legacy = {
      ...defaultProgress,
      adventure: undefined,
      currentVehicle: "jet",
      ownedVehicles: ["jet"],
      paint: "#abcdef",
      day: 7,
      timeOfDay: 21,
    };
    localStorage.setItem(
      "four-wheeler-3d-game-state",
      JSON.stringify({ state: { progress: legacy }, version: 0 }),
    );
    await useFourWheeler3dStore.persist.rehydrate();
    const state = useFourWheeler3dStore.getState();
    expect(state.mode).toBe("aircraft");
    expect(state.clock).toBe(21);
    expect(state.progress.day).toBe(7);
    expect(
      state.progress.adventure.fleet[state.progress.adventure.activeVehicleId!]
        .paint,
    ).toBe("#abcdef");
  });
});

describe("bounded purchases preserve saved ownership", () => {
  it("salvages other rides and removes broken references when one entry is invalid", () => {
    const a = createAdventureProgress();
    a.fleet["starter-atv"].speedUpgrade = 1010;
    a.fleet["starter-truck-1"].paint = "#123456";
    a.fleet["starter-trailer"].cargo = ["starter-atv"];
    const next = migrateAdventure(a);
    expect(next.fleet["starter-atv"]).toBeUndefined();
    expect(next.fleet["starter-truck-1"].paint).toBe("#123456");
    expect(next.fleet["starter-trailer"].cargo).toEqual([]);
    expect(next.activeVehicleId).toBeNull();
    expect(adventureSchema.safeParse(next).success).toBe(true);
  });
  it("accepts the final valid speed purchase, rejects the next, and round-trips all rides", () => {
    const p = fresh();
    p.adventure.fleet["starter-atv"].speedUpgrade = MAX_SPEED_UPGRADE - 10;
    const result = customizeVehicle(p, "starter-atv", { speedDelta: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patch.money).toBe(p.money - 10);
    const rejected = customizeVehicle(result.patch, "starter-atv", {
      speedDelta: 10,
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.message).toContain("limit");
    expect(migrateAdventure(result.patch.adventure).fleet).toEqual(
      result.patch.adventure.fleet,
    );
  });
  it("reserves fleet slots for a paid delivery before another direct purchase", () => {
    const p = fleetAt(MAX_FLEET_VEHICLES - 1);
    const order = orderDelivery(p, "anyStore:truck");
    expect(order.ok).toBe(true);
    if (!order.ok) return;
    expect(buyOffer(order.patch, "dealership:truck", at).ok).toBe(false);
    const arrived = advanceDelivery(order.patch, 38, at);
    expect(arrived.ok).toBe(true);
    if (!arrived.ok) return;
    expect(Object.keys(arrived.patch.adventure.fleet)).toHaveLength(
      MAX_FLEET_VEHICLES,
    );
    expect(adventureSchema.safeParse(arrived.patch.adventure).success).toBe(
      true,
    );
    expect(buyOffer(arrived.patch, "dealership:truck", at).ok).toBe(false);
  });
  it("requires two available slots for a shop boat plus its trailer", () => {
    const p = fleetAt(MAX_FLEET_VEHICLES - 1),
      before = structuredClone(p);
    expect(buyOffer(p, "boatDealer:boat", at).ok).toBe(false);
    expect(p).toEqual(before);
  });
});
