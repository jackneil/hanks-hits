/**
 * The Quoridor board inside the GameShell play box, and the geometry a
 * finger needs: which square or which wall a touch point means.
 *
 * Why: the board was a 17 x 17 CSS grid of equal tracks, so a groove was
 * as big as a square (18.9 px squares, 14 px pawns and 6 px move dots on a
 * 375 px phone), and it was sized by the width only, so held sideways it
 * ran 4 rows past the screen. A wall was placed by a tap on a 19 px groove,
 * and a tap that missed it by a few px placed a wall one row away, at once
 * (phone UX audit 2026-09-29, Quoridor graded D upright, F sideways).
 *
 * Now the squares take the room and a groove is a thin line (about a
 * quarter of a square). The board is as big as the play box allows with
 * the turn strip and the controls above and below it upright, or in a
 * column beside it sideways. A touch never has to hit a line: in move mode
 * it goes to the nearest green dot, and in wall mode it snaps to the
 * nearest groove crossing (every wall is centred on one of 8 x 8).
 */

import { BOARD_SIZE, type Position, type Wall, type WallOrientation } from "./constants";

export const EDGE = 8;
export const GAP = 8;
/** The turn strip over the board, upright. */
export const HUD_ROW = 44;
/** The Move / Wall / Turn / Place buttons under the board, upright. */
export const CONTROL_ROW = 52;
/** The column beside the board, sideways: the turn strip and the buttons. */
export const SIDE_COLUMN = 184;
/** A groove is this part of a square, within the bounds below. */
export const GROOVE_RATIO = 0.28;
export const MIN_GROOVE = 6;
export const MAX_GROOVE = 12;
/** The biggest square: on a tablet the board stops growing here. */
export const MAX_SQUARE = 64;

export interface QuoridorLayout {
  sideways: boolean;
  /** One square, in CSS px. */
  square: number;
  /** One groove (the gap between two squares), in CSS px. */
  groove: number;
  /** The whole board: 9 squares and 8 grooves. */
  board: number;
}

/** Board geometry: the square and groove sizes in CSS px. */
export interface BoardGeometry {
  square: number;
  groove: number;
}

export function quoridorLayout(box: { width: number; height: number }): QuoridorLayout {
  const sideways = box.width > box.height;
  const room = sideways
    ? Math.min(box.height - 2 * EDGE, box.width - 2 * EDGE - SIDE_COLUMN - GAP)
    : Math.min(box.width - 2 * EDGE, box.height - 2 * EDGE - HUD_ROW - CONTROL_ROW - 2 * GAP);
  const cells = BOARD_SIZE + (BOARD_SIZE - 1) * GROOVE_RATIO;
  const groove = Math.round(Math.min(MAX_GROOVE, Math.max(MIN_GROOVE, (room / cells) * GROOVE_RATIO)));
  const square = Math.max(12, Math.min(MAX_SQUARE, Math.floor((room - (BOARD_SIZE - 1) * groove) / BOARD_SIZE)));
  return { sideways, square, groove, board: BOARD_SIZE * square + (BOARD_SIZE - 1) * groove };
}

const pitch = (g: BoardGeometry) => g.square + g.groove;

/**
 * The top-left corner of a square on the board, in px. Row 8 is the top
 * row (Player 2 starts there), row 0 the bottom (Player 1).
 */
export function squareOrigin(pos: Position, g: BoardGeometry): { x: number; y: number } {
  return { x: pos.col * pitch(g), y: (BOARD_SIZE - 1 - pos.row) * pitch(g) };
}

/** The centre of a square, in px. */
export function squareCentre(pos: Position, g: BoardGeometry): { x: number; y: number } {
  const o = squareOrigin(pos, g);
  return { x: o.x + g.square / 2, y: o.y + g.square / 2 };
}

/**
 * The rectangle a wall covers, in px. A horizontal wall {row R, col C}
 * lies in the groove above row R - 1 and spans columns C and C + 1. A
 * vertical wall {row R, col C} lies in the groove left of column C and
 * spans rows R and R + 1 (quoridorLogic.ts).
 */
export function wallRect(wall: Wall, g: BoardGeometry): { x: number; y: number; width: number; height: number } {
  const p = pitch(g);
  const long = 2 * g.square + g.groove;
  if (wall.orientation === "horizontal") {
    return { x: wall.col * p, y: (BOARD_SIZE - 1 - wall.row) * p + g.square, width: long, height: g.groove };
  }
  return { x: (wall.col - 1) * p + g.square, y: (BOARD_SIZE - 2 - wall.row) * p, width: g.groove, height: long };
}

/** The 8 x 8 groove crossings: i from the left, j from the top, 0 to 7. */
export interface Crossing {
  i: number;
  j: number;
}

const LAST_CROSSING = BOARD_SIZE - 2;

/** The groove crossing nearest to a point on the board (in px from its top-left). */
export function nearestCrossing(x: number, y: number, g: BoardGeometry): Crossing {
  const p = pitch(g);
  const toIndex = (v: number) => Math.min(LAST_CROSSING, Math.max(0, Math.round((v - g.square - g.groove / 2) / p)));
  return { i: toIndex(x), j: toIndex(y) };
}

/** The wall centred on a crossing, lying one way. */
export function wallAt(crossing: Crossing, orientation: WallOrientation): Wall {
  return orientation === "horizontal"
    ? { row: BOARD_SIZE - 1 - crossing.j, col: crossing.i, orientation }
    : { row: LAST_CROSSING - crossing.j, col: crossing.i + 1, orientation };
}

/** The crossing a wall is centred on (the inverse of wallAt). */
export function crossingOf(wall: Wall): Crossing {
  return wall.orientation === "horizontal"
    ? { i: wall.col, j: BOARD_SIZE - 1 - wall.row }
    : { i: wall.col - 1, j: LAST_CROSSING - wall.row };
}

/** A crossing moved by (di, dj), kept on the board. */
export function stepCrossing(c: Crossing, di: number, dj: number): Crossing {
  const clamp = (v: number) => Math.min(LAST_CROSSING, Math.max(0, v));
  return { i: clamp(c.i + di), j: clamp(c.j + dj) };
}

/**
 * How far from a green dot a tap still counts as a tap on it: three
 * quarters of a square and a groove. Two dots are at least one square and
 * a groove apart, so the nearest one is the one the finger meant, and the
 * pawn's own centre (one pitch from each dot) picks none.
 */
export const MOVE_REACH = 0.75;

/** The move a tap at (x, y) means: the nearest dot within reach, or null. */
export function nearestMove(x: number, y: number, moves: Position[], g: BoardGeometry): Position | null {
  const reach = MOVE_REACH * pitch(g);
  let best: Position | null = null;
  let bestDistance = Infinity;
  for (const move of moves) {
    const c = squareCentre(move, g);
    const d = Math.hypot(c.x - x, c.y - y);
    if (d <= reach && d < bestDistance) {
      best = move;
      bestDistance = d;
    }
  }
  return best;
}
