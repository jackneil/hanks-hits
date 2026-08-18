"use client";

import { GameShell } from "@/shared/components";
import { WordleGame, useWordleStore } from ".";

export default function WordleGameShell() {
  const reset = useWordleStore((state) => state.reset);
  return (
    <GameShell gameName="Wordle" appId="wordle" canPause={false} onRestart={reset}>
      <WordleGame />
    </GameShell>
  );
}
