"use client";

import dynamic from "next/dynamic";
import { ProgressHydrationBoundary } from "@/shared/components/ProgressHydrationBoundary";

const loadProgressModule = () => import("@/games/endless-runner/GameShell");

const EndlessRunnerGameShell = dynamic(loadProgressModule, { ssr: false });

function EndlessRunnerPageContent() {
  return <EndlessRunnerGameShell />;
}

export default function EndlessRunnerPage() {
  return (
    <ProgressHydrationBoundary appId="endless-runner" loadModule={loadProgressModule}>
      <EndlessRunnerPageContent />
    </ProgressHydrationBoundary>
  );
}
