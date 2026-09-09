import { describe, it, expect } from "vitest";

import {
  CHASE_DEFAULTS,
  chaseTarget,
  criticalDamping,
  FOV_MAX,
  FOV_MIN,
  fovForSpeed,
  shakeOffset,
  springStep,
  type SpringState,
  type Vec3,
} from "../lib/camera";

const vec = (): Vec3 => ({ x: 0, y: 0, z: 0 });
const NO_TURN = { x: 0, y: 0, z: 0, w: 1 };
/** A half turn about the up axis, so the vehicle faces the other way. */
const HALF_TURN = { x: 0, y: 1, z: 0, w: 0 };

describe("chase target", () => {
  it("sits behind and above a vehicle facing forward", () => {
    const out = chaseTarget(
      { x: 0, y: 0, z: 0 },
      NO_TURN,
      CHASE_DEFAULTS,
      vec(),
    );
    expect(out.x).toBeCloseTo(0, 6);
    expect(out.y).toBeCloseTo(2.2, 6);
    expect(out.z).toBeCloseTo(-5, 6);
  });

  it("swings around with the vehicle", () => {
    const out = chaseTarget(
      { x: 0, y: 0, z: 0 },
      HALF_TURN,
      CHASE_DEFAULTS,
      vec(),
    );
    expect(out.z).toBeCloseTo(5, 6);
    expect(out.y).toBeCloseTo(2.2, 6);
  });

  it("follows the vehicle wherever it is", () => {
    const out = chaseTarget(
      { x: 12, y: 3, z: -7 },
      NO_TURN,
      CHASE_DEFAULTS,
      vec(),
    );
    expect(out.x).toBeCloseTo(12, 6);
    expect(out.y).toBeCloseTo(5.2, 6);
    expect(out.z).toBeCloseTo(-12, 6);
  });
});

describe("the follow spring", () => {
  it("settles on the target without overshooting it", () => {
    const state: SpringState = { value: 0, velocity: 0 };
    const target = 10;
    let previous = state.value;
    for (let step = 0; step < 240; step += 1) {
      const value = springStep(state, target, 1 / 60, { stiffness: 90 });
      // It only ever moves toward the target.
      expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
      // And it never sails past it by even one percent.
      expect(value).toBeLessThanOrEqual(target * 1.01);
      previous = value;
    }
    expect(state.value).toBeCloseTo(target, 3);
  });

  it("settles from a long frame the same way it settles from a short one", () => {
    const slow: SpringState = { value: 0, velocity: 0 };
    for (let step = 0; step < 40; step += 1) {
      const value = springStep(slow, 10, 0.1, { stiffness: 90 });
      expect(value).toBeLessThanOrEqual(10.1);
    }
    expect(slow.value).toBeCloseTo(10, 3);
  });

  it("uses critical damping when no damping is given", () => {
    expect(criticalDamping(100)).toBeCloseTo(20, 6);
  });
});

describe("the view widens with speed", () => {
  it("is narrow standing still and wide flat out", () => {
    expect(fovForSpeed(0, 21.888)).toBe(FOV_MIN);
    expect(fovForSpeed(21.888, 21.888)).toBe(FOV_MAX);
    expect(fovForSpeed(10.944, 21.888)).toBeCloseTo(67.5, 6);
  });

  it("never goes past its ends, forward or backward", () => {
    expect(fovForSpeed(100, 21.888)).toBe(FOV_MAX);
    expect(fovForSpeed(-21.888, 21.888)).toBe(FOV_MAX);
    expect(fovForSpeed(5, 0)).toBe(FOV_MIN);
  });
});

describe("the landing shake", () => {
  it("is gone within six tenths of a second", () => {
    const out = shakeOffset(0.6, 1, vec());
    expect(Math.abs(out.x)).toBeLessThan(0.01);
    expect(Math.abs(out.y)).toBeLessThan(0.01);
  });

  it("fades the whole way down and never grows", () => {
    let biggest = 0;
    for (let step = 1; step <= 60; step += 1) {
      const time = step / 100;
      const out = shakeOffset(time, 1, vec());
      const size = Math.max(Math.abs(out.x), Math.abs(out.y));
      if (time > 0.05) expect(size).toBeLessThanOrEqual(biggest + 1e-9);
      biggest = Math.max(biggest, size);
    }
  });

  it("shakes harder for a bigger landing", () => {
    const small = shakeOffset(0.02, 0.1, vec());
    const big = shakeOffset(0.02, 0.4, vec());
    expect(Math.abs(big.x)).toBeGreaterThan(Math.abs(small.x));
  });
});
