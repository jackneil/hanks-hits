import type { GameMetadata } from "@/shared/lib/game-registry";

export const metadata: GameMetadata = {
  id: "breakout",
  name: "Breakout",
  emoji: "🧱",
  category: "arcade",
  description: "Brick breaker with power-ups",
  clips: true,
  // The field is 3:4: upright it is twice the size (325x433 at 375x549
  // against 191x255 sideways), so the tip says so once. Sideways still plays.
  preferredOrientation: "portrait",
};
