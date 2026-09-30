// Chess game types and constants

export type Player = "white" | "black";
export type Difficulty = "easy" | "medium" | "hard";
export type GameMode = "ai" | "local";
export type GameStatus = "playing" | "checkmate" | "stalemate" | "draw" | "resigned";

export const BOARD_SIZE = 8;

// Colors for the chess board (kid-friendly)
export const COLORS = {
  LIGHT_SQUARE: "#EDEED1",
  DARK_SQUARE: "#779952",
  SELECTED: "#F6F669",
  // Where a piece can go: dark and half clear, so it shows on both square colours.
  VALID_MOVE: "rgba(20, 40, 20, 0.45)",
  LAST_MOVE: "#CDD26A",
  CHECK: "#E84855",
} as const;

// Piece values for AI evaluation
export const PIECE_VALUES: Record<string, number> = {
  p: 1,   // pawn
  n: 3,   // knight
  b: 3,   // bishop
  r: 5,   // rook
  q: 9,   // queen
  k: 100, // king
};

// AI depth settings
export const AI_CONFIG = {
  EASY_DEPTH: 1,      // Random with slight preference
  MEDIUM_DEPTH: 2,    // Basic minimax
  HARD_DEPTH: 3,      // Deeper minimax
  MOVE_DELAY_MS: 500, // Delay before AI moves
} as const;

// Unicode chess pieces for display fallback
export const PIECE_UNICODE: Record<string, string> = {
  wK: "\u2654", // White King
  wQ: "\u2655", // White Queen
  wR: "\u2656", // White Rook
  wB: "\u2657", // White Bishop
  wN: "\u2658", // White Knight
  wP: "\u2659", // White Pawn
  bK: "\u265A", // Black King
  bQ: "\u265B", // Black Queen
  bR: "\u265C", // Black Rook
  bB: "\u265D", // Black Bishop
  bN: "\u265E", // Black Knight
  bP: "\u265F", // Black Pawn
};
