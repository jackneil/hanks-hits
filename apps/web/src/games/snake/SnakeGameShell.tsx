"use client";

// Route-level wrapper: hangs Snake inside the shared GameShell (home, title,
// pause button, ESC + pause-on-blur, fullscreen, leaderboard) and wires the
// shell's pause to the game's own store. Before this, the route mounted a bare
// <GameShell canPause> with no onPause/onResume, so the shell's pause menu and
// the game's own Space/ESC pause were two independent states that could desync.
// The store lives in this module, so the wiring belongs here, not in the thin
// route page.

import { GameShell } from "@/shared/components";
import { SnakeGame } from "./Game";
import { useSnakeStore } from "./lib/store";

export function SnakeGameShell() {
  const status = useSnakeStore((s) => s.status);
  const pauseGame = useSnakeStore((s) => s.pauseGame);
  const resumeGame = useSnakeStore((s) => s.resumeGame);
  const reset = useSnakeStore((s) => s.reset);

  // Pausing only makes sense mid-round; gating canPause here keeps the shell's
  // pause menu (and ESC / pause button / pause-on-blur) off the idle and
  // game-over screens, matching the store's own pauseGame guard (it only
  // transitions "playing" -> "paused").
  const canPause = status === "playing" || status === "paused";

  return (
    <GameShell
      gameName="Snake"
      appId="snake"
      canPause={canPause}
      onRestart={reset}
      onPause={pauseGame}
      onResume={resumeGame}
    >
      <SnakeGame />
    </GameShell>
  );
}

export default SnakeGameShell;
