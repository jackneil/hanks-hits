"use client";

import dynamic from "next/dynamic";
import { GameShell } from "@/shared/components";

const FourWheelerAdventureGame = dynamic(
  () => import("@/games/four-wheeler-adventure"),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-[#1f6b3a] flex flex-col items-center justify-center">
        <div className="text-6xl mb-4 animate-bounce">🐕</div>
        <h1 className="text-4xl font-bold text-white mb-4">
          Four-Wheeler Adventure
        </h1>
        <div className="w-64 h-2 bg-black/30 rounded-full overflow-hidden">
          <div
            className="h-full bg-yellow-400 rounded-full animate-pulse"
            style={{ width: "30%" }}
          />
        </div>
        <p className="text-white/70 mt-4">Loading game...</p>
      </div>
    ),
  }
);

export default function FourWheelerAdventurePage() {
  return (
    <GameShell
      gameName="Four-Wheeler Adventure"
      appId="four-wheeler-adventure"
      canPause={false}
    >
      <FourWheelerAdventureGame />
    </GameShell>
  );
}
