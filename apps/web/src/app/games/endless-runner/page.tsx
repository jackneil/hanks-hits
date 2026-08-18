"use client";

import dynamic from "next/dynamic";

const EndlessRunnerGameShell = dynamic(() => import("@/games/endless-runner/GameShell"), { ssr: false });

export default function EndlessRunnerPage() {
  return <EndlessRunnerGameShell />;
}
