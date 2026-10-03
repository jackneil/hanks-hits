import { BOARD, disc, frame, rect, text } from "@/shared/clips/replay/draw";
import { COLORS } from "./constants";
import type { GameState } from "./store";
export type CheckersClipState = Pick<GameState, "board" | "currentPlayer" | "status" | "selectedPiece" | "lastMove">;
export function paintCheckers(c: CanvasRenderingContext2D, s: CheckersClipState): void {
  frame(c, "Checkers", s.status === "playing" ? `${s.currentPlayer === "red" ? "Red" : "Black"}'s turn` : s.status === "red-wins" ? "Red wins!" : s.status === "black-wins" ? "Black wins!" : "Draw", "#451a03");
  s.board.forEach((row, r) => row.forEach((piece, col) => {
    const x = BOARD.x + col * 72, y = BOARD.y + r * 72;
    const selected = s.selectedPiece?.row === r && s.selectedPiece?.col === col;
    const last = (s.lastMove?.from.row === r && s.lastMove.from.col === col) || (s.lastMove?.to.row === r && s.lastMove.to.col === col);
    rect(c, x, y, 72, 72, selected ? COLORS.SELECTED : last ? COLORS.LAST_MOVE : (r + col) % 2 ? COLORS.DARK_SQUARE : COLORS.LIGHT_SQUARE);
    if (piece) {
      disc(c, x + 36, y + 36, 29, piece.startsWith("red") ? COLORS.RED_PIECE : COLORS.BLACK_PIECE);
      disc(c, x + 36, y + 36, 22, piece.startsWith("red") ? COLORS.RED_PIECE_DARK : COLORS.BLACK_PIECE_DARK);
      if (piece.includes("king")) text(c, "♛", x + 36, y + 36, 34, "#fde68a");
    }
  }));
}
