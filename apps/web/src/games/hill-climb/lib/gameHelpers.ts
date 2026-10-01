/**
 * Hill Climb Racing - pure game-loop helpers
 *
 * Small, side-effect-free functions used by Game.tsx. Kept here so they
 * can be unit tested without spinning up a canvas or Matter.js.
 */

import { CAMERA } from './constants';

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

/** Where the camera looks, for a canvas of this size (CSS px). */
export type CameraOffsets = {
  /** The camera centre is this far ahead of the chassis, so the truck sits left of centre. */
  lookAhead: number;
  /** The camera centre is this far above the chassis (a negative y offset). */
  verticalOffset: number;
};

/**
 * The camera offsets for a canvas of this size.
 *
 * The look-ahead is 22% of the width, and 200 px at most: the truck is
 * drawn at 28% of the width on a phone (a fixed 200 px put it at x = -12
 * on a 375 px canvas). The vertical offset is 12% of the height: the
 * chassis sits at 62% of the height, so the wheels and the ground under
 * them are on screen at every size (a fixed 100 px put the chassis at 82%
 * of a 311 px canvas, with the wheels under the screen).
 */
export function cameraOffsets(width: number, height: number): CameraOffsets {
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const h = Number.isFinite(height) && height > 0 ? height : 0;
  return {
    lookAhead: Math.min(CAMERA.LOOK_AHEAD_MAX, w * CAMERA.LOOK_AHEAD_SHARE),
    verticalOffset: -(h * CAMERA.VERTICAL_SHARE),
  };
}

/** The words of the result, read aloud and shown over the crash. */
export function resultText(input: {
  reason: 'head' | 'fuel' | null;
  distance: number;
  coins: number;
  flips: number;
  newRecord: boolean;
}): string {
  const what = input.reason === 'fuel' ? 'Out of fuel!' : 'You crashed!';
  const parts = [`${what} You drove ${Math.floor(input.distance)} meters and got ${input.coins} coins.`];
  if (input.flips > 0) parts.push(`${input.flips} ${input.flips === 1 ? 'flip' : 'flips'}!`);
  if (input.newRecord) parts.push('That is a new record!');
  return parts.join(' ');
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
