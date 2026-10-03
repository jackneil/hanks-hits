"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Canvas, type RootState } from "@react-three/fiber";
import { useRunClips } from "@/shared/clips/useRunClips";
import { adventureClipState } from "./lib/clipState";

import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { useShellHold } from "@/shared/hooks/useShellHold";
import { wantGameAudio } from "@/shared/lib/audio";
import { WebGLGate } from "@/shared/components";
import { useCoarsePointer } from "@/shared/hooks/useCoarsePointer";

import { World } from "./components/World";
import { ChunkCounter } from "./components/hud/ChunkCounter";
import { Speedo } from "./components/hud/Speedo";
import { HintToast } from "./components/hud/HintToast";
import { MobileControls } from "./components/MobileControls";
import { useGameControls } from "./hooks/useControls";
import { useAdventureEscape } from "./hooks/useAdventureEscape";
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
import { ActivitiesPanel } from "./components/ui/ActivitiesPanel";

/** The speedometer is redrawn no more often than this, in milliseconds. */
const SPEEDO_INTERVAL = 80;

export function FourWheeler3dGame() {
  useEffect(() => wantGameAudio(), []);
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
  // The shell holds the game under a shell overlay (the restart question,
  // the install steps) and in a hidden tab: the physics stand still, like
  // under the pause menu. Read here, outside the Canvas (its own React
  // root), and passed down as a prop.
  const held = useShellHold();
  const isCoarse = useCoarsePointer();
  const generation = useAdventureSession((s) => s.generation);
  const panel = useAdventureSession((s) => s.panel);
  const clipCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [clipCanvasReady, setClipCanvasReady] = useState(false);
  const onCanvasCreated = useCallback(({ gl }: RootState) => {
    clipCanvasRef.current = gl.domElement;
    setClipCanvasReady(true);
  }, []);
  useRunClips(clipCanvasRef, adventureClipState(store, held, clipCanvasReady, panel !== null, generation));
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

  // Escape closes a panel or the scope before the site's pause menu sees it.
  useAdventureEscape();

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
      <WebGLGate gameName="Four-Wheeler Adventure 3D">
        <GameContextProvider value={gameContext}>
          {/* On a phone: one pixel per CSS pixel, no shadows and no
              antialiasing, and the scene renders on demand under the start
              screen (a real iPhone SE ran 38 fps behind the start screen,
              phone UX audit 2026-09-29, S15). */}
          <Canvas
            onCreated={onCanvasCreated}
            shadows={!isCoarse}
            dpr={isCoarse ? 1 : [1, 1.5]}
            frameloop={hasStarted ? "always" : "demand"}
            gl={{ antialias: !isCoarse, powerPreference: "high-performance" }}
            camera={{ fov: 60, near: 0.3, far: 1500, position: [-400, 6, 24] }}
            style={{ touchAction: "none" }}
          >
            <Suspense fallback={null}>
              <World key={generation} controls={controls} onSpeed={onSpeed} held={held} />
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
                    nos={["vehicle", "boat", "aircraft"].includes(mode)}
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
    </div>
  );
}

export default FourWheeler3dGame;
