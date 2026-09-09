import { describe, expect, it } from "vitest";
import { createAdventureProgress } from "../lib/adventureTypes";
import { NEUTRAL } from "../lib/controls";
import { buyOffer } from "../lib/economy";
import {
  PLANETS,
  PLANET_RADIUS,
  collectSpaceGems,
  createMeteors,
  createPlanetSurface,
  createSpaceSession,
  landOnPlanet,
  leavePlanet,
  stepSpace,
  type Meteor,
} from "../lib/space";

describe("rocket and planetary exploration", () => {
  it("requires $500,000 to own the rocket without charging failed purchases", () => {
    const p = {
        money: 499999,
        totalEarned: 0,
        ownedVehicles: ["atv"],
        adventure: createAdventureProgress(),
      },
      at = { x: -429, y: 0, z: -63 };
    expect(buyOffer(p, "flyStore:rocket", at).ok).toBe(false);
    expect(p.money).toBe(499999);
    const bought = buyOffer({ ...p, money: 500000 }, "flyStore:rocket", at);
    expect(bought.ok).toBe(true);
    if (bought.ok) {
      expect(bought.patch.money).toBe(0);
      expect(bought.patch.adventure.rocketOwned).toBe(true);
    }
  });
  it("restores all four original planets and deterministic surfaces", () => {
    expect(PLANETS.map((p) => p.name)).toEqual([
      "Mars",
      "Neptune",
      "Saturn",
      "Moon",
    ]);
    for (const p of PLANETS) {
      const surface = createPlanetSurface(p.id);
      expect(surface.gems).toHaveLength(14);
      expect(surface.rocks).toHaveLength(22);
      expect(surface.aliens).toHaveLength(5);
      expect(createPlanetSurface(p.id)).toEqual(surface);
    }
    expect(
      new Set(
        PLANETS.flatMap((p) => createPlanetSurface(p.id).gems.map((g) => g.id)),
      ).size,
    ).toBe(56);
  });
  it("launches with a finite meteor grace period and sixteen drifting rocks", () => {
    expect(createSpaceSession().grace).toBe(1.2);
    expect(createMeteors()).toHaveLength(16);
    const meteors = createMeteors(),
      x = meteors[0].x;
    stepSpace(createSpaceSession(), meteors, NEUTRAL, 0.05);
    expect(meteors[0].x).not.toBe(x);
  });
  it("allows steering, thrust and braking with a bounded top speed", () => {
    let s = createSpaceSession();
    for (let i = 0; i < 500; i++)
      s = stepSpace(s, [], { ...NEUTRAL, throttle: 1 }, 0.02).state;
    expect(s.speed).toBeLessThanOrEqual(80.000001);
    expect(s.speed).toBeGreaterThan(70);
    const turn = stepSpace(s, [], { ...NEUTRAL, steer: 1 }, 0.05).state;
    expect(turn.heading).toBeLessThan(s.heading);
    const brake = stepSpace(s, [], { ...NEUTRAL, brake: 1 }, 0.05).state;
    expect(brake.speed).toBeLessThan(s.speed);
  });
  it("detects a swept meteor collision but respects launch grace", () => {
    const meteor: Meteor = {
      id: "test",
      x: 2,
      z: 0,
      vx: 0,
      vz: 0,
      radius: 0.2,
      spin: 0,
      spinV: 0,
    };
    const state = {
      ...createSpaceSession(),
      x: 0,
      z: 0,
      vx: 80,
      vz: 0,
      grace: 0,
    };
    expect(stepSpace(state, [{ ...meteor }], NEUTRAL, 0.05).crash).toBe(true);
    expect(
      stepSpace({ ...state, grace: 1 }, [{ ...meteor }], NEUTRAL, 0.05).crash,
    ).toBe(false);
  });
  it("wraps meteors without false collision across the middle of space", () => {
    const m: Meteor = {
      id: "wrap",
      x: 4600 / 18 - 0.1,
      z: 0,
      vx: 20,
      vz: 0,
      radius: 2,
      spin: 0,
      spinV: 0,
    };
    expect(
      stepSpace(
        { ...createSpaceSession(), x: 0, z: 0, grace: 0 },
        [m],
        NEUTRAL,
        0.05,
      ).crash,
    ).toBe(false);
    expect(m.x).toBe(-4600 / 18);
  });
  it.each(PLANETS)("automatically lands on $name at its surface", (p) => {
    const result = stepSpace(
      { ...createSpaceSession(), x: p.x, z: p.z - p.radius - 1, vx: 0, vz: 0 },
      [],
      NEUTRAL,
      0.02,
    );
    expect(result.landed).toBe(p.id);
    expect(result.state.phase).toBe("surface");
    expect(result.state.planet).toBe(p.id);
  });
  it("offers landing only within the original approach range", () => {
    const p = PLANETS[0],
      s = {
        ...createSpaceSession(),
        x: p.x,
        z: p.z - p.radius - 10,
        vx: 0,
        vz: 0,
      };
    expect(stepSpace(s, [], NEUTRAL, 0.02).state.nearPlanet).toBe("mars");
    expect(
      stepSpace({ ...s, z: p.z - p.radius - 25 }, [], NEUTRAL, 0.02).state
        .nearPlanet,
    ).toBeNull();
  });
  it("walks diagonally at the same speed and clamps the planet rim", () => {
    const s = landOnPlanet("moon"),
      straight = stepSpace(s, [], { ...NEUTRAL, throttle: 1 }, 0.05).state,
      diagonal = stepSpace(
        s,
        [],
        { ...NEUTRAL, throttle: 1, steer: 1 },
        0.05,
      ).state;
    expect(Math.hypot(diagonal.x - s.x, diagonal.z - s.z)).toBeCloseTo(
      Math.hypot(straight.x - s.x, straight.z - s.z),
    );
    const edge = stepSpace(
      { ...s, x: PLANET_RADIUS - 1, z: 0 },
      [],
      { ...NEUTRAL, steer: 1 },
      0.05,
    ).state;
    expect(Math.hypot(edge.x, edge.z)).toBeCloseTo(PLANET_RADIUS - 30 / 18);
    expect(
      stepSpace(s, [], { ...NEUTRAL, brake: 1 }, 0.05).state.z,
    ).toBeGreaterThan(s.z);
  });
  it("collects gems atomically once and preserves the other worlds", () => {
    const adventure = createAdventureProgress(),
      g = createPlanetSurface("mars").gems[0],
      state = { ...landOnPlanet("mars"), x: g.x, z: g.z };
    const first = collectSpaceGems(adventure, state);
    expect(first.reward).toBe(5000);
    expect(first.adventure.space.gems.mars).toContain(g.id);
    expect(collectSpaceGems(first.adventure, state).reward).toBe(0);
    expect(adventure.space.gems.mars).toBeUndefined();
    const moon = createPlanetSurface("moon").gems[0],
      second = collectSpaceGems(first.adventure, {
        ...landOnPlanet("moon"),
        x: moon.x,
        z: moon.z,
      });
    expect(second.adventure.space.gems.mars).toEqual(
      first.adventure.space.gems.mars,
    );
    expect(collectSpaceGems(adventure, createSpaceSession()).reward).toBe(0);
  });
  it("requires physically reaching the rocket before relaunching", () => {
    expect(leavePlanet(landOnPlanet("saturn"))).toBeNull();
    const next = leavePlanet({
      ...landOnPlanet("saturn"),
      x: 0,
      z: PLANET_RADIUS * 0.6,
    });
    expect(next?.phase).toBe("flight");
    expect(next?.grace).toBe(1.2);
    expect(next?.z).toBeLessThan(PLANETS[2].z - PLANETS[2].radius);
  });
});
