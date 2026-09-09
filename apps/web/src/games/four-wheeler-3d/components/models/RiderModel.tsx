"use client";
import { useFourWheeler3dStore } from "../../lib/store";
import { OutfitText } from "./OutfitText";
import { useMemo } from "react";
import * as THREE from "three";
import { bar, combine, ellipsoid, rounded, type Point } from "./modelGeometry";

function torso() {
  const p: number[] = [],
    uv: number[] = [],
    ix: number[] = [];
  const rings = [
    [0.41, 0.13, 0.095, -0.19],
    [0.49, 0.15, 0.1, -0.17],
    [0.62, 0.17, 0.11, -0.12],
    [0.78, 0.215, 0.115, -0.08],
    [0.85, 0.17, 0.095, -0.06],
    [0.89, 0.075, 0.075, -0.045],
  ];
  for (const [y, w, d, z] of rings)
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      p.push(Math.cos(a) * w, y, z + Math.sin(a) * d);
      uv.push(i / 20, y);
    }
  for (let j = 0; j < rings.length - 1; j++)
    for (let i = 0; i < 20; i++) {
      const a = j * 20 + i,
        b = j * 20 + ((i + 1) % 20);
      ix.push(a, a + 20, b, b, a + 20, b + 20);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(ix);
  g.computeVertexNormals();
  return g;
}
// Geometry passed by prop stays cached; child materials retain normal R3F disposal.
const riderCache = new Map<string, Record<string, THREE.BufferGeometry>>();
function buildRider() {
  const jersey = [torso()],
    pants: THREE.BufferGeometry[] = [],
    boots: THREE.BufferGeometry[] = [],
    trim: THREE.BufferGeometry[] = [],
    pack: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const shoulder: Point = [s * 0.19, 0.8, -0.075],
      elbow: Point = [s * 0.3, 0.67, 0.025],
      wrist: Point = [s * 0.345, 0.6, 0.16],
      knee: Point = [s * 0.29, 0.18, 0.12];
    jersey.push(
      bar(shoulder, elbow, 0.076, 0.065),
      bar(elbow, wrist, 0.064, 0.043),
      ellipsoid([0.067, 0.067, 0.067], elbow),
    );
    pants.push(
      bar([s * 0.11, 0.43, -0.2], knee, 0.106, 0.08),
      bar(knee, [s * 0.34, -0.095, -0.02], 0.08, 0.049),
      ellipsoid([0.082, 0.082, 0.085], knee),
    );
    boots.push(
      rounded([0.115, 0.22, 0.12], [s * 0.34, -0.085, -0.02], 0.026),
      rounded([0.12, 0.085, 0.245], [s * 0.34, -0.19, 0.05], 0.024),
      ellipsoid([0.047, 0.037, 0.062], gloveCenter(wrist)),
    );
    for (let f = 0; f < 4; f++)
      boots.push(
        bar(
          [s * (0.315 + f * 0.014), 0.597, 0.175],
          [s * (0.315 + f * 0.014), 0.578, 0.204],
          0.009,
        ),
      );
    boots.push(rounded([0.11, 0.105, 0.045], [s * 0.29, 0.2, 0.187], 0.014));
    for (let i = 0; i < 3; i++)
      trim.push(
        rounded(
          [0.119, 0.014, 0.012],
          [s * 0.34, -0.14 + i * 0.062, 0.047],
          0.004,
        ),
      );
    trim.push(
      bar([s * 0.11, 0.83, -0.17], [s * 0.12, 0.48, -0.245], 0.013),
      bar([s * 0.17, 0.79, 0.016], [s * 0.11, 0.48, -0.062], 0.013),
    );
    pack.push(rounded([0.08, 0.23, 0.057], [s * 0.11, 0.66, -0.252], 0.023));
  }
  trim.push(
    bar([0, 0.5, -0.065], [0, 0.84, 0.037], 0.006),
    rounded([0.245, 0.032, 0.015], [0, 0.73, 0.048], 0.006),
  );
  pack.push(
    rounded([0.255, 0.32, 0.095], [0, 0.69, -0.255], 0.037),
    rounded([0.2, 0.1, 0.028], [0, 0.58, -0.31], 0.015),
  );
  return {
    jersey: combine(jersey),
    pants: combine(pants),
    boots: combine(boots),
    trim: combine(trim),
    pack: combine(pack),
  };
}
function gloveCenter(p: Point): Point {
  return [p[0], p[1] - 0.005, p[2] + 0.018];
}
/** Seated adult proportions, bent elbows, boots on footboards and hands around grips. */
export function RiderModel({ paint = "#ddd8c6" }: { paint?: string }) {
  const outfit = useFourWheeler3dStore((s) => s.progress.adventure.outfit);
  const g = useMemo(() => {
    if (!riderCache.has("rider")) riderCache.set("rider", buildRider());
    return riderCache.get("rider")!;
  }, []);
  return (
    <group name="helmeted-trail-rider">
      <OutfitText back position={[0, 0.73, -0.317]} width={0.24} />
      {Object.entries(g).map(([key, geometry]) => (
        <mesh key={key} geometry={geometry} castShadow>
          <meshStandardMaterial
            color={
              {
                jersey: outfit.color,
                pants: "#34403f",
                boots: "#252a28",
                trim: "#777b72",
                pack: "#56604a",
              }[key]
            }
            roughness={key === "trim" ? 0.65 : 0.93}
          />
        </mesh>
      ))}
      <group position={[0, 0.995, -0.025]} rotation={[0.12, 0, 0]}>
        <mesh castShadow scale={[0.158, 0.181, 0.181]}>
          <sphereGeometry args={[1, 28, 20]} />
          <meshPhysicalMaterial
            color={paint}
            roughness={0.35}
            clearcoat={0.65}
          />
        </mesh>
        <mesh position={[0, 0.006, 0.152]} scale={[0.142, 0.057, 0.045]}>
          <sphereGeometry args={[1, 24, 12]} />
          <meshPhysicalMaterial
            color="#172d32"
            metalness={0.5}
            roughness={0.12}
            clearcoat={1}
          />
        </mesh>
        <mesh position={[0, 0.08, 0.09]} rotation={[-0.11, 0, 0]}>
          <boxGeometry args={[0.32, 0.014, 0.245]} />
          <meshStandardMaterial color="#333b39" roughness={0.45} />
        </mesh>
        <mesh position={[0, -0.101, 0.126]} rotation={[-0.25, 0, 0]}>
          <boxGeometry args={[0.2, 0.066, 0.13]} />
          <meshStandardMaterial color="#303936" roughness={0.45} />
        </mesh>
        {[-1, 0, 1].map((x) => (
          <mesh
            key={x}
            position={[x * 0.045, -0.091, 0.197]}
            rotation={[-0.25, 0, 0]}
          >
            <boxGeometry args={[0.02, 0.022, 0.006]} />
            <meshStandardMaterial color="#101816" />
          </mesh>
        ))}
        {[-1, 1].map((s) => (
          <mesh
            key={s}
            position={[s * 0.146, -0.015, 0.01]}
            rotation={[0, 0, Math.PI / 2]}
          >
            <cylinderGeometry args={[0.027, 0.027, 0.016, 12]} />
            <meshStandardMaterial
              color="#c8c6b9"
              metalness={0.7}
              roughness={0.35}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}
