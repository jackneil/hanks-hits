import { BOARD, frame, rect, text } from "@/shared/clips/replay/draw";
import { COLORS } from "./constants";
import type { GameState } from "./store";
export type ChessClipState = Pick<GameState, "fen" | "gameMode" | "playerColor" | "status" | "selectedSquare" | "lastMove" | "kingInCheck" | "legalMoves">;
const PIECES: Record<string, string> = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟", K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙" };
export function paintChess(c: CanvasRenderingContext2D, s: ChessClipState): void {
  const [position, turn] = s.fen.split(" ");
  const flipped = s.gameMode === "ai" && s.playerColor === "black";
  const status = { playing: `${turn === "w" ? "White" : "Black"}'s turn`, checkmate: "Checkmate!", stalemate: "Stalemate", draw: "Draw", resigned: "Game ended" }[s.status];
  frame(c, "Chess", status, "#064e3b");
  position.split("/").forEach((rank, r) => {
    let col = 0;
    for (const char of rank) {
      const count = /[1-8]/.test(char) ? Number(char) : 1;
      for (let n = 0; n < count; n++, col++) {
        const x = BOARD.x + (flipped ? 7 - col : col) * 72;
        const y = BOARD.y + (flipped ? 7 - r : r) * 72;
        const square = `${String.fromCharCode(97 + col)}${8 - r}`;
        const highlighted = s.selectedSquare === square || s.lastMove?.from === square || s.lastMove?.to === square;
        rect(c, x, y, 72, 72, s.kingInCheck === square ? COLORS.CHECK : s.selectedSquare === square ? COLORS.SELECTED : highlighted ? COLORS.LAST_MOVE : (r + col) % 2 ? COLORS.DARK_SQUARE : COLORS.LIGHT_SQUARE);
        if (PIECES[char]) {
          // Black outline under the white glyph keeps both sides readable.
          c.strokeStyle = char === char.toUpperCase() ? "#334155" : "#f8fafc";
          c.lineWidth = 2;
          c.font = "56px serif";
          c.textAlign = "center";
          c.textBaseline = "middle";
          c.strokeText(PIECES[char], x + 36, y + 37);
          c.fillStyle = char === char.toUpperCase() ? "#fff" : "#111827";
          c.fillText(PIECES[char], x + 36, y + 37);
        }
      }
    }
  });
  text(c, flipped ? "Black at the bottom" : "White at the bottom", 320, 697, 18);
}
