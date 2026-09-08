"use client";

/**
 * Trees, rocks and grass for one chunk, drawn as instanced meshes.
 *
 * Every model is built from Three primitives, so the game ships no art files
 * at all. The models are made once at module load and shared by every chunk.
 *
 * Level of detail works per chunk rather than per tree: a chunk 200 m away
 * swaps its detailed trees for a single instanced cone. One distance check
 * per chunk, ten frames apart, replaces a per tree test that would cost more
 * than it saves.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { LOD_FRAME_INTERVAL, TREE_LOD_DISTANCE, WORLD } from "../lib/constants";
import { chunkOrigin, propsForChunk, type PlacedProp } from "../lib/terrain";
import { useGameContext } from "../lib/gameContext";

// ============================================================================
// MODELS, BUILT ONCE
// ============================================================================

const BARK = new THREE.MeshStandardMaterial({ color: "#6b4a2f", roughness: 1 });
const BIRCH_BARK = new THREE.MeshStandardMaterial({ color: "#e8e4d8", roughness: 1 });
const PINE_LEAF = new THREE.MeshStandardMaterial({ color: "#2c5c33", roughness: 1, flatShading: true });
const OAK_LEAF = new THREE.MeshStandardMaterial({ color: "#4a8236", roughness: 1, flatShading: true });
const BIRCH_LEAF = new THREE.MeshStandardMaterial({ color: "#7fae4c", roughness: 1, flatShading: true });
const ROCK_MAT = new THREE.MeshStandardMaterial({ color: "#7a7a7e", roughness: 1, flatShading: true });
const GRASS_MAT = new THREE.MeshStandardMaterial({
  color: "#5f9243",
  roughness: 1,
  side: THREE.DoubleSide,
  transparent: false,
});

/** Stack a trunk under a crown and keep them as two material groups. */
function tree(trunk: THREE.BufferGeometry, crown: THREE.BufferGeometry) {
  return mergeGeometries([trunk, crown], true);
}

function shifted(geometry: THREE.BufferGeometry, y: number) {
  geometry.translate(0, y, 0);
  return geometry;
}

const PINE = tree(
  shifted(new THREE.CylinderGeometry(0.3, 0.45, 3, 6), 1.5),
  shifted(new THREE.ConeGeometry(2.2, 7, 7), 6.5)
);
const OAK = tree(
  shifted(new THREE.CylinderGeometry(0.35, 0.5, 3.5, 6), 1.75),
  shifted(new THREE.SphereGeometry(2.6, 8, 6), 5.6)
);
const BIRCH = tree(
  shifted(new THREE.CylinderGeometry(0.2, 0.28, 6, 6), 3),
  shifted(new THREE.SphereGeometry(1.5, 7, 5), 7)
);
const BILLBOARD = shifted(new THREE.ConeGeometry(2.2, 9, 5), 4.5);
const ROCK = new THREE.DodecahedronGeometry(1, 0);
const GRASS = (() => {
  const blade = new THREE.PlaneGeometry(0.7, 0.9);
  const crossed = blade.clone();
  crossed.rotateY(Math.PI / 2);
  return shifted(mergeGeometries([blade, crossed]), 0.45);
})();

const SPECIES = [
  { geometry: PINE, materials: [BARK, PINE_LEAF] },
  { geometry: OAK, materials: [BARK, OAK_LEAF] },
  { geometry: BIRCH, materials: [BIRCH_BARK, BIRCH_LEAF] },
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
  originZ: number
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
    () => [0, 1, 2].map((id) => props.trees.filter((tree) => tree.species === id)),
    [props]
  );

  const nearMeshRef = useRef<Array<THREE.InstancedMesh | null>>([null, null, null]);
  const farRef = useRef<THREE.InstancedMesh | null>(null);
  const rockRef = useRef<THREE.InstancedMesh | null>(null);
  const grassRef = useRef<THREE.InstancedMesh | null>(null);
  const frame = useRef(0);

  // Which set of trees is drawn. It flips at most once per crossing of the
  // LOD distance, so a chunk re-renders only when the player rides past it.
  const [far, setFar] = useState(false);

  useEffect(() => {
    bySpecies.forEach((items, index) =>
      fillInstances(nearMeshRef.current[index], items, origin.x, origin.z)
    );
    fillInstances(farRef.current, props.trees, origin.x, origin.z);
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
          args={[species.geometry, species.materials as unknown as THREE.Material[], Math.max(1, bySpecies[index].length)]}
          visible={!far}
          castShadow
          receiveShadow
        />
      ))}

      <instancedMesh
        ref={farRef}
        args={[BILLBOARD, PINE_LEAF, Math.max(1, props.trees.length)]}
        visible={far}
      />

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
