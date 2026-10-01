/**
 * The Chess board inside the GameShell play box: the turn and the pieces
 * the other side took in a row over the board upright, the pieces you took
 * with Undo and Give up in a row under it, and all of them in a column
 * beside the board sideways.
 *
 * Why: the board was `w-full max-w-lg` (512 px) with no height cap, so held
 * sideways 4 of 8 ranks showed and 6 of 8 moves needed a scroll between
 * the two taps; upright the mode, difficulty and colour rows and Undo /
 * Resign / Stats ran under the fold (phone UX audit 2026-09-29, Chess
 * graded B- upright, D sideways). The pickers are on the start card now.
 */

export const EDGE = 8;
export const GAP = 8;
/** The turn and the other side's captures, over the board upright. */
export const TOP_ROW = 40;
/** Your captures, Undo and Give up, under the board upright. */
export const BOTTOM_ROW = 48;
/** The column beside the board, sideways. */
export const SIDE_COLUMN = 184;
/** A board bigger than this looks like a poster on a tablet. */
export const MAX_BOARD = 640;

export interface ChessLayout {
  sideways: boolean;
  /** The board, square, in CSS px (a multiple of 8, so every square is whole). */
  board: number;
}

export function chessLayout(box: { width: number; height: number }): ChessLayout {
  const sideways = box.width > box.height;
  const room = sideways
    ? Math.min(box.height - 2 * EDGE, box.width - 2 * EDGE - SIDE_COLUMN - GAP)
    : Math.min(box.width - 2 * EDGE, box.height - 2 * EDGE - TOP_ROW - BOTTOM_ROW - 2 * GAP);
  const board = Math.max(8 * 12, Math.floor(Math.min(MAX_BOARD, room) / 8) * 8);
  return { sideways, board };
}
