"use client";

// Route-level wrapper: hangs Chess inside the shared GameShell and wires the
// shell's pause to the store, so the computer waits under the pause menu
// instead of moving behind it.

import { GameShell } from "@/shared/components";
import { ChessGame, useChessStore } from ".";

export default function ChessGameShell() {
  const newGame = useChessStore((state) => state.newGame);
  const pauseGame = useChessStore((state) => state.pauseGame);
  const resumeGame = useChessStore((state) => state.resumeGame);
  return (
    <GameShell
      gameName="Chess"
      appId="chess"
      canPause
      onPause={pauseGame}
      onResume={resumeGame}
      onRestart={() => newGame()}
    >
      <ChessGame />
    </GameShell>
  );
}
