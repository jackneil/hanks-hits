"use client";

import dynamic from "next/dynamic";
import { ProgressHydrationBoundary } from "@/shared/components/ProgressHydrationBoundary";

const loadProgressModule = () => import("@/games/snake/SnakeGameShell");

const SnakeGameShell = dynamic(
  loadProgressModule,
  {
    ssr: false,
    loading: () => (
      <div className="min-h-full bg-gradient-to-b from-green-800 to-green-950 flex flex-col items-center justify-center">
        <div className="text-6xl mb-4 animate-bounce">🐍</div>
        <h1 className="text-4xl font-bold text-white mb-4">Snake</h1>
        <div className="w-64 h-2 bg-black/30 rounded-full overflow-hidden">
          <div className="h-full bg-green-400 rounded-full animate-pulse" style={{ width: "30%" }} />
        </div>
        <p className="text-green-200 mt-4">Loading game...</p>
      </div>
    ),
  }
);

function SnakePageContent() {
  return <SnakeGameShell />;
}

export default function SnakePage() {
  return (
    <ProgressHydrationBoundary appId="snake" loadModule={loadProgressModule}>
      <SnakePageContent />
    </ProgressHydrationBoundary>
  );
}
