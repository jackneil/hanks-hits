"use client";

import dynamic from "next/dynamic";
import { GameShell } from "@/shared/components";

const DrumMachine = dynamic(() => import("@/apps/drum-machine"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center min-h-full bg-slate-900">
      <div className="text-6xl mb-4 animate-bounce">🥁</div>
      <div className="text-2xl text-white animate-pulse">Loading Drum Machine...</div>
    </div>
  ),
});

export default function DrumMachinePage() {
  return (
    <GameShell gameName="Drum Machine" canPause={false}>
      <DrumMachine />
    </GameShell>
  );
}
