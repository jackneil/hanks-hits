import { fitCanvas, type CanvasFit } from "@/shared/hooks/usePlayBox";

import { GAME } from "./constants";

/**
 * The Math Attack screen inside the GameShell play box: the HUD row (lives,
 * the answer being typed, the score), the sky where the problems fall, and
 * an on-screen number pad.
 *
 * Why: the game used a number input, so on a phone the system keyboard
 * came up, covered half the screen, and scrolled the sky away; held
 * sideways the canvas and the input were below the screen (phone UX audit
 * 2026-09-29, grade F). The pad is part of the game now and no system
 * keyboard ever opens.
 *
 * - Upright: the pad is two rows of six keys (1 to 5 and delete, 6 to 0
 *   and send) under the sky, so the sky keeps most of the height.
 * - Sideways: the pad is three keys by four in the right gutter, the HUD a
 *   column on the left, and the sky takes the whole height (a HUD row over
 *   it left a 133 x 199 sky with 10 px sums).
 * - A mouse: the pad under the sky, and the number keys type too.
 */

export const HUD_ROW = 44;
/** The HUD as a column beside the sky, sideways. */
export const HUD_COLUMN = 96;
export const EDGE = 8;
export const GAP = 8;
export const KEY_GAP = 6;
export const MIN_KEY = 44;
export const MAX_KEY = 60;

/** The upright pad: 1 to 5 and delete, then 6 to 0 and send. */
export const PAD_WIDE = [
  ["1", "2", "3", "4", "5", "⌫"],
  ["6", "7", "8", "9", "0", "⚡"],
];
/** The sideways pad: a phone's number pad, with delete and send beside the 0. */
export const PAD_TALL = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["⌫", "0", "⚡"],
];

export interface MathAttackLayout {
  sideways: boolean;
  sky: CanvasFit;
  key: number;
  pad: string[][];
  padSize: { width: number; height: number };
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

function padSize(pad: string[][], key: number) {
  const cols = pad[0].length;
  return { width: cols * key + (cols - 1) * KEY_GAP, height: pad.length * key + (pad.length - 1) * KEY_GAP };
}

export function mathAttackLayout(box: { width: number; height: number }): MathAttackLayout {
  const sideways = box.width > box.height;
  if (sideways) {
    const pad = PAD_TALL;
    const key = clamp(Math.floor((box.height - 2 * EDGE - (pad.length - 1) * KEY_GAP) / pad.length), MIN_KEY, MAX_KEY);
    const size = padSize(pad, key);
    const sky = fitCanvas(box, GAME.width, GAME.height, {
      width: 2 * EDGE + HUD_COLUMN + GAP + GAP + size.width,
      height: 2 * EDGE,
    });
    return { sideways, sky, key, pad, padSize: size };
  }
  const pad = PAD_WIDE;
  const key = clamp(Math.floor((box.width - 2 * EDGE - (pad[0].length - 1) * KEY_GAP) / pad[0].length), MIN_KEY, MAX_KEY);
  const size = padSize(pad, key);
  const sky = fitCanvas(box, GAME.width, GAME.height, { width: 2 * EDGE, height: 2 * EDGE + HUD_ROW + GAP + size.height + GAP });
  return { sideways, sky, key, pad, padSize: size };
}
