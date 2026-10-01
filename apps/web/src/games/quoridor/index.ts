// Quoridor Game - Main exports
// Self-contained game module

export { QuoridorGame, default } from "./Game";
export { useQuoridorStore } from "./lib/store";
export type { QuoridorProgress, GameState } from "./lib/store";
export type {
  Player,
  Position,
  Wall,
  WallOrientation,
  GameStatus,
  GameMode,
  Difficulty,
} from "./lib/constants";
