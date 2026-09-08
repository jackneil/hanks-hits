"use client";

import { Suspense, useEffect } from "react";
import { Canvas } from "@react-three/fiber";

import { useAuthSync } from "@/shared/hooks/useAuthSync";
import {
  GameStartOverlay,
  OrientationWarning,
  PauseMenu,
  WebGLGate,
} from "@/shared/components";

import { World } from "./components/World";
import { ClockBadge } from "./components/hud/ClockBadge";
import { ChunkCounter } from "./components/hud/ChunkCounter";
import {
  GameContextProvider,
  useCreateGameContext,
} from "./lib/gameContext";
import type { Weather } from "./lib/dayNight";
import { useFourWheeler3dStore, type FourWheeler3dProgress } from "./lib/store";

export function FourWheeler3dGame() {
  const gameContext = useCreateGameContext();

  const store = useFourWheeler3dStore();
  useAuthSync<FourWheeler3dProgress>({
    appId: "four-wheeler-3d",
    localStorageKey: "four-wheeler-3d-game-state",
    getState: () => store.getProgress(),
    setState: (data) => store.setProgress(data),
    debounceMs: 3000,
  });

  const hasStarted = useFourWheeler3dStore((s) => s.hasStarted);
  const setHasStarted = useFourWheeler3dStore((s) => s.setHasStarted);
  const isPaused = useFourWheeler3dStore((s) => s.isPaused);
  const setPaused = useFourWheeler3dStore((s) => s.setPaused);
  const timeOfDay = useFourWheeler3dStore((s) => s.clock);
  const day = useFourWheeler3dStore((s) => s.progress.day);
  const weather = useFourWheeler3dStore((s) => s.progress.weather) as Weather;

  // Escape pauses and unpauses, the same as the other 3D game.
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.code === "Escape") setPaused(!isPaused);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isPaused, setPaused]);

  return (
    <div className="fixed inset-0 bg-black">
      <OrientationWarning />

      <WebGLGate gameName="Four-Wheeler Adventure 3D">
        <GameContextProvider value={gameContext}>
          <Canvas
            shadows
            camera={{ fov: 60, near: 0.3, far: 1500, position: [-400, 6, 24] }}
            style={{ touchAction: "none" }}
          >
            <Suspense fallback={null}>
              <World />
            </Suspense>
          </Canvas>

          {hasStarted && (
            <>
              <ClockBadge timeOfDay={timeOfDay} day={day} weather={weather} />
              <ChunkCounter />
            </>
          )}
        </GameContextProvider>

        {!hasStarted && (
          <GameStartOverlay
            title="Four-Wheeler Adventure 3D"
            emoji="🏍️"
            subtitle="Ride around, race, fish, and explore with your dog!"
            touchHints={[
              "🦶 Tap GAS to go, BRAKE to stop",
              "👈👉 Tap the arrows to steer",
              "🤸 Tap JUMP for a stunt",
              "📱 Tap TILT to steer by tilting your phone",
            ]}
            keyboardHints={[
              "🦶 Press W or the up arrow to go",
              "🛑 Press S or the down arrow to stop",
              "👈👉 Press A and D to steer",
              "🤸 Press the space bar to jump",
            ]}
            onStart={() => setHasStarted(true)}
          />
        )}
      </WebGLGate>

      <PauseMenu
        isOpen={isPaused}
        gameName="Four-Wheeler Adventure 3D"
        onResume={() => setPaused(false)}
        onHome={() => {
          window.location.href = "/";
        }}
      />
    </div>
  );
}

export default FourWheeler3dGame;
