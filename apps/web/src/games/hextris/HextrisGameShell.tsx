"use client";

// Route-level wrapper: hangs Hextris inside the shared GameShell (home, title,
// pause button, ESC + pause-on-blur, fullscreen, leaderboard) and wires the
// shell's pause to the game's own store. Before this, the route mounted a bare
// <GameShell canPause> with no onPause/onResume, so the shell's pause menu and
// the game's own P/ESC pause were two independent states that could desync. The
// store lives in this module, so the wiring belongs here, not in the thin route
// page.

import { GameShell } from "@/shared/components";
import { HextrisGame } from "./Game";
import { useHextrisStore } from "./lib/store";

export function HextrisGameShell() {
  const status = useHextrisStore((s) => s.status);
  const pauseGame = useHextrisStore((s) => s.pauseGame);
  const resumeGame = useHextrisStore((s) => s.resumeGame);
  const startGame = useHextrisStore((s) => s.startGame);

  // Pausing only makes sense mid-round; gating canPause here keeps the shell's
  // pause menu (and ESC / pause button / pause-on-blur) off the idle and
  // game-over screens, matching the store's own pauseGame guard (it only
  // transitions "playing" -> "paused").
  const canPause = status === "playing" || status === "paused";

  return (
    <GameShell
      gameName="Hextris"
      appId="hextris"
      canPause={canPause}
      onRestart={startGame}
      onPause={pauseGame}
      onResume={resumeGame}
    >
      <HextrisGame />
    </GameShell>
  );
}

export default HextrisGameShell;
