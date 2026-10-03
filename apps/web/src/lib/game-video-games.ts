/** Every playable game supports recording and sharing runs. Apps are deliberately excluded. */
export const GAME_VIDEO_IDS = [
  "2048",
  "arkanoid",
  "asteroids",
  "blitz-bomber",
  "bomberman",
  "breakout",
  "checkers",
  "chess",
  "cookie-clicker",
  "dino-runner",
  "endless-runner",
  "flappy-bird",
  "four-wheeler-3d",
  "four-wheeler-adventure",
  "hextris",
  "hill-climb",
  "math-attack",
  "memory-match",
  "monster-truck",
  "oregon-trail",
  "platformer",
  "quoridor",
  "retro-arcade",
  "snake",
  "space-invaders",
  "wordle",
] as const;

export type GameVideoId = (typeof GAME_VIDEO_IDS)[number];

export function isGameVideoGame(value: unknown): value is GameVideoId {
  return typeof value === "string" && (GAME_VIDEO_IDS as readonly string[]).includes(value);
}
