"use client";

import {
  Component,
  Suspense,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

const ROOT = "/games/four-wheeler-3d/assets";
const FILES = {
  rock: `${ROOT}/rock_moss_set_01/rock_moss_set_01_1k.gltf`,
  grass: `${ROOT}/grass_medium_01/grass_medium_01_1k.gltf`,
  pier: `${ROOT}/modular_wooden_pier/modular_wooden_pier_1k.gltf`,
  car: `${ROOT}/car_concept/CarConcept.gltf`,
} as const;

type AssetKind = keyof typeof FILES;
type Vector = [number, number, number];
export type AssetPlacement = {
  position: Vector;
  rotation?: Vector;
  scale?: number | Vector;
};
type AssetProps = Partial<AssetPlacement> & { fallback?: ReactNode };

/** A failed optional scenery asset must not take the physics world down with it. */
class AssetBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function AssetGate({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return (
    <AssetBoundary fallback={fallback}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </AssetBoundary>
  );
}

function nodeName(kind: AssetKind, variant: number) {
  if (kind === "rock")
    return `rock_moss_set_01_rock0${1 + (((variant % 6) + 6) % 6)}`;
  if (kind === "grass") {
    // Real modeled blades, 28-79 triangles for ground cover and 290-340 for taller tufts.
    const names = [
      "tiny_a",
      "tiny_b",
      "tiny_c",
      "tiny_d",
      "tiny_e",
      "tiny_f",
      "tall_a",
      "tall_b",
      "tall_c",
    ];
    return `grass_medium_01_${names[((variant % names.length) + names.length) % names.length]}_LOD0`;
  }
  return "modular_wooden_pier_section_02";
}

function useSource(kind: AssetKind, variant = 0) {
  // Every dependency is vendored. These assets require no compression decoders.
  const { scene } = useGLTF(FILES[kind], false, false);
  const object =
    kind === "car" ? scene : scene.getObjectByName(nodeName(kind, variant));
  if (!object) throw new Error(`Missing local scenery mesh: ${kind}`);
  return object;
}

/** Keep cached loader resources shared. Only object transforms are cloned. */
function AssetModel({
  kind,
  variant = 0,
}: {
  kind: AssetKind;
  variant?: number;
}) {
  const source = useSource(kind, variant);
  const object = useMemo(() => {
    const clone = source.clone(true);
    if (kind !== "car") clone.position.set(0, 0, 0); // Remove the source pack's display-grid placement.
    clone.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = kind !== "grass";
      child.receiveShadow = true;
      // The source's logo texture is on these two dedicated meshes.
      if (
        kind === "car" &&
        /License.?Plate|InteriorSteeringEmblem/.test(child.name)
      )
        child.visible = false;
    });
    clone.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(clone);
    const center = bounds.getCenter(new THREE.Vector3());
    let anchorY = bounds.min.y;
    if (kind === "pier") {
      // Anchor the walking surface, letting the support posts extend below it.
      clone.traverse((child) => {
        if (
          child instanceof THREE.Mesh &&
          !Array.isArray(child.material) &&
          child.material.name.endsWith("_planks")
        ) {
          anchorY = new THREE.Box3().setFromObject(child).max.y;
        }
      });
    }
    const normalized = new THREE.Group();
    normalized.add(clone);
    clone.position.sub(new THREE.Vector3(center.x, anchorY, center.z));
    if (kind === "car") {
      const size = bounds.getSize(new THREE.Vector3());
      normalized.scale.setScalar(4.6 / Math.max(size.x, size.z));
    }
    return normalized;
  }, [source, kind]);
  return <primitive object={object} dispose={null} />;
}

function Asset({
  kind,
  variant,
  fallback,
  ...placement
}: AssetProps & { kind: AssetKind; variant?: number }) {
  return (
    <group {...placement}>
      <AssetGate fallback={fallback}>
        <AssetModel kind={kind} variant={variant} />
      </AssetGate>
    </group>
  );
}

/** Six distinct mossy rocks. Position is the bottom-center of the selected rock. */
export function RockAsset({
  variant = 2,
  ...props
}: AssetProps & { variant?: number }) {
  return <Asset kind="rock" variant={variant} {...props} />;
}

/** Variants 0-5 are tiny ground cover, 6-8 are taller tufts. */
export function GrassAsset({
  variant = 6,
  ...props
}: AssetProps & { variant?: number }) {
  return <Asset kind="grass" variant={variant} {...props} />;
}

/** A roughly 2.5m-wide wooden section. Position.y is its deck surface. Visual mesh only. */
export function PierAsset(props: AssetProps) {
  return <Asset kind="pier" {...props} />;
}

/** Detailed 4.6m concept car for a garage/landmark. Visual mesh only, facing +Z. */
export function SportsCarAsset(props: AssetProps) {
  return <Asset kind="car" {...props} />;
}

function Instances({
  kind,
  variant,
  instances,
}: {
  kind: "rock" | "grass";
  variant: number;
  instances: AssetPlacement[];
}) {
  const source = useSource(kind, variant);
  if (!(source instanceof THREE.Mesh))
    throw new Error(`Scenery is not instanceable: ${kind}`);
  const mesh = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const instance = mesh.current;
    return () => {
      instance?.dispose();
    };
  }, [source, instances.length]);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const geometry = source.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const center = box.getCenter(new THREE.Vector3());
    const local = new THREE.Matrix4().makeTranslation(
      -center.x,
      -box.min.y,
      -center.z,
    );
    const transform = new THREE.Object3D();
    const matrix = new THREE.Matrix4();
    instances.forEach((placement, index) => {
      transform.position.set(...placement.position);
      transform.rotation.set(...(placement.rotation ?? [0, 0, 0]));
      const scale = placement.scale ?? 1;
      if (typeof scale === "number") transform.scale.setScalar(scale);
      else transform.scale.set(...scale);
      transform.updateMatrix();
      matrix.multiplyMatrices(transform.matrix, local);
      mesh.current!.setMatrixAt(index, matrix);
    });
    mesh.current.count = instances.length;
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [source, instances]);
  return (
    <instancedMesh
      ref={mesh}
      args={[source.geometry, source.material, Math.max(1, instances.length)]}
      castShadow={kind === "rock"}
      receiveShadow
      dispose={null}
    />
  );
}

/** One draw call per batch. Keep batches chunk-sized so frustum culling remains useful. */
export function RockAssets({
  instances,
  variant = 2,
  fallback,
}: {
  instances: AssetPlacement[];
  variant?: number;
  fallback?: ReactNode;
}) {
  return (
    <AssetGate fallback={fallback}>
      <Instances kind="rock" variant={variant} instances={instances} />
    </AssetGate>
  );
}

export function GrassAssets({
  instances,
  variant = 0,
  fallback,
}: {
  instances: AssetPlacement[];
  variant?: number;
  fallback?: ReactNode;
}) {
  return (
    <AssetGate fallback={fallback}>
      <Instances kind="grass" variant={variant} instances={instances} />
    </AssetGate>
  );
}
