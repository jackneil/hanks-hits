import { describe, it, expect } from "vitest";

import {
  combine,
  NEUTRAL_TOUCH,
  reduceKeyboard,
  reduceTouch,
  steerFromGamma,
  TILT_FULL_DEGREES,
  type TouchState,
} from "../lib/controls";

const keys = (...codes: string[]) => new Set(codes);
const touch = (partial: Partial<TouchState>): TouchState => ({
  ...NEUTRAL_TOUCH,
  ...partial,
});

describe("keyboard and touch agree", () => {
  it("reads W the same way it reads the GAS pedal", () => {
    expect(reduceKeyboard(keys("KeyW")).throttle).toBe(1);
    expect(reduceTouch(touch({ gas: true })).throttle).toBe(1);
  });

  it("reads A the same way it reads the LEFT arrow button", () => {
    expect(reduceKeyboard(keys("KeyA")).steer).toBe(-1);
    expect(reduceTouch(touch({ left: true })).steer).toBe(-1);
    expect(reduceKeyboard(keys("KeyD")).steer).toBe(1);
    expect(reduceTouch(touch({ right: true })).steer).toBe(1);
  });

  it("uses the arrow keys as well as the letters", () => {
    expect(reduceKeyboard(keys("ArrowUp")).throttle).toBe(1);
    expect(reduceKeyboard(keys("ArrowDown")).throttle).toBe(-1);
    expect(reduceKeyboard(keys("ArrowLeft")).steer).toBe(-1);
    expect(reduceKeyboard(keys("ArrowRight")).steer).toBe(1);
  });

  it("maps every other key to its job", () => {
    expect(reduceKeyboard(keys("Space")).jump).toBe(true);
    expect(reduceKeyboard(keys("ShiftLeft")).handbrake).toBe(true);
    expect(reduceKeyboard(keys("KeyX")).handbrake).toBe(true);
    expect(reduceKeyboard(keys("KeyH")).horn).toBe(true);
    expect(reduceKeyboard(keys("KeyR")).reset).toBe(true);
    expect(reduceKeyboard(keys("KeyC")).camera).toBe(true);
    expect(reduceKeyboard(keys("KeyE")).interact).toBe(true);
    expect(reduceKeyboard(keys("KeyN")).nos).toBe(true);
  });

  it("holds still when nothing is pressed", () => {
    const idle = reduceKeyboard(keys());
    expect(idle.throttle).toBe(0);
    expect(idle.steer).toBe(0);
    expect(idle.jump).toBe(false);
  });

  it("lets the brake pedal be held at the same time as the gas", () => {
    const both = reduceTouch(touch({ gas: true, brake: true }));
    expect(both.throttle).toBe(1);
    expect(both.brake).toBe(1);
  });
});

describe("tilt steering", () => {
  it("turns a 20 degree roll to the right into a full right turn", () => {
    expect(TILT_FULL_DEGREES).toBe(20);
    expect(steerFromGamma(20)).toBe(1);
    expect(steerFromGamma(-20)).toBe(-1);
    expect(steerFromGamma(10)).toBeCloseTo(0.5, 6);
    expect(steerFromGamma(0)).toBe(0);
  });

  it("never steers harder than all the way, however far the phone rolls", () => {
    expect(steerFromGamma(90)).toBe(1);
    expect(steerFromGamma(-90)).toBe(-1);
  });

  it("steers by tilt when no arrow is held", () => {
    expect(reduceTouch(touch({ steerAxis: 0.8 })).steer).toBeCloseTo(0.8, 6);
  });

  it("takes the bigger push when an arrow and a tilt disagree", () => {
    // A held arrow is a full push, so it beats a gentle lean.
    expect(reduceTouch(touch({ left: true, steerAxis: 0.3 })).steer).toBe(-1);
  });
});

describe("combining both hands", () => {
  it("takes the stronger steer", () => {
    const keyboard = reduceKeyboard(keys("KeyA"));
    const gentle = reduceTouch(touch({ steerAxis: 0.3 }));
    expect(combine(keyboard, gentle).steer).toBe(-1);

    const idle = reduceKeyboard(keys());
    expect(combine(idle, gentle).steer).toBeCloseTo(0.3, 6);
  });

  it("takes the stronger throttle", () => {
    expect(combine(reduceKeyboard(keys("KeyW")), reduceTouch(NEUTRAL_TOUCH)).throttle).toBe(1);
    expect(combine(reduceKeyboard(keys()), reduceTouch(touch({ gas: true }))).throttle).toBe(1);
    expect(combine(reduceKeyboard(keys("KeyS")), reduceTouch(NEUTRAL_TOUCH)).throttle).toBe(-1);
  });

  it("honks when either hand honks", () => {
    expect(combine(reduceKeyboard(keys("KeyH")), reduceTouch(NEUTRAL_TOUCH)).horn).toBe(true);
    expect(combine(reduceKeyboard(keys()), reduceTouch(touch({ horn: true }))).horn).toBe(true);
    expect(combine(reduceKeyboard(keys()), reduceTouch(NEUTRAL_TOUCH)).horn).toBe(false);
  });

  it("jumps when either hand jumps", () => {
    expect(combine(reduceKeyboard(keys("Space")), reduceTouch(NEUTRAL_TOUCH)).jump).toBe(true);
    expect(combine(reduceKeyboard(keys()), reduceTouch(touch({ jump: true }))).jump).toBe(true);
  });
});
