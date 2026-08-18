"use client";

import dynamic from "next/dynamic";

const DinoRunnerGameShell = dynamic(() => import("@/games/dino-runner/GameShell"), { ssr: false });

export default function DinoRunnerPage() {
  return <DinoRunnerGameShell />;
}
