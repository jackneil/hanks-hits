/**
 * The Checkers board inside the GameShell play box: the turn and each
 * side's pieces left in a row over the board upright, and in a column
 * beside it sideways.
 *
 * Why: the board was `w-full max-w-lg` (512 px) with no height cap, so a
 * phone held sideways showed 4 of 8 rows and the kid scrolled to see the
 * computer's pieces and back to move; upright, New Game, the rules and the
 * difficulty ran under the fold, and New Game left the reset board scrolled
 * off screen (phone UX audit 2026-09-29, Checkers graded B upright, D+
 * sideways). The choices are on the start card now.
 */

export const EDGE = 8;
export const GAP = 8;
/** The turn and the piece counts, over the board upright. */
export const TOP_ROW = 44;
/** The column beside the board, sideways. */
export const SIDE_COLUMN = 160;
/** A board bigger than this looks like a poster on a tablet. */
export const MAX_BOARD = 640;

export interface CheckersLayout {
  sideways: boolean;
  /** The board, square, in CSS px (a multiple of 8, so every square is whole). */
  board: number;
}

export function checkersLayout(box: { width: number; height: number }): CheckersLayout {
  const sideways = box.width > box.height;
  const room = sideways
    ? Math.min(box.height - 2 * EDGE, box.width - 2 * EDGE - SIDE_COLUMN - GAP)
    : Math.min(box.width - 2 * EDGE, box.height - 2 * EDGE - TOP_ROW - GAP);
  const board = Math.max(8 * 12, Math.floor(Math.min(MAX_BOARD, room) / 8) * 8);
  return { sideways, board };
}
