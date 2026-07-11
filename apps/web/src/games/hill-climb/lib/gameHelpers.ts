/**
 * Hill Climb Racing - pure game-loop helpers
 *
 * Small, side-effect-free functions used by Game.tsx. Kept here so they
 * can be unit tested without spinning up a canvas or Matter.js.
 */

/**
 * Maximum per-frame delta time (seconds) the game loop may act on.
 *
 * A throttled / slow first frame (e.g. a phone still loading) can hand the
 * loop a delta of a second or more. Un-clamped, that single huge step spikes
 * the physics (the truck jumped to 130 km/h on frame 1 and insta-crashed).
 * Clamping to 50ms keeps one stalled frame from exploding the simulation.
 */
export const MAX_DELTA_TIME = 0.05;

/**
 * Clamp a raw per-frame delta time (seconds) to a sane maximum so one huge
 * frame gap can't blow up the physics. Negative/NaN deltas collapse to 0.
 */
export function clampDeltaTime(deltaSeconds: number, max: number = MAX_DELTA_TIME): number {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) return 0;
  return Math.min(deltaSeconds, max);
}

/**
 * Controls legend for the start screen. Touch viewports get finger-friendly
 * copy; keyboard viewports get the key legend. Coarse pointer = touchscreen.
 */
export function getControlsCopy(isCoarsePointer: boolean): string {
  return isCoarsePointer
    ? 'Hold the green pedal to GO, red to brake. Drag up or down on a pedal to lean!'
    : 'D/→ Gas | A/← Brake | W/↑ Lean Back | S/↓ Lean Forward | Space Nitro';
}
