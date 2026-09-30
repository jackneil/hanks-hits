import { fitCanvas, type CanvasFit } from "@/shared/hooks/usePlayBox";

/**
 * The layout of the Arkanoid screen inside the GameShell play box.
 *
 * Why: the canvas filled whatever box it got, and the field is drawn in
 * normalized -1..1 coordinates, so the balls and the walls stretched with
 * the screen, and on a phone held sideways the canvas was 333 px tall in a
 * 195 px slot with the paddle below the screen (phone UX audit
 * 2026-09-29). Now the field is square and fits the play box on both axes:
 *
 * - Upright: the HUD line above the field.
 * - Sideways: the HUD in a column beside the field, so it gets the height.
 *
 * A finger drags the paddle from anywhere on the screen (a relative drag),
 * so the room beside or under the field is play room too.
 */

/** The field's size in world pixels (square). */
export const FIELD_PX = 600;
/** The HUD line above the field when upright. */
export const HUD_ROW_PX = 56;
/** The HUD column beside the field when sideways. */
export const HUD_COLUMN_PX = 112;
/** The room around the field, on each side. */
export const EDGE_PX = 8;
/** The room between the HUD and the field. */
export const GAP_PX = 8;

export interface ArkanoidLayout {
  sideways: boolean;
  /** The size of the field on screen. */
  field: CanvasFit;
}

export function arkanoidLayout(box: { width: number; height: number }): ArkanoidLayout {
  const sideways = box.width > box.height;
  const room = { width: box.width - EDGE_PX * 2, height: box.height - EDGE_PX * 2 };
  const reserved = sideways
    ? { width: (HUD_COLUMN_PX + GAP_PX) * 2 }
    : { height: HUD_ROW_PX + GAP_PX };
  return { sideways, field: fitCanvas(room, FIELD_PX, FIELD_PX, reserved) };
}
