import { fitCanvas, type CanvasFit } from "@/shared/hooks/usePlayBox";

import { CANVAS_HEIGHT, CANVAS_WIDTH } from "./constants";

/**
 * The layout of the Asteroids screen inside the GameShell play box.
 *
 * Why: the canvas used to take its scale from its own container's height
 * (a content-sized box), so on a phone held sideways it was 554 px tall on
 * a 271 px box, the ship spawned under the fold and the pad sat 350 px
 * under the screen (phone UX audit 2026-09-29). Now the canvas fits the
 * play box on both axes, and the pad goes where the thumbs are:
 *
 * - Upright (the box is taller than wide): the stats line above the
 *   canvas, the pad in one row under it.
 * - Sideways (the box is wider than tall): the pad in the two gutters
 *   beside the canvas. Turn left and turn right under the left thumb,
 *   thrust and fire under the right thumb. The stats and the sound switch
 *   sit under the buttons in the gutters, so the canvas gets the whole
 *   height of the box.
 */

/** The width and height of a turn button, in CSS px. */
export const TURN_BUTTON_PX = 64;
/** The width and height of an action button (thrust, fire): bigger than a turn. */
export const ACTION_BUTTON_PX = 72;
/** The room between two pad buttons. */
export const PAD_GAP_PX = 8;
/** The stats line above the canvas when upright (High, Best Wave, the sound switch). */
export const STATS_ROW_PX = 44;
/** The room around the canvas, on each side. */
export const EDGE_PX = 8;
/** The largest scale: a 500 px field is never drawn wider than 750 px. */
export const MAX_SCALE = 1.5;

/** One gutter beside the canvas when sideways: the widest pad (two action buttons) plus the gap to the canvas. */
export const GUTTER_PX = ACTION_BUTTON_PX * 2 + PAD_GAP_PX * 2;

export interface AsteroidsLayout {
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

export function asteroidsLayout(box: { width: number; height: number }): AsteroidsLayout {
  const sideways = box.width > box.height;
  if (sideways) {
    // The pad, the stats and the sound switch live in the gutters, so
    // only the edge room comes off the height.
    const fit = fitCanvas(
      { width: box.width - EDGE_PX * 2, height: box.height - EDGE_PX * 2 },
      CANVAS_WIDTH,
      CANVAS_HEIGHT,
      { width: GUTTER_PX * 2 }
    );
    return { sideways, canvas: capped(fit) };
  }
  const fit = fitCanvas(
    { width: box.width - EDGE_PX * 2, height: box.height - EDGE_PX * 2 },
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
    { height: STATS_ROW_PX + ACTION_BUTTON_PX + PAD_GAP_PX * 2 }
  );
  return { sideways, canvas: capped(fit) };
}
