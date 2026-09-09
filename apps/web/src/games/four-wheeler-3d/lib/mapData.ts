import type { WildlifeAnimal } from "./hunting";

/** Shared with Farm: map pins and collectible meshes must never drift apart. */
export const BONE_POINTS = Array.from({ length: 56 }, (_, i) => {
  const angle = i * 2.399963,
    radius = 420 + (i % 8) * 175;
  return {
    id: `bone-${i}`,
    x: Math.cos(angle) * radius,
    z: Math.sin(angle) * radius,
  };
});
/** Hunting binds its live array once; the map samples it without publishing thousands of React states. */
export const wildlifeMapRuntime: { animals: readonly WildlifeAnimal[] } = {
  animals: [],
};
export const ANIMAL_MAP_COLORS: Record<string, string> = {
  wolf: "#ef6657",
  tiger: "#e0852a",
  lion: "#d3a85a",
  zebra: "#dddddd",
  bat: "#ad9dde",
  buck: "#e0903a",
  rabbit: "#d0d0d0",
  deer: "#a9743f",
};

export function wildlifeMapPaths(
  animals: readonly WildlifeAnimal[],
  bounds: { x: number; z: number; span: number },
  size: number,
): Record<string, string> {
  const paths: Record<string, string> = {};
  for (const animal of animals) {
    if (
      !animal.alive ||
      Math.abs(animal.position.x - bounds.x) > bounds.span / 2 ||
      Math.abs(animal.position.z - bounds.z) > bounds.span / 2
    )
      continue;
    const x = (animal.position.x - size / 2).toFixed(1),
      z = (animal.position.z - size / 2).toFixed(1);
    paths[animal.type] =
      (paths[animal.type] ?? "") + `M${x} ${z}h${size}v${size}h-${size}Z`;
  }
  return paths;
}
