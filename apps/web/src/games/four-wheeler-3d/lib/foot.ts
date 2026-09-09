import type { ControlValues } from "./controls";
import { FOOT_SPEEDS } from "./vehicles";

export const PLAYER_HALF_HEIGHT = 0.8;
export const SWIM_FOOT_HEIGHT = -0.55;
export type FootState = {
  heading: number;
  verticalVelocity: number;
  grounded: boolean;
};
export type FootEnvironment = {
  swimming: boolean;
  parachute: boolean;
  stationary: boolean;
};
export type FootMovement = { x: number; y: number; z: number };

/** The same rider-right convention as the quad: looking along +Z, right is -X. */
export function footMovement(
  state: FootState,
  controls: ControlValues,
  jump: boolean,
  dt: number,
  environment: FootEnvironment,
  out: FootMovement,
): void {
  state.heading -= Math.max(-1, Math.min(1, controls.steer)) * 2.4 * dt;
  state.heading = Math.atan2(Math.sin(state.heading), Math.cos(state.heading));
  const speed = environment.stationary
    ? 0
    : environment.swimming
      ? 1.8
      : controls.handbrake
        ? FOOT_SPEEDS.run
        : FOOT_SPEEDS.walk;
  const throttle = Math.max(-1, Math.min(1, controls.throttle));
  out.x = Math.sin(state.heading) * speed * throttle * dt;
  out.z = Math.cos(state.heading) * speed * throttle * dt;
  if (environment.stationary) {
    state.verticalVelocity = 0;
  } else if (jump && state.grounded && !environment.swimming) {
    state.verticalVelocity = 5.5;
    state.grounded = false;
  } else if (state.grounded && state.verticalVelocity < 0) {
    state.verticalVelocity = -1;
  } else {
    state.verticalVelocity = Math.max(
      environment.parachute ? -3 : -25,
      state.verticalVelocity - 16 * dt,
    );
  }
  out.y = state.verticalVelocity * dt;
}

/** Buoyancy replaces the lake bed as the support height, keeping the head above water. */
export function footSupportHeight(terrainHeight: number): number {
  return Math.max(terrainHeight, SWIM_FOOT_HEIGHT);
}

/** A distance-based gait keeps feet still when blocked and works at any frame rate. */
export function gaitAngle(distance: number, moving: number, phase = 0): number {
  return Math.sin(distance * 8 + phase) * 0.55 * Math.min(1, moving / 3);
}
