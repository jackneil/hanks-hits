"use client";

import dynamic from "next/dynamic";
import { ProgressHydrationBoundary } from "@/shared/components/ProgressHydrationBoundary";

const loadProgressModule = () => import("@/games/space-invaders/SpaceInvadersGameShell");

const SpaceInvadersGameShell = dynamic(
  loadProgressModule,
  {
    ssr: false,
    loading: () => (
      <div className="min-h-full bg-black flex flex-col items-center justify-center">
        <div className="text-6xl mb-4 animate-bounce">&#128125;</div>
        <h1 className="text-4xl font-bold text-green-500 mb-4">Space Invaders</h1>
        <div className="w-64 h-2 bg-gray-800 rounded-full overflow-hidden">
          <div className="h-full bg-green-500 rounded-full animate-pulse" style={{ width: "30%" }} />
        </div>
        <p className="text-green-400 mt-4">Loading game...</p>
      </div>
    ),
  }
);

function SpaceInvadersPageContent() {
  return <SpaceInvadersGameShell />;
}

export default function SpaceInvadersPage() {
  return (
    <ProgressHydrationBoundary appId="space-invaders" loadModule={loadProgressModule}>
      <SpaceInvadersPageContent />
    </ProgressHydrationBoundary>
  );
}
