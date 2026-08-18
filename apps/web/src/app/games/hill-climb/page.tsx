"use client";

import dynamic from "next/dynamic";

const HillClimbGameShell = dynamic(() => import("@/games/hill-climb/GameShell"), { ssr: false });

export default function HillClimbPage() {
  return <HillClimbGameShell />;
}
