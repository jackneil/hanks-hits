"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { useAttachedGame } from "../service/context";
import { useRunClips, type RunClipState } from "../useRunClips";

export type ClipPainter<T> = (context: CanvasRenderingContext2D, state: T) => void;
export const CLIP_WIDTH = 640;
export const CLIP_HEIGHT = 720;

/** Game-owned pixels only. No DOM, account UI, input elements or screenshot API.
 * Redraw on committed state changes; the existing capture clock encodes frames.
 * A native minigame canvas can replace the semantic board without ending its run.
 */
export function useSemanticClips<T>(state: T, paint: ClipPainter<T>, run: RunClipState, nativeCanvas?: HTMLCanvasElement | null): void {
  const game = useAttachedGame();
  const backing = useRef<HTMLCanvasElement | null>(null);
  const source = useRef<HTMLCanvasElement | null>(null);
  useLayoutEffect(() => {
    if (!game) return;
    if (!backing.current) {
      backing.current = document.createElement("canvas");
      backing.current.width = CLIP_WIDTH;
      backing.current.height = CLIP_HEIGHT;
    }
    const context = backing.current.getContext("2d");
    if (context) paint(context, state);
    source.current = nativeCanvas ?? backing.current;
  });
  useRunClips(source, run);

  // DOM games do not own a continuous rAF loop. The clip source uses the
  // shared frame dispatcher, so keep its clock moving while play is active,
  // without repainting an unchanged board. Observe getContext after source
  // registration as well: the activity tracker may have arrived after the
  // first layout paint. Native minigames already own their drawing clock.
  useEffect(() => {
    if (!game || run.phase !== "playing" || nativeCanvas) return;
    let frameId = 0;
    const frame = () => {
      // The engine can finish capability detection after many frames. This
      // cheap lookup lets a late activity tracker observe the existing 2D
      // context, even while the player is thinking and the board is unchanged.
      backing.current?.getContext("2d");
      frameId = requestAnimationFrame(frame);
    };
    frameId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameId);
  }, [game, run.phase, nativeCanvas]);
}
