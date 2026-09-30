"use client";

import { GameShell } from "@/shared/components";
import { DinoRunnerGame, useDinoRunnerStore } from ".";

export default function DinoRunnerGameShell() {
  // The header's Restart (after its question) starts a new run at once,
  // like the result chip's Play again; a kid never lands on the start card
  // to press Play a second time.
  const startGame = useDinoRunnerStore((state) => state.startGame);
  return (
    <GameShell gameName="Dino Runner" appId="dino-runner" canPause={false} onRestart={startGame}>
      <DinoRunnerGame />
    </GameShell>
  );
}
