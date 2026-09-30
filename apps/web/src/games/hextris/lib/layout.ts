import { fitThumbPads, type ThumbFit } from "@/shared/components/ThumbPadLayout";

import { CANVAS_HEIGHT, CANVAS_WIDTH } from "./constants";

/**
 * The Hextris screen inside the GameShell play box, on the shared thumb-pad
 * layout: held sideways the field fills the height with a spin button under
 * each thumb; held upright the field sits on top with the two spin buttons
 * in one row under it; with a mouse the field alone.
 *
 * Why: the canvas was scaled once from its container, 120 px was guessed
 * for the buttons, and nothing followed a turn of the phone. On an iPhone
 * held sideways the hexagon sat below the bottom of the screen (phone UX
 * audit 2026-09-29, grade F).
 *
 * The whole 400 x 500 field shows: blocks fly in from 250 px out, so a crop
 * would hide where the next one comes from.
 */

/** The largest scale on a big screen. */
export const MAX_SCALE = 1.5;

export function fitHextris(box: { width: number; height: number }, coarse: boolean): ThumbFit {
  return fitThumbPads(box, coarse, { width: CANVAS_WIDTH, height: CANVAS_HEIGHT }, { maxScale: MAX_SCALE });
}
