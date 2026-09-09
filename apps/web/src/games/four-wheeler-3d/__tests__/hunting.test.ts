import { describe, expect, it } from "vitest";
import { createAdventureProgress } from "../lib/adventureTypes";
import {
  ANIMAL_TYPES,
  applyHuntingItem,
  buildWildlife,
  callWildlife,
  consumeCorn,
  nearestShot,
  refillFromCornTrailer,
  retrieveCarcass,
  sellHuntingKills,
  stepWildlife,
  tagWildlife,
  WILDLIFE_COUNT,
  wolfReset,
  type AnimalType,
  type WildlifeAnimal,
  type WildlifeContext,
} from "../lib/hunting";
import { hubBounds, LAKE, TREESTANDS } from "../lib/landmarks";
import { defaultProgress, type FourWheeler3dProgress } from "../lib/store";

const fresh = (): FourWheeler3dProgress => ({
  ...structuredClone(defaultProgress),
  adventure: createAdventureProgress(),
});
const point = (x = 1000, z = 1000) => ({ x, y: 0, z });
const animal = (
  type: AnimalType = "buck",
  x = 1000,
  z = 1000,
  id = "animal-0",
): WildlifeAnimal => ({
  id,
  type,
  position: point(x, z),
  heading: 0,
  speed: 0,
  targetSpeed: 0,
  turnIn: 100,
  calledFor: 0,
  alive: true,
});
const context = (
  overrides: Partial<WildlifeContext> = {},
): WildlifeContext => ({
  player: point(1500, 1500),
  mode: "foot",
  camo: false,
  feeders: [],
  protected: false,
  ...overrides,
});

describe("full wildlife population", () => {
  it("creates every original animal and exactly 96 additional stand animals", () => {
    const all = buildWildlife(1987);
    expect(all).toHaveLength(WILDLIFE_COUNT);
    expect(new Set(all.map((a) => a.id)).size).toBe(1876);
    expect(
      all.filter((a) => ["buck", "deer", "rabbit"].includes(a.type)),
    ).toHaveLength(1336);
    for (const [type, count] of [
      ["lion", 108],
      ["tiger", 108],
      ["zebra", 120],
      ["bat", 120],
      ["wolf", 84],
    ])
      expect(all.filter((a) => a.type === type)).toHaveLength(count as number);
    for (let i = 0; i < 4; i++)
      for (const a of all.slice(1240 + i * 24, 1240 + (i + 1) * 24))
        expect(
          Math.hypot(
            a.position.x - TREESTANDS[i].x,
            a.position.z - TREESTANDS[i].z,
          ),
        ).toBeLessThanOrEqual(620 / 18 + 0.001);
  });
  it("rebuilds deterministically and preserves removed animals across reload", () => {
    expect(buildWildlife(42)).toEqual(buildWildlife(42));
    const all = buildWildlife(42, ["animal-3", "animal-1800"]);
    expect(all[3].alive).toBe(false);
    expect(all[1800].alive).toBe(false);
    expect(all.filter((a) => a.alive)).toHaveLength(1874);
  });
  it("never starts wildlife in the lake or compound", () => {
    for (const a of buildWildlife()) {
      expect(Math.hypot(a.position.x, a.position.z)).toBeGreaterThan(LAKE.r);
      expect(
        a.position.x > hubBounds.minX &&
          a.position.x < hubBounds.maxX &&
          a.position.z > hubBounds.minZ &&
          a.position.z < hubBounds.maxZ,
      ).toBe(false);
    }
  });
});

describe("wildlife behavior", () => {
  it("prey flee, while camo and an occupied stand suppress that response", () => {
    const prey = animal();
    stepWildlife([prey], context({ player: point(1000, 1005) }), 0.1);
    expect(prey.position.z).toBeLessThan(1000);
    for (const settings of [{ camo: true }, { mode: "stand" as const }]) {
      const hidden = animal();
      stepWildlife(
        [hidden],
        context({ player: point(1000, 1005), ...settings }),
        0.1,
      );
      expect(hidden.speed).toBe(0);
    }
  });
  it("wolves catch exposed walkers but respect camo, vehicles, stands and spawn protection", () => {
    expect(
      stepWildlife(
        [animal("wolf")],
        context({ player: point(1000, 1001) }),
        0.1,
      ),
    ).toBe("animal-0");
    for (const settings of [
      { camo: true },
      { protected: true },
      { mode: "vehicle" as const },
      { mode: "stand" as const },
    ])
      expect(
        stepWildlife(
          [animal("wolf")],
          context({ player: point(1000, 1001), ...settings }),
          0.1,
        ),
      ).toBeNull();
  });
  it("full feeders attract from source ranges and scent extends their reach", () => {
    const feeder = {
      id: "f",
      position: point(1000, 1250),
      label: "Feeder",
      corn: 18,
      scented: false,
    };
    const a = animal();
    stepWildlife([a], context({ feeders: [feeder] }), 0.1);
    expect(a.speed).toBe(0);
    feeder.scented = true;
    stepWildlife([a], context({ feeders: [feeder] }), 0.1);
    expect(a.position.z).toBeGreaterThan(1000);
    const empty = animal();
    stepWildlife([empty], context({ feeders: [{ ...feeder, corn: 0 }] }), 0.1);
    expect(empty.speed).toBe(0);
  });
  it("grunt calls reach only living deer and bucks within range", () => {
    const deer = animal("deer"),
      buck = animal("buck", 1001),
      wolf = animal("wolf"),
      far = animal("buck", 1800);
    expect(callWildlife([deer, buck, wolf, far], point())).toBe(2);
    expect(deer.calledFor).toBe(6);
    expect(wolf.calledFor).toBe(0);
    expect(far.calledFor).toBe(0);
  });
  it("land wildlife cannot cross the shore while bats can", () => {
    for (const type of ["deer", "bat"] as const) {
      const a = animal(type, LAKE.r + 25 / 18 + 0.01, 0);
      a.heading = -Math.PI / 2;
      a.speed = 10;
      a.targetSpeed = 10;
      stepWildlife([a], context(), 0.1);
      expect(a.position.x < LAKE.r + 25 / 18).toBe(type === "bat");
    }
  });
  it("mounted animals are controlled by their rider rather than autonomous AI", () => {
    const a = animal();
    a.speed = 10;
    stepWildlife([a], context({ mountId: a.id }), 0.1);
    expect(a.position).toEqual(point());
  });
});

describe("actual hits and trophy ownership", () => {
  it("chooses the first live animal on the ray and rejects behind/off-axis targets", () => {
    const near = animal("buck", 0, 10, "near"),
      far = animal("deer", 0, 20, "far");
    const behind = animal("wolf", 0, -1, "behind"),
      aside = animal("lion", 3, 3, "aside");
    const origin = { x: 0, y: 1, z: 0 },
      direction = { x: 0, y: 0, z: 1 };
    expect(nearestShot([far, aside, behind, near], origin, direction)?.id).toBe(
      "near",
    );
    near.alive = false;
    expect(nearestShot([far, near], origin, direction)?.id).toBe("far");
    expect(nearestShot([behind, aside], origin, direction)).toBeNull();
    expect(nearestShot([far], origin, { x: 0, y: 0, z: 0 })).toBeNull();
  });
  it("records a tag only once and bounds retained carcasses without forgetting tags", () => {
    let a = createAdventureProgress();
    for (let i = 0; i < 51; i++)
      a = tagWildlife(a, animal("buck", 1000, 1000, `animal-${i}`));
    expect(a.hunting.removedAnimalIds).toHaveLength(51);
    expect(a.hunting.carcasses).toHaveLength(50);
    expect(a.hunting.carcasses[0].id).toBe("animal-1");
    expect(tagWildlife(a, animal("buck", 1000, 1000, "animal-1"))).toBe(a);
  });
  it("retrieval transfers one carcass into held inventory once", () => {
    let a = tagWildlife(createAdventureProgress(), animal("wolf"));
    a = retrieveCarcass(a, "animal-0");
    expect(a.heldKills.wolf).toBe(1);
    expect(a.hunting.carcasses).toHaveLength(0);
    expect(retrieveCarcass(a, "animal-0")).toBe(a);
  });
  it("sells original species payouts and leaves physical buck skulls to collect", () => {
    const p = fresh();
    p.adventure.heldKills = { wolf: 1, bat: 2, buck: 3, deer: 1 };
    const sold = sellHuntingKills(p, point());
    expect(sold.ok).toBe(true);
    expect(sold.progress.money - p.money).toBe(42000);
    expect(sold.progress.adventure.trophyCounts.buck).toBe(3);
    expect(sold.progress.adventure.hunting.looseSkulls).toHaveLength(3);
    expect(sold.progress.adventure.collectedSkulls).toBe(0);
    expect(sellHuntingKills(sold.progress, point()).ok).toBe(false);
    expect(p.adventure.heldKills.buck).toBe(3);
  });
});

describe("gear and feeder lifecycle", () => {
  it("requires owned gear and proximity before consuming scent", () => {
    const p = fresh();
    expect(applyHuntingItem(p, "camo", point(), "foot").ok).toBe(false);
    p.adventure.inventory.scent = 1;
    expect(applyHuntingItem(p, "scent", point(), "foot").ok).toBe(false);
    expect(p.adventure.inventory.scent).toBe(1);
    const used = applyHuntingItem(
      p,
      "scent",
      p.adventure.feeders[0].position,
      "foot",
    );
    expect(used.progress.adventure.feeders[0].scented).toBe(true);
    expect(used.progress.adventure.inventory.scent).toBe(0);
  });
  it("carries corn, caps refill at eighteen and spends exactly one bag", () => {
    let p = fresh();
    p.adventure.inventory.corn = 2;
    p.adventure.feeders[0].corn = 15;
    const location = p.adventure.feeders[0].position;
    p = applyHuntingItem(p, "corn", location, "foot").progress;
    expect(p.adventure.hunting.carryingCorn).toBe(true);
    expect(p.adventure.inventory.corn).toBe(2);
    p = applyHuntingItem(p, "corn", location, "foot").progress;
    expect(p.adventure.feeders[0].corn).toBe(18);
    expect(p.adventure.inventory.corn).toBe(1);
    expect(p.adventure.hunting.carryingCorn).toBe(false);
  });
  it("loads trailer corn and transfers only the missing amount into nearby feeders", () => {
    let p = fresh();
    p.adventure.inventory.corn = 1;
    const trailer = p.adventure.fleet["starter-trailer"];
    p = applyHuntingItem(p, "corn", trailer.position, "foot").progress;
    p = applyHuntingItem(p, "corn", trailer.position, "foot").progress;
    expect(p.adventure.fleet[trailer.id].cornLoad).toBe(6);
    p.adventure.fleet["starter-atv"].hitch = trailer.id;
    p.adventure.feeders[0].position = { ...trailer.position };
    p.adventure.feeders[0].corn = 16;
    const filled = refillFromCornTrailer(p.adventure);
    expect(filled.feeders[0].corn).toBe(18);
    expect(filled.fleet[trailer.id].cornLoad).toBe(4);
  });
  it("depletes one drop per four game hours, including elapsed multi-day updates", () => {
    let a = createAdventureProgress();
    a = consumeCorn(a, 3.9);
    expect(a.feeders[0].corn).toBe(18);
    a = consumeCorn(a, 0.2);
    expect(a.feeders[0].corn).toBe(17);
    expect(a.hunting.cornHours).toBeCloseTo(0.1);
    a = consumeCorn(a, 72);
    expect(a.feeders[0].corn).toBe(0);
    expect(consumeCorn(a, NaN)).toBe(a);
  });
  it("places unique feeder/stand IDs and supports pickup without duplicating stock", () => {
    let p = fresh();
    p.adventure.inventory.feeder = 2;
    p.adventure.inventory["stand-tree"] = 1;
    p = applyHuntingItem(p, "feeder", point(), "foot").progress;
    expect(new Set(p.adventure.feeders.map((f) => f.id)).size).toBe(5);
    p = applyHuntingItem(p, "feeder", point(), "foot").progress;
    expect(p.adventure.feeders).toHaveLength(4);
    expect(p.adventure.inventory.feeder).toBe(2);
    p = applyHuntingItem(p, "stand-tree", point(), "foot").progress;
    expect(new Set(p.adventure.stands.map((s) => s.id)).size).toBe(5);
    expect(applyHuntingItem(p, "stand-tree", point(), "foot").ok).toBe(false);
  });
  it("cannot place equipment while driving or in water", () => {
    const p = fresh();
    p.adventure.inventory.feeder = 1;
    expect(applyHuntingItem(p, "feeder", point(), "vehicle").ok).toBe(false);
    expect(applyHuntingItem(p, "feeder", point(0, 0), "foot").ok).toBe(false);
    expect(p.adventure.inventory.feeder).toBe(1);
  });
  it("allows ten grunt uses and rejects the eleventh without going negative", () => {
    let p = fresh();
    p.adventure.hunting.gruntUses = 10;
    p.adventure.inventory.call = 1;
    for (let i = 0; i < 10; i++) {
      const r = applyHuntingItem(p, "grunt", point(), "foot");
      expect(r.ok).toBe(true);
      p = r.progress;
    }
    expect(applyHuntingItem(p, "grunt", point(), "foot").ok).toBe(false);
    expect(p.adventure.hunting.gruntUses).toBe(0);
  });
});

describe("wolf policy", () => {
  it("keeps cash and owned land, resets trophies/fleet and leaves the player on foot", () => {
    const p = fresh();
    p.money = 123456;
    p.trophies = 5;
    p.adventure.plots["plot-1"].owned = true;
    p.adventure.trophyCounts.buck = 20;
    p.adventure.collectedSkulls = 5;
    p.adventure.hunting.removedAnimalIds = ["animal-0"];
    p.adventure.fleet.bought = {
      ...p.adventure.fleet["starter-atv"],
      id: "bought",
    };
    const reset = wolfReset(p);
    expect(reset.money).toBe(123456);
    expect(reset.adventure.plots["plot-1"].owned).toBe(true);
    expect(reset.adventure.fleet.bought).toBeUndefined();
    expect(reset.adventure.activeVehicleId).toBeNull();
    expect(reset.trophies).toBe(0);
    expect(reset.adventure.trophyCounts).toEqual({});
    expect(reset.adventure.hunting.removedAnimalIds).toEqual([]);
    expect(p.adventure.fleet.bought).toBeDefined();
  });
  it("retains source payout coverage for every species", () => {
    expect(ANIMAL_TYPES).toHaveLength(8);
  });
});
