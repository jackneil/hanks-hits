"use client";

/**
 * The quad, built out of boxes and cylinders.
 *
 * Nothing is loaded from anywhere: every part is a Three.js primitive. The
 * model faces local +Z, which is the direction Rapier drives the wheels in.
 * The wheels themselves belong to `Vehicle.tsx`, so every vehicle spins and
 * steers its wheels the same way.
 */

import type { VehicleTuning } from "../../lib/vehicles";

export type VehicleModelProps = {
  tuning: VehicleTuning;
  /** The color the kid picked in the garage. */
  paint: string;
};

export function AtvModel({ tuning, paint }: VehicleModelProps) {
  const { length, width, height } = tuning.chassis;

  return (
    <group>
      {/* The main body. */}
      <mesh castShadow position={[0, 0, 0]}>
        <boxGeometry args={[width * 0.72, height * 0.7, length * 0.8]} />
        <meshStandardMaterial color={paint} roughness={0.5} metalness={0.1} />
      </mesh>

      {/* The front rack, which is where a quad carries things. */}
      <mesh castShadow position={[0, height * 0.35, length * 0.36]}>
        <boxGeometry args={[width * 0.6, height * 0.12, length * 0.2]} />
        <meshStandardMaterial color="#3a3f47" roughness={0.8} />
      </mesh>

      {/* The seat. */}
      <mesh castShadow position={[0, height * 0.45, -length * 0.12]}>
        <boxGeometry args={[width * 0.42, height * 0.35, length * 0.42]} />
        <meshStandardMaterial color="#1f2329" roughness={0.9} />
      </mesh>

      {/* The handlebars: a post and a bar across it. */}
      <mesh castShadow position={[0, height * 0.6, length * 0.24]}>
        <cylinderGeometry args={[0.035, 0.035, height * 0.7, 8]} />
        <meshStandardMaterial color="#2b2f36" />
      </mesh>
      <mesh
        castShadow
        position={[0, height * 0.95, length * 0.24]}
        rotation={[0, 0, Math.PI / 2]}
      >
        <cylinderGeometry args={[0.03, 0.03, width * 0.8, 8]} />
        <meshStandardMaterial color="#2b2f36" />
      </mesh>

      {/* Headlight. */}
      <mesh position={[0, height * 0.6, length * 0.42]}>
        <sphereGeometry args={[0.09, 10, 10]} />
        <meshStandardMaterial
          color="#fff3c4"
          emissive="#ffe9a3"
          emissiveIntensity={0.6}
        />
      </mesh>

      <Rider height={height} paint={paint} />
    </group>
  );
}

/** The kid on the quad: a body, two arms and a helmet. */
function Rider({ height, paint }: { height: number; paint: string }) {
  const seatY = height * 0.62;
  return (
    <group position={[0, seatY, -0.05]}>
      <mesh castShadow position={[0, 0.34, 0]}>
        <capsuleGeometry args={[0.16, 0.42, 4, 10]} />
        <meshStandardMaterial color="#2f6fdb" roughness={0.8} />
      </mesh>
      <mesh castShadow position={[0.2, 0.42, 0.18]} rotation={[0.5, 0, -0.3]}>
        <capsuleGeometry args={[0.055, 0.3, 4, 8]} />
        <meshStandardMaterial color="#2f6fdb" roughness={0.8} />
      </mesh>
      <mesh castShadow position={[-0.2, 0.42, 0.18]} rotation={[0.5, 0, 0.3]}>
        <capsuleGeometry args={[0.055, 0.3, 4, 8]} />
        <meshStandardMaterial color="#2f6fdb" roughness={0.8} />
      </mesh>
      <mesh castShadow position={[0, 0.72, 0]}>
        <sphereGeometry args={[0.2, 14, 14]} />
        <meshStandardMaterial color={paint} roughness={0.35} />
      </mesh>
      {/* The visor. */}
      <mesh position={[0, 0.71, 0.17]}>
        <boxGeometry args={[0.22, 0.1, 0.06]} />
        <meshStandardMaterial color="#12161c" roughness={0.2} />
      </mesh>
    </group>
  );
}

export default AtvModel;
