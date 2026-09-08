"use client";

/**
 * Placeholder buildings at the hub, so the yard reads as a place to go.
 *
 * These are plain boxes with a roof and a window band. The real models arrive
 * with the economy milestone. The windows glow and a few lamps switch on once
 * night falls, which is what makes the hub a landmark you can steer toward in
 * the dark.
 */

import { useMemo } from "react";

import { LANDMARKS } from "../lib/landmarks";
import { nightFactor } from "../lib/dayNight";

/** The hub pad height from lib/terrain, so nothing floats or sinks. */
const GROUND = 2;

type Building = {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  color: string;
  roof: string;
};

const BUILDINGS: Building[] = [
  {
    id: "garage",
    ...LANDMARKS.garage,
    width: 14,
    depth: 11,
    height: 6,
    color: "#c25b3a",
    roof: "#7d3b26",
  },
  {
    id: "trophy-room",
    ...LANDMARKS.trophyRoom,
    width: 11,
    depth: 9,
    height: 5.5,
    color: "#3f7fa8",
    roof: "#28536e",
  },
  {
    id: "dealership",
    ...LANDMARKS.dealership,
    width: 16,
    depth: 12,
    height: 7,
    color: "#e8b23a",
    roof: "#a97c1c",
  },
  {
    id: "house",
    ...LANDMARKS.house,
    width: 13,
    depth: 12,
    height: 7.5,
    color: "#efe3c8",
    roof: "#8c4b34",
  },
];

export function Buildings({ timeOfDay }: { timeOfDay: number }) {
  const night = nightFactor(timeOfDay);
  const lampsOn = night > 0.3;
  const glow = useMemo(() => (lampsOn ? 1.1 : 0), [lampsOn]);

  return (
    <group>
      {BUILDINGS.map((building) => (
        <group key={building.id} position={[building.x, GROUND, building.z]}>
          <mesh castShadow receiveShadow position={[0, building.height / 2, 0]}>
            <boxGeometry args={[building.width, building.height, building.depth]} />
            <meshStandardMaterial color={building.color} roughness={0.9} />
          </mesh>

          {/* A simple pitched roof, made from a four sided cone. */}
          <mesh castShadow position={[0, building.height + 1.4, 0]} rotation={[0, Math.PI / 4, 0]}>
            <coneGeometry args={[Math.max(building.width, building.depth) * 0.78, 2.8, 4]} />
            <meshStandardMaterial color={building.roof} roughness={1} flatShading />
          </mesh>

          {/* The window band. It lights up after dark. */}
          <mesh position={[0, building.height * 0.62, building.depth / 2 + 0.06]}>
            <planeGeometry args={[building.width * 0.7, 1.6]} />
            <meshStandardMaterial
              color={lampsOn ? "#ffe9a8" : "#5d7285"}
              emissive="#ffcf6b"
              emissiveIntensity={glow}
              roughness={0.4}
            />
          </mesh>

          {lampsOn && (
            <pointLight
              position={[0, building.height + 1, building.depth / 2 + 2]}
              intensity={12}
              distance={26}
              decay={2}
              color="#ffd9a0"
            />
          )}
        </group>
      ))}
    </group>
  );
}

export default Buildings;
