"use client";

import { GameShell } from "@/shared/components";
import { QuoridorGame, useQuoridorStore } from ".";

export default function QuoridorGameShell() {
  const newGame = useQuoridorStore((state) => state.newGame);
  return (
    <GameShell gameName="Quoridor" appId="quoridor" canPause onRestart={() => newGame()}>
      <QuoridorGame />
    </GameShell>
  );
}
