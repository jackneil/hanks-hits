"use client";

import dynamic from "next/dynamic";

const ChessGameShell = dynamic(() => import("@/games/chess/GameShell"), { ssr: false });

export default function ChessPage() {
  return <ChessGameShell />;
}
