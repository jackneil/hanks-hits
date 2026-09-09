import { describe, expect, it } from "vitest";
import { createAdventureProgress } from "../lib/adventureTypes";
import { migrateAdventure } from "../lib/migration";
import { adventureSchema } from "../lib/adventureSchema";
import { calculatorKey, emptyCalculator } from "../lib/calculator";
import { routeTo } from "../lib/destinations";
import { buyOffer } from "../lib/economy";
import { defaultProgress } from "../lib/store";
import { eatMeal, hungerReset, saddleHorse } from "../lib/life";

describe("complete adventure migration", () => {
  it("loads pre-adventure saves with a complete valid starter world", () => {
    expect(adventureSchema.safeParse(migrateAdventure(undefined)).success).toBe(
      true,
    );
  });
  it("keeps owned rides and money systems when new hunting fields did not exist", () => {
    const a = createAdventureProgress();
    a.inventory.camo = 3;
    a.fleet["starter-atv"].paint = "#123456";
    const old = JSON.parse(JSON.stringify(a));
    delete old.hunting.carcasses;
    delete old.hunting.worldSeed;
    delete old.fleet["starter-atv"].cornLoad;
    const next = migrateAdventure(old);
    expect(next.inventory.camo).toBe(3);
    expect(next.fleet["starter-atv"].paint).toBe("#123456");
    expect(next.hunting.carcasses).toEqual([]);
    expect(next.fleet["starter-atv"].cornLoad).toBe(0);
    expect(adventureSchema.safeParse(next).success).toBe(true);
  });
  it("round-trips every catalog purchase with the cloud save schema", () => {
    for (const id of [
      "dealership:truck",
      "anyStore:yacht",
      "huntStore:camo",
      "flyStore:rocket",
      "bucketShop:bucket-blue",
      "bikeStore:supere",
    ]) {
      const result = buyOffer(
        {
          ...defaultProgress,
          money: 20000000,
          adventure: createAdventureProgress(),
        },
        id,
        { x: -400, y: 2, z: 20 },
      );
      expect(result.ok).toBe(true);
      if (result.ok)
        expect(
          adventureSchema.safeParse(
            JSON.parse(JSON.stringify(result.patch.adventure)),
          ).success,
        ).toBe(true);
    }
  });
  it("repairs only the invalid subsystem of a corrupted local save", () => {
    const a = createAdventureProgress();
    a.inventory.rod = 1;
    const next = migrateAdventure({
      ...a,
      dog: { hungerHours: Infinity, alive: true },
    });
    expect(next.inventory.rod).toBe(1);
    expect(next.dog.hungerHours).toBe(0);
  });
  it("rejects unbounded arrays and invalid fleet fields at the API contract", () => {
    const a = createAdventureProgress();
    a.fleet["starter-atv"].position.x = Infinity;
    expect(adventureSchema.safeParse(a).success).toBe(false);
  });
});
describe("phone and world interactions", () => {
  const calc = (keys: string[]) =>
    keys.reduce(calculatorKey, { ...emptyCalculator });
  it("calculates chained expressions, decimals, sign and percent without eval", () => {
    expect(calc(["2", "+", "3", "×", "4", "="]).display).toBe("20");
    expect(calc(["1", ".", "5", "±", "+", "2", "="]).display).toBe("0.5");
    expect(calc(["5", "0", "%"]).display).toBe("0.5");
  });
  it("reports divide by zero and allows a fresh number after the error", () => {
    expect(calc(["9", "÷", "0", "="]).display).toBe("Error");
    expect(calc(["9", "÷", "0", "=", "4"]).display).toBe("4");
  });
  it("routes land travel around the lake rather than straight through it", () => {
    const route = routeTo({ x: -500, z: 0 }, { x: 500, z: 0 });
    expect(route.length).toBeGreaterThan(2);
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1],
        b = route[i];
      for (let j = 0; j <= 10; j++) {
        expect(
          Math.hypot(
            a.x + ((b.x - a.x) * j) / 10,
            a.z + ((b.z - a.z) * j) / 10,
          ),
        ).toBeGreaterThan(360);
      }
    }
  });
  it("keeps a direct route for short trips in town", () => {
    expect(routeTo({ x: -400, z: 0 }, { x: -450, z: -40 })).toHaveLength(2);
  });
  it("requires money for food and preserves land on starvation", () => {
    expect(eatMeal({ ...defaultProgress, money: 99 })).toBeNull();
    const p = {
      ...defaultProgress,
      money: 100,
      hunger: 12,
      adventure: createAdventureProgress(),
    };
    p.adventure.plots["plot-1"].owned = true;
    expect(eatMeal(p)?.hunger).toBe(0);
    expect(eatMeal(p)?.money).toBe(0);
    expect(hungerReset(p).adventure.plots["plot-1"].owned).toBe(true);
    expect(hungerReset(p).money).toBe(20000);
  });
  it("consumes a saddle once and retains it on the same horse", () => {
    const a = createAdventureProgress();
    a.inventory["saddle-western"] = 1;
    const next = saddleHorse(a, a.horses[0].id)!;
    expect(next.inventory["saddle-western"]).toBe(0);
    expect(next.horses[0].saddle).toBe("saddle-western");
    expect(saddleHorse(next, a.horses[0].id)).toBeNull();
  });
});
