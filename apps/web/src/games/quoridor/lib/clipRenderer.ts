import { BOARD, disc, frame, rect, text } from "@/shared/clips/replay/draw";
import { COLORS } from "./constants";
import { squareCentre, squareOrigin, wallRect } from "./layout";
import type { GameState } from "./store";

export type QuoridorClipState = Pick<GameState, "positions" | "walls" | "wallsRemaining" | "currentPlayer" | "status" | "movesThisGame">;
export function paintQuoridor(c: CanvasRenderingContext2D, s: QuoridorClipState): void {
  const status = s.status === "playing" ? `${s.currentPlayer === 1 ? "Blue" : "Orange"}'s turn` : s.status === "player1-wins" ? "Blue wins!" : "Orange wins!";
  frame(c, "Quoridor", `${status} · ${s.movesThisGame} moves`, "#451a03");
  const geometry = { square: 56, groove: 9 };
  rect(c, BOARD.x, BOARD.y, BOARD.size, BOARD.size, COLORS.GROOVE);
  for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
    const p = squareOrigin({ row, col }, geometry);
    rect(c, BOARD.x + p.x, BOARD.y + p.y, 56, 56, row === 8 ? COLORS.GOAL_P1 : row === 0 ? COLORS.GOAL_P2 : COLORS.BOARD_LIGHT);
  }
  for (const wall of s.walls) {
    const p = wallRect(wall, geometry);
    rect(c, BOARD.x + p.x, BOARD.y + p.y, p.width, p.height, COLORS.WALL);
  }
  for (const player of [1, 2] as const) {
    const p = squareCentre(s.positions[player], geometry);
    disc(c, BOARD.x + p.x, BOARD.y + p.y, 23, s.currentPlayer === player ? "#fde68a" : COLORS.GROOVE);
    disc(c, BOARD.x + p.x, BOARD.y + p.y, 19, player === 1 ? COLORS.PLAYER1 : COLORS.PLAYER2);
  }
  text(c, `Blue: ${s.wallsRemaining[1]} walls · Orange: ${s.wallsRemaining[2]} walls`, 320, 697, 20);
}
