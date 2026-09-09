import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Deterministic leaf sprays, baked once then instanced across the forest. */
export function foliageGeometry(
  pine: boolean,
  slender = false,
  distant = false,
) {
  const vertices: number[] = [];
  const colors: number[] = [];
  let seed = pine ? 91 : slender ? 163 : 47;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
  const leaves = distant ? 280 : pine ? 1300 : 1800;
  for (let i = 0; i < leaves; i++) {
    const angle = random() * Math.PI * 2;
    const level = random();
    const radius = pine
      ? (1 - level) * 2.4
      : Math.sqrt(1 - (level * 2 - 1) ** 2) * (slender ? 1.65 : 2.8);
    const spread = radius * Math.sqrt(random());
    const x = Math.cos(angle) * spread;
    const z = Math.sin(angle) * spread;
    const y = pine
      ? 2.5 + level * 7.5
      : (slender ? 4.4 : 3.1) + level * (slender ? 4.3 : 5.2);
    const size = ((pine ? 0.2 : 0.12) + random() * 0.16) * (distant ? 2.1 : 1);
    const yaw = random() * Math.PI * 2;
    const tilt = random() * 2.6 - 1.3;
    const leafWidth = pine ? 0.18 : 0.5;
    const dx = Math.cos(yaw) * size;
    const dz = Math.sin(yaw) * size;
    // Bent diamond leaves avoid both solid crowns and flat camera-facing cards.
    const points = [
      [x - dx, y, z - dz],
      [x, y + size * (0.45 + tilt), z + size * leafWidth],
      [x + dx, y + tilt * size, z + dz],
      [x, y - size * 0.25, z - size * leafWidth],
    ];
    const shade = 0.6 + random() * 0.4;
    for (const index of [0, 1, 2, 0, 2, 3]) {
      vertices.push(...points[index]);
      colors.push(shade * (pine ? 0.62 : 0.85), shade, shade * 0.55);
    }
  }
  const leaf = new THREE.BufferGeometry();
  leaf.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  leaf.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  leaf.computeVertexNormals();
  const trunk = new THREE.CylinderGeometry(
    slender ? 0.07 : 0.1,
    slender ? 0.22 : 0.36,
    pine ? 9 : 6.5,
    9,
  ).toNonIndexed();
  trunk.translate(0, pine ? 4.5 : 3.25, 0);
  const barkColors = new Float32Array(
    trunk.getAttribute("position").count * 3,
  ).fill(1);
  trunk.setAttribute("color", new THREE.BufferAttribute(barkColors, 3));
  // Leaf geometry has no UVs; neither material needs them.
  trunk.deleteAttribute("uv");
  const geometry = mergeGeometries([trunk, leaf], true)!;
  trunk.dispose();
  leaf.dispose();
  return geometry;
}
