"use client";

import dynamic from "next/dynamic";

const HextrisGameShell = dynamic(() => import("@/games/hextris/HextrisGameShell"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center min-h-screen bg-slate-900">
      <div className="text-6xl mb-4 animate-bounce">⬡</div>
      <div className="text-2xl text-white animate-pulse">Loading Hextris...</div>
    </div>
  ),
});

export default function HextrisPage() {
  return <HextrisGameShell />;
}
