"use client";

// Route-level wrapper: hangs Hank's Hopper inside the shared GameShell (home,
// title, pause button, ESC + pause-on-blur, fullscreen, leaderboard) and wires
// the shell's pause to the game's own store. The platformer had NO pause state
// at all, so the shell's pause menu used to open while the player kept running
// (and dying) behind it. The store now carries a transient "paused" state that
// freezes the game loop; the wiring belongs here, not in the thin route page.

import { GameShell } from "@/shared/components";
import { PlatformerGame } from "./Game";
import { usePlatformerStore } from "./lib/store";

export function PlatformerGameShell() {
  const gameState = usePlatformerStore((s) => s.gameState);
  const pauseGame = usePlatformerStore((s) => s.pauseGame);
  const resumeGame = usePlatformerStore((s) => s.resumeGame);
  const resetGame = usePlatformerStore((s) => s.reset);

  // Pausing only makes sense mid-level; gating canPause here keeps the shell's
  // pause menu (and ESC / pause button / pause-on-blur) off the ready, gameOver
  // and levelComplete screens, matching the store's own pauseGame guard (it
  // only transitions "playing" -> "paused").
  const canPause = gameState === "playing" || gameState === "paused";

  return (
    <GameShell
      gameName="Hank's Hopper"
      appId="platformer"
      canPause={canPause}
      onPause={pauseGame}
      onResume={resumeGame}
      onRestart={resetGame}
    >
      <PlatformerGame />
    </GameShell>
  );
}

export default PlatformerGameShell;
