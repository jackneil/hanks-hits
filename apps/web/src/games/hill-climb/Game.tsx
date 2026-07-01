'use client';

/**
 * Hill Climb Racing - Main Game Component
 *
 * Canvas-based 2D physics game using Matter.js.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import Matter from 'matter-js';
import { useCombinedControls, useIsMobile, usePauseKeyboard } from './hooks/useControls';
import { useHillClimbStore, type HillClimbProgress } from './lib/store';
import { useAuthSync } from '@/shared/hooks/useAuthSync';
import {
  createVehicle,
  applyWheelTorque,
  applyLeanTorque,
  resetVehicle,
  createTerrainBodies,
  createFuelCanBody,
  createCoinBody,
  getVehicleSpeed,
  getVehicleRotation,
  getVehicleDistance,
  type VehicleComposite,
} from './lib/physics';
import { TerrainGenerator, renderTerrain, type TerrainChunk } from './lib/terrainGenerator';
import { PHYSICS, TERRAIN, FUEL, NITRO, SCORING, CAMERA, STAGES, VEHICLES } from './lib/constants';
import { GameUI } from './ui/GameUI';
import { MobileControls } from './ui/MobileControls';
import { GameOverScreen } from './ui/GameOverScreen';
import { PauseMenu } from './ui/PauseMenu';
import { Garage } from './ui/Garage';
import { FullscreenButton, OrientationWarning } from '@/shared/components';

// =============================================================================
// TYPES
// =============================================================================

interface CollectibleBody {
  body: Matter.Body;
  chunkId: number;
  collected: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  type: 'nitro' | 'coin' | 'fuel' | 'dust' | 'flip';
}

// =============================================================================
// MAIN GAME COMPONENT
// =============================================================================

export function HillClimbGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Matter.Engine | null>(null);
  const runnerRef = useRef<Matter.Runner | null>(null);
  const vehicleRef = useRef<VehicleComposite | null>(null);
  const terrainGeneratorRef = useRef<TerrainGenerator | null>(null);
  const chunksRef = useRef<Map<number, TerrainChunk>>(new Map());
  const terrainBodiesRef = useRef<Map<number, Matter.Body[]>>(new Map());
  const fuelCansRef = useRef<CollectibleBody[]>([]);
  const coinsRef = useRef<CollectibleBody[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const animationFrameRef = useRef<number>(0);

  // Flip tracking
  const lastRotationRef = useRef(0);
  const totalRotationRef = useRef(0);
  const isAirborneRef = useRef(false);
  const airborneTimeRef = useRef(0);

  // Refs to track state (avoids stale closure in render loop)
  const isPlayingRef = useRef(false);
  const isPausedRef = useRef(false);
  const nitroRef = useRef<number>(NITRO.MAX);
  const shakeRef = useRef({ intensity: 0, duration: 0 });

  const controls = useCombinedControls();
  const controlsRef = useRef(controls);
  const isMobile = useIsMobile();
  usePauseKeyboard(); // Handle Escape key for pause menu

  // Store
  const store = useHillClimbStore();

  // Cloud sync for authenticated users
  const { forceSync } = useAuthSync<HillClimbProgress>({
    appId: "hill-climb",
    localStorageKey: "hill-climb-storage",
    getState: () => store.getProgress(),
    setState: (data) => store.setProgress(data),
    debounceMs: 3000,
  });

  const {
    isPlaying,
    isGameOver,
    isPaused,
    fuel,
    nitro,
    distance,
    currentVehicleId,
    currentStageId,
    leanSensitivity,
    startRun,
    endRun,
    consumeFuel,
    collectFuel,
    consumeNitro,
    refillNitro,
    addCoins,
    addFlip,
    addAirtime,
    updateDistance,
    getVehicleStats,
  } = store;

  // Force save immediately on game over
  useEffect(() => {
    if (isGameOver) {
      forceSync();
    }
  }, [isGameOver, forceSync]);

  // Local state
  const [speed, setSpeed] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [showStartScreen, setShowStartScreen] = useState(true);
  const [showGarage, setShowGarage] = useState(false);

  // Update refs when state changes
  useEffect(() => {
    controlsRef.current = controls;
  }, [controls]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    isPausedRef.current = isPaused;
    // Stop/start physics engine when pause state changes
    if (isPaused && runnerRef.current) {
      Matter.Runner.stop(runnerRef.current);
    } else if (!isPaused && runnerRef.current && engineRef.current) {
      Matter.Runner.run(runnerRef.current, engineRef.current);
    }
  }, [isPaused]);

  useEffect(() => {
    nitroRef.current = nitro;
  }, [nitro]);

  // Get current stage config
  const stageConfig = STAGES.find((s) => s.id === currentStageId) || STAGES[0];

  // ==========================================================================
  // CHUNK MANAGEMENT
  // ==========================================================================

  const createChunk = useCallback((chunkIndex: number) => {
    if (!terrainGeneratorRef.current || !engineRef.current) return;
    if (chunksRef.current.has(chunkIndex)) return;

    const chunk = terrainGeneratorRef.current.generateChunk(chunkIndex);
    chunksRef.current.set(chunkIndex, chunk);

    // Create terrain bodies
    const bodies = createTerrainBodies(chunk, stageConfig.friction);
    terrainBodiesRef.current.set(chunkIndex, bodies);
    Matter.Composite.add(engineRef.current.world, bodies);

    // Create fuel cans
    chunk.fuelCanPositions.forEach((pos) => {
      const body = createFuelCanBody(pos.x, pos.y);
      fuelCansRef.current.push({ body, chunkId: chunkIndex, collected: false });
      Matter.Composite.add(engineRef.current!.world, body);
    });

    // Create coins
    chunk.coinPositions.forEach((pos) => {
      const body = createCoinBody(pos.x, pos.y);
      coinsRef.current.push({ body, chunkId: chunkIndex, collected: false });
      Matter.Composite.add(engineRef.current!.world, body);
    });
  }, [stageConfig.friction]);

  const removeChunk = useCallback((chunkIndex: number) => {
    if (!engineRef.current) return;

    // Remove terrain bodies
    const bodies = terrainBodiesRef.current.get(chunkIndex);
    if (bodies) {
      bodies.forEach((body) => Matter.Composite.remove(engineRef.current!.world, body));
      terrainBodiesRef.current.delete(chunkIndex);
    }

    // Remove collectibles from this chunk
    fuelCansRef.current = fuelCansRef.current.filter((fc) => {
      if (fc.chunkId === chunkIndex) {
        Matter.Composite.remove(engineRef.current!.world, fc.body);
        return false;
      }
      return true;
    });

    coinsRef.current = coinsRef.current.filter((c) => {
      if (c.chunkId === chunkIndex) {
        Matter.Composite.remove(engineRef.current!.world, c.body);
        return false;
      }
      return true;
    });

    chunksRef.current.delete(chunkIndex);
  }, []);

  const updateChunks = useCallback(() => {
    if (!vehicleRef.current) return;

    const vehicleX = vehicleRef.current.chassis.position.x;
    const currentChunk = Math.floor(vehicleX / TERRAIN.CHUNK_WIDTH);

    // Create chunks ahead
    for (let i = currentChunk; i <= currentChunk + TERRAIN.CHUNKS_AHEAD; i++) {
      createChunk(i);
    }

    // Remove chunks behind
    chunksRef.current.forEach((_, chunkIndex) => {
      if (chunkIndex < currentChunk - TERRAIN.CHUNKS_BEHIND) {
        removeChunk(chunkIndex);
      }
    });
  }, [createChunk, removeChunk]);

  // Simple airborne check
  function checkIfAirborne(vehicle: VehicleComposite): boolean {
    // Check if both wheels are above expected ground level
    const frontY = vehicle.wheelFront.position.y;
    const rearY = vehicle.wheelRear.position.y;
    const chassisY = vehicle.chassis.position.y;

    // If chassis is moving up or wheels are significantly above where ground would be
    const velocity = vehicle.chassis.velocity;
    return velocity.y < -2 || (frontY < chassisY && rearY < chassisY);
  }

  // ==========================================================================
  // RENDERING HELPERS
  // ==========================================================================

  function renderVehicle(ctx: CanvasRenderingContext2D, vehicle: VehicleComposite) {
    const { chassis, head, wheelFront, wheelRear } = vehicle;

    // Get vehicle render config
    const vehicleData = VEHICLES.find(v => v.id === currentVehicleId);
    const render = vehicleData?.render || {
      scale: 1.0, bodyColor: '#FF6B35', accentColor: '#87CEEB',
      wheelScale: 1.0, wheelColor: '#333333', bodyShape: 'standard' as const
    };

    const wheelRadius = PHYSICS.WHEEL_RADIUS * render.wheelScale;
    const chassisW = PHYSICS.CHASSIS_WIDTH * render.scale;
    const chassisH = PHYSICS.CHASSIS_HEIGHT * render.scale;

    // Render wheels
    ctx.fillStyle = render.wheelColor;
    ctx.beginPath();
    ctx.arc(wheelRear.position.x, wheelRear.position.y, wheelRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(wheelFront.position.x, wheelFront.position.y, wheelRadius, 0, Math.PI * 2);
    ctx.fill();

    // Wheel spokes (except for tracked vehicles)
    if (render.bodyShape !== 'tracked') {
      ctx.strokeStyle = '#666666';
      ctx.lineWidth = 2;
      [wheelRear, wheelFront].forEach((wheel) => {
        ctx.save();
        ctx.translate(wheel.position.x, wheel.position.y);
        ctx.rotate(wheel.angle);
        ctx.beginPath();
        ctx.moveTo(-wheelRadius * 0.8, 0);
        ctx.lineTo(wheelRadius * 0.8, 0);
        ctx.moveTo(0, -wheelRadius * 0.8);
        ctx.lineTo(0, wheelRadius * 0.8);
        ctx.stroke();
        ctx.restore();
      });
    } else {
      // Tank tracks - draw treads between wheels
      ctx.fillStyle = render.wheelColor;
      const trackY = (wheelRear.position.y + wheelFront.position.y) / 2;
      const trackWidth = Math.abs(wheelFront.position.x - wheelRear.position.x) + wheelRadius * 2;
      ctx.fillRect(
        Math.min(wheelRear.position.x, wheelFront.position.x) - wheelRadius,
        trackY - wheelRadius * 0.6,
        trackWidth,
        wheelRadius * 1.2
      );
    }

    // Render chassis based on body shape
    ctx.save();
    ctx.translate(chassis.position.x, chassis.position.y);
    ctx.rotate(chassis.angle);
    ctx.fillStyle = render.bodyColor;

    switch (render.bodyShape) {
      case 'narrow': // Motorbike, Rocket - streamlined
        ctx.beginPath();
        ctx.ellipse(0, 0, chassisW / 2, chassisH / 3, 0, 0, Math.PI * 2);
        ctx.fill();
        // Windshield/fairing
        ctx.fillStyle = render.accentColor;
        ctx.beginPath();
        ctx.ellipse(chassisW / 4, -chassisH / 4, chassisW / 6, chassisH / 4, 0, 0, Math.PI * 2);
        ctx.fill();
        break;

      case 'long': // Big Rig - extended body
        ctx.fillRect(-chassisW / 2, -chassisH / 2, chassisW, chassisH);
        // Cab section
        ctx.fillStyle = render.accentColor;
        ctx.fillRect(chassisW / 4, -chassisH / 2 - chassisH / 3, chassisW / 4, chassisH / 2);
        // Trailer detail
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 2;
        ctx.strokeRect(-chassisW / 2 + 5, -chassisH / 2 + 5, chassisW / 2, chassisH - 10);
        break;

      case 'wide': // Monster Truck, Quad Bike - boxy lifted
        ctx.fillRect(-chassisW / 2, -chassisH / 2 - 5, chassisW, chassisH);
        // Raised body detail
        ctx.fillStyle = render.accentColor;
        ctx.fillRect(chassisW / 6, -chassisH / 2 - chassisH / 2, chassisW / 3, chassisH / 2);
        break;

      case 'tracked': // Tank - angular military
        // Main body
        ctx.fillRect(-chassisW / 2, -chassisH / 2, chassisW, chassisH);
        // Turret
        ctx.fillStyle = render.accentColor;
        ctx.beginPath();
        ctx.arc(0, -chassisH / 2, chassisH / 2, 0, Math.PI * 2);
        ctx.fill();
        // Gun barrel
        ctx.fillStyle = render.bodyColor;
        ctx.fillRect(chassisH / 3, -chassisH / 2 - 3, chassisW / 3, 6);
        break;

      default: // Standard - Jeep, Dune Buggy
        ctx.fillRect(-chassisW / 2, -chassisH / 2, chassisW, chassisH);
        // Windshield
        ctx.fillStyle = render.accentColor;
        ctx.fillRect(chassisW / 4, -chassisH / 2 - 5, chassisW / 4, chassisH / 2);
    }
    ctx.restore();

    // Render head (driver)
    ctx.fillStyle = '#FFE4C4';
    ctx.beginPath();
    ctx.arc(head.position.x, head.position.y, PHYSICS.HEAD_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    // Helmet (color matches vehicle accent)
    ctx.fillStyle = render.accentColor === '#1F2937' ? '#FF0000' : render.accentColor;
    ctx.beginPath();
    ctx.arc(head.position.x, head.position.y - 3, PHYSICS.HEAD_RADIUS, Math.PI, 0);
    ctx.fill();
  }

  function renderFuelCan(ctx: CanvasRenderingContext2D, x: number, y: number) {
    ctx.fillStyle = '#FF0000';
    ctx.fillRect(x - 15, y - 20, 30, 40);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('F', x, y + 7);
  }

  function renderCoin(ctx: CanvasRenderingContext2D, x: number, y: number) {
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.arc(x, y, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#DAA520';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#DAA520';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('$', x, y + 5);
  }

  // Particle system helpers
  function spawnParticle(
    x: number,
    y: number,
    type: Particle['type'],
    options?: Partial<{ vx: number; vy: number; size: number; color: string; life: number }>
  ) {
    const defaults = {
      nitro: { color: '#22D3EE', size: 8, life: 0.4, vx: (Math.random() - 0.5) * 50, vy: Math.random() * 30 + 20 },
      coin: { color: '#FFD700', size: 6, life: 0.8, vx: (Math.random() - 0.5) * 100, vy: -Math.random() * 80 - 40 },
      fuel: { color: '#22C55E', size: 5, life: 0.6, vx: (Math.random() - 0.5) * 80, vy: -Math.random() * 60 - 30 },
      dust: { color: '#A78B5B', size: 10, life: 0.5, vx: (Math.random() - 0.5) * 40, vy: -Math.random() * 20 - 10 },
      flip: { color: '#FBBF24', size: 8, life: 1.0, vx: (Math.random() - 0.5) * 150, vy: -Math.random() * 100 - 50 },
    };
    const d = defaults[type];
    particlesRef.current.push({
      x, y,
      vx: options?.vx ?? d.vx,
      vy: options?.vy ?? d.vy,
      life: options?.life ?? d.life,
      maxLife: options?.life ?? d.life,
      size: options?.size ?? d.size,
      color: options?.color ?? d.color,
      type,
    });
  }

  // Screen shake helper
  function triggerShake(intensity: number, duration: number) {
    shakeRef.current = { intensity, duration };
  }

  function updateShake(deltaTime: number) {
    if (shakeRef.current.duration > 0) {
      shakeRef.current.duration -= deltaTime;
      if (shakeRef.current.duration <= 0) {
        shakeRef.current.intensity = 0;
      }
    }
  }

  function getShakeOffset(): { x: number; y: number } {
    if (shakeRef.current.intensity <= 0) return { x: 0, y: 0 };
    const intensity = shakeRef.current.intensity;
    return {
      x: (Math.random() - 0.5) * intensity * 2,
      y: (Math.random() - 0.5) * intensity * 2,
    };
  }

  function updateParticles(deltaTime: number) {
    particlesRef.current = particlesRef.current.filter((p) => {
      p.x += p.vx * deltaTime;
      p.y += p.vy * deltaTime;
      p.vy += 150 * deltaTime; // Gravity for most particles
      p.life -= deltaTime;
      return p.life > 0;
    });
  }

  function renderParticles(ctx: CanvasRenderingContext2D) {
    particlesRef.current.forEach((p) => {
      const alpha = p.life / p.maxLife;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  // ==========================================================================
  // COLLISION HANDLING
  // ==========================================================================

  const handleCollision = useCallback((event: Matter.IEventCollision<Matter.Engine>) => {
    for (const pair of event.pairs) {
      const labels = [pair.bodyA.label, pair.bodyB.label];

      // Head hit terrain = death
      if (labels.includes('driverHead') && (labels.includes('terrain') || labels.includes('ground'))) {
        triggerShake(25, 0.5); // Big shake on crash
        endRun('head');
        return;
      }

      // Collect fuel can
      if (labels.includes('fuelCan')) {
        const fuelBody = pair.bodyA.label === 'fuelCan' ? pair.bodyA : pair.bodyB;
        const fuelCan = fuelCansRef.current.find((fc) => fc.body === fuelBody);
        if (fuelCan && !fuelCan.collected) {
          fuelCan.collected = true;
          collectFuel();
          // Spawn fuel pickup particles
          for (let i = 0; i < 8; i++) {
            spawnParticle(fuelBody.position.x, fuelBody.position.y, 'fuel');
          }
          Matter.Composite.remove(engineRef.current!.world, fuelBody);
        }
      }

      // Collect coin
      if (labels.includes('coin')) {
        const coinBody = pair.bodyA.label === 'coin' ? pair.bodyA : pair.bodyB;
        const coin = coinsRef.current.find((c) => c.body === coinBody);
        if (coin && !coin.collected) {
          coin.collected = true;
          const value = SCORING.COIN_VALUE_MIN + Math.floor(Math.random() * (SCORING.COIN_VALUE_MAX - SCORING.COIN_VALUE_MIN));
          addCoins(value);
          // Spawn coin pickup particles
          for (let i = 0; i < 6; i++) {
            spawnParticle(coinBody.position.x, coinBody.position.y, 'coin');
          }
          Matter.Composite.remove(engineRef.current!.world, coinBody);
        }
      }
    }
  }, [endRun, collectFuel, addCoins]);

  // ==========================================================================
  // GAME LOOP
  // ==========================================================================

  const gameLoop = useCallback((deltaTime: number) => {
    if (!vehicleRef.current || !engineRef.current || !isPlayingRef.current) return;

    const vehicle = vehicleRef.current;
    const currentControls = controlsRef.current;
    const stats = getVehicleStats(currentVehicleId);
    const currentNitro = nitroRef.current;

    // Check if nitro is active (control pressed, has nitro, and has fuel)
    const nitroActive = currentControls.nitro && currentNitro > 0 && fuel > 0;
    const isGrounded = !isAirborneRef.current;

    // Calculate boost multipliers
    const torqueMult = nitroActive && isGrounded ? NITRO.WHEEL_BOOST : 1;
    const leanMult = nitroActive ? NITRO.LEAN_BOOST : 1;

    // Apply controls with nitro boost
    applyWheelTorque(vehicle, currentControls.gas, currentControls.brake, stats.torque * torqueMult);
    applyLeanTorque(vehicle, currentControls.leanBack, currentControls.leanForward, stats.airControl * leanMult * leanSensitivity);

    // Handle nitro consumption/refill
    if (nitroActive) {
      // Drain rate is adjusted by duration upgrade (higher = slower drain)
      consumeNitro((NITRO.DRAIN_RATE / stats.nitroDuration) * deltaTime);
      // Spawn nitro trail particles behind wheels
      if (Math.random() < 0.5) {
        spawnParticle(vehicle.wheelRear.position.x, vehicle.wheelRear.position.y + 10, 'nitro');
        spawnParticle(vehicle.wheelFront.position.x, vehicle.wheelFront.position.y + 10, 'nitro');
      }
    } else if (currentNitro < NITRO.MAX) {
      // Refill rate is adjusted by recharge upgrade (higher = faster refill)
      refillNitro(NITRO.BASE_REFILL_RATE * stats.nitroRecharge * deltaTime);
    }

    // Update particles
    updateParticles(deltaTime);

    // Handle reset
    if (currentControls.reset) {
      resetVehicle(vehicle, 200, 300);
    }

    // Consume fuel
    if (currentControls.gas) {
      consumeFuel(FUEL.DRAIN_RATE * stats.fuelEfficiency * deltaTime);
    } else {
      consumeFuel(FUEL.IDLE_DRAIN_RATE * deltaTime);
    }

    // Update distance
    const dist = getVehicleDistance(vehicle);
    updateDistance(dist);

    // Update chunks based on position
    updateChunks();

    // Track airborne state and flips
    const isCurrentlyAirborne = checkIfAirborne(vehicle);
    const currentRotation = vehicle.chassis.angle;

    if (isCurrentlyAirborne) {
      if (!isAirborneRef.current) {
        // Just became airborne
        isAirborneRef.current = true;
        airborneTimeRef.current = 0;
        totalRotationRef.current = 0;
        lastRotationRef.current = currentRotation;
      } else {
        // Still airborne
        airborneTimeRef.current += deltaTime;

        // Track rotation for flips
        const rotationDelta = currentRotation - lastRotationRef.current;
        totalRotationRef.current += rotationDelta;
        lastRotationRef.current = currentRotation;

        // Check for completed flip
        if (Math.abs(totalRotationRef.current) >= SCORING.FLIP_ROTATION_THRESHOLD) {
          addFlip();
          addCoins(SCORING.FRONT_FLIP_COINS);
          // Spawn flip celebration particles
          for (let i = 0; i < 15; i++) {
            spawnParticle(vehicle.chassis.position.x, vehicle.chassis.position.y, 'flip');
          }
          totalRotationRef.current = totalRotationRef.current % (Math.PI * 2);
        }
      }
    } else {
      if (isAirborneRef.current && airborneTimeRef.current > SCORING.MIN_AIRTIME_FOR_BONUS) {
        // Just landed after significant airtime
        const airtimeCoins = Math.floor(airborneTimeRef.current * SCORING.AIRTIME_COINS_PER_SECOND);
        if (airtimeCoins > 0) {
          addCoins(airtimeCoins);
          addAirtime(airborneTimeRef.current);
        }
        // Spawn dust particles on landing
        for (let i = 0; i < 10; i++) {
          spawnParticle(vehicle.wheelRear.position.x, vehicle.wheelRear.position.y, 'dust');
          spawnParticle(vehicle.wheelFront.position.x, vehicle.wheelFront.position.y, 'dust');
        }
        // Screen shake on hard landing (intensity based on airtime)
        const shakeIntensity = Math.min(15, airborneTimeRef.current * 5);
        triggerShake(shakeIntensity, 0.2);
      }
      isAirborneRef.current = false;
      airborneTimeRef.current = 0;
      totalRotationRef.current = 0;
    }

    // Update UI state
    setSpeed(Math.round(getVehicleSpeed(vehicle)));
    setRotation(Math.round(getVehicleRotation(vehicle)));
  }, [currentVehicleId, getVehicleStats, consumeFuel, consumeNitro, refillNitro, fuel, leanSensitivity, updateDistance, updateChunks, addFlip, addCoins, addAirtime]);

  // ==========================================================================
  // RENDER LOOP
  // ==========================================================================

  const startRenderLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let lastTime = performance.now();

    const render = (currentTime: number) => {
      const deltaTime = (currentTime - lastTime) / 1000;
      lastTime = currentTime;

      // Render sky background with gradient
      const skyRender = stageConfig.render;
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      gradient.addColorStop(0, skyRender.skyGradient[0]);
      gradient.addColorStop(1, skyRender.skyGradient[1]);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Render stars (static background, no camera transform)
      if (skyRender.hasStars) {
        ctx.fillStyle = '#FFFFFF';
        // Deterministic star positions based on canvas size
        for (let i = 0; i < 100; i++) {
          const seed = i * 12345;
          const x = (seed * 7919) % canvas.width;
          const y = ((seed * 104729) % (canvas.height * 0.7));
          const size = (seed % 3) + 1;
          const twinkle = Math.sin(performance.now() / 500 + i) * 0.3 + 0.7;
          ctx.globalAlpha = twinkle;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // Render celestial bodies (static background)
      if (skyRender.showSun) {
        ctx.fillStyle = '#FFD700';
        ctx.beginPath();
        ctx.arc(canvas.width - 100, 80, 40, 0, Math.PI * 2);
        ctx.fill();
        // Sun glow
        ctx.fillStyle = 'rgba(255, 215, 0, 0.3)';
        ctx.beginPath();
        ctx.arc(canvas.width - 100, 80, 60, 0, Math.PI * 2);
        ctx.fill();
      }

      if (skyRender.showMoon) {
        ctx.fillStyle = '#F0F0F0';
        ctx.beginPath();
        ctx.arc(canvas.width - 80, 60, 30, 0, Math.PI * 2);
        ctx.fill();
        // Moon craters
        ctx.fillStyle = '#D0D0D0';
        ctx.beginPath();
        ctx.arc(canvas.width - 90, 55, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(canvas.width - 70, 70, 5, 0, Math.PI * 2);
        ctx.fill();
      }

      if (skyRender.showEarth) {
        // Earth in the moon sky
        ctx.fillStyle = '#4169E1';
        ctx.beginPath();
        ctx.arc(canvas.width - 120, 100, 50, 0, Math.PI * 2);
        ctx.fill();
        // Continents
        ctx.fillStyle = '#228B22';
        ctx.beginPath();
        ctx.arc(canvas.width - 130, 90, 20, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(canvas.width - 100, 110, 15, 0, Math.PI * 2);
        ctx.fill();
        // Clouds
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.beginPath();
        ctx.arc(canvas.width - 140, 100, 12, 0, Math.PI * 2);
        ctx.fill();
      }

      // Render aurora (animated)
      if (skyRender.hasAurora) {
        const time = performance.now() / 2000;
        for (let i = 0; i < 5; i++) {
          const wave = Math.sin(time + i * 0.5) * 20;
          const grd = ctx.createLinearGradient(0, 50 + wave + i * 30, 0, 120 + wave + i * 30);
          grd.addColorStop(0, 'rgba(0, 255, 100, 0)');
          grd.addColorStop(0.5, `rgba(0, 255, ${150 + i * 20}, 0.3)`);
          grd.addColorStop(1, 'rgba(100, 0, 255, 0)');
          ctx.fillStyle = grd;
          ctx.fillRect(0, 50 + wave + i * 30, canvas.width, 80);
        }
      }

      // Render clouds (parallax effect)
      if (skyRender.hasClouds && vehicleRef.current) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        const parallax = vehicleRef.current.chassis.position.x * 0.1;
        for (let i = 0; i < 8; i++) {
          const baseX = (i * 200 - parallax) % (canvas.width + 200) - 100;
          const y = 50 + (i % 3) * 40;
          // Cloud shape (multiple circles)
          ctx.beginPath();
          ctx.arc(baseX, y, 30, 0, Math.PI * 2);
          ctx.arc(baseX + 25, y - 10, 25, 0, Math.PI * 2);
          ctx.arc(baseX + 50, y, 30, 0, Math.PI * 2);
          ctx.arc(baseX + 25, y + 10, 20, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (vehicleRef.current && isPlayingRef.current && !isPausedRef.current) {
        // Run game logic (skip when paused to prevent fuel drain, etc.)
        gameLoop(deltaTime);

        // Update screen shake
        updateShake(deltaTime);
        const shake = getShakeOffset();

        // Camera transform with shake
        const vehicle = vehicleRef.current;
        const cameraX = vehicle.chassis.position.x + CAMERA.LOOK_AHEAD;
        const cameraY = Math.max(CAMERA.MIN_Y, vehicle.chassis.position.y + CAMERA.VERTICAL_OFFSET);

        ctx.save();
        ctx.translate(canvas.width / 2 - cameraX + shake.x, canvas.height / 2 - cameraY + shake.y);

        // Render terrain chunks
        chunksRef.current.forEach((chunk) => {
          renderTerrain(ctx, chunk.points, stageConfig.groundColor);
        });

        // Render terrain decorations (rocks, trees, crystals, etc.)
        chunksRef.current.forEach((chunk) => {
          const decorations = skyRender.decorations;
          const colors = skyRender.decorationColors;

          // Place decorations at intervals along terrain
          chunk.points.forEach((point, idx) => {
            if (idx % 8 !== 0) return; // Every 8th point
            const seed = Math.floor(point.x * 100);
            const decorType = decorations[seed % decorations.length];
            const color = colors[seed % colors.length];

            switch (decorType) {
              case 'rocks':
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.moveTo(point.x - 8, point.y);
                ctx.lineTo(point.x - 5, point.y - 12);
                ctx.lineTo(point.x + 3, point.y - 10);
                ctx.lineTo(point.x + 8, point.y);
                ctx.closePath();
                ctx.fill();
                break;

              case 'trees':
                // Tree trunk
                ctx.fillStyle = '#5D4037';
                ctx.fillRect(point.x - 3, point.y - 40, 6, 40);
                // Tree foliage
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.moveTo(point.x, point.y - 80);
                ctx.lineTo(point.x - 20, point.y - 40);
                ctx.lineTo(point.x + 20, point.y - 40);
                ctx.closePath();
                ctx.fill();
                ctx.beginPath();
                ctx.moveTo(point.x, point.y - 100);
                ctx.lineTo(point.x - 15, point.y - 60);
                ctx.lineTo(point.x + 15, point.y - 60);
                ctx.closePath();
                ctx.fill();
                break;

              case 'crystals':
                ctx.fillStyle = color;
                ctx.globalAlpha = 0.7;
                ctx.beginPath();
                ctx.moveTo(point.x, point.y - 25);
                ctx.lineTo(point.x - 6, point.y);
                ctx.lineTo(point.x + 6, point.y);
                ctx.closePath();
                ctx.fill();
                ctx.beginPath();
                ctx.moveTo(point.x + 8, point.y - 15);
                ctx.lineTo(point.x + 4, point.y);
                ctx.lineTo(point.x + 12, point.y);
                ctx.closePath();
                ctx.fill();
                ctx.globalAlpha = 1;
                break;

              case 'craters':
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.ellipse(point.x, point.y + 2, 15, 5, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#4A4A4A';
                ctx.lineWidth = 2;
                ctx.stroke();
                break;

              case 'snowdrifts':
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.ellipse(point.x, point.y - 5, 20, 10, 0, 0, Math.PI);
                ctx.fill();
                break;

              case 'cacti':
                ctx.fillStyle = '#228B22';
                // Main stem
                ctx.fillRect(point.x - 4, point.y - 30, 8, 30);
                // Arms
                ctx.fillRect(point.x - 15, point.y - 25, 12, 6);
                ctx.fillRect(point.x - 15, point.y - 35, 6, 15);
                ctx.fillRect(point.x + 3, point.y - 20, 12, 6);
                ctx.fillRect(point.x + 9, point.y - 30, 6, 15);
                break;
            }
          });
        });

        // Render snowfall particles (arctic stage)
        if (skyRender.hasSnowfall) {
          ctx.fillStyle = '#FFFFFF';
          for (let i = 0; i < 50; i++) {
            const seed = i * 7919;
            const time = performance.now() / 1000;
            const x = cameraX - canvas.width / 2 + ((seed + time * 50) % canvas.width);
            const y = cameraY - canvas.height / 2 + ((seed * 3 + time * 100) % canvas.height);
            const size = (seed % 3) + 2;
            ctx.globalAlpha = 0.7;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }

        // Render rising ember particles (volcano stage)
        if (skyRender.hasEmbers) {
          for (let i = 0; i < 40; i++) {
            const seed = i * 5347;
            const time = performance.now() / 1000;
            // Embers rise from bottom
            const x = cameraX - canvas.width / 2 + ((seed + time * 30) % canvas.width);
            const baseY = cameraY + canvas.height / 2;
            const y = baseY - ((seed * 2 + time * 80) % (canvas.height * 1.5));
            const size = (seed % 3) + 2;
            const flicker = Math.sin(time * 10 + i) * 0.3 + 0.7;
            // Color varies between orange and red
            const colorVal = (seed % 2 === 0) ? '#FF4500' : '#FF6600';
            ctx.fillStyle = colorVal;
            ctx.globalAlpha = flicker * 0.8;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }

        // Render collectibles
        fuelCansRef.current.forEach((fc) => {
          if (!fc.collected) {
            renderFuelCan(ctx, fc.body.position.x, fc.body.position.y);
          }
        });

        coinsRef.current.forEach((c) => {
          if (!c.collected) {
            renderCoin(ctx, c.body.position.x, c.body.position.y);
          }
        });

        // Render vehicle
        renderVehicle(ctx, vehicle);

        // Render particles
        renderParticles(ctx);

        ctx.restore();
      }

      animationFrameRef.current = requestAnimationFrame(render);
    };

    animationFrameRef.current = requestAnimationFrame(render);
  }, [stageConfig, gameLoop, renderVehicle]);

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  const initGame = useCallback(() => {
    if (!canvasRef.current) return;

    // Size the canvas first (critical - must happen before render loop)
    canvasRef.current.width = window.innerWidth;
    canvasRef.current.height = window.innerHeight;

    // Clean up existing
    if (engineRef.current) {
      Matter.Engine.clear(engineRef.current);
    }
    if (runnerRef.current) {
      Matter.Runner.stop(runnerRef.current);
    }

    // Create engine with stage-specific gravity
    const engine = Matter.Engine.create({
      gravity: { x: 0, y: PHYSICS.GRAVITY * stageConfig.gravity },
    });
    engineRef.current = engine;

    // Create terrain generator
    terrainGeneratorRef.current = new TerrainGenerator(Date.now());

    // Clear chunk refs
    chunksRef.current.clear();
    terrainBodiesRef.current.clear();
    fuelCansRef.current = [];
    coinsRef.current = [];

    // Create initial terrain chunks
    for (let i = -1; i <= TERRAIN.CHUNKS_AHEAD; i++) {
      createChunk(i);
    }

    // Create vehicle
    const stats = getVehicleStats(currentVehicleId);
    const vehicle = createVehicle({
      x: 200,
      y: 300,
      stats,
    });
    vehicleRef.current = vehicle;
    Matter.Composite.add(engine.world, vehicle.composite);

    // Create flat starting ground
    const startGround = Matter.Bodies.rectangle(200, 450, 600, 60, {
      isStatic: true,
      friction: stageConfig.friction,
      label: 'ground',
      render: { fillStyle: stageConfig.groundColor },
    });
    Matter.Composite.add(engine.world, startGround);

    // Set up collision detection
    Matter.Events.on(engine, 'collisionStart', handleCollision);

    // Create runner
    const runner = Matter.Runner.create();
    runnerRef.current = runner;
    Matter.Runner.run(runner, engine);

    // Reset tracking
    lastRotationRef.current = 0;
    totalRotationRef.current = 0;
    isAirborneRef.current = false;
    airborneTimeRef.current = 0;

    // Start render loop
    startRenderLoop();
  }, [
    currentVehicleId,
    currentStageId,
    stageConfig,
    getVehicleStats,
    createChunk,
    handleCollision,
    startRenderLoop,
  ]);

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================

  useEffect(() => {
    if (!showStartScreen && isPlaying) {
      initGame();
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (runnerRef.current) {
        Matter.Runner.stop(runnerRef.current);
      }
      if (engineRef.current) {
        Matter.Engine.clear(engineRef.current);
      }
    };
  }, [showStartScreen, isPlaying, initGame]);

  // Canvas resize - must run when canvas appears (not on mount when start screen is shown)
  useEffect(() => {
    if (showStartScreen) return; // Canvas doesn't exist yet

    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [showStartScreen]);

  // ==========================================================================
  // HANDLERS
  // ==========================================================================

  const handleStart = () => {
    setShowStartScreen(false);
    setShowGarage(false);
    startRun();
  };

  const handleRestart = () => {
    startRun();
    initGame();
  };

  const handleGoToGarage = () => {
    setShowStartScreen(false);
    setShowGarage(true);
  };

  const handleStartFromGarage = () => {
    setShowGarage(false);
    startRun();
  };

  // ==========================================================================
  // RENDER
  // ==========================================================================

  // Show Garage screen
  if (showGarage) {
    return <Garage onStartGame={handleStartFromGarage} />;
  }

  // Show Start screen
  if (showStartScreen) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-sky-400 to-sky-600 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-6xl font-bold text-white mb-4 drop-shadow-lg">
            🏔️ Hill Climb Racing
          </h1>
          <p className="text-xl text-white/80 mb-8">
            Drive as far as you can without running out of fuel!
          </p>
          <div className="flex gap-4 justify-center mb-8">
            <button
              onClick={handleStart}
              className="btn btn-primary btn-lg text-2xl px-12"
            >
              🚗 Play Now
            </button>
            <button
              onClick={handleGoToGarage}
              className="btn btn-secondary btn-lg text-2xl px-8"
            >
              🔧 Garage
            </button>
          </div>
          <div className="text-white/70">
            <p>
              <strong>Controls:</strong> D/→ Gas | A/← Brake | W/↑ Lean Back | S/↓ Lean Forward | Space Nitro
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-screen overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0" style={{ touchAction: 'none' }} />

      {/* Orientation warning - shows in portrait mode */}
      <OrientationWarning />

      {/* Fullscreen button - top right corner */}
      <div className="absolute top-4 right-4 z-50">
        <FullscreenButton />
      </div>

      {isPlaying && (
        <>
          <GameUI
            fuel={fuel}
            maxFuel={getVehicleStats(currentVehicleId).maxFuel}
            nitro={nitro}
            maxNitro={NITRO.MAX}
            nitroActive={controls.nitro && nitro > 0 && fuel > 0}
            distance={distance}
            speed={speed}
          />
          {isMobile && <MobileControls setNitro={controls.setNitro} />}
        </>
      )}

      {isPaused && !isGameOver && (
        <PauseMenu onGoToGarage={handleGoToGarage} />
      )}

      {isGameOver && (
        <GameOverScreen onRestart={handleRestart} onGoToGarage={handleGoToGarage} />
      )}
    </div>
  );
}

export default HillClimbGame;
