"use client";

import dynamic from "next/dynamic";
import { ProgressHydrationBoundary } from "@/shared/components/ProgressHydrationBoundary";

const loadProgressModule = () => import("@/games/checkers/GameShell");

const CheckersGameShell = dynamic(loadProgressModule, { ssr: false });

function CheckersPageContent() {
  return <CheckersGameShell />;
}

export default function CheckersPage() {
  return (
    <ProgressHydrationBoundary appId="checkers" loadModule={loadProgressModule}>
      <CheckersPageContent />
    </ProgressHydrationBoundary>
  );
}
