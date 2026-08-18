"use client";

// Route-level wrapper: hangs Bomberman inside the shared GameShell (home, title,
// pause button, ESC + pause-on-blur, fullscreen, leaderboard) and wires the
// shell's pause to the game's own store. Before this, the route mounted a bare
// <GameShell canPause> with no onPause/onResume, so the shell's pause menu and
// the game's own P/ESC pause were two independent states that could desync. The
// store lives in this module, so the wiring belongs here, not in the thin route
// page.

import { GameShell } from "@/shared/components";
import { BombermanGame } from "./Game";
import { useBombermanStore } from "./lib/store";

export function BombermanGameShell() {
  const gameState = useBombermanStore((s) => s.gameState);
  const pauseGame = useBombermanStore((s) => s.pauseGame);
  const resumeGame = useBombermanStore((s) => s.resumeGame);
  const resetGame = useBombermanStore((s) => s.resetGame);

  // The store's pauseGame/resumeGame set the state unconditionally, so gate
  // canPause to the in-round states here — otherwise the shell's ESC / pause
  // button / pause-on-blur could force "paused" over the menu or won/lost
  // screens.
  const canPause = gameState === "playing" || gameState === "paused";

  return (
    <GameShell
      gameName="Bomberman"
      appId="bomberman"
      canPause={canPause}
      onRestart={resetGame}
      onPause={pauseGame}
      onResume={resumeGame}
    >
      <BombermanGame />
    </GameShell>
  );
}

export default BombermanGameShell;
