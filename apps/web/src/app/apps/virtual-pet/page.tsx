"use client";

import dynamic from "next/dynamic";
import { ProgressHydrationBoundary } from "@/shared/components/ProgressHydrationBoundary";
import { GameShell } from "@/shared/components";

const loadProgressModule = () => import("@/apps/virtual-pet");

const VirtualPet = dynamic(loadProgressModule, {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center min-h-full bg-amber-50">
      <div className="text-6xl mb-4 animate-bounce">🐣</div>
      <div className="text-2xl text-amber-800 animate-pulse">Loading Virtual Pet...</div>
    </div>
  ),
});

function VirtualPetPageContent() {
  return (
    <GameShell gameName="Virtual Pet" canPause={false}>
      <VirtualPet />
    </GameShell>
  );
}

export default function VirtualPetPage() {
  return (
    <ProgressHydrationBoundary appId="virtual-pet" loadModule={loadProgressModule}>
      <VirtualPetPageContent />
    </ProgressHydrationBoundary>
  );
}
