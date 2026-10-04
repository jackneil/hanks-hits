"use client";

import dynamic from "next/dynamic";
import { ProgressHydrationBoundary } from "@/shared/components/ProgressHydrationBoundary";

const loadProgressModule = () => import("@/games/quoridor/GameShell");

const QuoridorGameShell = dynamic(loadProgressModule, { ssr: false });

function QuoridorPageContent() {
  return <QuoridorGameShell />;
}

export default function QuoridorPage() {
  return (
    <ProgressHydrationBoundary appId="quoridor" loadModule={loadProgressModule}>
      <QuoridorPageContent />
    </ProgressHydrationBoundary>
  );
}
