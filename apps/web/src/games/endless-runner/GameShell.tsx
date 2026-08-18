"use client";

import { GameShell } from "@/shared/components";
import { EndlessRunnerGame, useEndlessRunnerStore } from ".";

export default function EndlessRunnerGameShell() {
  const reset = useEndlessRunnerStore((state) => state.reset);
  return (
    <GameShell gameName="Endless Runner" appId="endless-runner" canPause={false} onRestart={reset}>
      <EndlessRunnerGame />
    </GameShell>
  );
}
