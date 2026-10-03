import { BOARD, frame, rect, text } from "@/shared/clips/replay/draw";
import { getTileColors } from "./constants";
import type { GameState } from "./store";
export type TileClipState = Pick<GameState, "grid" | "score" | "status">;
export function paint2048(c: CanvasRenderingContext2D, s: TileClipState): void {
  frame(c, "2048", `Score: ${s.score}${s.status === "won" ? " · You made 2048!" : s.status === "game-over" ? " · No more moves" : ""}`, "#655c52");
  rect(c, BOARD.x, BOARD.y, BOARD.size, BOARD.size, "#bbada0");
  s.grid.forEach((row, r) => row.forEach((value, col) => {
    const colors = getTileColors(value);
    const x = BOARD.x + 8 + col * 142, y = BOARD.y + 8 + r * 142;
    rect(c, x, y, 134, 134, value ? colors.bg : "#cdc1b4");
    if (value) text(c, String(value), x + 67, y + 67, value > 999 ? 38 : 52, colors.text);
  }));
}
