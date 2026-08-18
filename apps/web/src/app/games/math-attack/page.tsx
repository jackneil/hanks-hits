"use client";

import dynamic from "next/dynamic";

const MathAttackGameShell = dynamic(() => import("@/games/math-attack/GameShell"), { ssr: false });

export default function MathAttackPage() {
  return <MathAttackGameShell />;
}
