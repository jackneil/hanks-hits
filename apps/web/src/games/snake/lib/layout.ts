// Snake on a phone: how the board and the controls share the play box.
//
// Why: the board scaled by width only, and the score row, PAUSE, a 256 px
// d-pad, Settings and Stats sat under it in one column. On a 375x549 phone
// every arrow was under the fold (129 of 129 steering taps missed), and on a
// phone held sideways the board itself was cut off (phone UX audit
// 2026-09-29, arcade-grid). Now the board is fitted to the box on both
// axes, with room kept for the controls: under the board when the phone is
// upright, beside it (in the gutters) when it is held sideways.

import { fitCanvas, type CanvasFit } from "@/shared/hooks/usePlayBox";

/** The board's own size in CSS px before scaling (GRID_SIZE x CELL_SIZE). */
export const BOARD_PX = 400;

/** The d-pad key size in CSS px: big for a thumb, bigger upright. */
export const PAD_KEY_UPRIGHT = 64;
export const PAD_KEY_SIDEWAYS = 56;
const PAD_GAP = 8;

/** The room around the board (the root's padding), both axes. */
const EDGE = 16;
/** The score row upright, or the score column's width sideways. */
const HUD_ROW = 44;
const HUD_COLUMN = 112;
/** The one-line hint under the board (swipe mode, or the keyboard hint). */
const HINT_ROW = 32;
const GAP = 8;

export type ControlKind = "pad" | "swipe" | "keyboard";

export interface SnakeLayout {
  /** The phone is held sideways (or the window is wide): controls in the gutters. */
  sideways: boolean;
  /** The board's size on screen and its scale. */
  fit: CanvasFit;
  /** The d-pad key size for this layout. */
  padKey: number;
}

/** The d-pad's footprint: three keys wide, two rows tall (an inverted T). */
export function padSize(key: number): { width: number; height: number } {
  return { width: key * 3 + PAD_GAP * 2, height: key * 2 + PAD_GAP };
}

/**
 * The layout for a play box of `width` x `height` and the control the kid
 * uses. Sideways, the score column takes the left gutter and the controls
 * the right one; upright, both sit under the board.
 */
export function layoutSnake(
  box: { width: number; height: number },
  controls: ControlKind
): SnakeLayout {
  const sideways = box.width > box.height;
  const padKey = sideways ? PAD_KEY_SIDEWAYS : PAD_KEY_UPRIGHT;
  const pad = padSize(padKey);
  const controlsHeight = controls === "pad" ? pad.height : HINT_ROW;
  const controlsWidth = controls === "pad" ? pad.width : HUD_COLUMN;
  const reserved = sideways
    ? { width: EDGE + HUD_COLUMN + GAP + GAP + controlsWidth + EDGE, height: EDGE * 2 }
    : { width: EDGE * 2, height: EDGE + HUD_ROW + GAP + GAP + controlsHeight + EDGE };
  const fit = fitCanvas(box, BOARD_PX, BOARD_PX, reserved);
  return { sideways, fit, padKey };
}
