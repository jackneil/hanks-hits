// constants.ts - Quoridor game types and constants

// Players
export type Player = 1 | 2;

// Board position (0-8 for row and col)
export type Position = {
  row: number;
  col: number;
};

// Wall placement
export type WallOrientation = "horizontal" | "vertical";

export type Wall = {
  row: number; // Row where wall starts (0-7 for horizontal, 0-8 for vertical)
  col: number; // Column where wall starts
  orientation: WallOrientation;
};

// Game status
export type GameStatus = "playing" | "player1-wins" | "player2-wins";

// Game mode
export type GameMode = "local" | "ai";

// AI difficulty
export type Difficulty = "easy" | "medium" | "hard";

// Board constants
export const BOARD_SIZE = 9;
export const WALLS_PER_PLAYER = 10;

// Player starting positions
export const PLAYER1_START: Position = { row: 0, col: 4 }; // Bottom center
export const PLAYER2_START: Position = { row: 8, col: 4 }; // Top center

// Goal rows
export const PLAYER1_GOAL_ROW = 8; // Player 1 needs to reach row 8
export const PLAYER2_GOAL_ROW = 0; // Player 2 needs to reach row 0

// Colors for UI - a wood board with sunken grooves
export const COLORS = {
  BOARD_LIGHT: "#e0b896", // Warm wood squares
  GROOVE: "#1a0f0a", // Near-black sunken grooves
  // The goal rows: each player's colour, faint, on the row it must reach.
  GOAL_P1: "#c3d6f5",
  GOAL_P2: "#f8d0a6",
  PLAYER1: "#3b82f6", // Blue
  PLAYER1_LIGHT: "#60a5fa", // Lighter blue for gradient
  PLAYER2: "#f97316", // Orange
  PLAYER2_LIGHT: "#fb923c", // Lighter orange for gradient
  WALL: "#dc2626", // Bright red - high visibility
  WALL_PREVIEW: "rgba(220, 38, 38, 0.6)",
  WALL_INVALID: "rgba(120, 113, 108, 0.7)",
  VALID_MOVE: "#22c55e",
} as const;

// Utility functions
export function positionsEqual(a: Position, b: Position): boolean {
  return a.row === b.row && a.col === b.col;
}

export function wallsEqual(a: Wall, b: Wall): boolean {
  return a.row === b.row && a.col === b.col && a.orientation === b.orientation;
}

export function isValidPosition(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

export function getOpponent(player: Player): Player {
  return player === 1 ? 2 : 1;
}

export function getGoalRow(player: Player): number {
  return player === 1 ? PLAYER1_GOAL_ROW : PLAYER2_GOAL_ROW;
}

export function createInitialPositions(): Record<Player, Position> {
  return {
    1: { ...PLAYER1_START },
    2: { ...PLAYER2_START },
  };
}
