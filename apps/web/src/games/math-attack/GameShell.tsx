"use client";

import { GameShell } from "@/shared/components";
import { MathAttackGame, useMathAttackStore } from ".";

export default function MathAttackGameShell() {
  const reset = useMathAttackStore((state) => state.reset);
  return (
    <GameShell gameName="Math Attack" appId="math-attack" canPause={false} onRestart={reset}>
      <MathAttackGame />
    </GameShell>
  );
}
