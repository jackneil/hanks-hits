/**
 * Where everything sits in the 3D world.
 *
 * The 2D game runs on a 72,000 x 72,000 field. The 3D world is 4,000 x 4,000 m
 * centred on the origin, so a 2D point (x, y) becomes a 3D point (x, z) with
 *
 *   x3 = (x2 - 36000) / 18        z3 = (y2 - 36000) / 18
 *
 * Every number below is that conversion applied to the matching 2D constant,
 * rounded to whole meters. Keeping the proportions means Hank can find the
 * lake, the hub and the treestands in the same places he already knows.
 */

import { WORLD } from "./constants";

/** A flat world position. The ground height comes from `terrain.heightAt`. */
export type Vec2 = { x: number; z: number };

/** An axis aligned rectangle on the ground plane. */
export type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };

/** Half the world, so bounds checks read clearly. */
export const HALF_WORLD = WORLD.SIZE / 2;

/** The lake in the middle of the map (2D: pond at the centre, r 6480). */
export const LAKE = { x: 0, z: 0, r: 360 } as const;

/**
 * The hub compound: every store, the garage, the house and the dock.
 * Roads leave from here and the ground inside is flat.
 */
export const hubBounds: Rect = {
  minX: -520,
  maxX: -355,
  minZ: -110,
  maxZ: 14,
};

/** Named single spots. Sizes are only given where something needs one. */
export const LANDMARKS = {
  lake: { x: LAKE.x, z: LAKE.z },

  // The yard: garage, trophy room, sell box.
  garage: { x: -400, z: 0 },
  trophyRoom: { x: -400, z: -26 },
  sellBox: { x: -400, z: -12 },

  // Dealers.
  dealership: { x: -437, z: 0 },
  boatDealer: { x: -436, z: -26 },

  // Shops.
  huntStore: { x: -429, z: -44 },
  flyStore: { x: -429, z: -63 },
  anyStore: { x: -448, z: -44 },
  bikeStore: { x: -443, z: -63 },
  bucketShop: { x: -443, z: -94 },
  standStore: { x: -461, z: -14 },
  saddleShop: { x: -462, z: -65 },
  carWash: { x: -496, z: -65 },

  // Home and the farm.
  house: { x: -485, z: -1 },
  dogHouse: { x: -480, z: -22 },
  customGarage: { x: -499, z: -22 },

  // Water and air.
  dockLand: { x: -373, z: 0 },
  dockWater: { x: -355, z: 0 },
  hydrant: { x: -371, z: 8 },
  helipad: { x: -384, z: -59 },
  launchPad: { x: -381, z: -61 },
} as const;

export type LandmarkId = keyof typeof LANDMARKS;

/** The cow pen, drawn as a rectangle with these half extents. */
export const COW_PEN = { x: -429, z: -94, halfX: 8.3, halfZ: 6.1 } as const;

/** The snow wonderland, a circle. */
export const WONDERLAND = { x: -480, z: -41, r: 12 } as const;

/** The horse pen, drawn as a rectangle with this full width and height. */
export const HORSE_PEN = { x: -480, z: -65, w: 20, h: 14 } as const;

/** The airstrip. It points east, so the plane rolls along +x. */
export const RUNWAY = {
  x: -407,
  z: -61,
  length: 60,
  width: 8,
  headingRadians: 0,
} as const;

/** Both ends of the runway centreline, handy for roads and for spawning. */
export const RUNWAY_ENDS: readonly [Vec2, Vec2] = [
  { x: RUNWAY.x - RUNWAY.length / 2, z: RUNWAY.z },
  { x: RUNWAY.x + RUNWAY.length / 2, z: RUNWAY.z },
];

/** Hunting stands, out east and north the way the 2D map has them. */
export const TREESTANDS: readonly Vec2[] = [
  { x: 417, z: -417 },
  { x: 472, z: 222 },
  { x: 222, z: 472 },
  { x: -111, z: 500 },
];

/** How far the six land plots sit from the lake (2D: LAND_RADIUS 16000). */
export const LAND_RADIUS = 889;

/** One side of a starter plot (2D: PLOT_SIZE 1600). */
export const PLOT_SIZE = 89;

/** The six buyable plots, on a ring, 60 degrees apart, starting at 15. */
export const LAND_PLOTS: readonly (Vec2 & { id: string; size: number })[] = [
  0, 1, 2, 3, 4, 5,
].map((index) => {
  const angle = ((15 + index * 60) * Math.PI) / 180;
  return {
    id: `plot-${index + 1}`,
    x: LAKE.x + Math.cos(angle) * LAND_RADIUS,
    z: LAKE.z + Math.sin(angle) * LAND_RADIUS,
    size: PLOT_SIZE,
  };
});

/** Cabins, spread wide so a ride out to one is a real trip. */
export const CABINS: readonly Vec2[] = [0, 1, 2, 3, 4, 5, 6, 7].map((index) => {
  const angle = ((22.5 + index * 45) * Math.PI) / 180;
  const radius = 1050 + (index % 3) * 130;
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
});

// ============================================================================
// LOOPS
// ============================================================================

/** The race track (2D: the dirt loop, TRACK_W 170). */
export const RACE_LOOP = { half: 1979, radius: 29, width: 9.4 } as const;

/** The start line sits at the bottom middle, the same as the 2D game. */
export const RACE_START: Vec2 = { x: 0, z: RACE_LOOP.half };

/** The train circles the very edge of the world. */
export const TRAIN_LOOP = { half: 1992, radius: 20, width: 7 } as const;

/** Where the train stops: the middle of each of the four sides. */
export const TRAIN_STATIONS: readonly (Vec2 & { name: string })[] = [
  { name: "south", x: 0, z: TRAIN_LOOP.half },
  { name: "east", x: TRAIN_LOOP.half, z: 0 },
  { name: "north", x: 0, z: -TRAIN_LOOP.half },
  { name: "west", x: -TRAIN_LOOP.half, z: 0 },
];

/** The branch line that brings the train in toward the hub. */
export const TRAIN_SPUR_END: Vec2 = { x: -503, z: 0 };

/**
 * Walk a rounded rectangle and return `count` points, evenly spaced by
 * distance. Point 0 is the bottom middle (x 0, z +half) and the path runs
 * toward +x from there.
 */
function roundedRectPoints(
  half: number,
  radius: number,
  count: number
): Vec2[] {
  const straight = half - radius;
  // Four half straights + four corners + four half straights, in order.
  const sideLength = 2 * straight;
  const arcLength = (Math.PI / 2) * radius;
  const perimeter = 4 * sideLength + 4 * arcLength;

  const points: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    points.push(pointOnRoundedRect((i / count) * perimeter, half, radius));
  }
  return points;

  function pointOnRoundedRect(distance: number, h: number, r: number): Vec2 {
    const s = h - r;
    const side = 2 * s;
    const arc = (Math.PI / 2) * r;
    // The walk starts at the bottom middle, so the first leg is only half a side.
    const legs: Array<{ length: number; at: (t: number) => Vec2 }> = [
      { length: s, at: (t) => ({ x: t * s, z: h }) },
      { length: arc, at: (t) => arcPoint(s, s, r, Math.PI / 2, -t * (Math.PI / 2)) },
      { length: side, at: (t) => ({ x: h, z: s - t * side }) },
      { length: arc, at: (t) => arcPoint(s, -s, r, 0, -t * (Math.PI / 2)) },
      { length: side, at: (t) => ({ x: s - t * side, z: -h }) },
      {
        length: arc,
        at: (t) => arcPoint(-s, -s, r, -Math.PI / 2, -t * (Math.PI / 2)),
      },
      { length: side, at: (t) => ({ x: -h, z: -s + t * side }) },
      {
        length: arc,
        at: (t) => arcPoint(-s, s, r, Math.PI, -t * (Math.PI / 2)),
      },
      { length: s, at: (t) => ({ x: -s + t * s, z: h }) },
    ];

    let remaining = distance;
    for (const leg of legs) {
      if (remaining <= leg.length || leg === legs[legs.length - 1]) {
        return leg.at(Math.min(1, remaining / leg.length));
      }
      remaining -= leg.length;
    }
    return { x: 0, z: h };
  }

  function arcPoint(
    cx: number,
    cz: number,
    r: number,
    startAngle: number,
    sweep: number
  ): Vec2 {
    const angle = startAngle + sweep;
    return { x: cx + Math.cos(angle) * r, z: cz + Math.sin(angle) * r };
  }
}

/** The race track centreline as a closed ring of points. */
export function raceLoopPoints(n = 400): Vec2[] {
  return roundedRectPoints(RACE_LOOP.half, RACE_LOOP.radius, n);
}

/** The train track centreline as a closed ring of points. */
export function trainLoopPoints(n = 1200): Vec2[] {
  return roundedRectPoints(TRAIN_LOOP.half, TRAIN_LOOP.radius, n);
}

/** The straight branch line from the west station in toward the hub. */
export function trainSpurPoints(n = 320): Vec2[] {
  const west = TRAIN_STATIONS[3];
  const points: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    points.push({
      x: west.x + (TRAIN_SPUR_END.x - west.x) * t,
      z: west.z + (TRAIN_SPUR_END.z - west.z) * t,
    });
  }
  return points;
}

/** True when a point is inside the hub compound. */
export function insideHub(x: number, z: number): boolean {
  return (
    x >= hubBounds.minX &&
    x <= hubBounds.maxX &&
    z >= hubBounds.minZ &&
    z <= hubBounds.maxZ
  );
}

/** The point on the hub edge closest to a target, used as a road start. */
export function hubEdgeToward(target: Vec2): Vec2 {
  return {
    x: Math.min(hubBounds.maxX, Math.max(hubBounds.minX, target.x)),
    z: Math.min(hubBounds.maxZ, Math.max(hubBounds.minZ, target.z)),
  };
}
