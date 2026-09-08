/**
 * The ground of Four-Wheeler Adventure 3D.
 *
 * Everything here is a pure function of a world position, so the physics
 * heightfield and the visible mesh sample exactly the same numbers and can
 * never disagree. Nothing in this file touches React or Three.
 *
 * The height is built in stages, in this order:
 *   1. rolling hills from simplex noise, held above a low land floor
 *   2. the lake basin, a bowl that reaches -6 m at the middle
 *   3. road ribbons, flattened to the road's own smoothed profile
 *   4. land plots, treestands and cabins, flat pads that match their road
 *   5. the hub compound, flat at 2 m with a 40 m skirt
 */

import { createNoise2D } from "simplex-noise";

import { WORLD } from "./constants";
import {
  CABINS,
  LAKE,
  LAND_PLOTS,
  PLOT_SIZE,
  RACE_LOOP,
  RUNWAY,
  RUNWAY_ENDS,
  TRAIN_LOOP,
  TREESTANDS,
  hubBounds,
  raceLoopPoints,
  trainLoopPoints,
  trainSpurPoints,
  type Vec2,
} from "./landmarks";

/** The lowest the lake bed ever goes. */
export const LAKE_FLOOR = -6;

/** Land never drops under this, so the shore only happens at the lake. */
const LAND_FLOOR = 1.2;

/**
 * The hills are lifted by this much before the land floor is applied. The
 * raw noise dips well under the floor about a third of the time, which would
 * clamp a third of the map into one dead flat plain. The lift keeps that
 * under a tenth, so the plains still roll.
 */
const HILL_LIFT = 8;

/**
 * Where the water meets the land. The Water component draws its disc at this
 * radius, so the basin is shaped to cross zero here and the two always agree.
 */
export const SHORE_RADIUS = 372;

/** The hub compound sits on a flat pad at this height. */
const HUB_HEIGHT = 2;

/** How wide the skirt around the hub pad is. */
const HUB_SKIRT = 40;

/** The ring road that runs around the lake, well clear of the water. */
const RING_RADIUS = 430;

/** How far past a road's own width the flattening fades out. */
const ROAD_BLEND = 6;

/** Half widths of every kind of road ribbon. */
const ROAD_HALF = {
  ring: 4.5,
  spoke: 4,
  race: RACE_LOOP.width / 2,
  train: TRAIN_LOOP.width / 2,
  runway: RUNWAY.width / 2,
} as const;

/** Flat pads: half the pad, then a skirt that blends back to the hills. */
const PLOT_HALF = PLOT_SIZE / 2;
const PLOT_SKIRT = 10;
const SPOT_RADIUS = 12;
const SPOT_SKIRT = 8;

/** Sand runs this far up the beach from the water line. */
const SAND_BAND = 8;

/** Above this height the ground takes a snowy tint. */
const SNOW_LINE = 24;

// ============================================================================
// NOISE
// ============================================================================

let noise2D: ReturnType<typeof createNoise2D> | null = null;

/** One fixed seed, made on first use, so the world is always the same. */
function getNoise(): ReturnType<typeof createNoise2D> {
  if (!noise2D) noise2D = createNoise2D(() => 0.42);
  return noise2D;
}

/** The classic smooth 0..1 ramp between two edges. */
export function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 === edge0) return value < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** A max that rounds off its corner, so the land floor leaves no crease. */
function smoothMax(a: number, b: number, k: number): number {
  const h = Math.max(0, 1 - Math.abs(a - b) / k);
  return Math.max(a, b) + h * h * k * 0.25;
}

// ============================================================================
// STAGE 1 AND 2: HILLS AND THE LAKE
// ============================================================================

/** Rolling hills, ridges and small bumps, held above the land floor. */
function hills(x: number, z: number): number {
  const noise = getNoise();
  const rolling = noise(x * 0.0015, z * 0.0015) * 18;
  const ridges = Math.abs(noise(x * 0.004 + 100, z * 0.004 + 100)) * 10;
  const bumps = noise(x * 0.02, z * 0.02) * 0.6;
  return smoothMax(rolling + ridges + bumps + HILL_LIFT, LAND_FLOOR, 3);
}

/** Distance from the middle of the lake. */
function lakeDistance(x: number, z: number): number {
  return Math.hypot(x - LAKE.x, z - LAKE.z);
}

/** The bowl under the water: -6 m in the middle, back to 0 at the shore. */
function lakeBowl(radius: number): number {
  return LAKE_FLOOR * (1 - smoothstep(0, SHORE_RADIUS, radius));
}

/** Hills, then the lake carved into them. */
function landAndLake(x: number, z: number): number {
  const radius = lakeDistance(x, z);
  const basin = 1 - smoothstep(SHORE_RADIUS, 420, radius);
  if (basin <= 0) return hills(x, z);
  return lerp(hills(x, z), lakeBowl(radius), basin);
}

/** How far a point is outside the hub rectangle. Zero when it is inside. */
function hubDistance(x: number, z: number): number {
  const dx = Math.max(hubBounds.minX - x, 0, x - hubBounds.maxX);
  const dz = Math.max(hubBounds.minZ - z, 0, z - hubBounds.maxZ);
  return Math.hypot(dx, dz);
}

/** 1 inside the hub, fading to 0 across the skirt. */
function hubWeight(x: number, z: number): number {
  return 1 - smoothstep(0, HUB_SKIRT, hubDistance(x, z));
}

/**
 * The ground before any road, pad or fence touches it. Roads read this to
 * work out the profile they should follow, which is why it is separate.
 */
function stageHeight(x: number, z: number): number {
  return lerp(landAndLake(x, z), HUB_HEIGHT, hubWeight(x, z));
}

// ============================================================================
// STAGE 3: THE ROAD NETWORK
// ============================================================================

type RoadSegment = {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  /** Smoothed ground height at each end of the segment. */
  h1: number;
  h2: number;
  halfWidth: number;
};

/** The grid cell used to find nearby road segments in one step. */
const ROAD_CELL = 64;

type RoadNetwork = {
  segments: RoadSegment[];
  grid: Map<number, number[]>;
  /** Flat pads that must match the road that ends on them. */
  pads: Array<{ x: number; z: number; half: number; skirt: number; height: number }>;
};

let network: RoadNetwork | null = null;

/** One integer key per grid cell, so the lookup map stays cheap. */
function cellKey(cellX: number, cellZ: number): number {
  return (cellX + 4096) * 16384 + (cellZ + 4096);
}

/**
 * Turn a centreline into segments whose heights follow a smoothed version of
 * the ground under it. Smoothing over neighbours is what stops a road from
 * copying every bump and giving the ATV a step to hit.
 */
function buildRoad(points: Vec2[], halfWidth: number, closed: boolean): RoadSegment[] {
  const raw = points.map((p) => stageHeight(p.x, p.z));
  const window = 4;
  const smooth = raw.map((_, index) => {
    let total = 0;
    let count = 0;
    for (let offset = -window; offset <= window; offset++) {
      let at = index + offset;
      if (closed) at = ((at % raw.length) + raw.length) % raw.length;
      else at = Math.min(raw.length - 1, Math.max(0, at));
      total += raw[at];
      count++;
    }
    return total / count;
  });

  const segments: RoadSegment[] = [];
  const last = closed ? points.length : points.length - 1;
  for (let i = 0; i < last; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    segments.push({
      x1: a.x,
      z1: a.z,
      x2: b.x,
      z2: b.z,
      h1: smooth[i],
      h2: smooth[(i + 1) % points.length],
      halfWidth,
    });
  }
  return segments;
}

/** Points along the ring road that circles the lake. */
function ringRoadPoints(count = 240): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    points.push({
      x: LAKE.x + Math.cos(angle) * RING_RADIUS,
      z: LAKE.z + Math.sin(angle) * RING_RADIUS,
    });
  }
  return points;
}

/**
 * A spoke: it leaves the ring road at the target's own bearing and runs
 * straight out to it. Starting on the ring is what keeps every road clear of
 * the water instead of driving through the lake.
 */
function spokePoints(target: Vec2, step = 8): Vec2[] {
  const angle = Math.atan2(target.z - LAKE.z, target.x - LAKE.x);
  const start = {
    x: LAKE.x + Math.cos(angle) * RING_RADIUS,
    z: LAKE.z + Math.sin(angle) * RING_RADIUS,
  };
  const length = Math.hypot(target.x - start.x, target.z - start.z);
  const count = Math.max(2, Math.round(length / step));
  const points: Vec2[] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    points.push({
      x: lerp(start.x, target.x, t),
      z: lerp(start.z, target.z, t),
    });
  }
  return points;
}

/** Build every ribbon once, then bucket the segments into a coarse grid. */
function getNetwork(): RoadNetwork {
  if (network) return network;

  const segments: RoadSegment[] = [];
  const pads: RoadNetwork["pads"] = [];

  segments.push(...buildRoad(ringRoadPoints(), ROAD_HALF.ring, true));
  segments.push(...buildRoad(raceLoopPoints(400), ROAD_HALF.race, true));
  segments.push(...buildRoad(trainLoopPoints(1200), ROAD_HALF.train, true));
  segments.push(...buildRoad(trainSpurPoints(320), ROAD_HALF.train, false));
  segments.push(...buildRoad([...RUNWAY_ENDS], ROAD_HALF.runway, false));

  /** A spoke plus the flat pad it lands on, both at the same height. */
  const addSpoke = (target: Vec2, half: number, skirt: number) => {
    const points = spokePoints(target);
    const built = buildRoad(points, ROAD_HALF.spoke, false);
    segments.push(...built);
    const end = built[built.length - 1];
    pads.push({ x: target.x, z: target.z, half, skirt, height: end.h2 });
  };

  for (const plot of LAND_PLOTS) addSpoke(plot, PLOT_HALF, PLOT_SKIRT);
  for (const stand of TREESTANDS) addSpoke(stand, SPOT_RADIUS, SPOT_SKIRT);
  for (const cabin of CABINS) addSpoke(cabin, SPOT_RADIUS, SPOT_SKIRT);

  const grid = new Map<number, number[]>();
  segments.forEach((segment, index) => {
    const reach = segment.halfWidth + ROAD_BLEND;
    const minX = Math.floor((Math.min(segment.x1, segment.x2) - reach) / ROAD_CELL);
    const maxX = Math.floor((Math.max(segment.x1, segment.x2) + reach) / ROAD_CELL);
    const minZ = Math.floor((Math.min(segment.z1, segment.z2) - reach) / ROAD_CELL);
    const maxZ = Math.floor((Math.max(segment.z1, segment.z2) + reach) / ROAD_CELL);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const key = cellKey(cx, cz);
        const bucket = grid.get(key);
        if (bucket) bucket.push(index);
        else grid.set(key, [index]);
      }
    }
  });

  network = { segments, grid, pads };
  return network;
}

/** What a road does to the ground at one point. */
export type RoadInfluence = {
  /** 0 = untouched ground, 1 = fully on the ribbon. */
  t: number;
  /** The height the ribbon wants the ground to be. */
  height: number;
};

const NO_ROAD: RoadInfluence = { t: 0, height: 0 };

/**
 * The strongest road ribbon at a point, found through the grid so this stays
 * a fixed amount of work no matter how many roads the world has.
 */
export function roadInfluence(x: number, z: number): RoadInfluence {
  const { segments, grid } = getNetwork();
  const bucket = grid.get(
    cellKey(Math.floor(x / ROAD_CELL), Math.floor(z / ROAD_CELL))
  );
  if (!bucket) return NO_ROAD;

  let bestT = 0;
  let bestHeight = 0;
  for (const index of bucket) {
    const segment = segments[index];
    const dx = segment.x2 - segment.x1;
    const dz = segment.z2 - segment.z1;
    const lengthSquared = dx * dx + dz * dz;
    const along =
      lengthSquared === 0
        ? 0
        : Math.min(
            1,
            Math.max(
              0,
              ((x - segment.x1) * dx + (z - segment.z1) * dz) / lengthSquared
            )
          );
    const nearX = segment.x1 + dx * along;
    const nearZ = segment.z1 + dz * along;
    const distance = Math.hypot(x - nearX, z - nearZ);
    const t =
      1 -
      smoothstep(segment.halfWidth, segment.halfWidth + ROAD_BLEND, distance);
    if (t > bestT) {
      bestT = t;
      bestHeight = lerp(segment.h1, segment.h2, along);
    }
  }

  return bestT > 0 ? { t: bestT, height: bestHeight } : NO_ROAD;
}

/** True on the dirt of a road ribbon, rather than out on the grass. */
export function isRoad(x: number, z: number): boolean {
  return roadInfluence(x, z).t > 0.5;
}

/** The flat pad a plot, treestand or cabin sits on, if the point is on one. */
function padInfluence(x: number, z: number): RoadInfluence {
  const { pads } = getNetwork();
  let bestT = 0;
  let bestHeight = 0;
  for (const pad of pads) {
    const distance = Math.max(Math.abs(x - pad.x), Math.abs(z - pad.z));
    if (distance > pad.half + pad.skirt) continue;
    const t = 1 - smoothstep(pad.half, pad.half + pad.skirt, distance);
    if (t > bestT) {
      bestT = t;
      bestHeight = pad.height;
    }
  }
  return bestT > 0 ? { t: bestT, height: bestHeight } : NO_ROAD;
}

// ============================================================================
// THE GROUND HEIGHT
// ============================================================================

/** The ground height in meters at any world position. */
export function heightAt(x: number, z: number): number {
  let height = landAndLake(x, z);

  const road = roadInfluence(x, z);
  if (road.t > 0) height = lerp(height, road.height, road.t);

  const pad = padInfluence(x, z);
  if (pad.t > 0) height = lerp(height, pad.height, pad.t);

  const hub = hubWeight(x, z);
  if (hub > 0) height = lerp(height, HUB_HEIGHT, hub);

  return Math.max(LAKE_FLOOR, height);
}

/** What the ground is made of. Snow is added at runtime, never returned here. */
export type Surface = "grass" | "dirt" | "sand" | "water" | "snow";

/** The material under a point, used for traction, dust and footstep sounds. */
export function surfaceAt(x: number, z: number): Surface {
  if (isRoad(x, z)) return "dirt";
  if (heightAt(x, z) < 0) return "water";
  if (lakeDistance(x, z) < SHORE_RADIUS + SAND_BAND) return "sand";
  return "grass";
}

/** The steepness of the ground, used to paint rock on the sharp faces. */
export function slopeAt(x: number, z: number, step = 4): number {
  const here = heightAt(x, z);
  const east = heightAt(x + step, z);
  const south = heightAt(x, z + step);
  return Math.max(Math.abs(east - here), Math.abs(south - here)) / step;
}

// ============================================================================
// CHUNKS
// ============================================================================

/** The map key for one chunk. */
export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

/** The middle of a chunk in world meters. Colliders sit on their middle. */
export function chunkOrigin(cx: number, cz: number): { x: number; z: number } {
  const size = WORLD.CHUNK;
  return { x: cx * size + size / 2, z: cz * size + size / 2 };
}

/** Which chunk a world position falls in. */
export function chunkCoordsFor(x: number, z: number): { cx: number; cz: number } {
  return {
    cx: Math.floor(x / WORLD.CHUNK),
    cz: Math.floor(z / WORLD.CHUNK),
  };
}

/**
 * The heights for one chunk's Rapier HeightfieldCollider.
 *
 * Rapier reads the array in column-major order and wants the TOTAL size as
 * the scale, not the step. The grid runs edge to edge, so the last column of
 * one chunk holds the same samples as the first column of its neighbour and
 * the seam between two chunks is exact.
 */
export function buildChunkHeights(
  cx: number,
  cz: number,
  segments = 32
): { heights: Float32Array; scale: { x: number; y: number; z: number } } {
  const size = WORLD.CHUNK;
  const origin = chunkOrigin(cx, cz);
  const half = size / 2;
  const step = size / segments;
  const heights = new Float32Array((segments + 1) * (segments + 1));

  for (let ix = 0; ix <= segments; ix++) {
    for (let iz = 0; iz <= segments; iz++) {
      const worldX = origin.x + ix * step - half;
      const worldZ = origin.z + iz * step - half;
      heights[iz + (segments + 1) * ix] = heightAt(worldX, worldZ);
    }
  }

  return { heights, scale: { x: size, y: 1, z: size } };
}

/** The palette the ground is painted with. */
const COLORS = {
  grassLow: [0.24, 0.42, 0.18],
  grassHigh: [0.42, 0.58, 0.28],
  dirt: [0.48, 0.35, 0.2],
  sand: [0.76, 0.7, 0.5],
  rock: [0.42, 0.42, 0.44],
  snow: [0.92, 0.94, 0.97],
} as const;

function mixInto(
  out: Float32Array,
  at: number,
  a: readonly number[],
  b: readonly number[],
  t: number
): void {
  out[at] = a[0] + (b[0] - a[0]) * t;
  out[at + 1] = a[1] + (b[1] - a[1]) * t;
  out[at + 2] = a[2] + (b[2] - a[2]) * t;
}

/** Positions, colours and triangles for one chunk's visible mesh. */
export type ChunkGeometryData = {
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  segments: number;
};

/**
 * Build the mesh for one chunk. It samples `heightAt` on the same grid the
 * collider uses, so what the player sees is exactly what the wheels touch.
 * Positions are local to the chunk middle.
 */
export function buildChunkGeometryData(
  cx: number,
  cz: number,
  segments = 32
): ChunkGeometryData {
  const size = WORLD.CHUNK;
  const origin = chunkOrigin(cx, cz);
  const half = size / 2;
  const step = size / segments;
  const side = segments + 1;

  const positions = new Float32Array(side * side * 3);
  const colors = new Float32Array(side * side * 3);
  const indices = new Uint32Array(segments * segments * 6);

  for (let ix = 0; ix < side; ix++) {
    for (let iz = 0; iz < side; iz++) {
      const localX = ix * step - half;
      const localZ = iz * step - half;
      const worldX = origin.x + localX;
      const worldZ = origin.z + localZ;
      const height = heightAt(worldX, worldZ);
      const at = (ix * side + iz) * 3;

      positions[at] = localX;
      positions[at + 1] = height;
      positions[at + 2] = localZ;

      const slope = slopeAt(worldX, worldZ, step);
      const road = roadInfluence(worldX, worldZ).t;
      const beach =
        1 -
        smoothstep(SHORE_RADIUS, SHORE_RADIUS + SAND_BAND, lakeDistance(worldX, worldZ));

      mixInto(colors, at, COLORS.grassLow, COLORS.grassHigh, smoothstep(2, 20, height));
      if (beach > 0) mixInto(colors, at, [colors[at], colors[at + 1], colors[at + 2]], COLORS.sand, beach);
      if (slope > 0.5) {
        const rocky = smoothstep(0.5, 1.1, slope);
        mixInto(colors, at, [colors[at], colors[at + 1], colors[at + 2]], COLORS.rock, rocky);
      }
      if (height > SNOW_LINE) {
        const snowy = smoothstep(SNOW_LINE, SNOW_LINE + 6, height);
        mixInto(colors, at, [colors[at], colors[at + 1], colors[at + 2]], COLORS.snow, snowy);
      }
      if (road > 0) mixInto(colors, at, [colors[at], colors[at + 1], colors[at + 2]], COLORS.dirt, road);
    }
  }

  let cursor = 0;
  for (let ix = 0; ix < segments; ix++) {
    for (let iz = 0; iz < segments; iz++) {
      const a = ix * side + iz;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      // Wound counter clockwise seen from above, so the normals point up.
      indices[cursor++] = a;
      indices[cursor++] = b;
      indices[cursor++] = c;
      indices[cursor++] = b;
      indices[cursor++] = d;
      indices[cursor++] = c;
    }
  }

  return { positions, colors, indices, segments };
}

// ============================================================================
// PROPS
// ============================================================================

/**
 * Per chunk prop counts. These are the documented performance budget from
 * design/games/four-wheeler-3d.md: instanced draws only, and a count that
 * keeps 49 loaded chunks inside the frame budget on a phone. They are
 * candidate counts, not caps on the world: props that land on a road, in the
 * lake, on the hub or on a pad are simply not placed there.
 */
export const PROP_BUDGET = { trees: 90, rocks: 25, grass: 400 } as const;

/** One placed prop. `y` is the ground height, so nothing floats. */
export type PlacedProp = {
  x: number;
  z: number;
  y: number;
  /** 0 pine, 1 oak, 2 birch. Rocks and grass always use 0. */
  species: 0 | 1 | 2;
  scale: number;
  rotation: number;
};

export type ChunkProps = {
  trees: PlacedProp[];
  rocks: PlacedProp[];
  grass: PlacedProp[];
};

/** A small integer hash, so a chunk always grows the same trees. */
function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 374761393);
  h = Math.imul(h + (b | 0), 668265263);
  h = Math.imul(h + (c | 0), 2246822519);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

/** The same hash as a 0..1 number. */
function rand01(a: number, b: number, c: number): number {
  return hash3(a, b, c) / 4294967296;
}

/** True where a prop would be in the way or in the water. */
function blocksProps(x: number, z: number): boolean {
  if (roadInfluence(x, z).t > 0) return true;
  if (lakeDistance(x, z) < SHORE_RADIUS + 4) return true;
  if (hubDistance(x, z) < 8) return true;
  if (padInfluence(x, z).t > 0) return true;
  for (const spot of [...TREESTANDS, ...CABINS]) {
    if (Math.hypot(x - spot.x, z - spot.z) < 6) return true;
  }
  return false;
}

/**
 * The trees, rocks and grass for one chunk. The layout comes from a hash of
 * the chunk coordinates, so a chunk that scrolls out of range and back looks
 * exactly the same when it returns.
 */
export function propsForChunk(cx: number, cz: number): ChunkProps {
  const size = WORLD.CHUNK;
  const origin = chunkOrigin(cx, cz);
  const half = size / 2;

  const place = (
    salt: number,
    count: number,
    kind: "trees" | "rocks" | "grass"
  ): PlacedProp[] => {
    const out: PlacedProp[] = [];
    for (let i = 0; i < count; i++) {
      const x = origin.x - half + rand01(cx + salt, cz, i * 3 + 1) * size;
      const z = origin.z - half + rand01(cx, cz + salt, i * 3 + 2) * size;
      if (blocksProps(x, z)) continue;
      const roll = rand01(cx + salt, cz + salt, i * 3 + 3);
      const species: 0 | 1 | 2 =
        kind === "trees" ? ((roll < 0.5 ? 0 : roll < 0.82 ? 1 : 2) as 0 | 1 | 2) : 0;
      const scale =
        kind === "trees"
          ? 0.75 + roll * 0.7
          : kind === "rocks"
            ? 0.5 + roll * 1.1
            : 0.6 + roll * 0.8;
      out.push({
        x,
        z,
        y: heightAt(x, z),
        species,
        scale,
        rotation: roll * Math.PI * 2,
      });
    }
    return out;
  };

  return {
    trees: place(17, PROP_BUDGET.trees, "trees"),
    rocks: place(53, PROP_BUDGET.rocks, "rocks"),
    grass: place(91, PROP_BUDGET.grass, "grass"),
  };
}

/** One straight run of fence. */
export type FenceSegment = { x1: number; z1: number; x2: number; z2: number };

/**
 * The fence around the hub compound. The dock side keeps a 6 m opening so the
 * player can always drive out to the water.
 */
export function hubFenceSegments(): FenceSegment[] {
  const { minX, maxX, minZ, maxZ } = hubBounds;
  const gap = 3;
  return [
    { x1: minX, z1: minZ, x2: maxX, z2: minZ },
    { x1: minX, z1: maxZ, x2: maxX, z2: maxZ },
    { x1: minX, z1: minZ, x2: minX, z2: maxZ },
    // The dock side, split around the opening at z 0.
    { x1: maxX, z1: minZ, x2: maxX, z2: -gap },
    { x1: maxX, z1: gap, x2: maxX, z2: maxZ },
  ];
}
