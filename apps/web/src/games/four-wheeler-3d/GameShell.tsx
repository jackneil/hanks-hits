"use client";
import { saveRiderPosition } from "./components/AdventureRuntime";
import { resetActivitiesSession } from "./lib/activitiesSession";

import { useState } from "react";
import { GameShell } from "@/shared/components";
import { FourWheeler3dGame, useFourWheeler3dStore } from ".";
import { useAdventureSession } from "./lib/adventureSession";

export default function FourWheeler3dGameShell() {
  const resetSession = useFourWheeler3dStore((state) => state.resetSession);
  const [gameKey, setGameKey] = useState(0);

  // The 3D scene owns the transient rigid-body world. Remount it for a real
  // reset, while resetSession clears only the run state and keeps progress.
  const restart = () => {
    saveRiderPosition();
    resetActivitiesSession();
    resetSession();
    useAdventureSession.getState().reset();
    setGameKey((key) => key + 1);
  };

  return (
    <GameShell
      gameName="Four-Wheeler Adventure 3D"
      appId="four-wheeler-3d"
      headerClassName="fw-shell-header"
      canPause={false}
      showPauseButton={false}
      onRestart={restart}
      restartConfirmationMessage="This starts the ride over. Your money, vehicles, land, and trophies stay saved."
    >
      <FourWheeler3dGame key={gameKey} />
    </GameShell>
  );
}
