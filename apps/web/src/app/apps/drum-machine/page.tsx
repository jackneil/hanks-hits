"use client";

import dynamic from "next/dynamic";
import { ProgressHydrationBoundary } from "@/shared/components/ProgressHydrationBoundary";
import { GameShell } from "@/shared/components";

const loadProgressModule = () => import("@/apps/drum-machine");

const DrumMachine = dynamic(loadProgressModule, {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center min-h-full bg-slate-900">
      <div className="text-6xl mb-4 animate-bounce">🥁</div>
      <div className="text-2xl text-white animate-pulse">Loading Drum Machine...</div>
    </div>
  ),
});

function DrumMachinePageContent() {
  return (
    <GameShell gameName="Drum Machine" canPause={false}>
      <DrumMachine />
    </GameShell>
  );
}

export default function DrumMachinePage() {
  return (
    <ProgressHydrationBoundary appId="drum-machine" loadModule={loadProgressModule}>
      <DrumMachinePageContent />
    </ProgressHydrationBoundary>
  );
}
