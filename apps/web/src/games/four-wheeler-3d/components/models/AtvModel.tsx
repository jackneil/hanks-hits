"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { VehicleTuning } from "../../lib/vehicles";
import { bar, combine, ellipsoid, rounded, type Point } from "./modelGeometry";

export type VehicleModelProps = { tuning: VehicleTuning; paint: string };

/** Full-size utility quad, facing +Z. All positions are relative to the physics chassis. */
export function AtvModel({ tuning, paint }: VehicleModelProps) {
  const headlightTarget = useMemo(() => {
    const target = new THREE.Object3D();
    target.position.set(0, -0.5, 12);
    return target;
  }, []);
  const parts = useMemo(() => {
    const shell = [
      rounded([0.51, 0.37, 0.8], [0, 0.07, 0.16], 0.13),
      rounded([0.81, 0.2, 0.5], [0, 0.1, 0.68], 0.08, [0.15, 0, 0]),
      rounded([0.82, 0.18, 0.42], [0, 0.13, -0.69], 0.07),
    ];
    const frame: THREE.BufferGeometry[] = [];
    const metal: THREE.BufferGeometry[] = [
      rounded([0.32, 0.28, 0.43], [0, -0.18, 0], 0.035),
    ];
    const rubber: THREE.BufferGeometry[] = [
      rounded([0.32, 0.17, 0.83], [0, 0.3, -0.17], 0.075),
    ];
    const red: THREE.BufferGeometry[] = [];
    const lamps: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      // Separate fenders leave daylight around each tire instead of a solid chassis box.
      for (const z of [-0.73, 0.73]) {
        shell.push(rounded([0.34, 0.14, 0.65], [side * 0.4, 0.05, z], 0.06));
        rubber.push(
          rounded([0.37, 0.055, 0.69], [side * 0.4, -0.035, z], 0.024),
        );
        frame.push(
          bar([side * 0.16, -0.22, z * 0.65], [side * 0.39, -0.48, z], 0.028),
        );
        metal.push(
          bar([side * 0.25, -0.03, z * 0.8], [side * 0.38, -0.47, z], 0.025),
        );
        for (let ring = 0; ring < 7; ring++) {
          const coil = new THREE.TorusGeometry(0.047, 0.008, 5, 12);
          coil
            .rotateX(Math.PI / 2)
            .translate(
              side * (0.27 + ring * 0.013),
              -0.12 - ring * 0.045,
              z * (0.85 + ring * 0.017),
            );
          red.push(coil);
        }
      }
      rubber.push(
        rounded([0.22, 0.09, 0.63], [side * 0.4, -0.29, -0.05], 0.025),
      );
      frame.push(
        bar([side * 0.26, -0.3, -0.73], [side * 0.26, -0.3, 0.7], 0.035),
      );
      lamps.push(
        rounded([0.22, 0.065, 0.04], [side * 0.27, 0.08, 0.937], 0.018),
      );
      red.push(rounded([0.19, 0.06, 0.035], [side * 0.31, 0.1, -0.94], 0.012));
      frame.push(
        bar([side * 0.42, -0.12, 0.99], [side * 0.42, 0.14, 0.91], 0.025),
      );
      frame.push(
        bar([side * 0.42, -0.12, -1], [side * 0.42, 0.13, -0.92], 0.025),
      );
    }
    for (let fin = 0; fin < 6; fin++)
      metal.push(
        rounded([0.4, 0.018, 0.32], [0, -0.21 + fin * 0.04, 0.05], 0.004),
      );
    // Open tubular luggage racks and brush guards.
    for (const z of [-0.72, 0.68]) {
      for (const x of [-0.39, 0.39])
        frame.push(bar([x, 0.26, z - 0.19], [x, 0.26, z + 0.19], 0.018));
      for (let rail = 0; rail < 5; rail++)
        frame.push(
          bar(
            [-0.39, 0.26, z - 0.19 + rail * 0.095],
            [0.39, 0.26, z - 0.19 + rail * 0.095],
            0.016,
          ),
        );
    }
    frame.push(
      bar([-0.42, -0.12, 0.99], [0.42, -0.12, 0.99], 0.028),
      bar([-0.42, -0.12, -1], [0.42, -0.12, -1], 0.028),
    );
    frame.push(bar([0, 0.22, 0.36], [0, 0.59, 0.24], 0.027));
    for (const side of [-1, 1]) {
      metal.push(bar([0, 0.59, 0.24], [side * 0.27, 0.6, 0.19], 0.022));
      rubber.push(
        bar([side * 0.27, 0.6, 0.19], [side * 0.43, 0.6, 0.13], 0.032),
      );
    }
    metal.push(bar([0.3, -0.16, -0.3], [0.3, -0.12, -0.88], 0.072));
    frame.push(bar([0.3, -0.12, -0.85], [0.3, -0.12, -0.95], 0.039));
    return {
      shell: combine(shell),
      frame: combine(frame),
      metal: combine(metal),
      rubber: combine(rubber),
      red: combine(red),
      lamps: combine(lamps),
    };
  }, []);
  useEffect(
    () => () => Object.values(parts).forEach((g) => g.dispose()),
    [parts],
  );
  return (
    <group
      name="utility-atv"
      scale={[
        tuning.chassis.width / 1.1,
        tuning.chassis.height / 0.6,
        tuning.chassis.length / 1.9,
      ]}
    >
      <mesh geometry={parts.shell} castShadow>
        <meshPhysicalMaterial
          color={paint}
          roughness={0.3}
          metalness={0.08}
          clearcoat={0.7}
          clearcoatRoughness={0.25}
        />
      </mesh>
      <mesh geometry={parts.frame} castShadow>
        <meshStandardMaterial
          color="#202628"
          roughness={0.48}
          metalness={0.55}
        />
      </mesh>
      <mesh geometry={parts.metal} castShadow>
        <meshStandardMaterial
          color="#939d9e"
          metalness={0.8}
          roughness={0.32}
        />
      </mesh>
      <mesh geometry={parts.rubber} castShadow>
        <meshStandardMaterial color="#191c1d" roughness={0.95} />
      </mesh>
      <mesh geometry={parts.red}>
        <meshStandardMaterial color="#d54128" roughness={0.38} />
      </mesh>
      <mesh geometry={parts.lamps}>
        <meshStandardMaterial
          color="#fff4d6"
          emissive="#ffe1a1"
          emissiveIntensity={2.2}
        />
      </mesh>
      <primitive object={headlightTarget} />
      <spotLight
        position={[0, 0.08, 0.98]}
        target={headlightTarget}
        color="#ffe6b7"
        intensity={85}
        distance={28}
        angle={0.65}
        penumbra={0.7}
        decay={2}
      />
      <Rider paint={paint} />
    </group>
  );
}

function Rider({ paint }: { paint: string }) {
  const parts = useMemo(() => {
    const jersey: THREE.BufferGeometry[] = [
      ellipsoid([0.21, 0.28, 0.14], [0, 0.69, -0.12]),
    ];
    const pants: THREE.BufferGeometry[] = [];
    const boots: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      const shoulder: Point = [side * 0.18, 0.82, -0.08];
      const elbow: Point = [side * 0.3, 0.65, 0.015];
      const hand: Point = [side * 0.33, 0.6, 0.16];
      jersey.push(
        bar(shoulder, elbow, 0.07, 0.085),
        bar(elbow, hand, 0.055, 0.067),
        ellipsoid([0.075, 0.075, 0.075], elbow),
      );
      pants.push(
        bar([side * 0.13, 0.45, -0.2], [side * 0.29, 0.2, 0.14], 0.095, 0.12),
        bar([side * 0.29, 0.2, 0.14], [side * 0.34, -0.1, -0.02], 0.065, 0.09),
      );
      boots.push(
        rounded([0.14, 0.18, 0.28], [side * 0.34, -0.14, 0.045], 0.04),
        ellipsoid([0.065, 0.055, 0.07], hand),
      );
    }
    return {
      jersey: combine(jersey),
      pants: combine(pants),
      boots: combine(boots),
    };
  }, []);
  useEffect(
    () => () => Object.values(parts).forEach((g) => g.dispose()),
    [parts],
  );
  return (
    <group name="helmeted-rider">
      <mesh geometry={parts.jersey} castShadow>
        <meshStandardMaterial color="#d3c6a3" roughness={0.98} />
      </mesh>
      <mesh geometry={parts.pants} castShadow>
        <meshStandardMaterial color="#303d43" roughness={1} />
      </mesh>
      <mesh geometry={parts.boots} castShadow>
        <meshStandardMaterial color="#242b29" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.72, -0.252]} scale={[0.15, 0.22, 0.075]} castShadow>
        <sphereGeometry args={[1, 16, 12]} />
        <meshStandardMaterial color="#4b5948" roughness={0.95} />
      </mesh>
      <group position={[0, 1.06, -0.045]} rotation={[0.1, 0, 0]}>
        <mesh scale={[0.19, 0.215, 0.215]} castShadow>
          <sphereGeometry args={[1, 28, 20]} />
          <meshPhysicalMaterial color={paint} roughness={0.3} clearcoat={0.8} />
        </mesh>
        <mesh position={[0, 0.01, 0.157]} scale={[0.172, 0.082, 0.087]}>
          <sphereGeometry args={[1, 24, 12]} />
          <meshStandardMaterial
            color="#162c32"
            metalness={0.5}
            roughness={0.12}
          />
        </mesh>
        <mesh
          position={[0, 0.113, 0.14]}
          scale={[0.205, 0.025, 0.18]}
          castShadow
        >
          <sphereGeometry args={[1, 20, 10]} />
          <meshStandardMaterial color="#232b2b" roughness={0.45} />
        </mesh>
        <mesh
          position={[0, -0.11, 0.14]}
          scale={[0.14, 0.065, 0.12]}
          castShadow
        >
          <sphereGeometry args={[1, 20, 12]} />
          <meshStandardMaterial color="#263332" roughness={0.5} />
        </mesh>
      </group>
    </group>
  );
}

export default AtvModel;
