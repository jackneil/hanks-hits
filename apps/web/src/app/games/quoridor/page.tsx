"use client";

import dynamic from "next/dynamic";

const QuoridorGameShell = dynamic(() => import("@/games/quoridor/GameShell"), { ssr: false });

export default function QuoridorPage() {
  return <QuoridorGameShell />;
}
