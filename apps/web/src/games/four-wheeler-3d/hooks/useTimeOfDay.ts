"use client";

/**
 * Drives the world clock from inside the render loop.
 *
 * The live clock is session state, so a ticking minute hand never touches the
 * saved progress. Progress is written only when something worth saving
 * happens: a new day, one whole game hour, a pause, or the page going away.
 */

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";

import { useFourWheeler3dStore } from "../lib/store";
import { readDevParams } from "../lib/devParams";

/** One game minute of real time. The clock moves no faster than this. */
const BATCH_SECONDS = 1;

/** Long pauses (a hidden tab) must not fast forward the whole night. */
const MAX_STEP_SECONDS = 0.25;

export function useTimeOfDay(): void {
  const tick = useFourWheeler3dStore((state) => state.tick);
  const seedClock = useFourWheeler3dStore((state) => state.seedClock);
  const flushClock = useFourWheeler3dStore((state) => state.flushClock);
  const setTimeOfDay = useFourWheeler3dStore((state) => state.setTimeOfDay);
  const isPaused = useFourWheeler3dStore((state) => state.isPaused);
  const hasStarted = useFourWheeler3dStore((state) => state.hasStarted);

  const pending = useRef(0);

  // Start from the clock that was saved, then let the development ?tod=
  // parameter override it, so a screenshot can be taken at any hour.
  useEffect(() => {
    seedClock();
    const { timeOfDay } = readDevParams();
    if (timeOfDay !== null) setTimeOfDay(timeOfDay);
  }, [seedClock, setTimeOfDay]);

  // Pausing saves the clock, so a kid who walks away keeps the time of day.
  useEffect(() => {
    if (isPaused) flushClock();
  }, [isPaused, flushClock]);

  // So does closing the tab, hiding it, or leaving the game.
  useEffect(() => {
    const save = () => flushClock();
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", save);
    return () => {
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", save);
      save();
    };
  }, [flushClock]);

  useFrame((_state, delta) => {
    if (isPaused || !hasStarted) return;
    pending.current += Math.min(delta, MAX_STEP_SECONDS);
    if (pending.current < BATCH_SECONDS) return;
    const step = pending.current;
    pending.current = 0;
    tick(step);
  });
}
