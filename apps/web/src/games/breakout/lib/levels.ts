// Breakout Game - Level Definitions

import type { BrickType } from "./constants";
import { BRICK_COLS } from "./constants";

export type LevelConfig = {
  id: number;
  name: string;
  pattern: (BrickType | null)[][];  // Row-major grid, null = no brick
  powerUpChance: number;
  ballSpeed: number;
};

// Helper to create empty row
const _ = null;
const N: BrickType = "normal";
const T: BrickType = "tough";
const I: BrickType = "indestructible";
const E: BrickType = "explosive";

// Level definitions
export const LEVELS: LevelConfig[] = [
  // Level 1: Introduction - Simple rectangle
  {
    id: 1,
    name: "Introduction",
    powerUpChance: 0.30,
    ballSpeed: 5,
    pattern: [
      [N, N, N, N, N, N, N, N],
      [N, N, N, N, N, N, N, N],
      [N, N, N, N, N, N, N, N],
      [N, N, N, N, N, N, N, N],
      [_, _, _, _, _, _, _, _],
      [_, _, _, _, _, _, _, _],
      [_, _, _, _, _, _, _, _],
      [_, _, _, _, _, _, _, _],
    ],
  },

  // Level 2: Diamond
  {
    id: 2,
    name: "Diamond",
    powerUpChance: 0.25,
    ballSpeed: 5.5,
    pattern: [
      [_, _, _, N, N, _, _, _],
      [_, _, N, N, N, N, _, _],
      [_, N, N, N, N, N, N, _],
      [N, N, N, N, N, N, N, N],
      [N, N, N, N, N, N, N, N],
      [_, N, N, N, N, N, N, _],
      [_, _, N, N, N, N, _, _],
      [_, _, _, N, N, _, _, _],
    ],
  },

  // Level 3: Checkerboard
  {
    id: 3,
    name: "Checkerboard",
    powerUpChance: 0.25,
    ballSpeed: 6,
    pattern: [
      [N, _, N, _, N, _, N, _],
      [_, N, _, N, _, N, _, N],
      [N, _, N, _, N, _, N, _],
      [_, N, _, N, _, N, _, N],
      [N, _, N, _, N, _, N, _],
      [_, N, _, N, _, N, _, N],
      [N, _, N, _, N, _, N, _],
      [_, N, _, N, _, N, _, N],
    ],
  },

  // Level 4: Fortress - Tough bricks protecting center
  {
    id: 4,
    name: "Fortress",
    powerUpChance: 0.30,
    ballSpeed: 6,
    pattern: [
      [T, T, T, T, T, T, T, T],
      [T, N, N, N, N, N, N, T],
      [T, N, E, N, N, E, N, T],
      [T, N, N, N, N, N, N, T],
      [T, N, N, N, N, N, N, T],
      [T, N, E, N, N, E, N, T],
      [T, N, N, N, N, N, N, T],
      [T, T, T, T, T, T, T, T],
    ],
  },

  // Level 5: Rainbow - Colorful rows
  {
    id: 5,
    name: "Rainbow",
    powerUpChance: 0.25,
    ballSpeed: 6.5,
    pattern: [
      [N, N, N, N, N, N, N, N],
      [N, N, N, N, N, N, N, N],
      [N, N, N, N, N, N, N, N],
      [N, N, N, N, N, N, N, N],
      [N, N, N, N, N, N, N, N],
      [N, N, N, N, N, N, N, N],
      [N, N, N, N, N, N, N, N],
      [N, N, N, N, N, N, N, N],
    ],
  },

  // Level 6: Space Invaders pattern
  {
    id: 6,
    name: "Invaders",
    powerUpChance: 0.25,
    ballSpeed: 7,
    pattern: [
      [_, N, _, _, _, _, N, _],
      [_, _, N, _, _, N, _, _],
      [_, N, N, N, N, N, N, _],
      [N, N, _, N, N, _, N, N],
      [N, N, N, N, N, N, N, N],
      [N, _, N, N, N, N, _, N],
      [N, _, N, _, _, N, _, N],
      [_, _, _, N, N, _, _, _],
    ],
  },

  // Level 7: HANK spelled out
  {
    id: 7,
    name: "HANK",
    powerUpChance: 0.30,
    ballSpeed: 7,
    pattern: [
      [N, _, N, _, N, _, _, _, N, _, N, _, N],
      [N, _, N, _, N, N, _, _, N, _, N, _,  N],
      [N, N, N, _, N, _, N, _, N, _, N, N, _],
      [N, _, N, _, N, _, N, _, N, _, N, _, N],
      [N, _, N, _, N, _, _, N, N, _, N, _, _,N],
      [_, _, _, _, _, _, _, _, _, _, _, _, _],
      [_, _, _, _, _, _, _, _, _, _, _, _, _],
      [_, _, _, _, _, _, _, _, _, _, _, _, _],
    ].map(row => row.slice(0, BRICK_COLS)) as (BrickType | null)[][],
  },

  // Level 8: Challenge - Mix of everything
  {
    id: 8,
    name: "Challenge",
    powerUpChance: 0.35,
    ballSpeed: 7.5,
    pattern: [
      [I, T, T, N, N, T, T, I],
      [T, E, N, N, N, N, E, T],
      [T, N, N, N, N, N, N, T],
      [N, N, N, E, E, N, N, N],
      [N, N, N, E, E, N, N, N],
      [T, N, N, N, N, N, N, T],
      [T, E, N, N, N, N, E, T],
      [I, T, T, N, N, T, T, I],
    ],
  },

  // Level 9: Pyramid
  {
    id: 9,
    name: "Pyramid",
    powerUpChance: 0.25,
    ballSpeed: 8,
    pattern: [
      [_, _, _, T, T, _, _, _],
      [_, _, T, N, N, T, _, _],
      [_, T, N, N, N, N, T, _],
      [T, N, N, E, E, N, N, T],
      [N, N, N, N, N, N, N, N],
      [N, N, N, N, N, N, N, N],
      [N, N, N, N, N, N, N, N],
      [N, N, N, N, N, N, N, N],
    ],
  },

  // Level 10: Boss level - lots of tough bricks
  {
    id: 10,
    name: "Boss",
    powerUpChance: 0.40,
    ballSpeed: 8,
    pattern: [
      [I, I, I, I, I, I, I, I],
      [I, T, T, T, T, T, T, I],
      [I, T, E, N, N, E, T, I],
      [I, T, N, T, T, N, T, I],
      [I, T, N, T, T, N, T, I],
      [I, T, E, N, N, E, T, I],
      [I, T, T, T, T, T, T, I],
      [I, I, I, I, I, I, I, I],
    ],
  },
];

/**
 * Get level by number (1-indexed)
 */
export function getLevel(levelNum: number): LevelConfig {
  const index = Math.min(levelNum - 1, LEVELS.length - 1);
  return LEVELS[Math.max(0, index)];
}

/**
 * Count breakable bricks in a level
 */
export function countBreakableBricks(pattern: (BrickType | null)[][]): number {
  let count = 0;
  for (const row of pattern) {
    for (const brick of row) {
      if (brick && brick !== "indestructible") {
        count++;
      }
    }
  }
  return count;
}

/**
 * Get total number of levels
 */
export function getTotalLevels(): number {
  return LEVELS.length;
}
