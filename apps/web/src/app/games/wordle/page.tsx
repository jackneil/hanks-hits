"use client";

import dynamic from "next/dynamic";

const WordleGameShell = dynamic(() => import("@/games/wordle/GameShell"), { ssr: false });

export default function WordlePage() {
  return <WordleGameShell />;
}
