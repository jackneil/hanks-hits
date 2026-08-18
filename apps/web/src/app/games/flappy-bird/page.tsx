"use client";

import dynamic from "next/dynamic";

const FlappyBirdGameShell = dynamic(() => import("@/games/flappy-bird/GameShell"), { ssr: false });

export default function FlappyBirdPage() {
  return <FlappyBirdGameShell />;
}
