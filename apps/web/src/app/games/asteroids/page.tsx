"use client";

import dynamic from "next/dynamic";

const AsteroidsGameShell = dynamic(
  () => import("@/games/asteroids/AsteroidsGameShell"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <div className="text-6xl mb-4 animate-bounce">☄️</div>
        <div className="text-2xl text-white animate-pulse">Loading Asteroids...</div>
      </div>
    ),
  }
);

export default function AsteroidsPage() {
  return <AsteroidsGameShell />;
}
