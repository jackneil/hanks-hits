"use client";

import dynamic from "next/dynamic";
import { GameShell } from "@/shared/components";

const VirtualPet = dynamic(() => import("@/apps/virtual-pet"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center min-h-full bg-amber-50">
      <div className="text-6xl mb-4 animate-bounce">🐣</div>
      <div className="text-2xl text-amber-800 animate-pulse">Loading Virtual Pet...</div>
    </div>
  ),
});

export default function VirtualPetPage() {
  return (
    <GameShell gameName="Virtual Pet" canPause={false}>
      <VirtualPet />
    </GameShell>
  );
}
