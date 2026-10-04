"use client";

import dynamic from "next/dynamic";
import { ProgressHydrationBoundary } from "@/shared/components/ProgressHydrationBoundary";

const loadProgressModule = () => import("@/games/wordle/GameShell");

const WordleGameShell = dynamic(loadProgressModule, { ssr: false });

function WordlePageContent() {
  return <WordleGameShell />;
}

export default function WordlePage() {
  return (
    <ProgressHydrationBoundary appId="wordle" loadModule={loadProgressModule}>
      <WordlePageContent />
    </ProgressHydrationBoundary>
  );
}
