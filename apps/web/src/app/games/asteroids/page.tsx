"use client";

import dynamic from "next/dynamic";
import { ProgressHydrationBoundary } from "@/shared/components/ProgressHydrationBoundary";

const loadProgressModule = () => import("@/games/asteroids/AsteroidsGameShell");

const AsteroidsGameShell = dynamic(
  loadProgressModule,
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center min-h-full bg-black">
        <div className="text-6xl mb-4 animate-bounce">☄️</div>
        <div className="text-2xl text-white animate-pulse">Loading Asteroids...</div>
      </div>
    ),
  }
);

function AsteroidsPageContent() {
  return <AsteroidsGameShell />;
}

export default function AsteroidsPage() {
  return (
    <ProgressHydrationBoundary appId="asteroids" loadModule={loadProgressModule}>
      <AsteroidsPageContent />
    </ProgressHydrationBoundary>
  );
}
