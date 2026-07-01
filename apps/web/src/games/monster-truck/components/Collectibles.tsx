'use client';

import { useRef, useMemo, useState, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { COLLECTIBLES, WORLD, LAKES } from '../lib/constants';
import { useGameStore } from '../lib/store';
import { sounds } from '../lib/sounds';
import { getTerrainHeight } from '../lib/terrainUtils';

// Check if position is in a lake
function isInLake(x: number, z: number): boolean {
  return LAKES.some(lake => {
    const dist = Math.sqrt((x - lake.x) ** 2 + (z - lake.z) ** 2);
    return dist < lake.size + 5;
  });
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function positionSeed(position: [number, number, number], salt = 0): number {
  return position[0] * 12.9898 + position[1] * 78.233 + position[2] * 37.719 + salt;
}

// Generate random positions ON THE TERRAIN (avoiding lakes)
function generatePositions(count: number, minDist = 10, hoverHeight = 0.8): [number, number, number][] {
  const positions: [number, number, number][] = [];
  const maxAttempts = count * 20;
  let attempts = 0;
  const seedBase = count * 97 + minDist * 31 + hoverHeight * 17;

  while (positions.length < count && attempts < maxAttempts) {
    attempts++;

    // Random position within world bounds (avoiding center spawn area)
    const angle = seededRandom(seedBase + attempts * 2) * Math.PI * 2;
    const distance = 40 + seededRandom(seedBase + attempts * 2 + 1) * (WORLD.HALF_SIZE - 60);
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;

    // Skip positions in lakes
    if (isInLake(x, z)) continue;

    // Sample terrain height and add hover offset
    const terrainY = getTerrainHeight(x, z);
    const y = terrainY + hoverHeight;

    // Check minimum distance from other collectibles
    const tooClose = positions.some(
      (p) => Math.sqrt((p[0] - x) ** 2 + (p[2] - z) ** 2) < minDist
    );

    if (!tooClose) {
      positions.push([x, y, z]);
    }
  }

  return positions;
}

// Single coin component
function Coin({
  position,
  onCollect,
}: {
  position: [number, number, number];
  onCollect: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [collected, setCollected] = useState(false);
  const baseY = useRef(position[1]);
  const time = useRef(seededRandom(positionSeed(position, 1)) * Math.PI * 2);

  useFrame((_, delta) => {
    if (!meshRef.current || collected) return;

    // Spin and hover animation
    time.current += delta * COLLECTIBLES.COIN.SPIN_SPEED;
    meshRef.current.rotation.y += delta * 2;
    meshRef.current.position.y =
      baseY.current + Math.sin(time.current) * COLLECTIBLES.COIN.HOVER_AMPLITUDE;
  });

  const handleCollision = () => {
    if (collected) return;
    setCollected(true);
    onCollect();
  };

  if (collected) return null;

  return (
    <RigidBody
      type="fixed"
      position={position}
      sensor
      onIntersectionEnter={handleCollision}
      colliders="ball"
    >
      <mesh ref={meshRef} castShadow>
        <cylinderGeometry args={[COLLECTIBLES.COIN.SIZE, COLLECTIBLES.COIN.SIZE, 0.1, 24]} />
        <meshStandardMaterial
          color="#ffd700"
          metalness={0.8}
          roughness={0.2}
          emissive="#ffa500"
          emissiveIntensity={0.3}
        />
      </mesh>
    </RigidBody>
  );
}

// Single star component
function Star({
  position,
  onCollect,
}: {
  position: [number, number, number];
  onCollect: () => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const [collected, setCollected] = useState(false);
  const baseY = useRef(position[1]);
  const time = useRef(seededRandom(positionSeed(position, 2)) * Math.PI * 2);

  // Star shape using triangles - MUST be before any conditional returns!
  const starShape = useMemo(() => {
    const shape = new THREE.Shape();
    const points = 5;
    const outerRadius = COLLECTIBLES.STAR.SIZE;
    const innerRadius = COLLECTIBLES.STAR.SIZE * 0.4;

    for (let i = 0; i < points * 2; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = (i * Math.PI) / points - Math.PI / 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    return shape;
  }, []);

  useFrame((_, delta) => {
    if (!groupRef.current || collected) return;

    time.current += delta * COLLECTIBLES.STAR.SPIN_SPEED;
    groupRef.current.rotation.y += delta * 1.5;
    groupRef.current.rotation.z = Math.sin(time.current * 0.5) * 0.2;
    groupRef.current.position.y =
      baseY.current + Math.sin(time.current) * COLLECTIBLES.STAR.HOVER_AMPLITUDE;
  });

  const handleCollision = () => {
    if (collected) return;
    setCollected(true);
    onCollect();
  };

  if (collected) return null;

  return (
    <RigidBody
      type="fixed"
      position={position}
      sensor
      onIntersectionEnter={handleCollision}
      colliders="ball"
    >
      <group ref={groupRef}>
        <mesh castShadow>
          { }
          <extrudeGeometry
            args={[starShape, { depth: 0.2, bevelEnabled: false }]}
          />
          <meshStandardMaterial
            color="#ffff00"
            metalness={0.9}
            roughness={0.1}
            emissive="#ffaa00"
            emissiveIntensity={0.5}
          />
        </mesh>
        {/* Glow effect */}
        <pointLight color="#ffff00" intensity={2} distance={5} />
      </group>
    </RigidBody>
  );
}

// Mystery box component
function MysteryBox({
  position,
  onCollect,
}: {
  position: [number, number, number];
  onCollect: (value: number) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [collected, setCollected] = useState(false);
  const time = useRef(seededRandom(positionSeed(position, 3)) * Math.PI * 2);

  useFrame((_, delta) => {
    if (!meshRef.current || collected) return;

    time.current += delta;
    meshRef.current.rotation.y += delta * 0.5;
    meshRef.current.position.y =
      position[1] + Math.sin(time.current) * 0.3;
  });

  const handleCollision = () => {
    if (collected) return;
    setCollected(true);
    // Random value between min and max
    const value =
      COLLECTIBLES.MYSTERY_BOX.MIN_VALUE +
      Math.floor(
        Math.random() *
          (COLLECTIBLES.MYSTERY_BOX.MAX_VALUE - COLLECTIBLES.MYSTERY_BOX.MIN_VALUE)
      );
    onCollect(value);
  };

  if (collected) return null;

  return (
    <RigidBody
      type="fixed"
      position={position}
      sensor
      onIntersectionEnter={handleCollision}
      colliders="cuboid"
    >
      <mesh ref={meshRef} castShadow>
        <boxGeometry args={[COLLECTIBLES.MYSTERY_BOX.SIZE, COLLECTIBLES.MYSTERY_BOX.SIZE, COLLECTIBLES.MYSTERY_BOX.SIZE]} />
        <meshStandardMaterial
          color="#9b59b6"
          metalness={0.5}
          roughness={0.3}
          emissive="#8e44ad"
          emissiveIntensity={0.4}
        />
      </mesh>
      {/* Question mark decal would go here */}
      <pointLight color="#9b59b6" intensity={3} distance={8} />
    </RigidBody>
  );
}

// All collectibles manager
export function Collectibles() {
  const addCoins = useGameStore((s) => s.addCoins);
  const collectStar = useGameStore((s) => s.collectStar);
  const soundEnabled = useGameStore((s) => s.soundEnabled);

  // Generate positions once
  const coinPositions = useMemo(
    () => generatePositions(COLLECTIBLES.COIN.COUNT, 8),
    []
  );
  const starPositions = useMemo(
    () => generatePositions(COLLECTIBLES.STAR.COUNT, 25),
    []
  );
  const mysteryPositions = useMemo(
    () => generatePositions(COLLECTIBLES.MYSTERY_BOX.COUNT, 50),
    []
  );

  const handleCoinCollect = useCallback(() => {
    addCoins(COLLECTIBLES.COIN.VALUE);
    if (soundEnabled) sounds.playCoin();
  }, [addCoins, soundEnabled]);

  const handleStarCollect = useCallback(() => {
    addCoins(COLLECTIBLES.STAR.VALUE);
    collectStar();
    if (soundEnabled) sounds.playStar();
  }, [addCoins, collectStar, soundEnabled]);

  const handleMysteryCollect = useCallback((value: number) => {
    addCoins(value);
    if (soundEnabled) {
      sounds.playStar();
      setTimeout(() => sounds.playUnlock(), 300);
    }
  }, [addCoins, soundEnabled]);

  return (
    <group>
      {/* Coins */}
      {coinPositions.map((pos, i) => (
        <Coin key={`coin-${i}`} position={pos} onCollect={handleCoinCollect} />
      ))}

      {/* Stars */}
      {starPositions.map((pos, i) => (
        <Star key={`star-${i}`} position={pos} onCollect={handleStarCollect} />
      ))}

      {/* Mystery boxes */}
      {mysteryPositions.map((pos, i) => (
        <MysteryBox
          key={`mystery-${i}`}
          position={pos}
          onCollect={handleMysteryCollect}
        />
      ))}
    </group>
  );
}

// Particle effect for collection (spawn on collect)
export function CollectParticles({
  position,
  color = '#ffd700',
  count = 20,
}: {
  position: [number, number, number];
  color?: string;
  count?: number;
}) {
  const particles = useMemo(() => {
    const baseSeed = positionSeed(position, count);
    return Array.from({ length: count }, (_, i) => ({
      velocity: new THREE.Vector3(
        (seededRandom(baseSeed + i * 3) - 0.5) * 5,
        seededRandom(baseSeed + i * 3 + 1) * 5 + 2,
        (seededRandom(baseSeed + i * 3 + 2) - 0.5) * 5
      ),
      position: new THREE.Vector3(...position),
    }));
  }, [position, count]);

  const groupRef = useRef<THREE.Group>(null);
  const [visible, setVisible] = useState(true);
  const time = useRef(0);

  useFrame((_, delta) => {
    if (!groupRef.current || !visible) return;

    time.current += delta;
    if (time.current > 1) {
      setVisible(false);
      return;
    }

    // Update particle positions
    groupRef.current.children.forEach((child, i) => {
      const p = particles[i];
      p.velocity.y -= delta * 10; // gravity
      p.position.add(p.velocity.clone().multiplyScalar(delta));
      child.position.copy(p.position);
      (child as THREE.Mesh).scale.setScalar(1 - time.current);
    });
  });

  if (!visible) return null;

  return (
    <group ref={groupRef}>
      {particles.map((p, i) => (
        <mesh key={i} position={p.position}>
          <sphereGeometry args={[0.1, 8, 8]} />
          <meshBasicMaterial color={color} />
        </mesh>
      ))}
    </group>
  );
}
