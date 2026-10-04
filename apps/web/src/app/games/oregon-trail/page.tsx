"use client";
import dynamic from "next/dynamic";
import { ProgressHydrationBoundary } from "@/shared/components/ProgressHydrationBoundary";

const loadProgressModule = () => import("@/games/oregon-trail/OregonTrailGameShell");

const OregonTrailGameShell = dynamic(
  loadProgressModule,
  { ssr: false }
);

function OregonTrailPageContent() {
  return <OregonTrailGameShell />;
}

export default function OregonTrailPage() {
  return (
    <ProgressHydrationBoundary appId="oregon-trail" loadModule={loadProgressModule}>
      <OregonTrailPageContent />
    </ProgressHydrationBoundary>
  );
}
