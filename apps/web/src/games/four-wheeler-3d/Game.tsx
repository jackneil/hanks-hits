"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";

import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { OrientationWarning, PauseMenu, WebGLGate } from "@/shared/components";

import { World } from "./components/World";
import { ChunkCounter } from "./components/hud/ChunkCounter";
import { Speedo } from "./components/hud/Speedo";
import { HintToast } from "./components/hud/HintToast";
import { MobileControls } from "./components/MobileControls";
import { useGameControls } from "./hooks/useControls";
import { GameContextProvider, useCreateGameContext } from "./lib/gameContext";
import { sounds } from "./lib/sounds";
import { useFourWheeler3dStore, type FourWheeler3dProgress } from "./lib/store";
import { useAdventureSession } from "./lib/adventureSession";
import { AdventureHUD } from "./components/ui/AdventureHUD";
import { HuntingScope } from "./components/ui/HuntingPanel";
import { InventoryPanel } from "./components/ui/InventoryPanel";
import { StartScreen } from "./components/StartScreen";
import { SceneCapture } from "./components/SceneCapture";
import { SpaceTouchControls } from "./components/SpaceTouchControls";
import { FishingPanel, RainbowCelebration } from "./components/ui/FishingPanel";
import { RacePanel, RaceStatus } from "./components/ui/RacePanel";
import { TrainPanel, TrainHUD } from "./components/ui/TrainPanel";
import { SpacePanel, SpaceHUD } from "./components/ui/SpacePanel";
import {
  ActivitiesPanel,
  ActivitiesControls,
} from "./components/ui/ActivitiesPanel";

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
  const isPaused = useFourWheeler3dStore((s) => s.isPaused);
  const setPaused = useFourWheeler3dStore((s) => s.setPaused);
  const generation = useAdventureSession((s) => s.generation);
  const panel = useAdventureSession((s) => s.panel);
  const racing = useAdventureSession(
    (s) => s.race?.phase === "countdown" || s.race?.phase === "racing",
  );
  const mode = useFourWheeler3dStore((s) => s.mode);
  const currentVehicle = useFourWheeler3dStore(
    (s) => s.progress.currentVehicle,
  );
  const soundEnabled = useFourWheeler3dStore(
    (s) => s.progress.settings.soundEnabled,
  );

  // Keys and buttons are dead on the start card and while the game is paused.
  const controls = useGameControls(hasStarted && !isPaused && !panel);

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
      if (event.code === "Escape") {
        const session = useAdventureSession.getState();
        if (session.panel) session.openPanel(null);
        else if (session.scope) useAdventureSession.setState({ scope: false });
        else setPaused(!isPaused);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isPaused, setPaused]);

  // The engine starts on the tap that starts the game, which is the tap the
  // browser needs before it will play any sound at all.
  useEffect(() => {
    sounds.setEnabled(soundEnabled);
    if (
      !hasStarted ||
      isPaused ||
      !soundEnabled ||
      !["vehicle", "boat", "aircraft"].includes(mode)
    ) {
      sounds.stopEngine();
      return;
    }
    sounds.resume();
    sounds.startEngine();
    return () => sounds.stopEngine();
  }, [hasStarted, isPaused, soundEnabled, mode]);

  return (
    <div className="fixed inset-0 bg-black">
      <OrientationWarning />

      <WebGLGate gameName="Four-Wheeler Adventure 3D">
        <GameContextProvider value={gameContext}>
          <Canvas
            shadows
            dpr={[1, 1.5]}
            gl={{ antialias: true, powerPreference: "high-performance" }}
            camera={{ fov: 60, near: 0.3, far: 1500, position: [-400, 6, 24] }}
            style={{ touchAction: "none" }}
          >
            <Suspense fallback={null}>
              <World key={generation} controls={controls} onSpeed={onSpeed} />
              <SceneCapture />
            </Suspense>
          </Canvas>

          {hasStarted && (
            <>
              <ChunkCounter />
              {["vehicle", "boat", "aircraft"].includes(mode) && (
                <Speedo
                  speed={speed}
                  vehicleId={currentVehicle}
                  raised={controls.isMobile}
                  racing={racing}
                />
              )}
              <HintToast raised={controls.isMobile} />
              {mode !== "space" && mode !== "planet" && (
                <AdventureHUD mobile={controls.isMobile}>
                  {panel === "inventory" ? (
                    <InventoryPanel />
                  ) : panel === "fishing" ? (
                    <FishingPanel />
                  ) : panel === "race" ? (
                    <RacePanel />
                  ) : panel === "train" ? (
                    <TrainPanel />
                  ) : panel === "space" ? (
                    <SpacePanel />
                  ) : panel === "activities" ? (
                    <ActivitiesPanel />
                  ) : null}
                </AdventureHUD>
              )}
              <RaceStatus />
              <RainbowCelebration />
              <TrainHUD />
              <SpaceHUD />
              {mode !== "space" && mode !== "planet" && <ActivitiesControls />}
              <HuntingScope />
              {controls.isMobile && ["space", "planet"].includes(mode) && (
                <SpaceTouchControls controls={controls} />
              )}

              {mode !== "space" &&
                mode !== "planet" &&
                mode !== "train" &&
                (controls.isMobile ? (
                  <MobileControls
                    controls={controls}
                    forwardLabel={mode === "parachute" ? "GLIDE" : undefined}
                    walking={["foot", "interior", "deck", "stand"].includes(
                      mode,
                    )}
                  />
                ) : mode !== "interior" ? (
                  <div className="pointer-events-auto fixed bottom-4 left-3 z-40 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        sounds.setEnabled(soundEnabled);
                        sounds.playHorn();
                      }}
                      className="h-11 rounded-xl bg-[#263b2d] px-4 text-sm font-black text-white shadow-md active:translate-y-0.5"
                    >
                      📣 HORN
                    </button>
                  </div>
                ) : null)}
            </>
          )}
        </GameContextProvider>

        {!hasStarted && <StartScreen />}
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
