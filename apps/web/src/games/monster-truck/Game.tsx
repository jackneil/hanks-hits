'use client';

import { Suspense, useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import type { RapierRigidBody } from '@react-three/rapier';

import { Vehicle } from './components/Vehicle';
import { Terrain, Boundaries } from './components/Terrain';
import { FollowCamera } from './components/FollowCamera';
import { Collectibles } from './components/Collectibles';
import { Destructibles } from './components/Destructibles';
import { Environment, EnvironmentColliders } from './components/Environment';
import { MobileControls } from './components/MobileControls';
import { GameUI, PauseMenu } from './components/GameUI';
import { Garage } from './components/Garage';
import { useCombinedControls } from './hooks/useControls';
import { useGameStore, type MonsterTruckProgress } from './lib/store';
import { useAuthSync } from '@/shared/hooks/useAuthSync';
import { sounds } from './lib/sounds';
import { WORLD } from './lib/constants';
import { getTerrainHeight } from './lib/terrainUtils';
import {
  GameStartOverlay,
  OrientationWarning,
  WebGLGate,
} from '@/shared/components';

// Speed tracker component (inside Canvas)
function SpeedTracker({
  vehicleRef,
  onSpeedUpdate,
}: {
  vehicleRef: React.RefObject<RapierRigidBody | null>;
  onSpeedUpdate: (speed: number) => void;
}) {
  const lastSpeed = useRef(0);

  useFrame(() => {
    if (!vehicleRef.current) return;
    const vel = vehicleRef.current.linvel();
    const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    // Only update when speed changes significantly to prevent render loop
    if (Math.abs(speed - lastSpeed.current) > 0.5) {
      lastSpeed.current = speed;
      onSpeedUpdate(speed);
    }
  });
  return null;
}

// The actual 3D game scene
function GameScene({
  getControls,
  vehicleRef,
  onSpeedUpdate,
}: {
  getControls: () => { throttle: number; steering: number; nos: boolean; horn: boolean; reset: boolean };
  vehicleRef: React.RefObject<RapierRigidBody | null>;
  onSpeedUpdate: (speed: number) => void;
}) {
  // Calculate spawn position dynamically based on terrain height
  // This prevents the truck from spawning inside the terrain
  const spawnPosition = useMemo(() => {
    const [x, , z] = WORLD.SPAWN.POSITION;
    const terrainY = getTerrainHeight(x, z);
    return [x, terrainY + 3, z] as [number, number, number];
  }, []);

  return (
    <>
      <Environment />

      <Physics gravity={[0, -20, 0]} debug={false}>
        <Terrain />
        <Boundaries />
        <EnvironmentColliders />

        <Vehicle
          ref={vehicleRef}
          position={spawnPosition}
          rotation={WORLD.SPAWN.ROTATION}
          getControls={getControls}
        />

        <Collectibles />
        <Destructibles />
      </Physics>

      <FollowCamera target={vehicleRef} />
      <SpeedTracker vehicleRef={vehicleRef} onSpeedUpdate={onSpeedUpdate} />
    </>
  );
}

// Main game component
export function MonsterTruckGame() {
  const vehicleRef = useRef<RapierRigidBody | null>(null);
  const [speed, setSpeed] = useState(0);
  // The player starts the game. The 3D world loads behind the start overlay,
  // so Play drops straight into a scene that is already warm.
  const [hasStarted, setHasStarted] = useState(false);

  // Cloud sync for authenticated users
  const store = useGameStore();
  useAuthSync<MonsterTruckProgress>({
    appId: "monster-truck",
    localStorageKey: "monster-truck-save",
    getState: () => store.getProgress(),
    setState: (data) => store.setProgress(data),
    debounceMs: 3000,
  });

  // Game state from store
  const isPaused = useGameStore((s) => s.isPaused);
  const setPaused = useGameStore((s) => s.setPaused);
  const showGarage = useGameStore((s) => s.showGarage);
  const setShowGarage = useGameStore((s) => s.setShowGarage);
  const nosCharge = useGameStore((s) => s.nosCharge);
  const nosMaxCharge = useGameStore((s) => s.nosMaxCharge);
  const soundEnabled = useGameStore((s) => s.soundEnabled);

  // Controls
  const handleHorn = useCallback(() => {
    if (soundEnabled) sounds.playHorn();
  }, [soundEnabled]);

  const handleReset = useCallback(() => {
    // Reset is handled in Vehicle component
  }, []);

  // Keys are dead until Play, so nothing the kid presses on the start
  // overlay drives the truck.
  const controls = useCombinedControls(handleHorn, handleReset, hasStarted);

  // Resume audio context on first interaction
  useEffect(() => {
    const resumeAudio = () => {
      sounds.resume();
      window.removeEventListener('click', resumeAudio);
      window.removeEventListener('touchstart', resumeAudio);
    };
    window.addEventListener('click', resumeAudio);
    window.addEventListener('touchstart', resumeAudio);
    return () => {
      window.removeEventListener('click', resumeAudio);
      window.removeEventListener('touchstart', resumeAudio);
    };
  }, []);

  // Handle NOS sound
  useEffect(() => {
    let nosPlaying = false;
    const checkNos = () => {
      const { nos } = controls.getControlValues();
      if (nos && nosCharge > 0 && !nosPlaying && soundEnabled) {
        sounds.playNos();
        nosPlaying = true;
      } else if (!nos) {
        nosPlaying = false;
      }
    };
    const interval = setInterval(checkNos, 200);
    return () => clearInterval(interval);
  }, [controls, nosCharge, soundEnabled]);

  // Handle pause with escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        setPaused(!isPaused);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isPaused, setPaused]);

  const handleSpeedUpdate = useCallback((newSpeed: number) => {
    setSpeed(newSpeed);
  }, []);

  const handleQuit = () => {
    window.location.href = '/';
  };

  return (
    <div className="fixed inset-0 bg-black">
      {/* Orientation warning - shows in portrait mode */}
      <OrientationWarning />


      {/* 3D Canvas - gated so a device without WebGL gets a friendly
          explanation instead of a silent black void */}
      <WebGLGate gameName="Monster Truck">
        <Canvas
          shadows
          camera={{
            fov: 75,
            near: 0.5,  // Prevent z-fighting
            far: 1000,
            position: [0, 10, 20],
          }}
          style={{ touchAction: 'none' }}
        >
          <Suspense fallback={null}>
            <GameScene
              getControls={controls.getControlValues}
              vehicleRef={vehicleRef}
              onSpeedUpdate={handleSpeedUpdate}
            />
          </Suspense>
        </Canvas>

        {/* Shared start screen. It lives INSIDE the WebGL gate so a device
            without WebGL shows the gate's friendly fallback instead of an
            overlay covering it. It renders the title exactly once. */}
        {!hasStarted && (
          <GameStartOverlay
            title="Monster Truck Mayhem"
            emoji="🚛"
            subtitle="Smash, jump, and collect stars in a big open world!"
            touchHints={[
              "👈👉 Tap the arrows to steer",
              "🦶 Tap GAS to go, BRAKE to stop",
              "📱 Tap TILT to steer by tilting your phone",
              "📣 Tap the horn!",
            ]}
            keyboardHints={[
              "🦶 Press W or the up arrow to go",
              "🛑 Press S or the down arrow to stop",
              "↔️ Press A and D to steer",
              "🚀 Hold Shift for a speed boost",
              "📣 Press H to honk, R to flip back over",
            ]}
            onStart={() => setHasStarted(true)}
          />
        )}
      </WebGLGate>

      {/* Game UI overlay */}
      {hasStarted && (
        <GameUI
          speed={speed}
          isMobile={controls.isMobile}
          onPause={() => setPaused(true)}
          onOpenGarage={() => setShowGarage(true)}
        />
      )}

      {/* Mobile controls */}
      {hasStarted && controls.isMobile && (
        <MobileControls
          touchControls={controls.touch}
          onHorn={handleHorn}
          onNos={() => {}}
          nosCharge={nosCharge}
          nosMaxCharge={nosMaxCharge}
          useTilt={controls.useTilt}
          onToggleTilt={() => controls.setUseTilt(!controls.useTilt)}
          onCalibrate={controls.tilt.calibrate}
        />
      )}

      {/* Pause menu */}
      {isPaused && (
        <PauseMenu
          onResume={() => setPaused(false)}
          onGarage={() => {
            setPaused(false);
            setShowGarage(true);
          }}
          onQuit={handleQuit}
        />
      )}

      {/* Garage */}
      {showGarage && (
        <Garage onClose={() => setShowGarage(false)} />
      )}
    </div>
  );
}

export default MonsterTruckGame;
