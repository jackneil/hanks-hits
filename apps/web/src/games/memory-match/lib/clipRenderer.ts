import { BOARD, frame, rect, text } from "@/shared/clips/replay/draw";
import { DIFFICULTIES } from "./constants";
import type { GameState } from "./store";
export type MemoryClipState = Pick<GameState, "cards" | "difficulty" | "moves" | "matchedPairs" | "isWon" | "currentTime">;
export function paintMemory(c: CanvasRenderingContext2D, s: MemoryClipState): void {
  const { rows, cols, pairs } = DIFFICULTIES[s.difficulty];
  frame(c, "Memory Match", `${s.isWon ? "All matched! · " : ""}${s.moves} moves · ${s.matchedPairs}/${pairs} pairs`, "#172554");
  const cell = Math.min(BOARD.size / cols, BOARD.size / rows);
  const left = (640 - cell * cols) / 2, top = BOARD.y + (BOARD.size - cell * rows) / 2;
  s.cards.forEach((card, index) => {
    const x = left + index % cols * cell, y = top + Math.floor(index / cols) * cell;
    const open = card.isFlipped || card.isMatched;
    rect(c, x + 4, y + 4, cell - 8, cell - 8, card.isMatched ? "#4ade80" : open ? "#fbbf24" : "#60a5fa");
    rect(c, x + 8, y + 8, cell - 16, cell - 16, open ? "#f8fafc" : "#1d4ed8");
    text(c, open ? card.imageId : "?", x + cell / 2, y + cell / 2, cell * .47, open ? "#0f172a" : "#93c5fd");
  });
  text(c, `${Math.floor(s.currentTime / 1000)} seconds`, 320, 697, 20);
}
