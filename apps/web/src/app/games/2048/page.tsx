"use client";

import dynamic from "next/dynamic";

const Game2048Shell = dynamic(() => import("@/games/2048/GameShell"), { ssr: false });

export default function Page2048() {
  return <Game2048Shell />;
}
