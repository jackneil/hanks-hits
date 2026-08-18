"use client";

import dynamic from "next/dynamic";

const CheckersGameShell = dynamic(() => import("@/games/checkers/GameShell"), { ssr: false });

export default function CheckersPage() {
  return <CheckersGameShell />;
}
