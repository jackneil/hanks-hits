"use client";

import { GameShell } from "@/shared/components";
import { Game2048, use2048Store } from ".";

export default function Game2048Shell() {
  const newGame = use2048Store((state) => state.newGame);
  return (
    <GameShell gameName="2048" appId="2048" canPause onRestart={newGame}>
      <Game2048 />
    </GameShell>
  );
}
