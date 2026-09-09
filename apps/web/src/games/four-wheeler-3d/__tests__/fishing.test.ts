import { describe, expect, it } from "vitest";
import {
  advanceFish,
  advanceReel,
  biteChance,
  catchLakeFish,
  createFishingSession,
  createLakeFish,
  fishSaleValue,
  netFish,
  rollCastTargets,
  type LakeFish,
} from "../lib/fishing";

const fish = (id: number, type: LakeFish["type"], x = 0): LakeFish => ({
  id,
  type,
  x,
  z: 0,
  heading: 0,
  speed: 1,
  alive: true,
  respawnIn: 0,
});

describe("lake population and bait", () => {
  it("starts with 900 ordinary fish and exactly two rare rainbow fish", () => {
    const population = createLakeFish();
    expect(population).toHaveLength(902);
    expect(population.filter((f) => f.type === "rainbow")).toHaveLength(2);
    expect(population.every((f) => Math.hypot(f.x, f.z) <= 355)).toBe(true);
  });
  it("preserves bait odds and never catches a zero-chance fish", () => {
    expect(biteChance("rainbow", null)).toBe(0.12);
    expect(biteChance("rainbow", "rainbow")).toBe(0.98);
    expect(biteChance("huge", "pro")).toBe(0.54);
    const population = [fish(1, "big"), fish(2, "little")];
    expect(
      rollCastTargets(population, 0, 0, 2, "bad", 0, () => 0).map(
        (f) => f.type,
      ),
    ).toEqual(["little"]);
  });
  it("casts one nearby target per rod and limits rainbow bait to two successes", () => {
    const population = [
      fish(1, "rainbow"),
      fish(2, "rainbow", 1),
      fish(3, "rainbow", 2),
      fish(4, "little", 80),
    ];
    expect(
      rollCastTargets(population, 0, 0, 10, "rainbow", 2, () => 0.5),
    ).toHaveLength(2);
    expect(
      rollCastTargets(population, 0, 0, 1, "rainbow", 2, () => 0),
    ).toHaveLength(1);
  });
  it("nets only real nearby ordinary fish and never catches the same fish twice", () => {
    const population = [
      fish(1, "rainbow"),
      ...Array.from({ length: 20 }, (_, i) => fish(i + 2, "little", i)),
      fish(99, "huge", 100),
    ];
    expect(netFish(population, 0, 0)).toHaveLength(16);
    expect(population[0].alive).toBe(true);
    expect(population.at(-1)?.alive).toBe(true);
    expect(netFish(population, 0, 0)).toHaveLength(4);
    expect(netFish(population, 0, 0)).toHaveLength(0);
  });
  it("replenishes caught fish and respawns rainbow fish in the lake center", () => {
    const population = [fish(1, "little", 30), fish(2, "rainbow", 20)];
    population.forEach(catchLakeFish);
    expect(population[1].alive).toBe(true);
    expect(population[1].x).toBe(0);
    advanceFish(population, 1.1);
    expect(population[0].alive).toBe(false);
    expect(population[1].alive).toBe(true);
    expect(Math.hypot(population[1].x, population[1].z)).toBeLessThan(2);
    advanceFish(population, 90);
    expect(population[0].alive).toBe(true);
  });
});

describe("reeling and sale", () => {
  it("snaps an over-tight line and expires an ignored bite", () => {
    const reel = {
      ...createFishingSession(),
      phase: "bite" as const,
      species: "huge" as const,
      reeling: true,
    };
    for (let i = 0; i < 50; i++) advanceReel(reel, 0.1);
    expect(reel.phase).toBe("escaped");
    const ignored = { ...createFishingSession(), phase: "bite" as const };
    advanceReel(ignored, 5.1);
    expect(ignored.phase).toBe("escaped");
  });
  it("lands a rainbow with controlled pull-and-release and cannot finish twice", () => {
    const reel = {
      ...createFishingSession(),
      phase: "bite" as const,
      species: "rainbow" as const,
    };
    for (let i = 0; i < 300; i++) {
      reel.reeling = reel.tension < 0.65;
      advanceReel(reel, 0.1);
    }
    expect(reel.phase).toBe("caught");
    expect(reel.reelProgress).toBe(1);
    const snapshot = { ...reel };
    advanceReel(reel, 10);
    expect(reel).toEqual(snapshot);
  });
  it("uses original sale prices, excluding rainbow's already-paid prize", () => {
    expect(
      fishSaleValue({ little: 2, middle: 1, big: 1, huge: 1, rainbow: 3 }),
    ).toBe(57000);
    expect(fishSaleValue({})).toBe(0);
  });
});

describe("rainbow population invariant", () => {
  it("always keeps two live rainbow fish, including immediately after consecutive catches", () => {
    const population = createLakeFish(() => 0.5),
      rainbows = population.filter((f) => f.type === "rainbow");
    expect(rainbows).toHaveLength(2);
    for (let i = 0; i < 12; i++) {
      catchLakeFish(rainbows[i % 2]);
      expect(
        population.filter((f) => f.type === "rainbow" && f.alive),
      ).toHaveLength(2);
      expect(rainbows[i % 2].respawnIn).toBe(0);
      expect(rainbows[i % 2].x).toBe(0);
      expect(rainbows[i % 2].z).toBe(0);
    }
  });
});
