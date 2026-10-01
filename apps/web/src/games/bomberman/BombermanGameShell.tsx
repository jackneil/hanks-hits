"use client";

// Route-level wrapper: hangs Bomberman inside the shared GameShell (home, title,
// pause button, ESC + pause-on-blur, fullscreen, leaderboard) and wires the
// shell's pause to the game's own store. Before this, the route mounted a bare
// <GameShell canPause> with no onPause/onResume, so the shell's pause menu and
// the game's own P/ESC pause were two independent states that could desync. The
// store lives in this module, so the wiring belongs here, not in the thin route
// page.
//
// The shell owns the pause: the game's own pause button, its PAUSED modal and
// the controls toggle are gone (phone UX audit 2026-09-29). The sound switch
// lives in the pause menu (and on the result chip).

import { GameShell } from "@/shared/components";
import { BombermanGame, SOUND_LABELS } from "./Game";
import { useBombermanStore } from "./lib/store";

/** The look of a pause-menu button (PauseMenu's own MENU_BUTTON). */
const MENU_BUTTON =
  "btn btn-lg text-xl gap-3 shadow-lg hover:scale-105 transition-transform w-full short:h-11 short:min-h-11 short:text-lg";

function BombermanPauseSettings() {
  const soundEnabled = useBombermanStore((s) => s.progress.settings.soundEnabled);
  const progress = useBombermanStore((s) => s.progress);
  const setProgress = useBombermanStore((s) => s.setProgress);
  return (
    <button
      type="button"
      onClick={() =>
        setProgress({ ...progress, settings: { ...progress.settings, soundEnabled: !soundEnabled } })
      }
      className={MENU_BUTTON}
    >
      <span className="text-2xl" aria-hidden="true">{soundEnabled ? "🔊" : "🔇"}</span>
      {soundEnabled ? SOUND_LABELS.on : SOUND_LABELS.off}
    </button>
  );
}

export function BombermanGameShell() {
  const gameState = useBombermanStore((s) => s.gameState);
  const pauseGame = useBombermanStore((s) => s.pauseGame);
  const resumeGame = useBombermanStore((s) => s.resumeGame);
  const startGame = useBombermanStore((s) => s.startGame);

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
      // Restart is a new run at once (the result chip's Play again does the
      // same); the shell asks its question first in the middle of a run.
      onRestart={startGame}
      onPause={pauseGame}
      onResume={resumeGame}
      pauseMenuChildren={<BombermanPauseSettings />}
    >
      <BombermanGame />
    </GameShell>
  );
}

export default BombermanGameShell;
