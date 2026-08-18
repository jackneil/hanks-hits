"use client";

// Route-level wrapper: hangs Blitz Bomber inside the shared GameShell (home,
// title, pause button, ESC + pause-on-blur, fullscreen, leaderboard) and wires
// the shell's pause to the game's own store. Blitz Bomber had NO pause state at
// all, so the shell's pause menu used to open while the plane kept flying (and
// crashing) behind it. The store now carries a transient "paused" state that
// freezes the game loop; the wiring belongs here, not in the thin route page.

import { GameShell } from "@/shared/components";
import { BlitzBomberGame } from "./Game";
import { useBlitzBomberStore } from "./lib/store";

export function BlitzBomberGameShell() {
  const gameState = useBlitzBomberStore((s) => s.gameState);
  const pauseGame = useBlitzBomberStore((s) => s.pauseGame);
  const resumeGame = useBlitzBomberStore((s) => s.resumeGame);
  const reset = useBlitzBomberStore((s) => s.reset);

  // Pausing only makes sense mid-flight; gating canPause here keeps the shell's
  // pause menu (and ESC / pause button / pause-on-blur) off the ready, crashed
  // and landed screens, matching the store's own pauseGame guard (it only
  // transitions "playing" -> "paused").
  const canPause = gameState === "playing" || gameState === "paused";

  return (
    <GameShell
      gameName="Blitz Bomber"
      appId="blitz-bomber"
      canPause={canPause}
      onRestart={reset}
      onPause={pauseGame}
      onResume={resumeGame}
    >
      <BlitzBomberGame />
    </GameShell>
  );
}

export default BlitzBomberGameShell;
