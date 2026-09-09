"use client";

/** Physical runway markings and the race start line. Plot signs live in Properties. */

import { useMemo } from "react";
import * as THREE from "three";

import { RACE_LOOP, RACE_START, RUNWAY } from "../lib/landmarks";
import { heightAt } from "../lib/terrain";

/** How many black and white squares make up the start line. */
const CHECKS = 12;

export function Roads() {
  const startLine = useMemo(() => {
    const y = heightAt(RACE_START.x, RACE_START.z) + 0.03;
    const cell = RACE_LOOP.width / CHECKS;
    const squares: Array<{ key: string; x: number; z: number; dark: boolean }> =
      [];
    for (let column = 0; column < CHECKS; column++) {
      for (let row = 0; row < 2; row++) {
        squares.push({
          key: `${column}-${row}`,
          x: RACE_START.x + (column - CHECKS / 2 + 0.5) * cell,
          z: RACE_START.z + (row - 0.5) * cell,
          dark: (column + row) % 2 === 0,
        });
      }
    }
    return { y, cell, squares };
  }, []);

  return (
    <group>
      <AirstripSurface />
      <group position={[0, startLine.y, 0]}>
        {startLine.squares.map((square) => (
          <mesh
            key={square.key}
            position={[square.x, 0, square.z]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <planeGeometry args={[startLine.cell, startLine.cell]} />
            <meshStandardMaterial
              color={square.dark ? "#20232a" : "#f4f6fa"}
              roughness={0.8}
              side={THREE.DoubleSide}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}

export default Roads;

function AirstripSurface() {
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(
      RUNWAY.length,
      RUNWAY.width,
      30,
      4,
    ).rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++)
      p.setY(i, heightAt(p.getX(i) + RUNWAY.x, p.getZ(i) + RUNWAY.z) + 0.04);
    g.computeVertexNormals();
    return g;
  }, []);
  const map = useMemo(() => {
    const t = new THREE.TextureLoader().load(
      "/games/four-wheeler-3d/assets/aerial_asphalt_01/aerial_asphalt_01_diff_1k.jpg",
    );
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(10, 1.33);
    t.anisotropy = 4;
    return t;
  }, []);
  return (
    <group>
      <mesh
        geometry={geometry}
        position={[RUNWAY.x, 0, RUNWAY.z]}
        receiveShadow
      >
        <meshStandardMaterial map={map} color="#888b85" roughness={0.95} />
      </mesh>
      {Array.from({ length: 10 }, (_, i) => {
        const x = RUNWAY.x - 27 + i * 6;
        return (
          <mesh
            key={i}
            position={[x, heightAt(x, RUNWAY.z) + 0.085, RUNWAY.z]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <planeGeometry args={[3, 0.16]} />
            <meshStandardMaterial color="#e5dfc7" roughness={0.9} />
          </mesh>
        );
      })}
    </group>
  );
}
