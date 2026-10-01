"use client";

// Route-level wrapper: hangs Hextris inside the shared GameShell (home, title,
// pause button, ESC + pause-on-blur, fullscreen, leaderboard) and wires the
// shell's pause to the game's own store. Before this, the route mounted a bare
// <GameShell canPause> with no onPause/onResume, so the shell's pause menu and
// the game's own P/ESC pause were two independent states that could desync. The
// store lives in this module, so the wiring belongs here, not in the thin route
// page.
//
// The shell owns the pause (the game's own II button is gone, phone UX audit
// 2026-09-29). The sound switch lives in the pause menu and on the result
// chip, so the play screen keeps its room for the field and the spin buttons.

import { GameShell } from "@/shared/components";
import { HextrisGame, SOUND_LABELS } from "./Game";
import { useHextrisStore } from "./lib/store";

/** The look of a pause-menu button (PauseMenu's own MENU_BUTTON). */
const MENU_BUTTON =
  "btn btn-lg text-xl gap-3 shadow-lg hover:scale-105 transition-transform w-full short:h-11 short:min-h-11 short:text-lg";

function HextrisPauseSettings() {
  const progress = useHextrisStore((s) => s.progress);
  const setProgress = useHextrisStore((s) => s.setProgress);
  const soundEnabled = progress.soundEnabled;
  return (
    <button
      type="button"
      onClick={() => setProgress({ ...progress, soundEnabled: !soundEnabled, lastModified: Date.now() })}
      className={MENU_BUTTON}
    >
      <span className="text-2xl" aria-hidden="true">{soundEnabled ? "🔊" : "🔇"}</span>
      {soundEnabled ? SOUND_LABELS.on : SOUND_LABELS.off}
    </button>
  );
}

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
      pauseMenuChildren={<HextrisPauseSettings />}
    >
      <HextrisGame />
    </GameShell>
  );
}

export default HextrisGameShell;
