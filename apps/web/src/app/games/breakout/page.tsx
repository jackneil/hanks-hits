"use client";

import dynamic from "next/dynamic";
import { ProgressHydrationBoundary } from "@/shared/components/ProgressHydrationBoundary";

const loadProgressModule = () => import("@/games/breakout/BreakoutGameShell");

const BreakoutGameShell = dynamic(
  loadProgressModule,
  {
    ssr: false,
    loading: () => (
      <div className="min-h-full bg-gradient-to-b from-indigo-900 via-purple-900 to-indigo-950 flex flex-col items-center justify-center">
        <div className="text-6xl mb-4 animate-bounce">🧱</div>
        <h1 className="text-4xl font-bold text-white mb-4">Breakout</h1>
        <div className="w-64 h-2 bg-black/30 rounded-full overflow-hidden">
          <div className="h-full bg-purple-400 rounded-full animate-pulse" style={{ width: "30%" }} />
        </div>
        <p className="text-purple-200 mt-4">Loading game...</p>
      </div>
    ),
  }
);

function BreakoutPageContent() {
  return <BreakoutGameShell />;
}

export default function BreakoutPage() {
  return (
    <ProgressHydrationBoundary appId="breakout" loadModule={loadProgressModule}>
      <BreakoutPageContent />
    </ProgressHydrationBoundary>
  );
}
