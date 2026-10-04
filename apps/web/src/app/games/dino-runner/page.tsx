"use client";

import dynamic from "next/dynamic";
import { ProgressHydrationBoundary } from "@/shared/components/ProgressHydrationBoundary";

const loadProgressModule = () => import("@/games/dino-runner/GameShell");

const DinoRunnerGameShell = dynamic(loadProgressModule, { ssr: false });

function DinoRunnerPageContent() {
  return <DinoRunnerGameShell />;
}

export default function DinoRunnerPage() {
  return (
    <ProgressHydrationBoundary appId="dino-runner" loadModule={loadProgressModule}>
      <DinoRunnerPageContent />
    </ProgressHydrationBoundary>
  );
}
