/**
 * Hill Climb Racing - pure game-loop helpers
 *
 * Small, side-effect-free functions used by Game.tsx. Kept here so they
 * can be unit tested without spinning up a canvas or Matter.js.
 */

/**
 * Maximum per-frame delta time (seconds) the game loop may act on.
 *
 * NOTE: vehicle physics is NOT the consumer - Matter.Runner steps the physics
 * engine on its own internal timestep, and wheel/lean torques are velocity-
 * capped, so a big render-loop dt cannot spike the truck's speed. What this
 * dt DOES multiply is the game-loop accumulators: fuel drain, nitro
 * drain/refill, airtime accrual (which gates bonus coins + landing shake),
 * and particle motion. Un-clamped, one stalled 1s+ frame (slow phone, tab
 * backgrounded) over-drains fuel/nitro and falsely credits an airtime bonus.
 * Clamping to 50ms keeps one huge frame from distorting those.
 */
export const MAX_DELTA_TIME = 0.05;

/**
 * Clamp a raw per-frame delta time (seconds) so one huge frame gap can't
 * distort the dt-driven accumulators (fuel, nitro, airtime, particles).
 * Negative/NaN deltas collapse to 0.
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
    ? 'Hold the green pedal to GO, red to brake. Drag up on a pedal to lean!'
    : 'D/→ Gas | A/← Brake | W/↑ Lean Back | S/↓ Lean Forward | Space Nitro';
}
