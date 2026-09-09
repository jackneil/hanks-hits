import type { AdventurePosition, Horse } from "./adventureTypes";
import { COW_PEN, HORSE_PEN, type Rect } from "./landmarks";

export type FarmPose = {
  id: string;
  kind: "cow" | "horse";
  position: AdventurePosition;
  heading: number;
  speed: number;
  distance: number;
  rest: number;
  target: { x: number; z: number };
  bounds: Rect;
  seed: number;
};
export const cowBounds: Rect = {
  minX: COW_PEN.x - COW_PEN.halfX + 1.4,
  maxX: COW_PEN.x + COW_PEN.halfX - 1.4,
  minZ: COW_PEN.z - COW_PEN.halfZ + 1.5,
  maxZ: COW_PEN.z + COW_PEN.halfZ - 1.5,
};
export const horseBounds: Rect = {
  minX: HORSE_PEN.x - HORSE_PEN.w / 2 + 1.5,
  maxX: HORSE_PEN.x + HORSE_PEN.w / 2 - 1.5,
  minZ: HORSE_PEN.z - HORSE_PEN.h / 2 + 1.6,
  maxZ: HORSE_PEN.z + HORSE_PEN.h / 2 - 1.6,
};
function inside(p: { x: number; z: number }, b: Rect) {
  return p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ;
}
/** Horses left outside the corral graze near their dismount point. */
export function boundsForHorse(p: AdventurePosition): Rect {
  return inside(p, horseBounds)
    ? { ...horseBounds }
    : { minX: p.x - 4, maxX: p.x + 4, minZ: p.z - 4, maxZ: p.z + 4 };
}
function random(p: FarmPose) {
  p.seed = (Math.imul(p.seed, 1664525) + 1013904223) >>> 0;
  return p.seed / 4294967296;
}
export function createFarmPose(
  id: string,
  kind: FarmPose["kind"],
  position: AdventurePosition,
  heading = 0,
): FarmPose {
  let seed = 1987;
  for (const c of id) seed = (Math.imul(seed, 31) + c.charCodeAt(0)) >>> 0;
  return {
    id,
    kind,
    position: { x: position.x, y: position.y, z: position.z },
    heading,
    speed: 0,
    distance: 0,
    rest: 1 + (seed % 60) / 10,
    target: { x: position.x, z: position.z },
    bounds: kind === "cow" ? { ...cowBounds } : boundsForHorse(position),
    seed,
  };
}
/** Bounded deterministic steering. Gait advances only by actual ground travel. */
export function advanceFarmPose(
  p: FarmPose,
  dt: number,
  herd: Iterable<FarmPose> = [],
  held = false,
): void {
  dt = Math.max(0, Math.min(dt, 0.1));
  if (!dt) return;
  if (held) {
    p.speed = 0;
    return;
  }
  if (p.rest > 0) {
    p.rest = Math.max(0, p.rest - dt);
    p.speed = 0;
    return;
  }
  let dx = p.target.x - p.position.x,
    dz = p.target.z - p.position.z;
  if (Math.hypot(dx, dz) < 0.65) {
    p.rest = 2 + random(p) * 5;
    p.target = {
      x: p.bounds.minX + random(p) * (p.bounds.maxX - p.bounds.minX),
      z: p.bounds.minZ + random(p) * (p.bounds.maxZ - p.bounds.minZ),
    };
    p.speed = 0;
    return;
  }
  const distance = Math.hypot(dx, dz);
  dx /= distance;
  dz /= distance;
  for (const other of herd) {
    if (other.id === p.id) continue;
    const ox = p.position.x - other.position.x,
      oz = p.position.z - other.position.z,
      d = Math.hypot(ox, oz);
    if (d > 0 && d < 2) {
      dx += (ox / d) * (2 - d) * 1.2;
      dz += (oz / d) * (2 - d) * 1.2;
    }
  }
  const desired = Math.atan2(dx, dz),
    turn = Math.atan2(
      Math.sin(desired - p.heading),
      Math.cos(desired - p.heading),
    );
  p.heading += Math.max(-dt * 1.2, Math.min(dt * 1.2, turn));
  const targetSpeed =
    (p.kind === "horse" ? 0.72 : 0.43) * Math.max(0.12, Math.cos(turn));
  p.speed += (targetSpeed - p.speed) * (1 - Math.exp(-dt * 4));
  const x = Math.max(
    p.bounds.minX,
    Math.min(p.bounds.maxX, p.position.x + Math.sin(p.heading) * p.speed * dt),
  );
  const z = Math.max(
    p.bounds.minZ,
    Math.min(p.bounds.maxZ, p.position.z + Math.cos(p.heading) * p.speed * dt),
  );
  const moved = Math.hypot(x - p.position.x, z - p.position.z);
  p.distance += moved;
  p.position.x = x;
  p.position.z = z;
  if (moved < 0.001 && p.speed > 0.1) {
    p.target = {
      x: (p.bounds.minX + p.bounds.maxX) / 2,
      z: (p.bounds.minZ + p.bounds.maxZ) / 2,
    };
  }
}
export function createCowHerd() {
  return Array.from({ length: 5 }, (_, i) =>
    createFarmPose(
      `cow-${i + 1}`,
      "cow",
      {
        x: COW_PEN.x - 5 + (i % 3) * 4.5,
        y: 0,
        z: COW_PEN.z - 2 + Math.floor(i / 3) * 4,
      },
      i * 1.8,
    ),
  );
}
export const cowPoses = new Map(createCowHerd().map((p) => [p.id, p]));
export const horsePoses = new Map<string, FarmPose>();
export function nearestCow(
  position: { x: number; z: number },
  maxDistance = 8.4,
): FarmPose | null {
  let found: FarmPose | null = null,
    distance = maxDistance;
  for (const cow of cowPoses.values()) {
    const d = Math.hypot(
      cow.position.x - position.x,
      cow.position.z - position.z,
    );
    if (d < distance) {
      distance = d;
      found = cow;
    }
  }
  return found;
}
/** Persist only the horse contract; runtime snapshots may also carry speed or heading. */
export function horseWithPose(
  horse: Horse,
  pose: Pick<FarmPose, "position" | "heading">,
): Horse {
  const p = pose.position;
  return {
    id: horse.id,
    color: horse.color,
    saddle: horse.saddle,
    heading: pose.heading,
    position: { x: p.x, y: p.y, z: p.z },
  };
}
export function nearestHorse(
  position: { x: number; z: number },
  horses: Horse[],
  maxDistance = 8.4,
): Horse | null {
  let found: Horse | null = null,
    distance = maxDistance;
  for (const horse of horses) {
    const pose = horsePoses.get(horse.id),
      p = pose?.position ?? horse.position,
      d = Math.hypot(p.x - position.x, p.z - position.z);
    if (d < distance) {
      distance = d;
      found = horseWithPose(horse, {
        position: p,
        heading: pose?.heading ?? horse.heading,
      });
    }
  }
  return found;
}
export function liveHorsePosition(id: string) {
  const p = horsePoses.get(id)?.position;
  return p ? { x: p.x, y: p.y, z: p.z } : null;
}
let flush: () => void = () => {};
export function registerFarmFlush(callback: () => void) {
  flush = callback;
  return () => {
    if (flush === callback) flush = () => {};
  };
}
export function flushFarmPoses() {
  flush();
}
