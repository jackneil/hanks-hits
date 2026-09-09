import { describe, expect, it } from "vitest";
import { createAdventureProgress } from "../lib/adventureTypes";
import { OFFERS } from "../lib/catalog";
import {
  advanceDelivery,
  advanceHelper,
  buyLand,
  buyOffer,
  canBoardFleetVehicle,
  constructBuilding,
  customizeVehicle,
  orderDelivery,
  requestHelper,
  sellMilk,
  sellVehicle,
  upgradeLand,
  waterDeliveryPosition,
  type EconomyProgress,
  type TransactionResult,
} from "../lib/economy";
import { LAKE, LANDMARKS } from "../lib/landmarks";

const here = { x: -430, y: 2, z: -30 };
const fresh = (money = 20000): EconomyProgress => ({
  money,
  totalEarned: 0,
  ownedVehicles: ["atv"],
  adventure: createAdventureProgress(),
});
function apply(p: EconomyProgress, result: TransactionResult): EconomyProgress {
  expect(result.ok, result.message).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return { ...p, ...result.patch };
}

describe("atomic commerce", () => {
  it("does not spend or grant below the offer price", () => {
    const p = fresh(19999),
      before = structuredClone(p);
    expect(buyOffer(p, "dealership:truck", here).ok).toBe(false);
    expect(p).toEqual(before);
  });
  it("creates unique instances for repeat buys and keeps zero-balance purchases valid", () => {
    let p = fresh(40000);
    p = apply(p, buyOffer(p, "dealership:truck", here));
    p = apply(p, buyOffer(p, "dealership:truck", here));
    expect(p.money).toBe(0);
    expect(p.adventure.fleet["vehicle-1"].type).toBe("truck");
    expect(p.adventure.fleet["vehicle-2"].type).toBe("truck");
    expect(p.adventure.fleet["vehicle-1"].position).not.toBe(
      p.adventure.fleet["vehicle-2"].position,
    );
    expect(p.ownedVehicles.filter((v) => v === "truck")).toHaveLength(1);
  });
  it("can grant every catalog offer without mutating the input", () => {
    for (const offer of OFFERS) {
      const p = fresh(10000000),
        before = structuredClone(p);
      const next = apply(p, buyOffer(p, offer.id, here));
      expect(next.money).toBe(p.money - offer.price);
      expect(next.adventure).not.toEqual(p.adventure);
      expect(p).toEqual(before);
    }
  });
  it("rejects unknown offers and invalid placement without spending", () => {
    expect(buyOffer(fresh(), "dealership:made-up", here).ok).toBe(false);
    expect(buyOffer(fresh(), "dealership:atv", { ...here, x: NaN }).ok).toBe(
      false,
    );
  });
  it("puts physical-shop boats on a trailer and prevents boarding the cargo", () => {
    let p = fresh();
    p = apply(p, buyOffer(p, "boatDealer:boat", here));
    expect(p.adventure.fleet["vehicle-2"].cargo).toEqual(["vehicle-1"]);
    expect(p.adventure.fleet["vehicle-1"].parked).toBe(false);
    expect(canBoardFleetVehicle(p.adventure, "vehicle-1")).toBe(false);
    expect(canBoardFleetVehicle(p.adventure, "starter-atv")).toBe(true);
  });
  it("unlocks starter aircraft with the package and rejects buying the unlock twice", () => {
    let p = fresh(500000);
    expect(canBoardFleetVehicle(p.adventure, "starter-plane")).toBe(false);
    p = apply(p, buyOffer(p, "anyStore:aircraft", here));
    expect(canBoardFleetVehicle(p.adventure, "starter-plane")).toBe(true);
    expect(buyOffer(p, "anyStore:aircraft", here).ok).toBe(false);
  });
  it("grants usable gear state consistently", () => {
    let p = fresh();
    for (const id of [
      "huntStore:call",
      "huntStore:call",
      "huntStore:decoy",
      "standStore:ground",
    ])
      p = apply(p, buyOffer(p, id, here));
    expect(p.adventure.hunting.gruntUses).toBe(20);
    expect(p.adventure.inventory.call).toBe(2);
    expect(p.adventure.inventory.feeder).toBe(1);
    expect(p.adventure.inventory["stand-ground"]).toBe(1);
  });
});

describe("selling and customization", () => {
  it("sells an instance once, removes references and preserves other identical vehicles", () => {
    let p = fresh();
    p.adventure.fleet["starter-trailer"].cargo.push("starter-atv");
    p = apply(p, sellVehicle(p, "starter-atv"));
    expect(p.money).toBe(40000);
    expect(p.totalEarned).toBe(20000);
    expect(p.adventure.activeVehicleId).toBeNull();
    expect(p.adventure.fleet["starter-trailer"].cargo).toEqual([]);
    expect(sellVehicle(p, "starter-atv").ok).toBe(false);
    expect(
      Object.values(p.adventure.fleet).filter((v) => v.type === "truck"),
    ).toHaveLength(2);
  });
  it("detaches a sold trailer and parks its cargo instead of losing the owned boat", () => {
    let p = apply(fresh(), buyOffer(fresh(), "boatDealer:boat", here));
    p.adventure.fleet["starter-atv"].hitch = "vehicle-2";
    p = apply(p, sellVehicle(p, "vehicle-2"));
    expect(p.adventure.fleet["starter-atv"].hitch).toBeNull();
    expect(p.adventure.fleet["vehicle-1"].parked).toBe(true);
    expect(canBoardFleetVehicle(p.adventure, "vehicle-1")).toBe(true);
  });
  it("charges tuning atomically with paint and refunds only speed actually removed", () => {
    const broke = fresh(0);
    expect(
      customizeVehicle(broke, "starter-atv", {
        paint: "#ffffff",
        speedDelta: 10,
      }).ok,
    ).toBe(false);
    expect(broke.adventure.fleet["starter-atv"].paint).toBe("#e63946");
    let p = fresh();
    p = apply(
      p,
      customizeVehicle(p, "starter-atv", { paint: "#ffffff", speedDelta: 10 }),
    );
    expect(p.money).toBe(19990);
    expect(p.adventure.fleet["starter-atv"].paint).toBe("#ffffff");
    p = apply(p, customizeVehicle(p, "starter-atv", { speedDelta: -10 }));
    expect(p.money).toBe(20000);
    for (let i = 0; i < 20; i++) {
      const result = customizeVehicle(p, "starter-atv", { speedDelta: -10 });
      if (result.ok) p = apply(p, result);
    }
    expect(customizeVehicle(p, "starter-atv", { speedDelta: -10 }).ok).toBe(
      false,
    );
    expect(p.money).toBeLessThan(20100);
    expect(customizeVehicle(p, "starter-boat", { paint: "#ffffff" }).ok).toBe(
      false,
    );
  });
  it("sells only milk that exists and consumes the bucket once", () => {
    let p = fresh();
    p.adventure.bucket = {
      color: "#ff0000",
      colorName: "Red",
      fill: 0.6,
      uses: 3,
    };
    p = apply(p, sellMilk(p));
    expect(p.money).toBe(20120);
    expect(p.adventure.bucket).toBeNull();
    expect(sellMilk(p).ok).toBe(false);
  });
});

describe("serializable delivery and helper errands", () => {
  it("charges once, refuses a second order, survives serialization and grants once", () => {
    let p = apply(fresh(), orderDelivery(fresh(), "dealership:truck"));
    expect(p.money).toBe(0);
    expect(orderDelivery(p, "huntStore:bow").ok).toBe(false);
    p = JSON.parse(JSON.stringify(p));
    p = apply(p, advanceDelivery(p, 37, here));
    expect(
      Object.values(p.adventure.fleet).filter((v) => v.type === "truck"),
    ).toHaveLength(2);
    p = apply(p, advanceDelivery(p, 1, here));
    expect(
      Object.values(p.adventure.fleet).filter((v) => v.type === "truck"),
    ).toHaveLength(3);
    expect(p.money).toBe(0);
    expect(p.adventure.delivery).toBeNull();
    expect(advanceDelivery(p, 38, here).ok).toBe(false);
  });
  it("does not start an unaffordable delivery", () => {
    const p = fresh(99);
    expect(orderDelivery(p, "huntStore:bow").ok).toBe(false);
    expect(p.adventure.delivery).toBeNull();
  });
  it("delivers a boat onto water near the player or to the dock", () => {
    let p = apply(fresh(), orderDelivery(fresh(), "boatDealer:boat"));
    p = apply(p, advanceDelivery(p, 38, { x: -370, y: 0, z: 0 }));
    const boat = Object.values(p.adventure.fleet).find((v) =>
      v.id.startsWith("vehicle-"),
    )!;
    expect(boat.type).toBe("boat");
    expect(Math.hypot(boat.position.x, boat.position.z)).toBeLessThan(LAKE.r);
    expect(boat.parked).toBe(true);
    expect(waterDeliveryPosition({ x: 1000, y: 0, z: 0 })).toEqual({
      ...LANDMARKS.dockWater,
      y: 0,
    });
  });
  it("rejects empty feeder errands and bills a delayed fill by feeder count", () => {
    let p = fresh();
    expect(requestHelper(p, "fill feeders").ok).toBe(false);
    p.adventure.feeders[0].corn = 0;
    p = apply(p, requestHelper(p, "please fill my corn feeders"));
    expect(p.money).toBe(19200);
    expect(requestHelper(p, "truck").ok).toBe(false);
    p = apply(p, advanceHelper(p, 3, here));
    expect(p.adventure.feeders[0].corn).toBe(0);
    p = apply(p, advanceHelper(p, 1, here));
    expect(p.adventure.feeders.every((f) => f.corn === 18)).toBe(true);
    expect(p.adventure.helperTask).toBeNull();
  });
  it("matches the requested vehicle and handles an unaffordable errand", () => {
    expect(requestHelper(fresh(100), "get a yacht").ok).toBe(false);
    const p = apply(fresh(), requestHelper(fresh(), "get my 18-wheeler truck"));
    expect(p.adventure.helperTask?.offerId).toBe("anyStore:semi");
  });
});

describe("land purchase and construction", () => {
  it("enforces ownership, sequential slots, prices and one-time purchases", () => {
    let p = fresh();
    expect(constructBuilding(p, "plot-1", 0, "garage").ok).toBe(false);
    p = apply(p, buyLand(p, "plot-1"));
    expect(p.money).toBe(14000);
    expect(buyLand(p, "plot-1").ok).toBe(false);
    expect(constructBuilding(p, "plot-1", 1, "garage").ok).toBe(false);
    p = apply(p, constructBuilding(p, "plot-1", 0, "garage"));
    expect(constructBuilding(p, "plot-1", 0, "garage").ok).toBe(false);
    p = apply(p, constructBuilding(p, "plot-1", 1, "house-small"));
    expect(p.money).toBe(7000);
    const result = upgradeLand(p, "plot-1");
    expect(result.ok).toBe(false);
    expect(p.adventure.plots["plot-1"].sizeLevel).toBe(0);
  });
  it("mirrors the legacy land fields and stops after four upgrades", () => {
    let p = apply(fresh(200000), buyLand(fresh(200000), "plot-2"));
    for (let i = 0; i < 4; i++) p = apply(p, upgradeLand(p, "plot-2"));
    expect(p.adventure.plots["plot-2"].sizeLevel).toBe(4);
    expect(upgradeLand(p, "plot-2").ok).toBe(false);
    const result = constructBuilding(p, "plot-2", 0, "house-huge");
    expect(result.ok && result.patch.land["plot-2"]).toEqual({
      size: 4,
      slots: ["house-huge"],
    });
  });
});
