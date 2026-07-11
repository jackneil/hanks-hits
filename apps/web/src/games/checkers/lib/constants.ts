// constants.ts - Checkers game types and constants

export type Player = "red" | "black";
export type PieceType = "red" | "black" | "red-king" | "black-king" | null;

export type Position = {
  row: number;
  col: number;
};

export type Move = {
  from: Position;
  to: Position;
  captures: Position[];
  isJump: boolean;
};

export type Difficulty = "easy" | "medium" | "hard";
export type GameStatus = "playing" | "red-wins" | "black-wins" | "draw";
export type GameVariant = "american" | "casual" | "brazilian" | "suicide";
export type GameMode = "vs-ai" | "vs-friend";

export type RuleSet = {
  variant: GameVariant;
  displayName: string;
  description: string;
  forcedCaptures: boolean;
  backwardCapture: boolean;
  flyingKings: boolean;
  majorityRule: boolean;
  invertedWinCondition: boolean;
};

export const RULE_SETS: Record<GameVariant, RuleSet> = {
  american: {
    variant: "american",
    displayName: "American",
    description: "Classic rules with forced jumps",
    forcedCaptures: true,
    backwardCapture: false,
    flyingKings: false,
    majorityRule: false,
    invertedWinCondition: false,
  },
  casual: {
    variant: "casual",
    displayName: "Casual",
    description: "Jumps are optional - great for beginners",
    forcedCaptures: false,
    backwardCapture: false,
    flyingKings: false,
    majorityRule: false,
    invertedWinCondition: false,
  },
  brazilian: {
    variant: "brazilian",
    displayName: "Brazilian",
    description: "Flying kings, backward capture, must take max jumps",
    forcedCaptures: true,
    backwardCapture: true,
    flyingKings: true,
    majorityRule: true,
    invertedWinCondition: false,
  },
  suicide: {
    variant: "suicide",
    displayName: "Giveaway",
    description: "First to lose all your pieces wins!",
    forcedCaptures: true,
    backwardCapture: false,
    flyingKings: false,
    majorityRule: false,
    invertedWinCondition: true,
  },
};

export const ALL_DIRECTIONS: [number, number][] = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

export function getDefaultRuleSet(): RuleSet {
  return RULE_SETS.american;
}

export const BOARD_SIZE = 8;
export const PIECES_PER_SIDE = 12;

export const COLORS = {
  LIGHT_SQUARE: "#f5deb3",
  DARK_SQUARE: "#8b4513",
  RED_PIECE: "#e74c3c",
  RED_PIECE_DARK: "#c0392b",
  BLACK_PIECE: "#2c3e50",
  BLACK_PIECE_DARK: "#1a252f",
  SELECTED: "#ffd700",
  VALID_MOVE: "#00ff00",
  LAST_MOVE: "#87ceeb",
  CAPTURE_HINT: "#ff6347",
} as const;

export const SIZES = {
  MIN_PIECE_SIZE: 50,
  MIN_SQUARE_SIZE: 40,
  MIN_BUTTON_SIZE: 48,
} as const;

export const AI_CONFIG = {
  EASY_DEPTH: 1,
  MEDIUM_DEPTH: 3,
  HARD_DEPTH: 6,
  MOVE_DELAY_MS: 500,
} as const;

export const PIECE_VALUES = {
  REGULAR: 100,
  KING: 150,
  CENTER_BONUS: 5,
  ADVANCEMENT_BONUS: 2,
  BACK_ROW_BONUS: 10,
} as const;

export function createInitialBoard(): PieceType[][] {
  const board: PieceType[][] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    const boardRow: PieceType[] = [];
    for (let col = 0; col < BOARD_SIZE; col++) {
      const isDark = (row + col) % 2 === 1;
      if (!isDark) {
        boardRow.push(null);
      } else if (row < 3) {
        boardRow.push("black");
      } else if (row > 4) {
        boardRow.push("red");
      } else {
        boardRow.push(null);
      }
    }
    board.push(boardRow);
  }
  return board;
}

export function getPlayerFromPiece(piece: PieceType): Player | null {
  if (!piece) return null;
  return piece.startsWith("red") ? "red" : "black";
}

export function isKing(piece: PieceType): boolean {
  return piece === "red-king" || piece === "black-king";
}

export function makeKing(piece: PieceType): PieceType {
  if (piece === "red") return "red-king";
  if (piece === "black") return "black-king";
  return piece;
}

export function getOpponent(player: Player): Player {
  return player === "red" ? "black" : "red";
}

export function isDarkSquare(row: number, col: number): boolean {
  return (row + col) % 2 === 1;
}

export function isValidPosition(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

export function positionsEqual(a: Position, b: Position): boolean {
  return a.row === b.row && a.col === b.col;
}

export function copyBoard(board: PieceType[][]): PieceType[][] {
  return board.map(row => [...row]);
}
