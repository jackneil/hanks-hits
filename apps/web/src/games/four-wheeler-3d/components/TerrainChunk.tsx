"use client";

/**
 * One 128 m square of ground: a fixed heightfield body for the physics and a
 * matching mesh for the eye. Both read the same `heightAt` samples, so a
 * wheel can never sink into a hill the player can see.
 */

import { useEffect, useMemo } from "react";
import { HeightfieldCollider, RigidBody } from "@react-three/rapier";
import * as THREE from "three";

import {
  buildChunkGeometryData,
  buildChunkHeights,
  chunkOrigin,
} from "../lib/terrain";
import { CHUNK_SEGMENTS } from "../lib/constants";
import { getTerrainMaterial } from "./terrainMaterial";
import { ChunkProps } from "./Props";

export function TerrainChunk({ cx, cz }: { cx: number; cz: number }) {
  const origin = useMemo(() => chunkOrigin(cx, cz), [cx, cz]);

  const geometry = useMemo(() => {
    const data = buildChunkGeometryData(cx, cz, CHUNK_SEGMENTS);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(data.colors, 3));
    // World-aligned texture coordinates stay continuous at chunk boundaries.
    const uv = new Float32Array((data.positions.length / 3) * 2);
    for (let i = 0; i < uv.length / 2; i++) {
      uv[i * 2] = (data.positions[i * 3] + origin.x) / 8;
      uv[i * 2 + 1] = (data.positions[i * 3 + 2] + origin.z) / 8;
    }
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geo.computeVertexNormals();
    return geo;
  }, [cx, cz, origin]);

  const heights = useMemo(() => {
    const built = buildChunkHeights(cx, cz, CHUNK_SEGMENTS);
    // The collider wants a plain array, and the same total size as the scale.
    return { values: Array.from(built.heights), scale: built.scale };
  }, [cx, cz]);

  // A chunk that scrolls out of range must give its buffers back.
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <group position={[origin.x, 0, origin.z]}>
      <RigidBody type="fixed" colliders={false}>
        <HeightfieldCollider
          args={[CHUNK_SEGMENTS, CHUNK_SEGMENTS, heights.values, heights.scale]}
        />
        <mesh
          geometry={geometry}
          material={getTerrainMaterial()}
          receiveShadow
        />
      </RigidBody>
      <ChunkProps cx={cx} cz={cz} />
    </group>
  );
}

export default TerrainChunk;
