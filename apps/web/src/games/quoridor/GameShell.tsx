"use client";

// Route-level wrapper: hangs Quoridor inside the shared GameShell and wires
// the shell's pause to the store, so the computer waits under the pause
// menu instead of moving behind it.

import { GameShell } from "@/shared/components";
import { QuoridorGame, useQuoridorStore } from ".";

export default function QuoridorGameShell() {
  const newGame = useQuoridorStore((state) => state.newGame);
  const pauseGame = useQuoridorStore((state) => state.pauseGame);
  const resumeGame = useQuoridorStore((state) => state.resumeGame);
  return (
    <GameShell
      gameName="Quoridor"
      appId="quoridor"
      canPause
      onPause={pauseGame}
      onResume={resumeGame}
      onRestart={() => newGame()}
    >
      <QuoridorGame />
    </GameShell>
  );
}
