"use client";

import { GameShell } from "@/shared/components";
import { CheckersGame, useCheckersStore } from ".";

export default function CheckersGameShell() {
  const newGame = useCheckersStore((state) => state.newGame);
  return (
    <GameShell gameName="Checkers" appId="checkers" canPause onRestart={() => newGame()}>
      <CheckersGame />
    </GameShell>
  );
}
