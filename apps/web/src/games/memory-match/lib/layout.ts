/**
 * The Memory Match board inside the GameShell play box: the stats (moves,
 * time, pairs) in a row over the cards upright, in a column beside them
 * sideways, and the cards as big as the rest of the box allows.
 *
 * Why: a card was min-h-[60px] and the width set the size, so Expert's six
 * columns were 400 px on a 375 px phone, and with the difficulty row, the
 * theme row, the stats and a New Game button stacked on top the cards ran
 * under the fold; held sideways only the top row showed (phone UX audit
 * 2026-09-29). The pickers are on the start card now.
 */

export const STATS_ROW = 44;
export const STATS_COLUMN = 112;
export const EDGE = 8;
export const GAP = 8;
export const CARD_GAP = 6;
export const MAX_CARD = 140;

export interface MemoryLayout {
  sideways: boolean;
  /** One card, square, in CSS px. */
  card: number;
}

export function memoryLayout(box: { width: number; height: number }, grid: { rows: number; cols: number }): MemoryLayout {
  const sideways = box.width > box.height;
  const room = sideways
    ? { width: box.width - 2 * EDGE - STATS_COLUMN - GAP, height: box.height - 2 * EDGE }
    : { width: box.width - 2 * EDGE, height: box.height - 2 * EDGE - STATS_ROW - GAP };
  const byWidth = (room.width - (grid.cols - 1) * CARD_GAP) / grid.cols;
  const byHeight = (room.height - (grid.rows - 1) * CARD_GAP) / grid.rows;
  return { sideways, card: Math.max(24, Math.floor(Math.min(MAX_CARD, byWidth, byHeight))) };
}
