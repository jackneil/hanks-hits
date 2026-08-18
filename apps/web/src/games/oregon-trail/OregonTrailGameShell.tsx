"use client";

// Route-level wrapper: hangs Oregon Trail inside the shared GameShell (home,
// title, pause button, ESC + pause-on-blur, fullscreen, leaderboard). Only the
// Hunting minigame runs a real-time loop (timer + spawner + rAF animation); the
// other phases are menu-driven and have nothing to freeze. So the shell's pause
// is gated to the hunting phase and wired to a transient hunt-pause flag that
// the Hunting component reads. That flag lives in its own non-persisted store,
// so a paused hunt is never written to storage.

import { useMemo } from "react";
import { GameShell } from "@/shared/components";
import OregonTrailGame from "./Game";
import { useOregonTrailStore } from "./lib/store";
import { useHuntPauseStore } from "./lib/huntPause";

export function OregonTrailGameShell() {
  const gamePhase = useOregonTrailStore((s) => s.gamePhase);
  const leaderName = useOregonTrailStore((s) => s.leaderName);
  const occupation = useOregonTrailStore((s) => s.occupation);
  const party = useOregonTrailStore((s) => s.party);
  const departureMonth = useOregonTrailStore((s) => s.departureMonth);
  const gameStarted = useOregonTrailStore((s) => s.gameStarted);
  const startGame = useOregonTrailStore((s) => s.startGame);
  const resetGame = useOregonTrailStore((s) => s.resetGame);
  const setPaused = useHuntPauseStore((s) => s.setPaused);
  const partyMemberNames = useMemo(() => party.map((member) => member.name), [party]);

  // Restart the current journey with its existing setup. On the title screen,
  // there is no journey to restart, so reset only the transient setup state.
  const restartGame = () => {
    if (gameStarted && partyMemberNames.length > 0) {
      startGame(leaderName, occupation, partyMemberNames, departureMonth);
    } else {
      resetGame();
    }
  };

  // Pausing only makes sense during the hunt (the only real-time phase). This
  // keeps the shell's pause menu off the title, store, travel, event, river,
  // and end screens, which have no loop to freeze.
  const canPause = gamePhase === "hunting";

  return (
    <GameShell
      gameName="Oregon Trail"
      appId="oregon-trail"
      canPause={canPause}
      onRestart={restartGame}
      onPause={() => setPaused(true)}
      onResume={() => setPaused(false)}
    >
      <OregonTrailGame />
    </GameShell>
  );
}

export default OregonTrailGameShell;
