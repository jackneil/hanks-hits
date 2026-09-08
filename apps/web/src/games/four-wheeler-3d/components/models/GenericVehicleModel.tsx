"use client";

/**
 * The stand-in body for every vehicle that does not have its own model yet.
 *
 * It is a boxy truck: a long lower body, a cab with windows near the front, a
 * bumper and two headlights, all sized from the tuning row. Milestone 6 gives
 * each vehicle its own shape. This one still reads as a truck at any size, so
 * a kid never sees a plain floating box.
 */

import type { VehicleModelProps } from "./AtvModel";

export function GenericVehicleModel({ tuning, paint }: VehicleModelProps) {
  const { length, width, height } = tuning.chassis;
  const bodyHeight = height * 0.55;
  const cabHeight = height * 0.45;
  const cabLength = length * 0.34;
  const cabZ = length * 0.16;

  return (
    <group>
      {/* The lower body. */}
      <mesh castShadow position={[0, -height * 0.5 + bodyHeight / 2, 0]}>
        <boxGeometry args={[width, bodyHeight, length]} />
        <meshStandardMaterial color={paint} roughness={0.5} metalness={0.15} />
      </mesh>

      {/* The cab. */}
      <mesh
        castShadow
        position={[0, -height * 0.5 + bodyHeight + cabHeight / 2, cabZ]}
      >
        <boxGeometry args={[width * 0.9, cabHeight, cabLength]} />
        <meshStandardMaterial color={paint} roughness={0.5} metalness={0.15} />
      </mesh>

      {/* The windshield. */}
      <mesh
        position={[
          0,
          -height * 0.5 + bodyHeight + cabHeight * 0.6,
          cabZ + cabLength / 2,
        ]}
      >
        <boxGeometry args={[width * 0.78, cabHeight * 0.5, 0.06]} />
        <meshStandardMaterial
          color="#9fd3ef"
          roughness={0.15}
          metalness={0.2}
        />
      </mesh>

      {/* The side windows. */}
      <mesh
        position={[
          width * 0.46,
          -height * 0.5 + bodyHeight + cabHeight * 0.6,
          cabZ,
        ]}
      >
        <boxGeometry args={[0.05, cabHeight * 0.45, cabLength * 0.7]} />
        <meshStandardMaterial color="#9fd3ef" roughness={0.15} />
      </mesh>
      <mesh
        position={[
          -width * 0.46,
          -height * 0.5 + bodyHeight + cabHeight * 0.6,
          cabZ,
        ]}
      >
        <boxGeometry args={[0.05, cabHeight * 0.45, cabLength * 0.7]} />
        <meshStandardMaterial color="#9fd3ef" roughness={0.15} />
      </mesh>

      {/* The bumper. */}
      <mesh castShadow position={[0, -height * 0.4, length * 0.5]}>
        <boxGeometry args={[width * 0.98, height * 0.16, 0.14]} />
        <meshStandardMaterial color="#454b55" roughness={0.7} />
      </mesh>

      {/* Two headlights. */}
      <mesh position={[width * 0.32, -height * 0.24, length * 0.5]}>
        <boxGeometry args={[width * 0.18, height * 0.12, 0.08]} />
        <meshStandardMaterial
          color="#fff3c4"
          emissive="#ffe9a3"
          emissiveIntensity={0.6}
        />
      </mesh>
      <mesh position={[-width * 0.32, -height * 0.24, length * 0.5]}>
        <boxGeometry args={[width * 0.18, height * 0.12, 0.08]} />
        <meshStandardMaterial
          color="#fff3c4"
          emissive="#ffe9a3"
          emissiveIntensity={0.6}
        />
      </mesh>
    </group>
  );
}

export default GenericVehicleModel;
