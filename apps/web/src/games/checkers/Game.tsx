"use client";

import { useEffect, useState } from "react";
import { Board } from "./components/Board";
import { GameUI } from "./components/GameUI";
import { useCheckersStore } from "./lib/store";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import { GameStartOverlay } from "@/shared/components/GameStartOverlay";

export function CheckersGame() {
  const store = useCheckersStore();
  const { status, progress } = store;

  // Checkers plays from mount, so there is no store-level "before" state. This
  // per-mount gate gives the player a real start moment: the shared overlay
  // covers the board AND the config panel until Play is pressed, so a stray tap
  // cannot move a piece before the player has read the hints.
  const [hasStarted, setHasStarted] = useState(false);

  // Sync with auth system
  const { isAuthenticated, syncStatus, forceSync } = useAuthSync({
    appId: "checkers",
    localStorageKey: "checkers-progress",
    getState: () => store.getProgress(),
    setState: (data) => store.setProgress(data),
    debounceMs: 2000,
  });

  // Force save immediately on game end
  useEffect(() => {
    if (status === "red-wins" || status === "black-wins" || status === "draw") {
      forceSync();
    }
  }, [status, forceSync]);

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-amber-800 to-amber-950 p-4 flex flex-col items-center justify-center gap-6">
      {/* iOS install prompt */}
      <IOSInstallPrompt />


      <Board />
      <GameUI />

      {/* Shared start screen. Mounted on the relative page container (not the
          board box) so the card never clips on a phone, and so it also covers
          the mode/difficulty panel underneath. */}
      {!hasStarted && (
        <GameStartOverlay
          title="Checkers"
          emoji="🔴"
          subtitle="Jump the other pieces and win!"
          touchHints={[
            "👆 Tap a piece, then tap where it goes",
            "⭐ Jump over a piece to take it",
            "👑 Reach the far row to get a crown",
          ]}
          keyboardHints={[
            "🖱️ Click a piece, then click where it goes",
            "⭐ Jump over a piece to take it",
            "👑 Reach the far row to get a crown",
          ]}
          onStart={() => setHasStarted(true)}
        >
          {progress.gamesPlayed > 0 && (
            <div className="text-base font-medium opacity-90">
              🏆 Wins: {progress.gamesWon} · 🔥 Best streak:{" "}
              {progress.bestWinStreak}
            </div>
          )}
        </GameStartOverlay>
      )}

      {/* Sync status indicator */}
      {isAuthenticated && (
        <div className="fixed bottom-2 right-2 text-xs text-amber-300/60">
          {syncStatus === "syncing" ? "Saving..." : syncStatus === "synced" ? "Saved" : ""}
        </div>
      )}
    </div>
  );
}

export default CheckersGame;
