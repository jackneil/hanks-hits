"use client";

// Route-level wrapper: hangs Breakout inside the shared GameShell (home, title,
// pause button, ESC + pause-on-blur, fullscreen, leaderboard) and wires the
// shell's pause to the game's own store. Before this, the route mounted a bare
// <GameShell canPause> with no onPause/onResume, so the shell's pause menu and
// the game's own P/ESC pause were two independent states that could desync. The
// store lives in this module, so the wiring belongs here, not in the thin route
// page.

import { GameShell } from "@/shared/components";
import { BreakoutGame } from "./Game";
import { useBreakoutStore } from "./lib/store";

export function BreakoutGameShell() {
  const status = useBreakoutStore((s) => s.status);
  const pauseGame = useBreakoutStore((s) => s.pauseGame);
  const resumeGame = useBreakoutStore((s) => s.resumeGame);
  const restartLevel = useBreakoutStore((s) => s.restartLevel);

  // Pausing only makes sense mid-round; gating canPause here keeps the shell's
  // pause menu (and ESC / pause button / pause-on-blur) off the idle, game-over
  // and level-complete screens, matching the store's own pauseGame guard (it
  // only transitions "playing" -> "paused").
  const canPause = status === "playing" || status === "paused";

  return (
    <GameShell
      gameName="Breakout"
      appId="breakout"
      canPause={canPause}
      onRestart={restartLevel}
      restartConfirmationMessage="Restart this level? Your progress in the current level will be lost."
      onPause={pauseGame}
      onResume={resumeGame}
    >
      <BreakoutGame />
    </GameShell>
  );
}

export default BreakoutGameShell;
