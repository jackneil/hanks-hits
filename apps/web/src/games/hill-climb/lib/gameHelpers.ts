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

/** The kid-level control hints shown on the start overlay. */
export type ControlsCopy = {
  /** Hints for a touchscreen (coarse pointer). */
  touch: string[];
  /** Hints for a keyboard/mouse viewport. */
  keyboard: string[];
};

/**
 * Controls legend for the start screen. This is the single source of the
 * hint copy: Game.tsx passes these lines straight to GameStartOverlay,
 * which picks the touch set on a coarse-pointer (touchscreen) viewport and
 * the keyboard set everywhere else.
 */
export function getControlsCopy(): ControlsCopy {
  return {
    touch: [
      '🦶 Tap the right side to go',
      '🛑 Tap the left side to stop',
      '🤸 Drag up to lean the truck',
      '⚡ Tap NITRO for a big boost',
    ],
    keyboard: [
      '🦶 Press D or the right arrow to go',
      '🛑 Press A or the left arrow to stop',
      '🤸 Press W and S to lean',
      '⚡ Press the space bar for nitro',
      '🔄 Press R to flip back over',
    ],
  };
}
