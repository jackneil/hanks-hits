import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type Point = [number, number, number];

/** Bake transforms and merge by material: mechanical detail without a draw call per bolt. */
export function rounded(
  size: Point,
  position: Point,
  radius = 0.04,
  rotation: Point = [0, 0, 0],
) {
  const g = new RoundedBoxGeometry(...size, 2, radius);
  g.applyMatrix4(
    new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)),
  );
  return g.translate(...position);
}

export function ellipsoid(size: Point, position: Point) {
  return new THREE.SphereGeometry(1, 16, 12)
    .scale(...size)
    .translate(...position);
}

export function bar(
  from: Point,
  to: Point,
  radius: number,
  topRadius = radius,
) {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const delta = b.clone().sub(a);
  const g = new THREE.CylinderGeometry(topRadius, radius, delta.length(), 10);
  g.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      delta.normalize(),
    ),
  );
  return g.translate(...a.add(b).multiplyScalar(0.5).toArray());
}

export function combine(parts: THREE.BufferGeometry[]) {
  // RoundedBoxGeometry is non-indexed, while cylinders and spheres are indexed.
  const normalized = parts.map((part) =>
    part.index ? part.toNonIndexed() : part,
  );
  const merged = mergeGeometries(normalized)!;
  new Set([...parts, ...normalized]).forEach((part) => part.dispose());
  return merged;
}
