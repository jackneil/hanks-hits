"use client";

// Route-level wrapper: hangs Math Attack inside the shared GameShell and wires
// the shell's pause to the game's store. The game had canPause={false}, so a
// kid had no way to stop the falling problems, and a phone that lost focus
// kept dropping them (phone UX audit 2026-09-29). The sound switch lives in
// the pause menu (and on the result chip).

import { GameShell } from "@/shared/components";
import { MathAttackGame, useMathAttackStore } from ".";
import { SOUND_LABELS } from "./Game";

/** The look of a pause-menu button (PauseMenu's own MENU_BUTTON). */
const MENU_BUTTON =
  "btn btn-lg text-xl gap-3 shadow-lg hover:scale-105 transition-transform w-full short:h-11 short:min-h-11 short:text-lg";

function MathAttackPauseSettings() {
  const soundEnabled = useMathAttackStore((s) => s.settings.soundEnabled);
  const setSoundEnabled = useMathAttackStore((s) => s.setSoundEnabled);
  return (
    <button type="button" onClick={() => setSoundEnabled(!soundEnabled)} className={MENU_BUTTON}>
      <span className="text-2xl" aria-hidden="true">{soundEnabled ? "🔊" : "🔇"}</span>
      {soundEnabled ? SOUND_LABELS.on : SOUND_LABELS.off}
    </button>
  );
}

export default function MathAttackGameShell() {
  const gameState = useMathAttackStore((s) => s.gameState);
  const reset = useMathAttackStore((s) => s.reset);
  const pauseGame = useMathAttackStore((s) => s.pauseGame);
  const resumeGame = useMathAttackStore((s) => s.resumeGame);
  return (
    <GameShell
      gameName="Math Attack"
      appId="math-attack"
      canPause={gameState === "playing" || gameState === "paused"}
      onPause={pauseGame}
      onResume={resumeGame}
      onRestart={reset}
      pauseMenuChildren={<MathAttackPauseSettings />}
    >
      <MathAttackGame />
    </GameShell>
  );
}
