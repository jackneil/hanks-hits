"use client";

// Route-level wrapper: hangs Space Invaders inside the shared GameShell (home,
// title, pause button, ESC + pause-on-blur, fullscreen, leaderboard) and wires
// the shell's pause to the game's own store. Before this, the route mounted a
// bare <GameShell canPause> with no onPause/onResume, so the shell's pause menu
// and the game's own P/ESC pause were two independent states: ESC paused both,
// then the menu's Resume closed the menu but left the game frozen behind it.
// The store lives in this module, so the wiring belongs here, not in the thin
// route page.

import { GameShell } from "@/shared/components";
import { SpaceInvadersGame } from "./Game";
import { useSpaceInvadersStore } from "./lib/store";

export function SpaceInvadersGameShell() {
  const gameState = useSpaceInvadersStore((s) => s.gameState);
  const pauseGame = useSpaceInvadersStore((s) => s.pauseGame);
  const resumeGame = useSpaceInvadersStore((s) => s.resumeGame);

  // Pausing only makes sense mid-round; gating canPause here keeps the shell's
  // pause menu (and ESC / pause button / pause-on-blur) off the ready,
  // game-over and wave-complete screens, matching the store's own pauseGame
  // guard (it only transitions "playing" -> "paused").
  const canPause = gameState === "playing" || gameState === "paused";

  return (
    <GameShell
      gameName="Space Invaders"
      appId="space-invaders"
      canPause={canPause}
      onPause={pauseGame}
      onResume={resumeGame}
    >
      <SpaceInvadersGame />
    </GameShell>
  );
}

export default SpaceInvadersGameShell;
