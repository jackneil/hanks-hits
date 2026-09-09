import { describe, expect, it } from "vitest";
import { NEUTRAL } from "../lib/controls";
import {
  footMovement,
  footSupportHeight,
  gaitAngle,
  type FootState,
} from "../lib/foot";

const land = { swimming: false, parachute: false, stationary: false };
function state(): FootState {
  return { heading: 0, verticalVelocity: 0, grounded: true };
}
function walk(seconds: number, hz: number, input = {}) {
  const actor = state();
  const movement = { x: 0, y: 0, z: 0 };
  const position = { x: 0, z: 0 };
  for (let i = 0; i < seconds * hz; i++) {
    footMovement(
      actor,
      { ...NEUTRAL, throttle: 1, ...input },
      false,
      1 / hz,
      land,
      movement,
    );
    position.x += movement.x;
    position.z += movement.z;
  }
  return { actor, position };
}

describe("walking movement", () => {
  it("walks at 3m/s and runs at 5m/s", () => {
    expect(walk(2, 60).position.z).toBeCloseTo(6);
    expect(walk(2, 60, { handbrake: true }).position.z).toBeCloseTo(10);
    expect(walk(2, 60, { throttle: -1 }).position.z).toBeCloseTo(-6);
  });
  it("turns right toward rider-right, with the same sign as driving", () => {
    const right = walk(0.5, 60, { steer: 1 });
    const left = walk(0.5, 60, { steer: -1 });
    expect(right.position.x).toBeLessThan(-0.5);
    expect(right.actor.heading).toBeLessThan(0);
    expect(left.position.x).toBeCloseTo(-right.position.x);
  });
  it("keeps travel speed and turn rate independent of frame rate", () => {
    expect(walk(2, 30).position.z).toBeCloseTo(walk(2, 120).position.z);
    expect(walk(2, 30, { steer: 1 }).actor.heading).toBeCloseTo(
      walk(2, 120, { steer: 1 }).actor.heading,
    );
  });
  it("jumps from the ground without allowing a midair second jump", () => {
    const actor = state();
    const movement = { x: 0, y: 0, z: 0 };
    footMovement(actor, NEUTRAL, true, 1 / 60, land, movement);
    expect(actor.verticalVelocity).toBe(5.5);
    expect(actor.grounded).toBe(false);
    footMovement(actor, NEUTRAL, true, 1 / 60, land, movement);
    expect(actor.verticalVelocity).toBeLessThan(5.5);
    expect(movement.y).toBeGreaterThan(0);
  });
  it("supports lake swimming and keeps the head above deep water", () => {
    expect(footSupportHeight(-6)).toBe(-0.55);
    expect(footSupportHeight(8)).toBe(8);
    const actor = state();
    const movement = { x: 0, y: 0, z: 0 };
    footMovement(
      actor,
      { ...NEUTRAL, throttle: 1, handbrake: true },
      true,
      1,
      { ...land, swimming: true },
      movement,
    );
    expect(movement.z).toBe(1.8);
    expect(actor.verticalVelocity).toBeLessThanOrEqual(0);
  });
  it("caps parachute descent and keeps stand/deck occupants in place", () => {
    const actor = { ...state(), grounded: false, verticalVelocity: -20 };
    const movement = { x: 0, y: 0, z: 0 };
    footMovement(
      actor,
      NEUTRAL,
      false,
      1 / 60,
      { ...land, parachute: true },
      movement,
    );
    expect(actor.verticalVelocity).toBe(-3);
    footMovement(
      actor,
      { ...NEUTRAL, throttle: 1, steer: 1 },
      true,
      1 / 60,
      { ...land, stationary: true },
      movement,
    );
    expect(Math.hypot(movement.x, movement.y, movement.z)).toBe(0);
    expect(actor.heading).toBeLessThan(0);
  });
  it("stops the gait when a collider prevents walking", () => {
    expect(gaitAngle(0.6, 0)).toBeCloseTo(0);
    expect(gaitAngle(0.6, 3)).toBeCloseTo(-gaitAngle(0.6, 3, Math.PI));
  });
});
