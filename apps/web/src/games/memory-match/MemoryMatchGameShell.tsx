"use client";

// Route-level wrapper: hangs Memory Match inside the shared GameShell (home,
// title, pause button, ESC + pause-on-blur, fullscreen, leaderboard) and wires
// the shell's pause to the game's timer. Before this, the round timer kept
// counting behind the shell's pause menu (it is anchored to a wall-clock start
// time), inflating the recorded time. The store now pauses/resumes that timer;
// the wiring belongs here, not in the thin route page.

import { GameShell } from "@/shared/components";
import { MemoryMatchGame } from "./Game";
import { useMemoryMatchStore } from "./lib/store";

export function MemoryMatchGameShell() {
  const isPlaying = useMemoryMatchStore((s) => s.isPlaying);
  const isWon = useMemoryMatchStore((s) => s.isWon);
  const pauseTimer = useMemoryMatchStore((s) => s.pauseTimer);
  const resumeTimer = useMemoryMatchStore((s) => s.resumeTimer);
  const newGame = useMemoryMatchStore((s) => s.newGame);

  // Pausing only matters once the timer is running (after the first flip) and
  // before the win modal; gating canPause keeps the shell's pause menu off the
  // pre-game board (difficulty/theme pickers) and the win screen, matching the
  // store's own pauseTimer guard.
  const canPause = isPlaying && !isWon;

  return (
    <GameShell
      gameName="Memory Match"
      appId="memory-match"
      canPause={canPause}
      onRestart={newGame}
      onPause={pauseTimer}
      onResume={resumeTimer}
      onRestart={newGame}
    >
      <MemoryMatchGame />
    </GameShell>
  );
}

export default MemoryMatchGameShell;
