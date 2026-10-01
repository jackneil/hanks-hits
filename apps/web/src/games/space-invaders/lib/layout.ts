import { fitCanvas, type CanvasFit } from "@/shared/hooks/usePlayBox";

import { CANVAS_HEIGHT, CANVAS_WIDTH } from "./constants";

/**
 * The layout of the Space Invaders screen inside the GameShell play box.
 *
 * Why: the canvas sat in a 60vh box and took 100 px off that box for
 * controls that were then drawn below it anyway, so on a phone upright it
 * was a 172x229 px stamp (19% of the screen) with 5.7 px HUD text, and
 * sideways a 65x87 px stamp with the pad under the fold (phone UX audit
 * 2026-09-29). Now the canvas fits the play box on both axes, the HUD is
 * DOM text (readable at any scale), and the pad goes where the thumbs are:
 *
 * - Upright: the HUD line above the canvas, the pad in one row under it
 *   (Move left and Move right under the left thumb, FIRE under the right).
 * - Sideways: the pad in the two gutters beside the canvas (the arrows on
 *   the left, FIRE on the right), with the HUD under the arrows and the
 *   sound switch under FIRE, so the canvas gets the whole height.
 */

/** The width and height of a move button, in CSS px. */
export const MOVE_BUTTON_PX = 64;
/** The width and height of the FIRE button: bigger than a move. */
export const FIRE_BUTTON_PX = 80;
/** The room between two pad buttons. */
export const PAD_GAP_PX = 8;
/** The HUD line above the canvas when upright (score, best, lives, wave, the sound switch). */
export const HUD_ROW_PX = 44;
/** The room around the canvas, on each side. */
export const EDGE_PX = 8;
/** The largest scale: a 480 px field is never drawn wider than 720 px. */
export const MAX_SCALE = 1.5;

/** One gutter beside the canvas when sideways: the widest pad (two move buttons) plus the gap to the canvas. */
export const GUTTER_PX = Math.max(MOVE_BUTTON_PX * 2 + PAD_GAP_PX, FIRE_BUTTON_PX) + PAD_GAP_PX;

export interface SpaceInvadersLayout {
  /** The box is wider than tall: the pad sits in the gutters beside the canvas. */
  sideways: boolean;
  /** The size of the canvas on screen. */
  canvas: CanvasFit;
}

function capped(fit: CanvasFit): CanvasFit {
  if (fit.scale <= MAX_SCALE) return fit;
  return {
    scale: MAX_SCALE,
    width: Math.round(CANVAS_WIDTH * MAX_SCALE),
    height: Math.round(CANVAS_HEIGHT * MAX_SCALE),
  };
}

export function spaceInvadersLayout(box: { width: number; height: number }): SpaceInvadersLayout {
  const sideways = box.width > box.height;
  const room = { width: box.width - EDGE_PX * 2, height: box.height - EDGE_PX * 2 };
  if (sideways) {
    return { sideways, canvas: capped(fitCanvas(room, CANVAS_WIDTH, CANVAS_HEIGHT, { width: GUTTER_PX * 2 })) };
  }
  return {
    sideways,
    canvas: capped(fitCanvas(room, CANVAS_WIDTH, CANVAS_HEIGHT, { height: HUD_ROW_PX + FIRE_BUTTON_PX + PAD_GAP_PX * 2 })),
  };
}
