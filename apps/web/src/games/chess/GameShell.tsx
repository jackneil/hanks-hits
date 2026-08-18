"use client";

import { GameShell } from "@/shared/components";
import { ChessGame, useChessStore } from ".";

export default function ChessGameShell() {
  const newGame = useChessStore((state) => state.newGame);
  return (
    <GameShell gameName="Chess" appId="chess" canPause onRestart={() => newGame()}>
      <ChessGame />
    </GameShell>
  );
}
