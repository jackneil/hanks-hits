/**
 * The 2048 board inside the GameShell play box: the score and Undo in a
 * row over the board upright, in a column beside it sideways, and the
 * board as big as the rest of the box allows.
 *
 * Why: the board was w-full max-w-[400px] aspect-square, so its height
 * followed the width; with the scoreboard, the buttons and the help text
 * stacked around it a phone held sideways showed the top two rows of tiles
 * (phone UX audit 2026-09-29, grade F).
 */

export const SCORE_ROW = 56;
export const SIDE_COLUMN = 120;
export const EDGE = 8;
export const GAP = 8;
export const MAX_BOARD = 480;

export interface BoardLayout {
  sideways: boolean;
  /** The board, square, in CSS px. */
  board: number;
}

export function boardLayout(box: { width: number; height: number }): BoardLayout {
  const sideways = box.width > box.height;
  const room = sideways
    ? { width: box.width - 2 * EDGE - SIDE_COLUMN - GAP, height: box.height - 2 * EDGE }
    : { width: box.width - 2 * EDGE, height: box.height - 2 * EDGE - SCORE_ROW - GAP };
  return { sideways, board: Math.max(120, Math.floor(Math.min(MAX_BOARD, room.width, room.height))) };
}
