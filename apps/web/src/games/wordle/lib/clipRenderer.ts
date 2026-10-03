import { BOARD, frame, rect, text } from "@/shared/clips/replay/draw";
import { getDifficultySettings } from "./constants";
import type { useWordleStore } from "./store";
export type WordleClipState = Pick<ReturnType<typeof useWordleStore.getState>, "gameState" | "guesses" | "results" | "currentGuess" | "currentRow" | "settings">;
/** Only validated, submitted tiles. Unsubmitted text can contain personal words. */
export function paintWordle(c: CanvasRenderingContext2D, s: WordleClipState): void {
  const { maxGuesses: rows, wordLength: cols } = getDifficultySettings(s.settings.difficulty);
  frame(c, "Wordle", s.gameState === "won" ? "You found the word!" : s.gameState === "lost" ? "Good try!" : "Find the word", "#111827");
  const cell = Math.min(BOARD.size / rows, BOARD.size / cols);
  const left = (640 - cell * cols) / 2;
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const x = left + col * cell, y = BOARD.y + row * cell;
    const status = s.results[row]?.[col];
    const color = status === "correct" ? "#22c55e" : status === "present" ? "#eab308" : status === "absent" ? "#4b5563" : "#1f2937";
    rect(c, x + 3, y + 3, cell - 6, cell - 6, "#6b7280");
    rect(c, x + 5, y + 5, cell - 10, cell - 10, color);
    const letter = s.guesses[row]?.[col] ?? "";
    const pending = row === s.currentRow && col < s.currentGuess.length;
    text(c, /^[a-z]$/i.test(letter) ? letter.toUpperCase() : pending ? "•" : "", x + cell / 2, y + cell / 2, cell * .5);
  }
}
