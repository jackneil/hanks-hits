"use client";

import dynamic from "next/dynamic";
import { ProgressHydrationBoundary } from "@/shared/components/ProgressHydrationBoundary";

const loadProgressModule = () => import("@/games/hextris/HextrisGameShell");

const HextrisGameShell = dynamic(loadProgressModule, {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center min-h-full bg-slate-900">
      <div className="text-6xl mb-4 animate-bounce">⬡</div>
      <div className="text-2xl text-white animate-pulse">Loading Hextris...</div>
    </div>
  ),
});

function HextrisPageContent() {
  return <HextrisGameShell />;
}

export default function HextrisPage() {
  return (
    <ProgressHydrationBoundary appId="hextris" loadModule={loadProgressModule}>
      <HextrisPageContent />
    </ProgressHydrationBoundary>
  );
}
