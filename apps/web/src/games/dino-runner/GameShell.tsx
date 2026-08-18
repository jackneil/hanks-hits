"use client";

import { GameShell } from "@/shared/components";
import { DinoRunnerGame, useDinoRunnerStore } from ".";

export default function DinoRunnerGameShell() {
  const reset = useDinoRunnerStore((state) => state.reset);
  return (
    <GameShell gameName="Dino Runner" appId="dino-runner" canPause={false} onRestart={reset}>
      <DinoRunnerGame />
    </GameShell>
  );
}
