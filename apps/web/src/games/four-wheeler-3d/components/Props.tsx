"use client";

/**
 * Trees, rocks and grass for one chunk, drawn as instanced meshes.
 *
 * Every model is built from Three primitives, so the game ships no art files
 * for its vegetation. The models are made once at module load and shared by every chunk.
 *
 * Level of detail works per chunk rather than per tree: a chunk 200 m away
 * swaps to a smaller leaf mesh for each species. One distance check
 * per chunk, ten frames apart, replaces a per tree test that would cost more
 * than it saves.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { LOD_FRAME_INTERVAL, TREE_LOD_DISTANCE, WORLD } from "../lib/constants";
import { chunkOrigin, propsForChunk, type PlacedProp } from "../lib/terrain";
import { foliageGeometry } from "./foliageGeometry";
import { useGameContext } from "../lib/gameContext";

// ============================================================================
// MODELS, BUILT ONCE
// ============================================================================

const BARK = new THREE.MeshStandardMaterial({ color: "#6b4a2f", roughness: 1 });
const BIRCH_BARK = new THREE.MeshStandardMaterial({
  color: "#e8e4d8",
  roughness: 1,
});
const PINE_LEAF = new THREE.MeshStandardMaterial({
  color: "#4d693e",
  roughness: 1,
  vertexColors: true,
  side: THREE.DoubleSide,
});
const OAK_LEAF = new THREE.MeshStandardMaterial({
  color: "#698444",
  roughness: 1,
  vertexColors: true,
  side: THREE.DoubleSide,
});
const BIRCH_LEAF = new THREE.MeshStandardMaterial({
  color: "#879657",
  roughness: 1,
  vertexColors: true,
  side: THREE.DoubleSide,
});
const ROCK_MAT = new THREE.MeshStandardMaterial({
  color: "#7a7a7e",
  roughness: 1,
  flatShading: true,
});
const GRASS_MAT = new THREE.MeshStandardMaterial({
  // The color comes from the blade itself, dark at the root and bright at the
  // tip, so a tuft reads as grass rather than as a green block.
  vertexColors: true,
  roughness: 1,
  side: THREE.DoubleSide,
  transparent: false,
});

const PINE = foliageGeometry(true);
const OAK = foliageGeometry(false);
const BIRCH = foliageGeometry(false, true);
const ROCK = new THREE.DodecahedronGeometry(1, 1);
/** How tall one tuft stands before the per-clump scale, in meters. */
const GRASS_HEIGHT = 0.24;

/** One blade: wide at the root, narrow at the tip, dark at the bottom. */
function grassBlade(): THREE.BufferGeometry {
  const halfBase = 0.024;
  const halfTip = 0.002;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        -halfBase,
        0,
        0,
        halfBase,
        0,
        0,
        halfTip,
        GRASS_HEIGHT,
        0,
        -halfTip,
        GRASS_HEIGHT,
        0,
      ],
      3,
    ),
  );
  geometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(
      [0.16, 0.28, 0.12, 0.16, 0.28, 0.12, 0.44, 0.64, 0.3, 0.44, 0.64, 0.3],
      3,
    ),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  return geometry;
}

/** Two blades crossed, so a tuft looks the same from every side. */
const GRASS = (() => {
  const blade = grassBlade();
  const crossed = grassBlade();
  crossed.rotateY(Math.PI / 2);
  return mergeGeometries([blade, crossed]);
})();

const SPECIES = [
  {
    geometry: PINE,
    distant: foliageGeometry(true, false, true),
    materials: [BARK, PINE_LEAF],
  },
  {
    geometry: OAK,
    distant: foliageGeometry(false, false, true),
    materials: [BARK, OAK_LEAF],
  },
  {
    geometry: BIRCH,
    distant: foliageGeometry(false, true, true),
    materials: [BIRCH_BARK, BIRCH_LEAF],
  },
] as const;

/** Scratch objects at module scope, so no frame ever allocates. */
const scratchMatrix = new THREE.Matrix4();
const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const scratchAxis = new THREE.Vector3(0, 1, 0);

/** Write one instanced mesh's matrices. Local to the chunk group. */
function fillInstances(
  mesh: THREE.InstancedMesh | null,
  items: PlacedProp[],
  originX: number,
  originZ: number,
): void {
  if (!mesh) return;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    scratchPosition.set(item.x - originX, item.y, item.z - originZ);
    scratchQuaternion.setFromAxisAngle(scratchAxis, item.rotation);
    scratchScale.setScalar(item.scale);
    scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
    mesh.setMatrixAt(i, scratchMatrix);
  }
  mesh.count = items.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
}

/** All of one chunk's props, with the near and far tree sets ready to swap. */
export function ChunkProps({ cx, cz }: { cx: number; cz: number }) {
  const { playerPos } = useGameContext();
  const origin = useMemo(() => chunkOrigin(cx, cz), [cx, cz]);
  const props = useMemo(() => propsForChunk(cx, cz), [cx, cz]);

  const bySpecies = useMemo(
    () =>
      [0, 1, 2].map((id) => props.trees.filter((tree) => tree.species === id)),
    [props],
  );

  const nearMeshRef = useRef<Array<THREE.InstancedMesh | null>>([
    null,
    null,
    null,
  ]);
  const farRef = useRef<Array<THREE.InstancedMesh | null>>([null, null, null]);
  const rockRef = useRef<THREE.InstancedMesh | null>(null);
  const grassRef = useRef<THREE.InstancedMesh | null>(null);
  const frame = useRef(0);

  // Which set of trees is drawn. It flips at most once per crossing of the
  // LOD distance, so a chunk re-renders only when the player rides past it.
  // Incoming distant chunks start inexpensive until the first distance check.
  const [far, setFar] = useState(true);

  useEffect(() => {
    bySpecies.forEach((items, index) =>
      fillInstances(nearMeshRef.current[index], items, origin.x, origin.z),
    );
    bySpecies.forEach((items, index) =>
      fillInstances(farRef.current[index], items, origin.x, origin.z),
    );
    fillInstances(rockRef.current, props.rocks, origin.x, origin.z);
    fillInstances(grassRef.current, props.grass, origin.x, origin.z);
  }, [bySpecies, props, origin]);

  useFrame(() => {
    frame.current = (frame.current + 1) % LOD_FRAME_INTERVAL;
    if (frame.current !== 0) return;
    const player = playerPos.current;
    const distance = Math.hypot(player.x - origin.x, player.z - origin.z);
    setFar(distance > TREE_LOD_DISTANCE + WORLD.CHUNK / 2);
  });

  return (
    <group>
      {SPECIES.map((species, index) => (
        <instancedMesh
          key={index}
          ref={(mesh) => {
            nearMeshRef.current[index] = mesh;
          }}
          args={[
            species.geometry,
            species.materials as unknown as THREE.Material[],
            Math.max(1, bySpecies[index].length),
          ]}
          visible={!far}
          castShadow
          receiveShadow
        />
      ))}

      {SPECIES.map((species, index) => (
        <instancedMesh
          key={`far-${index}`}
          ref={(mesh) => {
            farRef.current[index] = mesh;
          }}
          args={[
            species.distant,
            species.materials as unknown as THREE.Material[],
            Math.max(1, bySpecies[index].length),
          ]}
          visible={far}
        />
      ))}

      <instancedMesh
        ref={rockRef}
        args={[ROCK, ROCK_MAT, Math.max(1, props.rocks.length)]}
        castShadow
        receiveShadow
      />

      <instancedMesh
        ref={grassRef}
        args={[GRASS, GRASS_MAT, Math.max(1, props.grass.length)]}
        visible={!far}
      />
    </group>
  );
}

export default ChunkProps;
