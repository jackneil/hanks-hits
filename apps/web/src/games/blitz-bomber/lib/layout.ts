import { fitCanvas, type CanvasFit } from "@/shared/hooks/usePlayBox";

import { CANVAS_HEIGHT, CANVAS_WIDTH } from "./constants";

/**
 * The Blitz Bomber field inside the GameShell play box: the whole 800 x 600
 * sky, as big as the box allows on both axes, on a page of the same sky.
 *
 * Why: the canvas box was `w-full aspect-[4/3]`, so its height followed its
 * width, and on a phone held sideways the ground and the buildings were
 * below the screen (phone UX audit 2026-09-29, grade F). The plane crosses
 * the whole width and every building must be flat to land, so no part of
 * the field may be cropped: the field letterboxes, and a tap anywhere on
 * the page (the sky around the field too) drops a bomb.
 */

/** Room around the field, in CSS px. */
export const EDGE_PX = 8;
/** The largest scale on a big screen. */
export const MAX_SCALE = 1.5;

export function blitzLayout(box: { width: number; height: number }): CanvasFit {
  const fit = fitCanvas(box, CANVAS_WIDTH, CANVAS_HEIGHT, { width: 2 * EDGE_PX, height: 2 * EDGE_PX });
  if (fit.scale <= MAX_SCALE) return fit;
  return { scale: MAX_SCALE, width: Math.round(CANVAS_WIDTH * MAX_SCALE), height: Math.round(CANVAS_HEIGHT * MAX_SCALE) };
}

/**
 * How much bigger the plane and the bombs are drawn on a small field. At a
 * phone's scale (0.42 to 0.45) the 60 px plane was 26 px and a bomb 4 x 7
 * px. The hit boxes do not change, so a bigger drawing only ever forgives.
 */
export function spriteBoost(scale: number): number {
  if (scale <= 0) return 1;
  return Math.min(1.4, Math.max(1, 0.55 / scale));
}
