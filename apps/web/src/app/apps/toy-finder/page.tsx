"use client";

import dynamic from "next/dynamic";
import { GameShell } from "@/shared/components";

const ToyFinder = dynamic(
  () => import("@/apps/toy-finder"),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-full bg-gradient-to-b from-blue-400 via-blue-500 to-purple-500 flex flex-col items-center justify-center">
        <div className="text-6xl mb-4 animate-bounce">&#x1F381;</div>
        <h1 className="text-4xl font-bold text-white mb-4">Toy Finder</h1>
        <div className="w-64 h-2 bg-white/30 rounded-full overflow-hidden">
          <div className="h-full bg-yellow-400 rounded-full animate-pulse" style={{ width: "30%" }} />
        </div>
        <p className="text-white mt-4">Loading awesome toys...</p>
      </div>
    ),
  }
);

export default function ToyFinderPage() {
  return (
    <GameShell gameName="Toy Finder" canPause={false}>
      <ToyFinder />
    </GameShell>
  );
}
