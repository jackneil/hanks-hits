"use client";

import dynamic from "next/dynamic";
import { ProgressHydrationBoundary } from "@/shared/components/ProgressHydrationBoundary";

const loadProgressModule = () => import("@/games/flappy-bird/GameShell");

const FlappyBirdGameShell = dynamic(loadProgressModule, { ssr: false });

function FlappyBirdPageContent() {
  return <FlappyBirdGameShell />;
}

export default function FlappyBirdPage() {
  return (
    <ProgressHydrationBoundary appId="flappy-bird" loadModule={loadProgressModule}>
      <FlappyBirdPageContent />
    </ProgressHydrationBoundary>
  );
}
