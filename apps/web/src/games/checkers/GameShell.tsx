"use client";

// Route-level wrapper: hangs Checkers inside the shared GameShell and wires
// the shell's pause to the store, so the computer waits under the pause
// menu instead of moving behind it.

import { GameShell } from "@/shared/components";
import { CheckersGame, useCheckersStore } from ".";

export default function CheckersGameShell() {
  const newGame = useCheckersStore((state) => state.newGame);
  const pauseGame = useCheckersStore((state) => state.pauseGame);
  const resumeGame = useCheckersStore((state) => state.resumeGame);
  return (
    <GameShell
      gameName="Checkers"
      appId="checkers"
      canPause
      onPause={pauseGame}
      onResume={resumeGame}
      onRestart={() => newGame()}
    >
      <CheckersGame />
    </GameShell>
  );
}
