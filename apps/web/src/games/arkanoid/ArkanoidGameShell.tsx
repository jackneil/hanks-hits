"use client";

// Route-level wrapper: hangs Arkanoid inside the shared GameShell (home,
// title, pause button, ESC + pause-on-blur, fullscreen, leaderboard) and wires
// the shell's pause to Arkanoid's own store. The store lives in this module, so
// the wiring belongs here rather than in the thin route page.

import { GameShell } from "@/shared/components";
import { ArkanoidGame } from "./Game";
import { useArkanoidStore } from "./lib/store";

export function ArkanoidGameShell() {
  const gameState = useArkanoidStore((s) => s.gameState);
  const pauseGame = useArkanoidStore((s) => s.pauseGame);
  const resumeGame = useArkanoidStore((s) => s.resumeGame);
  const startGame = useArkanoidStore((s) => s.startGame);

  // Mirror the old HUD pause button's disabled logic: pausing is only
  // meaningful while a round is in progress, never on the menu or game-over
  // screens. Gating canPause here also keeps the shell's pause menu from
  // popping up over those screens.
  const canPause = gameState === "playing" || gameState === "paused";

  return (
    <GameShell
      gameName="Arkanoid"
      appId="arkanoid"
      canPause={canPause}
      onRestart={startGame}
      onPause={pauseGame}
      onResume={resumeGame}
    >
      <ArkanoidGame />
    </GameShell>
  );
}

export default ArkanoidGameShell;
