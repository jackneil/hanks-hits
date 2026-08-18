"use client";

import dynamic from "next/dynamic";
import { GameShell } from "@/shared/components";
import { useRetroArcadeStore } from "@/games/retro-arcade/lib/store";

const RetroArcadeGame = dynamic(
  () => import("@/games/retro-arcade"),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 flex flex-col items-center justify-center">
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

export default function RetroArcadePage() {
  const restartGame = useRetroArcadeStore((state) => state.restartGame);
  const isPlaying = useRetroArcadeStore((state) => state.isPlaying);

  return (
    <GameShell
      gameName="Retro Arcade"
      canPause={false}
      onRestart={isPlaying ? restartGame : undefined}
    >
      <RetroArcadeGame />
    </GameShell>
  );
}
