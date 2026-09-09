import { describe, expect, it } from "vitest";
import { NEUTRAL } from "../lib/controls";
import { createAdventureProgress } from "../lib/adventureTypes";
import { adventureSchema, MAX_FLEET_VEHICLES } from "../lib/adventureSchema";
import { SHORE_RADIUS } from "../lib/terrain";
import {
  AIRCRAFT_TYPES,
  BOAT_TYPES,
  canBailOut,
  createTransportState,
  launchYachtToy,
  loadYachtToy,
  stepTransport,
  transportTuning,
  yachtToyId,
  createAirEffects,
  dropToyBomb,
  stepAirEffects,
  parseAirImpact,
  AIR_EFFECT_LIMITS,
} from "../lib/transport";

const ground = () => 2;
const water = () => -6;

describe("watercraft simulation", () => {
  it.each(BOAT_TYPES)(
    "keeps the whole %s hull afloat during a long ride",
    (type) => {
      const state = createTransportState(0, 0, 0, 0);
      for (let i = 0; i < 3600; i++)
        stepTransport(
          state,
          type,
          { ...NEUTRAL, throttle: 1, steer: 0.1 },
          1 / 60,
          water,
        );
      expect(Math.hypot(state.x, state.z)).toBeLessThanOrEqual(
        SHORE_RADIUS - transportTuning(type).length / 2 - 1.99,
      );
      expect(state.y).toBeGreaterThan(-0.05);
      expect(state.y).toBeLessThan(1.2);
      expect(state.speed).toBeGreaterThan(0);
    },
  );
  it("steers toward rider-right and drops anchor without teleporting", () => {
    const state = createTransportState(0, 0, 0, 0);
    for (let i = 0; i < 120; i++)
      stepTransport(
        state,
        "boat",
        { ...NEUTRAL, throttle: 1, steer: 1 },
        1 / 60,
        water,
      );
    expect(state.x).toBeLessThan(-1);
    state.anchorDown = true;
    for (let i = 0; i < 120; i++)
      stepTransport(state, "boat", { ...NEUTRAL, throttle: 1 }, 1 / 60, water);
    expect(state.speed).toBe(0);
  });
});

describe("aircraft simulation", () => {
  it.each(AIRCRAFT_TYPES)("takes off and safely descends the %s", (type) => {
    const state = createTransportState(0, 3, 0, 0);
    for (let i = 0; i < 600; i++)
      stepTransport(state, type, { ...NEUTRAL, throttle: 1 }, 1 / 60, ground);
    expect(state.y).toBeGreaterThan(10);
    expect(canBailOut(state, 2)).toBe(true);
    state.autoTakeoff = false;
    state.climb = -1;
    for (let i = 0; i < 600; i++)
      stepTransport(state, type, NEUTRAL, 1 / 60, ground);
    expect(state.y).toBeCloseTo(2 + transportTuning(type).deckHeight);
    expect(canBailOut(state, 2)).toBe(false);
  });
  it("levels on command and completes a barrel roll without changing altitude", () => {
    const state = createTransportState(0, 70, 0, 0);
    state.speed = 30;
    state.autoTakeoff = false;
    state.rollRemaining = 0.7;
    for (let i = 0; i < 100; i++)
      stepTransport(
        state,
        "plane",
        { ...NEUTRAL, throttle: 1 },
        1 / 60,
        ground,
      );
    expect(state.rollRemaining).toBe(0);
    expect(state.roll).toBe(0);
    expect(state.y).toBeCloseTo(70);
  });
});

function yachtProgress() {
  const progress = createAdventureProgress();
  progress.fleet.yacht = {
    ...progress.fleet["starter-atv"],
    id: "yacht",
    type: "yacht",
    position: { x: SHORE_RADIUS - 25, y: 0, z: 0 },
    cargo: [],
  };
  progress.activeVehicleId = "yacht";
  return progress;
}

describe("yacht extras", () => {
  it.each(["minifishingboat", "jetski", "utv", "heli"])(
    "launches the included %s once and can load it again",
    (type) => {
      const first = launchYachtToy(yachtProgress(), "yacht", type, ground);
      expect(first.ok).toBe(true);
      if (!first.ok) throw new Error(first.message);
      expect(launchYachtToy(first.adventure, "yacht", type, ground).ok).toBe(
        false,
      );
      // Drive the launched toy back beside its parent yacht.
      first.adventure.fleet[first.vehicle.id].position = {
        ...first.adventure.fleet.yacht.position,
        x: first.adventure.fleet.yacht.position.x + 4,
      };
      const loaded = loadYachtToy(first.adventure, first.vehicle.id);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) throw new Error(loaded.message);
      expect(loaded.adventure.fleet.yacht.cargo).toContain(first.vehicle.id);
      expect(launchYachtToy(loaded.adventure, "yacht", type, ground).ok).toBe(
        true,
      );
    },
  );
  it("does not regenerate sold toys or let a UTV launch into deep water", () => {
    const progress = yachtProgress();
    progress.fleet.yacht.position = { x: 0, y: 0, z: 0 };
    expect(launchYachtToy(progress, "yacht", "utv", ground).ok).toBe(false);
    const first = launchYachtToy(progress, "yacht", "jetski", ground);
    if (!first.ok) throw new Error(first.message);
    delete first.adventure.fleet[first.vehicle.id];
    expect(launchYachtToy(first.adventure, "yacht", "jetski", ground).ok).toBe(
      false,
    );
  });
  it("requires a physical return to the yacht before loading", () => {
    const result = launchYachtToy(yachtProgress(), "yacht", "heli", ground);
    if (!result.ok) throw new Error(result.message);
    result.adventure.fleet[result.vehicle.id].position = {
      x: -1000,
      y: 50,
      z: 0,
    };
    expect(loadYachtToy(result.adventure, result.vehicle.id).ok).toBe(false);
  });
});

describe("water stunts and craft boost", () => {
  it("a moving hull launches on a big wave and settles under an anchor", () => {
    const state = createTransportState(0, 0, 0, 0);
    state.speed = 8;
    state.waveIn = 0;
    for (let i = 0; i < 20; i++)
      stepTransport(
        state,
        "boat",
        { ...NEUTRAL, throttle: 1 },
        1 / 60,
        water,
        0,
        false,
        () => 0,
      );
    expect(state.waveHeight).toBeGreaterThan(0.3);
    expect(state.y).toBeLessThan(1.2);
    state.anchorDown = true;
    for (let i = 0; i < 180; i++)
      stepTransport(state, "boat", NEUTRAL, 1 / 60, water, 0, false, () => 0);
    expect(state.waveHeight).toBe(0);
    expect(state.waveVelocity).toBe(0);
    expect(state.speed).toBe(0);
  });
  it.each(["boat", "jet"])(
    "doubles %s current speed only once per boost and returns to its cap",
    (type) => {
      const state = createTransportState(0, 70, 0, 0),
        tune = transportTuning(type);
      state.speed = tune.maxSpeed;
      state.autoTakeoff = false;
      stepTransport(
        state,
        type,
        { ...NEUTRAL, throttle: 1 },
        1 / 60,
        ground,
        0,
        true,
        () => 1,
      );
      expect(state.speed).toBe(tune.maxSpeed * 2);
      stepTransport(
        state,
        type,
        { ...NEUTRAL, throttle: 1 },
        1 / 60,
        ground,
        0,
        true,
        () => 1,
      );
      expect(state.speed).toBe(tune.maxSpeed * 2);
      for (let i = 0; i < 1200; i++)
        stepTransport(
          state,
          type,
          { ...NEUTRAL, throttle: 1 },
          1 / 60,
          ground,
          0,
          false,
          () => 1,
        );
      expect(state.speed).toBeCloseTo(tune.maxSpeed);
      expect(Math.abs(state.x)).toBeLessThanOrEqual(1950);
      expect(Math.abs(state.z)).toBeLessThanOrEqual(1950);
    },
  );
});

describe("toy bomb effects", () => {
  it("carries half the aircraft speed and delivers exactly one bounded impact", () => {
    const effects = createAirEffects(),
      impacts: unknown[] = [];
    dropToyBomb(effects, {
      x: 0,
      y: 20,
      z: 0,
      heading: Math.PI / 2,
      speed: 10,
    });
    stepAirEffects(
      effects,
      0.5,
      () => 0,
      (p) => impacts.push(p),
      () => 0.5,
    );
    expect(effects.bombs[0].x).toBeCloseTo(2.5);
    expect(impacts).toHaveLength(0);
    for (let i = 0; i < 30; i++)
      stepAirEffects(
        effects,
        0.1,
        () => 0,
        (p) => impacts.push(p),
        () => 0.5,
      );
    expect(impacts).toHaveLength(1);
    expect(impacts[0]).toMatchObject({
      y: 0,
      treeRadius: 95 / 18,
      animalRadius: 130 / 18,
    });
    expect(effects.scorches).toHaveLength(1);
    expect(effects.particles.every((p) => p.life === 0)).toBe(true);
  });
  it("cannot grow projectile, particle or scorch memory during repeated drops", () => {
    const effects = createAirEffects();
    let count = 0;
    for (let round = 0; round < 10; round++) {
      for (let i = 0; i < 100; i++)
        dropToyBomb(effects, { x: 0, y: 1, z: 0, heading: 0, speed: 5 });
      stepAirEffects(
        effects,
        1,
        () => 0,
        () => count++,
        () => 0.5,
      );
    }
    expect(count).toBe(10 * AIR_EFFECT_LIMITS.bombs);
    expect(effects.bombs).toHaveLength(AIR_EFFECT_LIMITS.bombs);
    expect(effects.particles).toHaveLength(AIR_EFFECT_LIMITS.particles);
    expect(effects.scorches).toHaveLength(AIR_EFFECT_LIMITS.scorches);
  });
  it("does not trust supplied damage radii or malformed action payloads", () => {
    expect(
      parseAirImpact('{"x":1,"y":2,"z":3,"animalRadius":10000}')?.animalRadius,
    ).toBe(130 / 18);
    expect(parseAirImpact("no")).toBeNull();
    expect(parseAirImpact('{"x":99999,"y":0,"z":0}')).toBeNull();
  });
});

describe("yacht extras save limits", () => {
  it("round-trips a toy from an80-character yacht id without an oversized ledger key", () => {
    const a = yachtProgress(),
      id = "y".repeat(80);
    a.fleet[id] = { ...a.fleet.yacht, id };
    delete a.fleet.yacht;
    a.activeVehicleId = id;
    const result = launchYachtToy(a, id, "jetski", ground);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vehicle.id).toBe(yachtToyId(id, "jetski"));
    expect(result.vehicle.id.length).toBeLessThanOrEqual(67);
    expect(adventureSchema.safeParse(result.adventure).success).toBe(true);
    result.adventure.fleet[result.vehicle.id].position = {
      ...result.adventure.fleet[id].position,
    };
    expect(loadYachtToy(result.adventure, result.vehicle.id).ok).toBe(true);
  });
  it("reserves the final fleet slot for a paid delivery instead of creating an invalid toy", () => {
    const a = yachtProgress(),
      template = a.fleet["starter-atv"];
    for (let i = Object.keys(a.fleet).length; i < MAX_FLEET_VEHICLES - 1; i++) {
      const id = `extra-${i}`;
      a.fleet[id] = { ...template, id };
    }
    a.delivery = {
      id: "order-1",
      offerId: "anyStore:truck",
      remainingSeconds: 20,
    };
    const before = structuredClone(a),
      result = launchYachtToy(a, "yacht", "jetski", ground);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("fleet");
    expect(a).toEqual(before);
  });
});
