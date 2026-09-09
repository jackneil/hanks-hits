import { describe, it, expect } from "vitest";
import { NEUTRAL_TOUCH, reduceTouch } from "../lib/controls";
import {
  createSpaceSession,
  landOnPlanet,
  leavePlanet,
  stepSpace,
} from "../lib/space";

describe("touch input reaches space movement", () => {
  it.each([
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ])("walks in surface direction %s,%s", (x, z) => {
    const touch = {
      ...NEUTRAL_TOUCH,
      left: x < 0,
      right: x > 0,
      gas: z < 0,
      brake: z > 0,
    };
    const before = landOnPlanet("mars"),
      after = stepSpace(before, [], reduceTouch(touch), 0.05).state;
    expect(Math.sign(after.x - before.x)).toBe(x);
    expect(Math.sign(after.z - before.z)).toBe(z);
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeCloseTo(1.5);
  });
  it("can walk from the landing point to the rocket and leave using touch", () => {
    let state = landOnPlanet("moon");
    expect(leavePlanet(state)).toBeNull();
    const down = reduceTouch({ ...NEUTRAL_TOUCH, brake: true });
    for (let i = 0; i < 5; i++)
      state = stepSpace(state, [], down, 1 / 60).state;
    expect(state.nearRocket).toBe(true);
    expect(leavePlanet(state)?.phase).toBe("flight");
  });
  it("turns, accelerates and brakes the rocket through existing touch reducers", () => {
    const state = createSpaceSession();
    const thrust = stepSpace(
      state,
      [],
      reduceTouch({ ...NEUTRAL_TOUCH, gas: true, right: true }),
      0.05,
    ).state;
    expect(thrust.heading).toBeLessThan(state.heading);
    expect(thrust.speed).toBeGreaterThan(state.speed);
    const braking = stepSpace(
      thrust,
      [],
      reduceTouch({ ...NEUTRAL_TOUCH, brake: true }),
      0.05,
    ).state;
    expect(braking.speed).toBeLessThan(thrust.speed);
  });
});
