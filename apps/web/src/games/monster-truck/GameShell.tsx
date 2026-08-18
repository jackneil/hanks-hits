"use client";

import { useState } from "react";
import { GameShell } from "@/shared/components";
import { MonsterTruckGame, useGameStore } from ".";

export default function MonsterTruckGameShell() {
  const resetSession = useGameStore((state) => state.resetSession);
  const [gameKey, setGameKey] = useState(0);

  // The 3D scene owns the transient rigid-body world. Remount it for a real
  // reset, while resetSession clears only the run counters and keeps progress.
  const restart = () => {
    resetSession();
    setGameKey((key) => key + 1);
  };

  return (
    <GameShell
      gameName="Monster Truck"
      appId="monster-truck"
      canPause={false}
      showPauseButton={false}
      onRestart={restart}
      restartConfirmationMessage="This resets the current session stats. Your coins, stars, challenges, trucks, upgrades, and settings stay saved."
    >
      <MonsterTruckGame key={gameKey} />
    </GameShell>
  );
}
