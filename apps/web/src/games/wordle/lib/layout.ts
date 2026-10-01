/**
 * The Wordle screen inside the GameShell play box.
 *
 * - Upright: the letter grid on top, the hint row, then the keyboard at the
 *   bottom, where the thumbs are.
 * - Sideways: the grid on the left, the hint row and the keyboard on the
 *   right.
 * - At a result the keyboard goes away and the grid moves down, clear of
 *   the result card at the top of the play box.
 *
 * Why: the tiles and the keys had fixed sizes per age, so on a 375 x 549
 * phone the keyboard ran under the fold for the older ages, and a phone
 * held sideways showed the grid and no keyboard at all (phone UX audit
 * 2026-09-29). Now the tiles take the height the keyboard leaves.
 */

import { KEYBOARD_ROWS, KEYS_PER_ROW } from "./constants";

/** A key is never under a thumb's 44 px, and never over 56 px. */
export const MIN_KEY = 44;
export const MAX_KEY = 56;
export const KEY_GAP = 4;
export const TILE_GAP = 4;
export const MAX_TILE = 56;
/** The hint row (the Hint button or the hint text). */
export const HINT_ROW = 44;
/** Room around everything, and between the parts. */
export const EDGE = 8;
export const GAP = 8;
/** The room the result card takes at the top of the play box. */
export const RESULT_CARD_ROOM = 72;

export interface WordleLayout {
  sideways: boolean;
  /** A letter tile, square, in CSS px. */
  tile: number;
  /** A keyboard key, square, in CSS px. */
  key: number;
  /** Keys a row: seven, or six on a screen too narrow for seven 44 px keys. */
  cols: number;
  /** The keyboard's size, in CSS px. */
  keyboard: { width: number; height: number };
}

/** Every key: the letters, delete and enter. */
const KEY_COUNT = KEYBOARD_ROWS.flat().length;
/** Six keys a row on a narrow screen (a 311 or 320 px phone could not fit seven of 44 px). */
export const NARROW_COLS = 6;

function keyboardSize(key: number, cols: number) {
  const rows = Math.ceil(KEY_COUNT / cols);
  return {
    width: cols * key + (cols - 1) * KEY_GAP,
    height: rows * key + (rows - 1) * KEY_GAP,
  };
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

function tileFor(room: { width: number; height: number }, grid: { rows: number; cols: number }): number {
  const byHeight = (room.height - (grid.rows - 1) * TILE_GAP) / grid.rows;
  const byWidth = (room.width - (grid.cols - 1) * TILE_GAP) / grid.cols;
  return Math.max(16, Math.floor(Math.min(MAX_TILE, byHeight, byWidth)));
}

export function wordleLayout(
  box: { width: number; height: number },
  grid: { rows: number; cols: number },
  result: boolean
): WordleLayout {
  const sideways = box.width > box.height;
  const top = result ? RESULT_CARD_ROOM : 0;
  if (sideways) {
    // The keyboard and the grid share the width. The biggest keys the height
    // allows can starve the grid (56 px keys left a 549 px screen 24 px
    // tiles), so pick the key size that gives the biggest tiles, and the
    // bigger key when two sizes tie.
    const tallest = clamp(
      Math.floor((box.height - 2 * EDGE - HINT_ROW - GAP - (KEYBOARD_ROWS.length - 1) * KEY_GAP) / KEYBOARD_ROWS.length),
      MIN_KEY,
      MAX_KEY
    );
    if (result) {
      const room = { width: box.width - 2 * EDGE, height: box.height - 2 * EDGE - top };
      return { sideways, tile: tileFor(room, grid), key: tallest, cols: KEYS_PER_ROW, keyboard: keyboardSize(tallest, KEYS_PER_ROW) };
    }
    let best = { key: tallest, tile: -1 };
    for (let key = tallest; key >= MIN_KEY; key--) {
      const room = { width: box.width - 2 * EDGE - GAP - keyboardSize(key, KEYS_PER_ROW).width, height: box.height - 2 * EDGE };
      const tile = tileFor(room, grid);
      if (tile > best.tile) best = { key, tile };
    }
    return { sideways, tile: best.tile, key: best.key, cols: KEYS_PER_ROW, keyboard: keyboardSize(best.key, KEYS_PER_ROW) };
  }
  const widthFor = (cols: number) => Math.floor((box.width - 2 * EDGE - (cols - 1) * KEY_GAP) / cols);
  const cols = widthFor(KEYS_PER_ROW) >= MIN_KEY ? KEYS_PER_ROW : NARROW_COLS;
  const key = clamp(widthFor(cols), MIN_KEY, MAX_KEY);
  const keyboard = keyboardSize(key, cols);
  const room = result
    ? { width: box.width - 2 * EDGE, height: box.height - 2 * EDGE - top }
    : { width: box.width - 2 * EDGE, height: box.height - 2 * EDGE - keyboard.height - GAP - HINT_ROW - GAP };
  return { sideways, tile: tileFor(room, grid), key, cols, keyboard };
}
