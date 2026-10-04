"use client";

import dynamic from "next/dynamic";
import { ProgressHydrationBoundary } from "@/shared/components/ProgressHydrationBoundary";

const loadProgressModule = () => import("@/games/monster-truck/GameShell");

const MonsterTruckGameShell = dynamic(loadProgressModule, { ssr: false });

function MonsterTruckPageContent() {
  return <MonsterTruckGameShell />;
}

export default function MonsterTruckPage() {
  return (
    <ProgressHydrationBoundary appId="monster-truck" loadModule={loadProgressModule}>
      <MonsterTruckPageContent />
    </ProgressHydrationBoundary>
  );
}
