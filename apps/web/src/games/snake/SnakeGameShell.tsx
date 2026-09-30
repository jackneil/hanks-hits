"use client";

// Route-level wrapper: hangs Snake inside the shared GameShell (home, title,
// pause button, ESC + pause-on-blur, fullscreen, leaderboard) and wires the
// shell's pause to the game's own store. Before this, the route mounted a bare
// <GameShell canPause> with no onPause/onResume, so the shell's pause menu and
// the game's own Space/ESC pause were two independent states that could desync.
// The store lives in this module, so the wiring belongs here, not in the thin
// route page.
//
// The pause menu holds the two settings that a kid may change between
// moves: the walls (wrap around, or solid) and, on a touch screen, how to
// turn (arrows or swipe). They sat in a Settings panel two screens under
// the board, disabled during play (phone UX audit 2026-09-29). The speed
// is picked on the start card.

import { GameShell } from "@/shared/components";
import { useCoarsePointer } from "@/shared/hooks/useCoarsePointer";
import { SnakeGame } from "./Game";
import { useSnakeStore } from "./lib/store";

/** The look of a pause-menu button (PauseMenu's own MENU_BUTTON). */
const MENU_BUTTON =
  "btn btn-lg text-xl gap-3 shadow-lg hover:scale-105 transition-transform w-full short:h-11 short:min-h-11 short:text-lg";

export const WALL_LABELS = {
  wrap: "🧱 Walls: wrap around",
  solid: "🧱 Walls: solid",
} as const;

export const CONTROL_LABELS = {
  buttons: "🔼 Turn: arrows",
  swipe: "👆 Turn: swipe",
} as const;

function SnakePauseSettings() {
  const isCoarse = useCoarsePointer();
  const wraparound = useSnakeStore((s) => s.progress.wraparoundWalls);
  const controlMode = useSnakeStore((s) => s.progress.controlMode);
  const setWraparound = useSnakeStore((s) => s.setWraparound);
  const setControlMode = useSnakeStore((s) => s.setControlMode);
  return (
    <>
      <button
        type="button"
        onClick={() => setWraparound(!wraparound)}
        aria-pressed={wraparound}
        className={MENU_BUTTON}
      >
        {wraparound ? WALL_LABELS.wrap : WALL_LABELS.solid}
      </button>
      {isCoarse && (
        <button
          type="button"
          onClick={() => setControlMode(controlMode === "swipe" ? "buttons" : "swipe")}
          className={MENU_BUTTON}
        >
          {controlMode === "swipe" ? CONTROL_LABELS.swipe : CONTROL_LABELS.buttons}
        </button>
      )}
    </>
  );
}

export function SnakeGameShell() {
  const status = useSnakeStore((s) => s.status);
  const pauseGame = useSnakeStore((s) => s.pauseGame);
  const resumeGame = useSnakeStore((s) => s.resumeGame);
  const startGame = useSnakeStore((s) => s.startGame);

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
      onPause={pauseGame}
      onResume={resumeGame}
      // Restart is a new run at once (the result chip's Play again does the
      // same); the shell asks its question first in the middle of a run.
      onRestart={startGame}
      pauseMenuChildren={<SnakePauseSettings />}
    >
      <SnakeGame />
    </GameShell>
  );
}

export default SnakeGameShell;
