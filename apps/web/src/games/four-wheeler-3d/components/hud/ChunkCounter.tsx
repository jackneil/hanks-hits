"use client";

/**
 * A small counter that shows how many ground chunks are loaded. It exists so
 * the streaming budget is visible while the game is being built, and it never
 * renders in a real build.
 */

import { useEffect, useState } from "react";

import { useGameContext } from "../../lib/gameContext";
import { HUD_TOP } from "./layout";

export function ChunkCounter() {
  const { getLoadedChunks } = useGameContext();
  const [count, setCount] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setCount(getLoadedChunks()), 500);
    return () => clearInterval(timer);
  }, [getLoadedChunks]);

  if (process.env.NODE_ENV === "production") return null;

  return (
    <div className={`pointer-events-none absolute right-3 ${HUD_TOP} z-20 rounded-lg bg-black/50 px-2 py-1 font-mono text-xs text-white`}>
      chunks: {count}
    </div>
  );
}

export default ChunkCounter;
