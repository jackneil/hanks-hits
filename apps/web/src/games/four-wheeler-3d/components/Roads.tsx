"use client";

/**
 * The two things a road needs that vertex colours cannot paint: the race
 * start line and a sign on every plot of land for sale.
 *
 * The dirt of every ribbon is already painted into the terrain mesh, so there
 * is no road geometry here at all. The signs are placeholders. The real ones
 * arrive with the My Land milestone.
 */

import { useMemo } from "react";
import * as THREE from "three";

import { LAND_PLOTS, RACE_LOOP, RACE_START } from "../lib/landmarks";
import { heightAt } from "../lib/terrain";

/** How many black and white squares make up the start line. */
const CHECKS = 12;

export function Roads() {
  const startLine = useMemo(() => {
    const y = heightAt(RACE_START.x, RACE_START.z) + 0.03;
    const cell = RACE_LOOP.width / CHECKS;
    const squares: Array<{ key: string; x: number; z: number; dark: boolean }> = [];
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

  const signs = useMemo(
    () =>
      LAND_PLOTS.map((plot) => ({
        id: plot.id,
        x: plot.x,
        z: plot.z,
        y: heightAt(plot.x, plot.z),
      })),
    []
  );

  return (
    <group>
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

      {signs.map((sign) => (
        <group key={sign.id} position={[sign.x, sign.y, sign.z]}>
          <mesh castShadow position={[0, 1.1, 0]}>
            <boxGeometry args={[0.18, 2.2, 0.18]} />
            <meshStandardMaterial color="#7a5a3a" roughness={1} />
          </mesh>
          <mesh castShadow position={[0, 2.6, 0]}>
            <boxGeometry args={[2.6, 1.5, 0.14]} />
            <meshStandardMaterial color="#2e8b57" roughness={0.8} />
          </mesh>
          <mesh position={[0, 2.6, 0.09]}>
            <planeGeometry args={[2.2, 1.1]} />
            <meshStandardMaterial color="#f7fbf6" roughness={0.7} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export default Roads;
