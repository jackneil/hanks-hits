import { BOARD, frame, rect, text } from "@/shared/clips/replay/draw";
import { COLORS, FOOD_EMOJI, GRID_SIZE } from "./constants";
import type { SnakeGameState } from "./store";
export type SnakeClipState = Pick<SnakeGameState, "snake" | "food" | "foodType" | "score" | "status">;
export function paintSnake(c: CanvasRenderingContext2D, s: SnakeClipState): void {
  frame(c, "Snake", `Score: ${s.score}${s.status === "game-over" ? " · Game over" : ""}`, "#14532d");
  rect(c, BOARD.x, BOARD.y, BOARD.size, BOARD.size, COLORS.GRID_BG);
  const cell = BOARD.size / GRID_SIZE;
  for (let i = 0; i <= GRID_SIZE; i++) {
    rect(c, BOARD.x + i * cell, BOARD.y, 1, BOARD.size, COLORS.GRID_LINE);
    rect(c, BOARD.x, BOARD.y + i * cell, BOARD.size, 1, COLORS.GRID_LINE);
  }
  text(c, FOOD_EMOJI[s.foodType], BOARD.x + (s.food.x + .5) * cell, BOARD.y + (s.food.y + .5) * cell, 25);
  s.snake.forEach((p, i) => rect(c, BOARD.x + p.x * cell + 1, BOARD.y + p.y * cell + 1, cell - 2, cell - 2, i === 0 ? COLORS.SNAKE_HEAD : i % 2 === 0 ? COLORS.SNAKE_BODY : COLORS.SNAKE_BODY_ALT));
  const head = s.snake[0];
  if (head) text(c, s.status === "game-over" ? "😵" : "😊", BOARD.x + (head.x + .5) * cell, BOARD.y + (head.y + .5) * cell, 20);
}
