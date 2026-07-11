"use client";

import dynamic from "next/dynamic";
import { GameShell } from "@/shared/components";

const JokeGenerator = dynamic(
  () => import("@/apps/joke-generator"),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-gradient-to-b from-yellow-300 via-yellow-400 to-orange-400 flex flex-col items-center justify-center">
        <div className="text-6xl mb-4 animate-bounce">&#x1F921;</div>
        <h1 className="text-4xl font-bold text-purple-800 mb-4">Joke Generator</h1>
        <div className="w-64 h-2 bg-purple-900/30 rounded-full overflow-hidden">
          <div className="h-full bg-purple-600 rounded-full animate-pulse" style={{ width: "30%" }} />
        </div>
        <p className="text-purple-800 mt-4">Loading jokes...</p>
      </div>
    ),
  }
);

export default function JokeGeneratorPage() {
  return (
    <GameShell gameName="Joke Generator" canPause={false}>
      <JokeGenerator />
    </GameShell>
  );
}
