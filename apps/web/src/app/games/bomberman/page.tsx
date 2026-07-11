"use client";

import dynamic from "next/dynamic";

const BombermanGameShell = dynamic(
  () => import("@/games/bomberman/BombermanGameShell"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center min-h-screen bg-gray-900">
        <div className="text-6xl mb-4 animate-bounce">💣</div>
        <div className="text-2xl text-white animate-pulse">Loading Bomberman...</div>
      </div>
    ),
  }
);

export default function BombermanPage() {
  return <BombermanGameShell />;
}
