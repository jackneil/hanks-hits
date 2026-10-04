"use client";

import dynamic from "next/dynamic";
import { ProgressHydrationBoundary } from "@/shared/components/ProgressHydrationBoundary";

const loadProgressModule = () => import("@/games/hill-climb/GameShell");

const HillClimbGameShell = dynamic(loadProgressModule, { ssr: false });

function HillClimbPageContent() {
  return <HillClimbGameShell />;
}

export default function HillClimbPage() {
  return (
    <ProgressHydrationBoundary appId="hill-climb" loadModule={loadProgressModule}>
      <HillClimbPageContent />
    </ProgressHydrationBoundary>
  );
}
