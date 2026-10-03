"use client";

import { useEffect, useRef, type RefObject } from "react";
import { wantGameAudio, watchIframeGameAudio } from "@/shared/lib/audio";
import { useAttachedGame } from "./service/context";
import { useRunClips, type RunClipState } from "./useRunClips";

/** Same-origin iframe games expose their real canvas through scoped discovery. */
export function useDiscoveredRunClips(root: RefObject<HTMLElement | null>, state: RunClipState): void {
  const game = useAttachedGame();
  const emptyCanvas = useRef<HTMLCanvasElement | null>(null);
  useRunClips(emptyCanvas, state);
  useEffect(() => {
    if (!game || !root.current) return;
    const element = root.current;
    const releaseWant = wantGameAudio();
    const releaseDiscovery = game.autoDiscover(element);
    const frames = new Map<HTMLIFrameElement, () => void>();
    const sync = () => {
      const live = new Set(element.querySelectorAll<HTMLIFrameElement>("iframe"));
      for (const [frame, release] of frames) if (!live.has(frame)) { release(); frames.delete(frame); }
      for (const frame of live) if (!frames.has(frame)) frames.set(frame, watchIframeGameAudio(frame));
    };
    const observer = new MutationObserver(sync);
    observer.observe(element, { childList: true, subtree: true });
    sync();
    return () => {
      observer.disconnect();
      for (const release of frames.values()) release();
      releaseDiscovery();
      releaseWant();
    };
  }, [game, root]);
}
