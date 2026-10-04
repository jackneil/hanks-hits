"use client";

import dynamic from "next/dynamic";
import { ProgressHydrationBoundary } from "@/shared/components/ProgressHydrationBoundary";

const loadProgressModule = () => import("@/games/arkanoid/ArkanoidGameShell");

const ArkanoidGameShell = dynamic(
  loadProgressModule,
  {
    ssr: false,
    loading: () => (
      <div className="min-h-full bg-slate-900 flex flex-col items-center justify-center">
        <div className="text-6xl mb-4 animate-bounce">🎱</div>
        <h1 className="text-4xl font-bold text-white mb-4">Arkanoid</h1>
        <div className="w-64 h-2 bg-black/30 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-400 rounded-full animate-pulse"
            style={{ width: "30%" }}
          />
        </div>
        <p className="text-slate-300 mt-4">Loading game...</p>
      </div>
    ),
  }
);

function ArkanoidPageContent() {
  return <ArkanoidGameShell />;
}

export default function ArkanoidPage() {
  return (
    <ProgressHydrationBoundary appId="arkanoid" loadModule={loadProgressModule}>
      <ArkanoidPageContent />
    </ProgressHydrationBoundary>
  );
}
