"use client";

import { useState } from "react";
import { GameShell } from "@/shared/components";
import { HillClimbGame, useHillClimbStore } from ".";

export default function HillClimbGameShell() {
  const restartRun = useHillClimbStore((state) => state.restartRun);
  const [gameKey, setGameKey] = useState(0);

  // Matter.js owns the transient physics world. Remount the game so restart
  // tears down the old engine and creates a clean vehicle and terrain.
  const restart = () => {
    restartRun();
    setGameKey((key) => key + 1);
  };

  return (
    <GameShell
      gameName="Hill Climb"
      appId="hill-climb"
      canPause={false}
      showPauseButton={false}
      onRestart={restart}
    >
      <HillClimbGame key={gameKey} />
    </GameShell>
  );
}
