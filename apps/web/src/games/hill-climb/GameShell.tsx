"use client";

import { GameShell } from "@/shared/components";
import { HillClimbGame, useHillClimbStore } from ".";

export default function HillClimbGameShell() {
  const restartRun = useHillClimbStore((state) => state.restartRun);
  return (
    <GameShell gameName="Hill Climb" appId="hill-climb" canPause={false} showPauseButton={false} onRestart={restartRun}>
      <HillClimbGame />
    </GameShell>
  );
}
