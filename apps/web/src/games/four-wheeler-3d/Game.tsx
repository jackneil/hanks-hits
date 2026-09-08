"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
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
import { Speedo } from "./components/hud/Speedo";
import { MobileControls } from "./components/MobileControls";
import { useGameControls } from "./hooks/useControls";
import {
  GameContextProvider,
  useCreateGameContext,
} from "./lib/gameContext";
import { sounds } from "./lib/sounds";
import type { Weather } from "./lib/dayNight";
import { useFourWheeler3dStore, type FourWheeler3dProgress } from "./lib/store";

/** The speedometer is redrawn no more often than this, in milliseconds. */
const SPEEDO_INTERVAL = 80;

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
  const soundEnabled = useFourWheeler3dStore(
    (s) => s.progress.settings.soundEnabled
  );
  const helmetCam = useFourWheeler3dStore((s) => s.progress.settings.helmetCam);
  const updateSettings = useFourWheeler3dStore((s) => s.updateSettings);

  // Keys and buttons are dead on the start card and while the game is paused.
  const controls = useGameControls(hasStarted && !isPaused);

  // The speedometer reads a number, not every frame of the ride.
  const [speed, setSpeed] = useState(0);
  const lastSpeedoAt = useRef(0);
  const onSpeed = useCallback((metersPerSecond: number) => {
    const now = performance.now();
    if (now - lastSpeedoAt.current < SPEEDO_INTERVAL) return;
    lastSpeedoAt.current = now;
    setSpeed(metersPerSecond);
  }, []);

  // Escape pauses and unpauses, the same as the other 3D game.
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.code === "Escape") setPaused(!isPaused);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isPaused, setPaused]);

  // The engine starts on the tap that starts the game, which is the tap the
  // browser needs before it will play any sound at all.
  useEffect(() => {
    sounds.setEnabled(soundEnabled);
    if (!hasStarted || isPaused || !soundEnabled) {
      sounds.stopEngine();
      return;
    }
    sounds.resume();
    sounds.startEngine();
    return () => sounds.stopEngine();
  }, [hasStarted, isPaused, soundEnabled]);

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
              <World controls={controls} onSpeed={onSpeed} />
            </Suspense>
          </Canvas>

          {hasStarted && (
            <>
              <ClockBadge timeOfDay={timeOfDay} day={day} weather={weather} />
              <ChunkCounter />
              <Speedo speed={speed} vehicleId="atv" raised={controls.isMobile} />

              {controls.isMobile ? (
                <MobileControls controls={controls} />
              ) : (
                <div className="pointer-events-auto fixed bottom-4 left-3 z-40 flex gap-2">
                  <button
                    type="button"
                    onClick={() => updateSettings({ helmetCam: !helmetCam })}
                    className="h-11 rounded-xl bg-slate-700 px-4 text-sm font-black text-white shadow-md active:translate-y-0.5"
                  >
                    📷 {helmetCam ? "RIDER VIEW" : "CHASE VIEW"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      sounds.setEnabled(soundEnabled);
                      sounds.playHorn();
                    }}
                    className="h-11 rounded-xl bg-sky-600 px-4 text-sm font-black text-white shadow-md active:translate-y-0.5"
                  >
                    📣 HORN
                  </button>
                </div>
              )}
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
              "📱 Tap TILT to steer by tilting your phone",
              "🤸 Tap JUMP for a stunt",
              "📣 Tap the horn!",
            ]}
            keyboardHints={[
              "🦶 Press W or the up arrow to go",
              "🛑 Press S or the down arrow to stop",
              "👈👉 Press A and D to steer",
              "🤸 Press the space bar to jump",
              "📷 Press C to switch camera",
              "🔄 Press R to flip back over",
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
