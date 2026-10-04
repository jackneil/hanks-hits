"use client";

import dynamic from "next/dynamic";
import { ProgressHydrationBoundary } from "@/shared/components/ProgressHydrationBoundary";

const loadProgressModule = () => import("@/games/math-attack/GameShell");

const MathAttackGameShell = dynamic(loadProgressModule, { ssr: false });

function MathAttackPageContent() {
  return <MathAttackGameShell />;
}

export default function MathAttackPage() {
  return (
    <ProgressHydrationBoundary appId="math-attack" loadModule={loadProgressModule}>
      <MathAttackPageContent />
    </ProgressHydrationBoundary>
  );
}
