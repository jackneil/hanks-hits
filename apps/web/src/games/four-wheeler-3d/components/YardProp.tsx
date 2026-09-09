"use client";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useFrame } from "@react-three/fiber";
import { heightAt } from "../lib/terrain";
import type { ActivityLocation } from "../lib/activities";
import { useActivitiesSession } from "../lib/activitiesSession";
import { bar, combine } from "./models/modelGeometry";

type P = [number, number, number];
function build(kind: string) {
  const p: Record<string, THREE.BufferGeometry[]> = {
    wood: [],
    metal: [],
    fabric: [],
    accent: [],
  };
  const box = (m: string, s: P, a: P) =>
    p[m].push(new THREE.BoxGeometry(...s).translate(...a));
  const pole = (m: string, a: P, b: P, r = 0.06) => p[m].push(bar(a, b, r));
  const sphere = (m: string, r: number, a: P) =>
    p[m].push(new THREE.SphereGeometry(r, 12, 8).translate(...a));
  if (kind === "trampoline") {
    p.fabric.push(
      new THREE.CylinderGeometry(1.6, 1.6, 0.08, 32).translate(0, 0.65, 0),
    );
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      pole(
        "metal",
        [Math.sin(a) * 1.5, 0, Math.cos(a) * 1.5],
        [Math.sin(a) * 1.5, 0.64, Math.cos(a) * 1.5],
      );
    }
    p.accent.push(
      new THREE.TorusGeometry(1.6, 0.12, 8, 32)
        .rotateX(Math.PI / 2)
        .translate(0, 0.65, 0),
    );
  } else if (kind === "swings") {
    for (const x of [-1.8, 1.8])
      for (const z of [-1, 1]) pole("wood", [x, 0, z], [x, 3, 0], 0.1);
    pole("metal", [-2, 3, 0], [2, 3, 0], 0.08);
  } else if (kind === "slide") {
    for (const s of [-1, 1]) {
      pole("metal", [s * 0.65, 0, -1.8], [s * 0.65, 2.8, -1.8]);
      pole("metal", [s * 0.65, 2.9, -1.8], [s * 0.65, 0.25, 2.6], 0.04);
    }
    p.fabric.push(
      new THREE.BoxGeometry(1.3, 0.1, 5.1)
        .rotateX(0.54)
        .translate(0, 1.45, 0.4),
    );
    for (let i = 0; i < 8; i++)
      pole("metal", [-0.6, i * 0.35, -1.8], [0.6, i * 0.35, -1.8], 0.03);
  } else if (kind === "goal") {
    for (const s of [-1, 1]) pole("metal", [s * 2, 0, 0], [s * 2, 2.2, 0]);
    pole("metal", [-2, 2.2, 0], [2, 2.2, 0]);
    for (let i = 0; i < 17; i++)
      pole("fabric", [-2 + i * 0.25, 0, -0.7], [-2 + i * 0.25, 2.2, 0], 0.007);
    for (let i = 0; i < 9; i++)
      pole(
        "fabric",
        [-2, i * 0.25, -0.7 + i * 0.08],
        [2, i * 0.25, -0.7 + i * 0.08],
        0.007,
      );
  } else if (kind === "hoop") {
    pole("metal", [0, 0, -0.6], [0, 3.8, -0.6], 0.09);
    box("wood", [1.7, 1, 0.1], [0, 3.45, -0.5]);
    p.accent.push(
      new THREE.TorusGeometry(0.43, 0.027, 8, 24)
        .rotateX(Math.PI / 2)
        .translate(0, 3, 0),
    );
  } else if (kind === "picnic" || kind === "seesaw") {
    const length = kind === "seesaw" ? 4 : 2.6;
    box("wood", [length, 0.12, kind === "seesaw" ? 0.4 : 1.3], [0, 0.95, 0]);
    for (const s of [-1, 1]) {
      pole("wood", [s * 0.8, 0, -0.6], [s * 0.8, 0.95, 0], 0.09);
      pole("wood", [s * 0.8, 0, 0.6], [s * 0.8, 0.95, 0], 0.09);
      if (kind === "picnic") box("wood", [2.8, 0.12, 0.4], [0, 0.5, s * 0.95]);
    }
  } else if (kind === "castle") {
    box("fabric", [4, 0.4, 4], [0, 0.2, 0]);
    for (const x of [-1.75, 1.75])
      for (const z of [-1.75, 1.75]) {
        p.accent.push(
          new THREE.CylinderGeometry(0.3, 0.35, 2.4, 12).translate(x, 1.4, z),
        );
        p.fabric.push(
          new THREE.ConeGeometry(0.45, 0.65, 12).translate(x, 2.9, z),
        );
      }
    for (const s of [-1, 1])
      box("accent", [0.25, 1.3, 3.5], [s * 1.75, 0.9, 0]);
    box("accent", [3.5, 1.3, 0.25], [0, 0.9, -1.75]);
  } else if (kind === "sandbox" || kind === "garden") {
    box("fabric", [3.4, 0.05, 2.4], [0, 0.08, 0]);
    for (const s of [-1, 1]) {
      box("wood", [3.7, 0.24, 0.14], [0, 0.14, s * 1.3]);
      box("wood", [0.14, 0.24, 2.6], [s * 1.8, 0.14, 0]);
    }
    if (kind === "garden")
      for (let i = 0; i < 12; i++)
        sphere("accent", 0.17, [
          -1.4 + (i % 4) * 0.9,
          0.24,
          -0.75 + Math.floor(i / 4) * 0.75,
        ]);
  } else if (kind === "campfire") {
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      sphere("metal", 0.25, [Math.sin(a) * 0.8, 0.2, Math.cos(a) * 0.8]);
    }
    for (const s of [-1, 1])
      pole("wood", [-0.6, 0.22, s * 0.3], [0.6, 0.22, -s * 0.3], 0.14);
  } else if (kind === "bbq") {
    box("metal", [1.4, 0.5, 0.65], [0, 1, 0]);
    for (const x of [-0.55, 0.55])
      for (const z of [-0.25, 0.25])
        pole("metal", [x, 0, z], [x, 0.8, z], 0.03);
    for (let i = 0; i < 9; i++)
      pole(
        "accent",
        [-0.62 + i * 0.15, 1.26, -0.3],
        [-0.62 + i * 0.15, 1.26, 0.3],
        0.015,
      );
  } else if (kind === "umbrella" || kind === "lemonade") {
    pole("wood", [0, 0, 0], [0, 2.8, 0], 0.055);
    p.fabric.push(new THREE.ConeGeometry(1.8, 0.6, 24).translate(0, 2.8, 0));
    if (kind === "lemonade") {
      box("wood", [2, 0.95, 0.9], [0, 0.48, 0]);
      box("accent", [1.8, 0.5, 0.02], [0, 0.65, 0.46]);
      for (const x of [-0.5, 0, 0.5])
        p.accent.push(
          new THREE.CylinderGeometry(0.09, 0.07, 0.2, 12).translate(x, 1.1, 0),
        );
    }
  } else if (kind === "fountain") {
    p.metal.push(
      new THREE.CylinderGeometry(1.6, 1.7, 0.4, 24).translate(0, 0.2, 0),
    );
    p.fabric.push(
      new THREE.CylinderGeometry(1.45, 1.45, 0.03, 24).translate(0, 0.42, 0),
    );
    pole("metal", [0, 0.3, 0], [0, 1.7, 0], 0.15);
    p.metal.push(
      new THREE.CylinderGeometry(0.65, 0.3, 0.25, 24).translate(0, 1.7, 0),
    );
  } else if (kind === "statue") {
    box("metal", [1.4, 0.5, 1.4], [0, 0.25, 0]);
    pole("accent", [0, 0.5, 0], [0, 1.7, 0], 0.22);
    sphere("accent", 0.27, [0, 2, 0]);
    for (const s of [-1, 1])
      pole("accent", [0, 1.6, 0], [s * 0.7, 1.15, 0], 0.1);
  } else if (kind === "windmill") {
    for (const s of [-1, 1]) pole("metal", [s * 0.7, 0, 0], [0, 4, 0]);
    sphere("metal", 0.18, [0, 3.8, 0]);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      p.accent.push(
        new THREE.BoxGeometry(0.3, 1.4, 0.035)
          .rotateZ(a)
          .translate(Math.sin(a) * 0.7, 3.8 + Math.cos(a) * 0.7, 0.07),
      );
    }
  } else if (kind === "pumpkins") {
    for (let i = 0; i < 5; i++) {
      const x = ((i % 3) - 1) * 0.7,
        z = Math.floor(i / 3) * 0.75;
      sphere("accent", 0.4, [x, 0.35, z]);
      pole("wood", [x, 0.65, z], [x, 0.88, z], 0.04);
    }
  } else if (kind === "hay") {
    for (let i = 0; i < 3; i++)
      p.fabric.push(
        new THREE.CylinderGeometry(0.65, 0.65, 1.1, 16)
          .rotateZ(Math.PI / 2)
          .translate((i - 1) * 1.15, 0.65, 0),
      );
  } else if (kind === "scarecrow") {
    pole("wood", [0, 0, 0], [0, 2.6, 0]);
    pole("wood", [-1, 1.85, 0], [1, 1.85, 0]);
    box("fabric", [0.65, 0.9, 0.25], [0, 1.6, 0]);
    sphere("accent", 0.24, [0, 2.3, 0]);
    p.wood.push(new THREE.ConeGeometry(0.45, 0.35, 12).translate(0, 2.6, 0));
  } else if (kind === "coop" || kind === "treehouse") {
    const base = kind === "treehouse" ? 2.1 : 0.4;
    box("wood", [2.5, 1.8, 2], [0, base + 0.9, 0]);
    for (const x of [-1, 1])
      for (const z of [-0.8, 0.8]) pole("wood", [x, 0, z], [x, base, z], 0.1);
    for (const s of [-1, 1])
      p.metal.push(
        new THREE.BoxGeometry(1.65, 0.1, 2.35)
          .rotateZ(-s * 0.5)
          .translate(s * 0.65, base + 2, 0),
      );
    box("fabric", [0.65, 0.8, 0.02], [0, base + 0.6, 1.01]);
    if (kind === "treehouse")
      for (let i = 0; i < 7; i++)
        pole("wood", [-0.5, i * 0.32, 1.25], [0.5, i * 0.32, 1.25], 0.04);
  }
  return Object.fromEntries(
    Object.entries(p)
      .filter(([, a]) => a.length)
      .map(([k, a]) => [k, combine(a)]),
  );
}
export function YardProp({ prop: p }: { prop: ActivityLocation }) {
  const parts = useMemo(() => build(p.kind), [p.kind]),
    seat = useRef<THREE.Group>(null);
  const ground = heightAt(p.x, p.z);
  useFrame(() => {
    if (!seat.current) return;
    const s = useActivitiesSession.getState();
    seat.current.rotation.x =
      s.swingId === p.id ? Math.sin((6 - s.swingRemaining) * 3) * 0.65 : 0;
  });
  const small = [
    "bbq",
    "lemonade",
    "fountain",
    "statue",
    "coop",
    "picnic",
    "hay",
  ].includes(p.kind);
  return (
    <RigidBody
      type="fixed"
      colliders={false}
      position={[p.x, ground, p.z]}
      name={p.id}
    >
      {small && <CuboidCollider args={[1, 0.65, 1]} position={[0, 0.65, 0]} />}
      {p.kind === "trampoline" && (
        <CuboidCollider args={[1.5, 0.1, 1.5]} position={[0, 0.6, 0]} />
      )}
      {p.kind === "slide" && (
        <CuboidCollider
          args={[0.65, 0.05, 2.55]}
          position={[0, 1.45, 0.4]}
          rotation={[0.54, 0, 0]}
        />
      )}
      {Object.entries(parts).map(([key, g]) => (
        <mesh key={key} geometry={g} castShadow receiveShadow>
          <meshStandardMaterial
            color={
              {
                wood: "#8d765b",
                metal: "#727d77",
                fabric:
                  p.kind === "hay"
                    ? "#b8a16a"
                    : p.kind === "sandbox"
                      ? "#b9aa81"
                      : p.kind === "trampoline"
                        ? "#343e3d"
                        : "#426b70",
                accent:
                  p.kind === "pumpkins"
                    ? "#af6a2b"
                    : p.kind === "garden"
                      ? "#496743"
                      : "#9d834b",
              }[key]
            }
            roughness={key === "metal" ? 0.48 : 0.88}
            metalness={key === "metal" ? 0.45 : 0}
          />
        </mesh>
      ))}
      {p.kind === "swings" && (
        <group ref={seat} position={[0, 3, 0]}>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.4, -1.2, 0]}>
              <cylinderGeometry args={[0.014, 0.014, 2.4, 8]} />
              <meshStandardMaterial color="#9b9c92" metalness={0.8} />
            </mesh>
          ))}
          <mesh position={[0, -2.4, 0]}>
            <boxGeometry args={[1, 0.09, 0.42]} />
            <meshStandardMaterial color="#404b40" />
          </mesh>
        </group>
      )}
    </RigidBody>
  );
}
