"use client";

import { GameShell } from "@/shared/components";
import { FlappyBirdGame, useFlappyStore } from ".";

export default function FlappyBirdGameShell() {
  const reset = useFlappyStore((state) => state.reset);
  return (
    <GameShell gameName="Flappy Bird" appId="flappy-bird" canPause={false} onRestart={reset}>
      <FlappyBirdGame />
    </GameShell>
  );
}
