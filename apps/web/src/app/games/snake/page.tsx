"use client";

import dynamic from "next/dynamic";

const SnakeGameShell = dynamic(
  () => import("@/games/snake/SnakeGameShell"),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-gradient-to-b from-green-800 to-green-950 flex flex-col items-center justify-center">
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

export default function SnakePage() {
  return <SnakeGameShell />;
}
