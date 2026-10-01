"use client";

// Route-level wrapper: hangs Blitz Bomber inside the shared GameShell (home,
// title, pause button, ESC + pause-on-blur, fullscreen, leaderboard) and wires
// the shell's pause to the game's own store. Blitz Bomber had NO pause state at
// all, so the shell's pause menu used to open while the plane kept flying (and
// crashing) behind it. The store now carries a transient "paused" state that
// freezes the game loop; the wiring belongs here, not in the thin route page.

//
// The sound switch lives in the pause menu and on the result chip (phone UX
// audit 2026-09-29), so the play screen is all sky for the tap-to-bomb.

import { GameShell } from "@/shared/components";
import { BlitzBomberGame, SOUND_LABELS } from "./Game";
import { useBlitzBomberStore } from "./lib/store";

/** The look of a pause-menu button (PauseMenu's own MENU_BUTTON). */
const MENU_BUTTON =
  "btn btn-lg text-xl gap-3 shadow-lg hover:scale-105 transition-transform w-full short:h-11 short:min-h-11 short:text-lg";

function BlitzBomberPauseSettings() {
  const soundEnabled = useBlitzBomberStore((s) => s.progress.settings.soundEnabled);
  const setSoundEnabled = useBlitzBomberStore((s) => s.setSoundEnabled);
  return (
    <button type="button" onClick={() => setSoundEnabled(!soundEnabled)} className={MENU_BUTTON}>
      <span className="text-2xl" aria-hidden="true">{soundEnabled ? "🔊" : "🔇"}</span>
      {soundEnabled ? SOUND_LABELS.on : SOUND_LABELS.off}
    </button>
  );
}

export function BlitzBomberGameShell() {
  const gameState = useBlitzBomberStore((s) => s.gameState);
  const pauseGame = useBlitzBomberStore((s) => s.pauseGame);
  const resumeGame = useBlitzBomberStore((s) => s.resumeGame);
  const resetGame = useBlitzBomberStore((s) => s.reset);

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
      onPause={pauseGame}
      onResume={resumeGame}
      onRestart={resetGame}
      pauseMenuChildren={<BlitzBomberPauseSettings />}
    >
      <BlitzBomberGame />
    </GameShell>
  );
}

export default BlitzBomberGameShell;
