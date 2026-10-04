"use client";

import dynamic from "next/dynamic";
import { ProgressHydrationBoundary } from "@/shared/components/ProgressHydrationBoundary";

const loadProgressModule = () => import("@/games/bomberman/BombermanGameShell");

const BombermanGameShell = dynamic(
  loadProgressModule,
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center min-h-full bg-gray-900">
        <div className="text-6xl mb-4 animate-bounce">💣</div>
        <div className="text-2xl text-white animate-pulse">Loading Bomberman...</div>
      </div>
    ),
  }
);

function BombermanPageContent() {
  return <BombermanGameShell />;
}

export default function BombermanPage() {
  return (
    <ProgressHydrationBoundary appId="bomberman" loadModule={loadProgressModule}>
      <BombermanPageContent />
    </ProgressHydrationBoundary>
  );
}
