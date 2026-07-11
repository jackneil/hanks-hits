"use client";

import { useEffect } from "react";
import { Board } from "./components/Board";
import { GameUI } from "./components/GameUI";
import { useCheckersStore } from "./lib/store";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";

export function CheckersGame() {
  const store = useCheckersStore();
  const { status } = store;

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
    <div className="min-h-screen bg-gradient-to-b from-amber-800 to-amber-950 p-4 flex flex-col items-center justify-center gap-6">
      {/* iOS install prompt */}
      <IOSInstallPrompt />


      <Board />
      <GameUI />

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
