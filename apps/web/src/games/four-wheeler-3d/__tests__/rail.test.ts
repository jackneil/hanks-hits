import { describe, expect, it } from "vitest";
import {
  RAIL_TRACKS,
  RAIL_MAX_SPEED,
  createRailSession,
  boardTrain,
  gapHeight,
  railPose,
  routeTrain,
  sampleTrack,
  stepTrain,
  toggleSkyTrack,
  type RailSession,
  type RailStop,
} from "../lib/rail";
import { buyOffer } from "../lib/economy";
import { createAdventureProgress } from "../lib/adventureTypes";

function arrive(state: RailSession, target: RailStop) {
  let next = routeTrain(state, target);
  for (let i = 0; i < 12000 && next.target; i++)
    next = stepTrain(next, 0, 0, 0.1);
  return next;
}
describe("railway routes", () => {
  it("requires exactly $110,000 once to own the train", () => {
    const p = {
        money: 109999,
        totalEarned: 0,
        ownedVehicles: ["atv"],
        adventure: createAdventureProgress(),
      },
      at = { x: -448, y: 0, z: -44 };
    expect(buyOffer(p, "anyStore:train", at).ok).toBe(false);
    expect(p.adventure.trainOwned).toBe(false);
    const bought = buyOffer({ ...p, money: 110000 }, "anyStore:train", at);
    expect(bought.ok).toBe(true);
    if (bought.ok) {
      expect(bought.patch.money).toBe(0);
      expect(bought.patch.adventure.trainOwned).toBe(true);
      expect(
        buyOffer({ ...p, ...bought.patch, money: 110000 }, "anyStore:train", at)
          .ok,
      ).toBe(false);
    }
  });
  it("builds all original paths and a joined home spur", () => {
    expect(RAIL_TRACKS.loop.points).toHaveLength(1200);
    expect(RAIL_TRACKS.spur.points).toHaveLength(321);
    expect(RAIL_TRACKS.sky.points).toHaveLength(1500);
    const west = sampleTrack(RAIL_TRACKS.loop, RAIL_TRACKS.loop.length * 0.75),
      junction = sampleTrack(RAIL_TRACKS.spur, 0);
    expect(Math.hypot(west.x - junction.x, west.z - junction.z)).toBeLessThan(
      0.01,
    );
  });
  it("samples exact open endpoints without wrapping back one segment", () => {
    expect(
      sampleTrack(RAIL_TRACKS.spur, RAIL_TRACKS.spur.length),
    ).toMatchObject({ x: -503, z: 0 });
    expect(sampleTrack(RAIL_TRACKS.spur, -100).x).toBe(-1992);
  });
  it("starts the consist at home with space for its carriages", () => {
    const s = createRailSession();
    expect(s.path).toBe("spur");
    expect(s.position.x).toBeCloseTo(-520.2);
    expect(s.speed).toBe(0);
  });
  it.each(["south", "east", "north", "west", "fence"] as const)(
    "routes from home to %s and stops at the platform",
    (target) => {
      const s = arrive(createRailSession(), target);
      expect(s.target).toBeNull();
      expect(s.speed).toBe(0);
      if (target === "fence") {
        expect(s.path).toBe("spur");
        expect(s.position.x).toBe(-503);
      } else {
        expect(s.path).toBe("loop");
        expect(s.distance).toBeCloseTo(
          (RAIL_TRACKS.loop.length *
            ["south", "east", "north", "west"].indexOf(target)) /
            4,
        );
      }
    },
  );
  it("returns from the far side through the west junction to home", () => {
    const east = arrive(createRailSession(), "east");
    let s = routeTrain(east, "fence", true);
    for (let i = 0; i < 12000 && s.target; i++) s = stepTrain(s, 0, 0, 0.1);
    expect(s.path).toBe("spur");
    expect(s.position.x).toBe(-503);
    expect(s.returning).toBe(false);
    expect(s.speed).toBe(0);
  });
  it("has four jump arcs and a low sky-track entrance", () => {
    for (const f of [0.12, 0.37, 0.63, 0.88])
      expect(gapHeight(RAIL_TRACKS.loop.length * f)).toBeCloseTo(80 / 18);
    expect(gapHeight(0)).toBe(0);
    expect(RAIL_TRACKS.sky.points[0].y).toBeCloseTo(12 / 18);
    expect(RAIL_TRACKS.sky.points[100].y).toBeCloseTo(340 / 18);
  });
  it("clears routes when switching into the sky and can return from there", () => {
    const sky = toggleSkyTrack(routeTrain(createRailSession(), "east"));
    expect(sky.path).toBe("sky");
    expect(sky.target).toBeNull();
    const home = arrive(sky, "fence");
    expect(home.position.x).toBe(-503);
    expect(home.target).toBeNull();
  });
  it("integrates controls and brakes without exceeding the cap or overshooting stops", () => {
    let s = createRailSession();
    for (let i = 0; i < 1000; i++) s = stepTrain(s, 1, 0, 0.1);
    expect(s.speed).toBe(RAIL_MAX_SPEED);
    s = {
      ...s,
      path: "loop",
      distance: RAIL_TRACKS.loop.length * 0.25 - 0.05,
      speed: 360,
      direction: 1,
    };
    s = stepTrain(routeTrain(s, "east"), 1, 0, 0.1);
    expect(s.target).toBeNull();
    expect(s.speed).toBe(0);
    expect(railPose(s).x).toBeCloseTo(1992);
    expect(stepTrain({ ...s, speed: 1 }, 0, 1, 0.1).speed).toBe(0);
  });
});

describe("train boarding and boost", () => {
  it("departs the Fence terminal on manual gas after returning home", () => {
    const returned = arrive(createRailSession(), "fence");
    expect(returned.direction).toBe(1);
    let boarded = boardTrain(returned);
    expect(boarded.direction).toBe(-1);
    for (let i = 0; i < 60; i++) boarded = stepTrain(boarded, 1, 0, 1 / 60);
    expect(boarded.distance).toBeLessThan(returned.distance - 10);
    expect(boarded.speed).toBeGreaterThan(20);
    expect(boarded.target).toBeNull();
  });
  it("keeps the current heading when boarding away from a terminal", () => {
    const state = { ...createRailSession(), direction: 1 as const, speed: 30 };
    const boarded = boardTrain(state);
    expect(boarded.direction).toBe(1);
    expect(boarded.speed).toBe(0);
    expect(boarded.distance).toBe(state.distance);
  });
  it("allows boost above the regular cap then restores the regular cap", () => {
    const state = {
      ...createRailSession(),
      path: "loop" as const,
      distance: 500,
      speed: RAIL_MAX_SPEED,
    };
    let boosted: RailSession = state;
    for (let i = 0; i < 30; i++) boosted = stepTrain(boosted, 1, 0, 0.1, true);
    expect(boosted.speed).toBeGreaterThan(RAIL_MAX_SPEED);
    expect(boosted.speed).toBeLessThanOrEqual(RAIL_MAX_SPEED * 2);
    expect(stepTrain(boosted, 1, 0, 0.1, false).speed).toBe(RAIL_MAX_SPEED);
  });
});
