"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { VehicleTuning } from "../../lib/vehicles";
import { bar, combine, rounded } from "./modelGeometry";

import { RiderModel } from "./RiderModel";

export type VehicleModelProps = {
  tuning: VehicleTuning;
  paint: string;
  detail?: "full" | "parked";
  lightsEnabled?: boolean;
  mud?: number;
};

/** Full-size utility quad, facing +Z. All positions are relative to the physics chassis. */
export function AtvModel({
  tuning,
  paint,
  detail = "full",
  lightsEnabled = true,
  mud = 0,
}: VehicleModelProps) {
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
          color={new THREE.Color(paint).lerp(
            new THREE.Color("#51412a"),
            mud * 0.75,
          )}
          roughness={0.3 + mud * 0.6}
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
          emissiveIntensity={lightsEnabled ? 2.2 : 0.15}
        />
      </mesh>
      <primitive object={headlightTarget} />
      {lightsEnabled && (
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
      )}
      {detail === "full" && <RiderModel paint={paint} />}
    </group>
  );
}

export default AtvModel;
