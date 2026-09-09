"use client";
import { useEffect, useRef, useCallback } from "react";
import type { GameControls } from "../hooks/useControls";
import { useFourWheeler3dStore } from "../lib/store";
import { useAdventureSession } from "../lib/adventureSession";

/** Two thumbs can combine vertical and horizontal input for all eight surface directions. */
export function SpaceTouchControls({ controls }: { controls: GameControls }) {
  const mode = useFourWheeler3dStore((s) => s.mode),
    paused = useFourWheeler3dStore((s) => s.isPaused);
  const panel = useAdventureSession((s) => s.panel),
    surface = mode === "planet";
  const { touch, setUseTilt } = controls,
    previousTilt = useRef(controls.useTilt);
  const handlers = touch.handlers;
  const releaseTouch = useCallback(() => {
    // Existing cancel handlers ignore their event and clear each held button.
    for (const key of ["left", "right", "gas", "brake"] as const)
      (handlers[key].onPointerCancel as () => void)();
  }, [handlers]);
  useEffect(() => {
    const restore = previousTilt.current;
    setUseTilt(false);
    return () => {
      releaseTouch();
      setUseTilt(restore);
    };
  }, [setUseTilt, releaseTouch]);
  useEffect(() => {
    releaseTouch();
  }, [mode, paused, panel, releaseTouch]);
  if (paused || panel || !["space", "planet"].includes(mode)) return null;
  const button =
    "pointer-events-auto flex h-16 min-w-20 touch-none select-none items-center justify-center rounded-2xl border border-white/25 bg-slate-900/90 px-3 text-sm font-bold text-white shadow-lg active:bg-amber-700";
  const controlsFor = (key: "left" | "right" | "gas" | "brake") => ({
    ...touch.handlers[key],
    onLostPointerCapture: touch.handlers[key].onPointerCancel,
  });
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex items-end justify-between gap-3 px-4"
      aria-label={
        surface ? "Planet movement controls" : "Rocket flight controls"
      }
    >
      <div className="flex gap-2">
        <button
          type="button"
          className={button}
          aria-label={surface ? "Move left" : "Steer rocket left"}
          {...controlsFor("left")}
        >
          ← {surface ? "Left" : "Turn"}
        </button>
        <button
          type="button"
          className={button}
          aria-label={surface ? "Move right" : "Steer rocket right"}
          {...controlsFor("right")}
        >
          {surface ? "Right" : "Turn"} →
        </button>
      </div>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          className={button}
          aria-label={surface ? "Move forward" : "Rocket thrust"}
          {...controlsFor("gas")}
        >
          {surface ? "↑ Forward" : "Thrust"}
        </button>
        <button
          type="button"
          className={button}
          aria-label={surface ? "Move backward" : "Brake rocket"}
          {...controlsFor("brake")}
        >
          {surface ? "↓ Back" : "Brake"}
        </button>
      </div>
    </div>
  );
}
export default SpaceTouchControls;
