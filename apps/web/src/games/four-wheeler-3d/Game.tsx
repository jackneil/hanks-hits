"use client";

import { Suspense, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { Physics, RigidBody } from "@react-three/rapier";
import { Sky } from "@react-three/drei";

import { useAuthSync } from "@/shared/hooks/useAuthSync";
import {
  GameStartOverlay,
  OrientationWarning,
  PauseMenu,
  WebGLGate,
} from "@/shared/components";

import { WORLD } from "./lib/constants";
import { useFourWheeler3dStore, type FourWheeler3dProgress } from "./lib/store";

/**
 * Milestone 2 placeholder scene: flat ground, one box for the ATV, and a sky.
 * Milestone 3 replaces this with the streamed terrain world.
 */
function PlaceholderScene() {
  return (
    <>
      <Sky sunPosition={[100, 40, 100]} />
      <ambientLight intensity={0.6} />
      <directionalLight
        position={[60, 90, 40]}
        intensity={1.1}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />

      <Physics gravity={[0, -9.81, 0]}>
        {/* Ground */}
        <RigidBody type="fixed" colliders="cuboid">
          <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
            <boxGeometry args={[WORLD.SIZE, WORLD.SIZE, 0.5]} />
            <meshStandardMaterial color="#4c9a3f" />
          </mesh>
        </RigidBody>

        {/* ATV placeholder */}
        <RigidBody type="dynamic" colliders="cuboid" position={[0, 2, 0]}>
          <mesh castShadow>
            <boxGeometry args={[1.2, 0.8, 1.9]} />
            <meshStandardMaterial color="#e63946" />
          </mesh>
        </RigidBody>
      </Physics>
    </>
  );
}

export function FourWheeler3dGame() {
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
        <Canvas
          shadows
          camera={{ fov: 60, near: 0.3, far: 1500, position: [0, 3, 8] }}
          style={{ touchAction: "none" }}
        >
          <Suspense fallback={null}>
            <PlaceholderScene />
          </Suspense>
        </Canvas>

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
