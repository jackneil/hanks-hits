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
import { FullscreenButton, OrientationWarning } from '@/shared/components';

// Loading screen component
function LoadingScreen() {
  return (
    <div className="fixed inset-0 bg-gradient-to-b from-orange-600 to-red-700 flex flex-col items-center justify-center z-50">
      <div className="text-6xl mb-4 animate-bounce">🚛</div>
      <h1 className="text-4xl font-bold text-white mb-4">Monster Truck Mayhem</h1>
      <div className="w-64 h-2 bg-black/30 rounded-full overflow-hidden">
        <div className="h-full bg-yellow-400 rounded-full animate-pulse" style={{ width: '60%' }} />
      </div>
      <p className="text-white/80 mt-4">Loading...</p>
    </div>
  );
}

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
  const [isLoaded, setIsLoaded] = useState(false);

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

  const controls = useCombinedControls(handleHorn, handleReset);

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

  // Simulate loading
  useEffect(() => {
    const timer = setTimeout(() => setIsLoaded(true), 1500);
    return () => clearTimeout(timer);
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

  if (!isLoaded) {
    return <LoadingScreen />;
  }

  return (
    <div className="fixed inset-0 bg-black">
      {/* Orientation warning - shows in portrait mode */}
      <OrientationWarning />

      {/* Fullscreen button - top right corner */}
      <div className="absolute top-4 right-4 z-50">
        <FullscreenButton />
      </div>

      {/* 3D Canvas */}
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

      {/* Game UI overlay */}
      <GameUI
        speed={speed}
        isMobile={controls.isMobile}
        onPause={() => setPaused(true)}
        onOpenGarage={() => setShowGarage(true)}
      />

      {/* Mobile controls */}
      {controls.isMobile && (
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
