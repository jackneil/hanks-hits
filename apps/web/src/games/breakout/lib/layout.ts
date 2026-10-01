import { fitCanvas, type CanvasFit } from "@/shared/hooks/usePlayBox";

import { CANVAS_HEIGHT, CANVAS_WIDTH } from "./constants";

/**
 * The layout of the Breakout screen inside the GameShell play box.
 *
 * Why: the canvas box was `w-full max-w-lg` with an aspect ratio, so its
 * height followed its width: on a phone held sideways it was 683 px tall
 * on a 271 px box and the paddle sat 400 px under the fold (phone UX audit
 * 2026-09-29). Now the canvas fits the play box on both axes:
 *
 * - Upright: the HUD line above the canvas (score, level, lives, the
 *   sound switch), the canvas under it.
 * - Sideways: the HUD in a column beside the canvas, so the canvas gets
 *   the whole height. The paddle follows a finger anywhere on the screen
 *   (a relative drag), so the room beside the canvas is play room too.
 *
 * The field is 3:4. Upright it is 325x433 at 375x549; sideways 191x255 at
 * 667x311. The game declares preferredOrientation "portrait": upright is
 * twice the size, and the tip says so once.
 */

/** The HUD line above the canvas when upright. */
export const HUD_ROW_PX = 44;
/** The HUD column beside the canvas when sideways. */
export const HUD_COLUMN_PX = 112;
/** The room around the canvas, on each side. */
export const EDGE_PX = 8;
/** The room between the HUD and the canvas. */
export const GAP_PX = 8;
/** The largest scale: a 480 px field is never drawn wider than 720 px. */
export const MAX_SCALE = 1.5;

export interface BreakoutLayout {
  /** The box is wider than tall: the HUD sits beside the canvas. */
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

export function breakoutLayout(box: { width: number; height: number }): BreakoutLayout {
  const sideways = box.width > box.height;
  const room = { width: box.width - EDGE_PX * 2, height: box.height - EDGE_PX * 2 };
  if (sideways) {
    // The HUD column on one side and the same room on the other keep the canvas centred.
    return { sideways, canvas: capped(fitCanvas(room, CANVAS_WIDTH, CANVAS_HEIGHT, { width: (HUD_COLUMN_PX + GAP_PX) * 2 })) };
  }
  return { sideways, canvas: capped(fitCanvas(room, CANVAS_WIDTH, CANVAS_HEIGHT, { height: HUD_ROW_PX + GAP_PX })) };
}
