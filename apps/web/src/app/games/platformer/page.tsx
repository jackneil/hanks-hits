"use client";

import dynamic from "next/dynamic";
import { GameShell } from "@/shared/components";

const PlatformerGame = dynamic(() => import("@/games/platformer"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-gradient-to-b from-sky-400 to-sky-600 flex flex-col items-center justify-center">
      <div className="text-6xl mb-4 animate-bounce">*</div>
      <h1 className="text-4xl font-bold text-white mb-4">Hank&apos;s Hopper</h1>
      <div className="w-64 h-2 bg-black/30 rounded-full overflow-hidden">
        <div
          className="h-full bg-green-400 rounded-full animate-pulse"
          style={{ width: "30%" }}
        />
      </div>
      <p className="text-sky-100 mt-4">Loading game...</p>
    </div>
  ),
});

export default function PlatformerPage() {
  return (
    <GameShell gameName="Hank's Hopper" appId="platformer" canPause>
      <PlatformerGame />
    </GameShell>
  );
}
