"use client";
import { useMemo } from "react";
import * as THREE from "three";
import { useFourWheeler3dStore } from "../lib/store";
import { useAdventureSession } from "../lib/adventureSession";
export function Headlights({
  width,
  length,
}: {
  width: number;
  length: number;
}) {
  const enabled = useAdventureSession((s) => s.lightsOn),
    clock = useFourWheeler3dStore((s) => s.clock),
    weather = useFourWheeler3dStore((s) => s.progress.weather);
  const targets = useMemo(
    () =>
      [-1, 1].map((side) => {
        const target = new THREE.Object3D();
        target.position.set(side * width * 0.3, -0.3, length / 2 + 20);
        return target;
      }),
    [length, width],
  );
  const night = clock < 7 || clock > 18,
    cones = night || weather === "foggy";
  return enabled ? (
    <group>
      {targets.map((target, i) => (
        <group key={i}>
          <primitive object={target} />
          <spotLight
            target={target}
            position={[(i ? 1 : -1) * width * 0.3, 0.15, length / 2]}
            color="#ffebbc"
            intensity={night ? 110 : 35}
            distance={35}
            angle={0.36}
            penumbra={0.65}
            decay={2}
          />
          {cones && (
            <mesh
              position={[(i ? 1 : -1) * width * 0.3, -0.05, length / 2 + 5]}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <coneGeometry args={[1.8, 10, 20, 1, true]} />
              <meshBasicMaterial
                color="#ffe2a0"
                transparent
                opacity={0.022}
                depthWrite={false}
                side={THREE.DoubleSide}
                blending={THREE.AdditiveBlending}
              />
            </mesh>
          )}
        </group>
      ))}
    </group>
  ) : null;
}
