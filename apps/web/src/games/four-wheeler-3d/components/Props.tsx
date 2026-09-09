"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useAdventureSession } from "../lib/adventureSession";
import { parseAirImpact } from "../lib/transport";
import { useFourWheeler3dStore } from "../lib/store";
import { useActivitiesSession } from "../lib/activitiesSession";
import { isGrassCut, sceneryId } from "../lib/activities";
import { LOD_FRAME_INTERVAL, WORLD } from "../lib/constants";
import {
  chunkOrigin,
  chunkCoordsFor,
  propsForChunk,
  type PlacedProp,
} from "../lib/terrain";
import { useGameContext } from "../lib/gameContext";
import { forestGeometry, forestMaterials } from "./forestGeometry";
import { GrassAssets, RockAssets, type AssetPlacement } from "./WorldAssets";

// Six shared geometry pairs; tree count never creates more meshes or materials.
const TREES = ([0, 1, 2] as const).map((species) => ({
  near: forestGeometry(species),
  far: forestGeometry(species, true),
}));
const ROCK = new THREE.IcosahedronGeometry(1, 1);
const ROCK_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#62685d",
  roughness: 1,
});
const DETAIL_DISTANCE = 72;
const TREE_DETAIL_DISTANCE = 110;
const DETAIL_ROCKS = 8;
let lastSceneryImpact: object | null = null;

function fillInstances(
  mesh: THREE.InstancedMesh | null,
  items: PlacedProp[],
  originX: number,
  originZ: number,
) {
  if (!mesh) return;
  const transform = new THREE.Object3D();
  items.forEach((item, i) => {
    transform.position.set(item.x - originX, item.y, item.z - originZ);
    transform.rotation.set(0, item.rotation, 0);
    transform.scale.setScalar(item.scale);
    transform.updateMatrix();
    mesh.setMatrixAt(i, transform.matrix);
  });
  mesh.count = items.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
}

function PlacedMesh({
  geometry,
  material,
  items,
  origin,
  shadow = false,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  items: PlacedProp[];
  origin: { x: number; z: number };
  shadow?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const instance = ref.current;
    return () => {
      instance?.dispose();
    };
  }, [geometry, material, items.length]);
  useLayoutEffect(
    () => fillInstances(ref.current, items, origin.x, origin.z),
    [items, origin, geometry],
  );
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, Math.max(1, items.length)]}
      castShadow={shadow}
      receiveShadow
      dispose={null}
    />
  );
}

/** Placement and collision data remain unchanged; only nearby visual detail is streamed. */
export function ChunkProps({ cx, cz }: { cx: number; cz: number }) {
  const { playerPos, playerSpeedRef } = useGameContext();
  const origin = useMemo(() => chunkOrigin(cx, cz), [cx, cz]);
  const original = useMemo(() => propsForChunk(cx, cz), [cx, cz]);
  useEffect(
    () =>
      useAdventureSession.subscribe((session, previous) => {
        if (
          session.action?.name !== "air:impact" ||
          session.action.id === previous.action?.id
        )
          return;
        if (lastSceneryImpact === session.action) return;
        lastSceneryImpact = session.action;
        const hit = parseAirImpact(session.action.payload);
        if (!hit) return;
        // Bombs keep traveling after the pilot moves away: query deterministic placement
        // at the impact, including chunks which are not currently rendered.
        const first = chunkCoordsFor(
            hit.x - hit.treeRadius,
            hit.z - hit.treeRadius,
          ),
          last = chunkCoordsFor(hit.x + hit.treeRadius, hit.z + hit.treeRadius);
        const removed: string[] = [];
        for (let x = first.cx; x <= last.cx; x++)
          for (let z = first.cz; z <= last.cz; z++) {
            const placed = propsForChunk(x, z);
            for (const [kind, items] of [
              ["tree", placed.trees],
              ["grass", placed.grass],
            ] as const)
              for (const p of items)
                if (Math.hypot(p.x - hit.x, p.z - hit.z) < hit.treeRadius)
                  removed.push(sceneryId(kind, p));
          }
        if (!removed.length) return;
        useFourWheeler3dStore.getState().updateProgress((p) => ({
          ...p,
          adventure: {
            ...p.adventure,
            activities: {
              ...p.adventure.activities,
              brokenProps: [
                ...new Set([...p.adventure.activities.brokenProps, ...removed]),
              ].slice(0, 5000),
            },
          },
        }));
      }),
    [],
  );
  const broken = useFourWheeler3dStore(
    (s) => s.progress.adventure.activities.brokenProps,
  );
  const savedGrass = useFourWheeler3dStore(
    (s) => s.progress.adventure.activities.cutGrass,
  );
  const liveGrass = useActivitiesSession((s) => s.liveActivities?.cutGrass);
  const cut = liveGrass ?? savedGrass;
  const props = useMemo(
    () => ({
      trees: original.trees.filter(
        (p) => !broken.includes(sceneryId("tree", p)),
      ),
      rocks: original.rocks.filter(
        (p) => !broken.includes(sceneryId("rock", p)),
      ),
      grass: original.grass.filter(
        (p) =>
          !broken.includes(sceneryId("grass", p)) && !isGrassCut(cut, p.x, p.z),
      ),
    }),
    [original, broken, cut],
  );
  const species = useMemo(
    () =>
      [0, 1, 2].map((id) => props.trees.filter((tree) => tree.species === id)),
    [props],
  );
  const materials = useMemo(() => forestMaterials(), []);
  const [detail, setDetail] = useState(false);
  const [nearTrees, setNearTrees] = useState(false);
  const frame = useRef(0);

  const placements = useMemo(() => {
    const place = (item: PlacedProp, scale = 1): AssetPlacement => ({
      position: [item.x - origin.x, item.y, item.z - origin.z],
      rotation: [0, item.rotation, 0],
      scale: item.scale * scale,
    });
    return {
      rocks: props.rocks
        .slice(0, DETAIL_ROCKS)
        .map((item) => place(item, 0.75)),
      grass: props.grass.slice(0, 240).map((item) => place(item, 2.1)),
      tallGrass: props.grass.slice(240, 290).map((item) => place(item, 1.2)),
    };
  }, [props, origin]);
  const simpleRocks = useMemo(
    () => (detail ? props.rocks.slice(DETAIL_ROCKS) : props.rocks),
    [props, detail],
  );

  useFrame(() => {
    frame.current = (frame.current + 1) % LOD_FRAME_INTERVAL;
    if (frame.current !== 0) return;
    const player = playerPos.current;
    const dx = Math.max(0, Math.abs(player.x - origin.x) - WORLD.CHUNK / 2);
    const dz = Math.max(0, Math.abs(player.z - origin.z) - WORLD.CHUNK / 2);
    const distance = Math.hypot(dx, dz);
    // Hysteresis avoids flickering between representations on a chunk boundary.
    setDetail((current) => distance < DETAIL_DISTANCE + (current ? 12 : 0));
    setNearTrees(
      (current) => distance < TREE_DETAIL_DISTANCE + (current ? 18 : 0),
    );
  });

  const breakScenery = (kind: string, p: PlacedProp) => {
    const store = useFourWheeler3dStore.getState();
    const speed = playerSpeedRef.current;
    if (
      store.mode !== "vehicle" ||
      Math.abs(speed) < 8 ||
      Math.hypot(playerPos.current.x - p.x, playerPos.current.z - p.z) > 8
    )
      return;
    const id = sceneryId(kind, p);
    if (store.progress.adventure.activities.brokenProps.includes(id)) return;
    store.updateProgress((value) => ({
      ...value,
      adventure: {
        ...value.adventure,
        activities: {
          ...value.adventure.activities,
          brokenProps: [...value.adventure.activities.brokenProps, id],
        },
      },
    }));
    useActivitiesSession.setState((s) => ({
      debris: [...s.debris.slice(-15), { id, ...p, kind }],
    }));
    store.setHint(
      kind === "tree" ? "You broke through a tree!" : "Rock broken!",
    );
  };
  return (
    <group>
      {TREES.map((tree, i) => {
        const geometry = nearTrees ? tree.near : tree.far;
        return (
          <group key={i}>
            <PlacedMesh
              geometry={geometry.bark}
              material={materials[i].bark}
              items={species[i]}
              origin={origin}
              shadow={detail}
            />
            <PlacedMesh
              geometry={geometry.leaves}
              material={materials[i].leaves}
              items={species[i]}
              origin={origin}
              shadow={detail}
            />
          </group>
        );
      })}
      <PlacedMesh
        geometry={ROCK}
        material={ROCK_MATERIAL}
        items={simpleRocks}
        origin={origin}
        shadow={detail}
      />
      {detail && (
        <>
          <RigidBody type="fixed" colliders={false}>
            {props.trees.map((p) => (
              <CuboidCollider
                key={sceneryId("tree", p)}
                args={[0.19 * p.scale, 2 * p.scale, 0.19 * p.scale]}
                position={[p.x - origin.x, p.y + 2 * p.scale, p.z - origin.z]}
                onCollisionEnter={() => breakScenery("tree", p)}
              />
            ))}
            {props.rocks.map((p) => (
              <CuboidCollider
                key={sceneryId("rock", p)}
                args={[0.65 * p.scale, 0.4 * p.scale, 0.65 * p.scale]}
                position={[
                  p.x - origin.x,
                  p.y + 0.25 * p.scale,
                  p.z - origin.z,
                ]}
                onCollisionEnter={() => breakScenery("rock", p)}
              />
            ))}
          </RigidBody>
          <RockAssets
            instances={placements.rocks}
            variant={2}
            fallback={
              <PlacedMesh
                geometry={ROCK}
                material={ROCK_MATERIAL}
                items={props.rocks.slice(0, DETAIL_ROCKS)}
                origin={origin}
                shadow
              />
            }
          />
          <GrassAssets instances={placements.grass} variant={0} />
          <GrassAssets instances={placements.tallGrass} variant={6} />
        </>
      )}
    </group>
  );
}

export default ChunkProps;
