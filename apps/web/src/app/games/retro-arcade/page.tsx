"use client";

import dynamic from "next/dynamic";
import { GameShell } from "@/shared/components";

const RetroArcadeGame = dynamic(
  () => import("@/games/retro-arcade"),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-full bg-gradient-to-b from-gray-900 to-gray-800 flex flex-col items-center justify-center">
        <div className="text-6xl mb-4 animate-bounce">🕹️</div>
        <h1 className="text-4xl font-bold text-white mb-4">Retro Arcade</h1>
        <div className="w-64 h-2 bg-black/30 rounded-full overflow-hidden">
          <div className="h-full bg-blue-400 rounded-full animate-pulse" style={{ width: "30%" }} />
        </div>
        <p className="text-white/60 mt-4">Loading arcade...</p>
      </div>
    ),
  }
);

// No onRestart here: a game runs in the full-screen emulator view, which
// sits above this header. Its own top bar has the restart button (with the
// same confirmation dialog). On the other screens nothing is running, so a
// restart button in this header would do nothing.
export default function RetroArcadePage() {
  return (
    <GameShell appId="retro-arcade" gameName="Retro Arcade" canPause={false}>
      <RetroArcadeGame />
    </GameShell>
  );
}
