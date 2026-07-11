"use client";

import dynamic from "next/dynamic";
import { GameShell } from "@/shared/components";

const Weather = dynamic(
  () => import("@/apps/weather"),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-gradient-to-b from-blue-400 via-blue-500 to-blue-600 flex flex-col items-center justify-center">
        <div className="text-8xl mb-4 animate-bounce">&#x26C5;</div>
        <h1 className="text-4xl font-bold text-white mb-4 drop-shadow-lg">Weather Buddy</h1>
        <div className="w-64 h-2 bg-white/30 rounded-full overflow-hidden">
          <div className="h-full bg-white rounded-full animate-pulse" style={{ width: "30%" }} />
        </div>
        <p className="text-white/80 mt-4">Loading weather...</p>
      </div>
    ),
  }
);

export default function WeatherPage() {
  return (
    <GameShell gameName="Weather Buddy" canPause={false}>
      <Weather />
    </GameShell>
  );
}
