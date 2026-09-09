import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

type Species = 0 | 1 | 2;
type Limb = {
  start: THREE.Vector3;
  end: THREE.Vector3;
  radius: number;
  endRadius?: number;
  level: number;
};
type Spray = {
  position: THREE.Vector3;
  direction: THREE.Vector3;
  size: number;
  roll: number;
  shade: number;
};

/** Tree silhouettes follow connected limbs. Near and far meshes share the same skeleton. */
export function forestGeometry(species: Species, distant = false) {
  let seed = [173, 941, 367][species];
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
  const limbs: Limb[] = [];
  const sprays: Spray[] = [];
  const height = species === 0 ? 10.5 : species === 1 ? 8.4 : 9.2;
  const trunkRadius = species === 2 ? 0.18 : 0.3;
  let previous = new THREE.Vector3();
  for (let i = 1; i <= 8; i++) {
    const end = new THREE.Vector3(
      Math.sin(i * 0.6) * 0.12,
      (i / 8) * height,
      Math.cos(i * 0.7) * 0.12,
    );
    limbs.push({
      start: previous,
      end,
      radius: trunkRadius * (1 - (i - 1) / 8) + 0.02,
      endRadius: trunkRadius * (1 - i / 8) + 0.02,
      level: 0,
    });
    previous = end;
  }
  const trunkPoint = (y: number) => {
    const segment = Math.min(7, Math.floor((y / height) * 8));
    const limb = limbs[segment];
    return limb.start
      .clone()
      .lerp(limb.end, (y - limb.start.y) / (limb.end.y - limb.start.y));
  };
  const addSpray = (
    position: THREE.Vector3,
    direction: THREE.Vector3,
    size: number,
  ) => {
    sprays.push({
      position,
      direction,
      size,
      roll: random() * Math.PI * 2,
      shade: 0.73 + random() * 0.27,
    });
  };
  if (species === 0) {
    // Drooping, irregular whorls with needle sprays extending along each branch.
    for (let tier = 0; tier < 8; tier++) {
      const y = 2.1 + tier * 1.04;
      const length = 2.8 * (1 - tier / 9);
      for (let arm = 0; arm < 6; arm++) {
        const angle = (arm * Math.PI) / 3 + tier * 1.8 + random() * 0.35;
        const start = trunkPoint(y);
        const end = start
          .clone()
          .add(
            new THREE.Vector3(
              Math.cos(angle) * length,
              -0.35 + random() * 0.7,
              Math.sin(angle) * length,
            ),
          );
        limbs.push({ start, end, radius: 0.065 * (1 - tier / 10), level: 1 });
        for (let twig = 0; twig < 7; twig++) {
          const t = 0.23 + twig * 0.115;
          const point = start.clone().lerp(end, t);
          const side = twig % 2 ? 1 : -1;
          const direction = new THREE.Vector3(
            Math.cos(angle + side * 0.5),
            0.25 + random() * 0.5,
            Math.sin(angle + side * 0.5),
          ).normalize();
          addSpray(point, direction, 0.75 + (1 - tier / 8) * 0.55);
        }
      }
    }
    addSpray(trunkPoint(height - 0.4), new THREE.Vector3(0, 1, 0), 1);
  } else {
    // Broad oak crowns and slender birches use secondary boughs and terminal twigs.
    for (let branch = 0; branch < 10; branch++) {
      const angle = branch * 2.399 + random() * 0.3;
      const level = branch / 10;
      const start = trunkPoint(2.8 + level * 4.2);
      const spread =
        (species === 2 ? 1.55 : 2.8) * (0.75 + Math.sin(level * Math.PI) * 0.3);
      const end = start
        .clone()
        .add(
          new THREE.Vector3(
            Math.cos(angle) * spread,
            1.1 + random() * 0.6,
            Math.sin(angle) * spread,
          ),
        );
      limbs.push({ start, end, radius: species === 2 ? 0.055 : 0.1, level: 1 });
      for (let fork = 0; fork < 3; fork++) {
        const joint = start.clone().lerp(end, 0.45 + fork * 0.22);
        const a = angle + (fork - 1) * 0.75;
        const tip = joint
          .clone()
          .add(
            new THREE.Vector3(
              Math.cos(a) * 0.9,
              0.55 + random() * 0.5,
              Math.sin(a) * 0.9,
            ),
          );
        limbs.push({ start: joint, end: tip, radius: 0.035, level: 2 });
        for (let leaf = 0; leaf < 8; leaf++) {
          const position = joint.clone().lerp(tip, 0.25 + leaf * 0.1);
          position.x += (random() - 0.5) * 0.65;
          position.z += (random() - 0.5) * 0.65;
          const direction = new THREE.Vector3(
            Math.cos(a + leaf),
            0.35 + random() * 0.7,
            Math.sin(a + leaf),
          ).normalize();
          addSpray(position, direction, species === 2 ? 0.85 : 1.15);
        }
      }
    }
  }
  const wood: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (const [index, limb] of limbs.entries()) {
    if (distant && limb.level === 2) continue;
    if (distant && species === 0 && limb.level === 1 && index % 3 !== 0)
      continue;
    const delta = limb.end.clone().sub(limb.start);
    const cylinder = new THREE.CylinderGeometry(
      limb.endRadius ?? limb.radius * 0.18,
      limb.radius,
      delta.length(),
      distant ? 4 : 7,
      1,
      true,
    );
    cylinder.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(up, delta.normalize()),
    );
    cylinder.translate(
      ...limb.start.clone().add(limb.end).multiplyScalar(0.5).toArray(),
    );
    wood.push(cylinder);
  }
  const bark = mergeGeometries(wood)!;
  wood.forEach((part) => part.dispose());
  const positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [],
    colors: number[] = [];
  const local = new THREE.Vector3();
  sprays.forEach((spray, index) => {
    if (distant && index % 4 !== 0) return;
    const size = spray.size * (distant ? 1.65 : 1);
    const rotation = new THREE.Quaternion().setFromUnitVectors(
      up,
      spray.direction,
    );
    rotation.multiply(new THREE.Quaternion().setFromAxisAngle(up, spray.roll));
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation);
    // Texture stem starts at the branch attachment, instead of floating at a card center.
    for (const [x, y, u, v] of [
      [-0.5, 0, 0, 0],
      [0.5, 0, 1, 0],
      [0.5, 1, 1, 1],
      [-0.5, 0, 0, 0],
      [0.5, 1, 1, 1],
      [-0.5, 1, 0, 1],
    ]) {
      local
        .set(x * size, y * size, 0)
        .applyQuaternion(rotation)
        .add(spray.position);
      positions.push(local.x, local.y, local.z);
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(u, v);
      colors.push(spray.shade, spray.shade, spray.shade);
    }
  });
  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  leaves.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  leaves.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  leaves.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  bark.computeBoundingSphere();
  leaves.computeBoundingSphere();
  return { bark, leaves };
}

let sharedMaterials:
  | { bark: THREE.MeshStandardMaterial; leaves: THREE.MeshStandardMaterial }[]
  | undefined;

/** One shared set of local textures for all chunks; no loader or material per tree. */
export function forestMaterials() {
  if (sharedMaterials) return sharedMaterials;
  const loader = new THREE.TextureLoader();
  const base = "/games/four-wheeler-3d/assets";
  const barkMap = loader.load(
    `${base}/bark_brown_02/bark_brown_02_diff_1k.jpg`,
  );
  const barkNormal = loader.load(
    `${base}/bark_brown_02/bark_brown_02_nor_gl_1k.jpg`,
  );
  barkMap.colorSpace = THREE.SRGBColorSpace;
  for (const texture of [barkMap, barkNormal]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 2);
    texture.anisotropy = 4;
  }
  sharedMaterials = ["pine", "oak", "aspen"].map((leaf, i) => {
    const map = loader.load(`${base}/forest_leaves/${leaf}.png`);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    return {
      bark: new THREE.MeshStandardMaterial({
        map: barkMap,
        normalMap: barkNormal,
        normalScale: new THREE.Vector2(0.65, 0.65),
        color: i === 2 ? "#d7d0bb" : "#b2a28b",
        roughness: 1,
      }),
      leaves: new THREE.MeshStandardMaterial({
        map,
        color: i === 0 ? "#71884f" : "#a0a980",
        alphaTest: 0.45,
        side: THREE.DoubleSide,
        vertexColors: true,
        roughness: 0.9,
      }),
    };
  });
  return sharedMaterials;
}
