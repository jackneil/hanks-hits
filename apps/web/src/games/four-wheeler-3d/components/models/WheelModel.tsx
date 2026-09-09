"use client";

import * as THREE from "three";
import { bar, combine, rounded } from "./modelGeometry";

const wheelCache = new Map<
  number,
  { tire: THREE.BufferGeometry; rim: THREE.BufferGeometry }
>();
/** Geometry belongs to this bounded catalog-radius cache, never to an individual wheel. */
export function wheelGeometry(radius: number) {
  const cached = wheelCache.get(radius);
  if (cached) return cached;
  const parts = (() => {
    const tire = new THREE.TorusGeometry(radius * 0.73, radius * 0.27, 12, 32);
    tire.rotateY(Math.PI / 2).scale(1.4, 1, 1);
    const treads: THREE.BufferGeometry[] = [tire];
    const rim: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 24; i++) {
        const angle = (i * Math.PI) / 12 + side * 0.055;
        const lug = rounded(
          [radius * 0.38, radius * 0.12, radius * 0.18],
          [0, 0, 0],
          radius * 0.018,
          [0, side * 0.38, 0],
        );
        lug.translate(side * radius * 0.17, radius * 0.97, 0).rotateX(angle);
        treads.push(lug);
      }
      const lip = new THREE.TorusGeometry(radius * 0.45, radius * 0.035, 6, 24);
      lip.rotateY(Math.PI / 2).translate(side * radius * 0.3, 0, 0);
      rim.push(lip);
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        rim.push(
          bar(
            [side * radius * 0.29, 0, 0],
            [
              side * radius * 0.29,
              Math.sin(a) * radius * 0.43,
              Math.cos(a) * radius * 0.43,
            ],
            radius * 0.045,
          ),
        );
      }
    }
    rim.push(bar([-radius * 0.34, 0, 0], [radius * 0.34, 0, 0], radius * 0.15));
    return { tire: combine(treads), rim: combine(rim) };
  })();
  wheelCache.set(radius, parts);
  return parts;
}
/** Axle is local X. Parent owns steering, spin and suspension. */
export function WheelModel({ radius }: { radius: number }) {
  const parts = wheelGeometry(radius);
  return (
    <group name="treaded-wheel">
      <mesh geometry={parts.tire} castShadow receiveShadow>
        <meshStandardMaterial color="#252825" roughness={0.94} />
      </mesh>
      <mesh geometry={parts.rim} castShadow>
        <meshStandardMaterial
          color="#aeb5b3"
          metalness={0.85}
          roughness={0.3}
        />
      </mesh>
    </group>
  );
}
