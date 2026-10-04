"use client";

import dynamic from "next/dynamic";
import { ProgressHydrationBoundary } from "@/shared/components/ProgressHydrationBoundary";

const loadProgressModule = () => import("@/games/four-wheeler-3d/GameShell");

const FourWheeler3dGameShell = dynamic(
  loadProgressModule,
  { ssr: false }
);

function FourWheeler3dPageContent() {
  return <FourWheeler3dGameShell />;
}

export default function FourWheeler3dPage() {
  return (
    <ProgressHydrationBoundary appId="four-wheeler-3d" loadModule={loadProgressModule}>
      <FourWheeler3dPageContent />
    </ProgressHydrationBoundary>
  );
}
