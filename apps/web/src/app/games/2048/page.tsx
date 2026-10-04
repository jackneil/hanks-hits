"use client";

import dynamic from "next/dynamic";
import { ProgressHydrationBoundary } from "@/shared/components/ProgressHydrationBoundary";

const loadProgressModule = () => import("@/games/2048/GameShell");

const Game2048Shell = dynamic(loadProgressModule, { ssr: false });

function Page2048Content() {
  return <Game2048Shell />;
}

export default function Page2048() {
  return (
    <ProgressHydrationBoundary appId="2048" loadModule={loadProgressModule}>
      <Page2048Content />
    </ProgressHydrationBoundary>
  );
}
