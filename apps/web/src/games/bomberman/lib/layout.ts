// Bomberman on a phone: how the arena and the controls share the play box.
//
// Why: the canvas was bounded by width only (maxWidth 100%, height auto),
// with two HUD rows above and the controls in normal flow below. On a phone
// held sideways the 624x528 arena ran two thirds under the fold and every
// control was off screen (31 of 31 play taps missed); upright on a 375x549
// phone the Down key was cut off (phone UX audit 2026-09-29, arcade-grid).
// Now the arena is fitted to the box on both axes, with the d-pad and the
// bomb button under it upright and in the gutters beside it sideways.
// Sideways the HUD sits in the right gutter under the bomb button, so the
// arena gets the whole height (a HUD row above it cost a fifth of it).

import { fitCanvas, type CanvasFit } from "@/shared/hooks/usePlayBox";

import { GRID_HEIGHT, GRID_WIDTH, TILE_SIZE } from "./constants";

export const CANVAS_WIDTH = GRID_WIDTH * TILE_SIZE;
export const CANVAS_HEIGHT = GRID_HEIGHT * TILE_SIZE;

/** A d-pad key: 64 px upright, 56 px sideways (a 44 px key is the floor for a thumb). */
export const PAD_KEY_UPRIGHT = 64;
export const PAD_KEY_SIDEWAYS = 56;
/** The smallest d-pad key: a thumb's 44 px. */
export const MIN_PAD_KEY = 44;
const PAD_GAP = 4;
/** The bomb button. */
export const BOMB_BUTTON_UPRIGHT = 96;
export const BOMB_BUTTON_SIDEWAYS = 80;

/** The root's padding, both axes. */
const EDGE = 8;
/** The control row's own padding on each side (px-2 in Game.tsx). */
export const CONTROL_ROW_PAD = 8;
/** The one HUD row over the arena. */
const HUD_ROW = 32;
const GAP = 8;

export interface BombermanLayout {
  /** The phone is held sideways (or the window is wide): controls in the gutters. */
  sideways: boolean;
  fit: CanvasFit;
  padKey: number;
  bombButton: number;
}

/** The d-pad's footprint: three keys wide, three keys tall (a plus). */
export function padSize(key: number): number {
  return key * 3 + PAD_GAP * 2;
}

/**
 * The layout for a play box of `width` x `height`. With `touch`, room is
 * kept for the controls: under the arena upright, beside it sideways.
 */
export function layoutBomberman(
  box: { width: number; height: number },
  touch: boolean
): BombermanLayout {
  const sideways = box.width > box.height;
  const bombButton = sideways ? BOMB_BUTTON_SIDEWAYS : BOMB_BUTTON_UPRIGHT;
  // Upright the d-pad and the bomb share one row: on a narrow phone (a
  // 311 or 320 px screen) 64 px keys pushed the bomb button off the right
  // edge, so the keys shrink to fit the width, never under 44 px.
  const padKey = sideways
    ? PAD_KEY_SIDEWAYS
    : Math.max(
        MIN_PAD_KEY,
        Math.min(PAD_KEY_UPRIGHT, Math.floor((box.width - 2 * EDGE - 2 * CONTROL_ROW_PAD - GAP - bombButton - 2 * PAD_GAP) / 3))
      );
  const pad = padSize(padKey);
  const reserved = sideways
    ? {
        width: EDGE + (touch ? pad + GAP : 0) + (touch ? GAP + Math.max(pad, bombButton) : 0) + EDGE,
        // The HUD is in the right gutter on a touch screen, over the arena
        // with a mouse.
        height: EDGE + (touch ? 0 : HUD_ROW + GAP) + EDGE,
      }
    : {
        width: EDGE * 2,
        height: EDGE + HUD_ROW + GAP + (touch ? GAP + Math.max(pad, bombButton) : 0) + EDGE,
      };
  const fit = fitCanvas(box, CANVAS_WIDTH, CANVAS_HEIGHT, reserved);
  return { sideways, fit, padKey, bombButton };
}
