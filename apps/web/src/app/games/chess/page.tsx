"use client";

import dynamic from "next/dynamic";
import { ProgressHydrationBoundary } from "@/shared/components/ProgressHydrationBoundary";

const loadProgressModule = () => import("@/games/chess/GameShell");

const ChessGameShell = dynamic(loadProgressModule, { ssr: false });

function ChessPageContent() {
  return <ChessGameShell />;
}

export default function ChessPage() {
  return (
    <ProgressHydrationBoundary appId="chess" loadModule={loadProgressModule}>
      <ChessPageContent />
    </ProgressHydrationBoundary>
  );
}
