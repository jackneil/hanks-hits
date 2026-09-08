import { describe, it, expect } from "vitest";

import { WORLD } from "../lib/constants";
import { LAKE, hubBounds, insideHub } from "../lib/landmarks";
import {
  SHORE_RADIUS,
  buildChunkGeometryData,
  buildChunkHeights,
  chunkCoordsFor,
  chunkKey,
  chunkOrigin,
  heightAt,
  hubFenceSegments,
  isRoad,
  propsForChunk,
  roadInfluence,
  surfaceAt,
} from "../lib/terrain";

/** A spot on the ring road around the lake, well away from any junction. */
const RING_ANGLE = 1.0;
const RING = {
  x: Math.cos(RING_ANGLE) * 430,
  z: Math.sin(RING_ANGLE) * 430,
};

describe("four-wheeler-3d terrain height", () => {
  it("gives the same height every time it is asked", () => {
    for (const [x, z] of [
      [0, 0],
      [123.4, -567.8],
      [1500, 1500],
      [-1999, 42],
    ]) {
      expect(heightAt(x, z)).toBe(heightAt(x, z));
    }
  });

  it("digs the lake below the water line and keeps the land above it", () => {
    expect(heightAt(LAKE.x, LAKE.z)).toBeLessThan(0);
    expect(heightAt(LAKE.x, LAKE.z)).toBeGreaterThanOrEqual(-6);
    expect(heightAt(500, 0)).toBeGreaterThan(0);
    expect(heightAt(0, 500)).toBeGreaterThan(0);
    expect(heightAt(-354, 354)).toBeGreaterThan(0);
  });

  it("keeps the hub compound flat", () => {
    const samples = [
      [hubBounds.minX + 1, hubBounds.minZ + 1],
      [hubBounds.maxX - 1, hubBounds.maxZ - 1],
      [-400, 0],
      [-460, -60],
      [-500, -100],
    ];
    for (const [x, z] of samples) {
      expect(insideHub(x, z)).toBe(true);
      expect(Math.abs(heightAt(x, z) - 2)).toBeLessThan(0.05);
    }
  });

  it("flattens a road ribbon so nothing steps up beside it", () => {
    expect(isRoad(RING.x, RING.z)).toBe(true);
    const outward = {
      x: RING.x + 3 * Math.cos(RING_ANGLE),
      z: RING.z + 3 * Math.sin(RING_ANGLE),
    };
    const difference = Math.abs(
      heightAt(RING.x, RING.z) - heightAt(outward.x, outward.z)
    );
    expect(difference).toBeLessThan(0.3);
    expect(roadInfluence(RING.x, RING.z).t).toBeGreaterThan(0.9);
    expect(roadInfluence(1500, 1500).t).toBe(0);
  });

  it("names the surface under a point", () => {
    expect(surfaceAt(LAKE.x, LAKE.z)).toBe("water");
    expect(surfaceAt(SHORE_RADIUS + 3, 0)).toBe("sand");
    expect(surfaceAt(RING.x, RING.z)).toBe("dirt");
    expect(surfaceAt(1500, 1500)).toBe("grass");
  });
});

describe("four-wheeler-3d terrain chunks", () => {
  it("maps world positions to chunks", () => {
    expect(chunkKey(2, -3)).toBe("2,-3");
    expect(chunkCoordsFor(0, 0)).toEqual({ cx: 0, cz: 0 });
    expect(chunkCoordsFor(-1, -1)).toEqual({ cx: -1, cz: -1 });
    const origin = chunkOrigin(2, -3);
    expect(origin.x).toBe(2 * WORLD.CHUNK + WORLD.CHUNK / 2);
    expect(origin.z).toBe(-3 * WORLD.CHUNK + WORLD.CHUNK / 2);
    expect(chunkCoordsFor(origin.x, origin.z)).toEqual({ cx: 2, cz: -3 });
  });

  it("matches the heights of two neighbouring chunks sample for sample", () => {
    const segments = 32;
    const side = segments + 1;
    const left = buildChunkHeights(4, 4, segments).heights;
    const right = buildChunkHeights(5, 4, segments).heights;
    for (let iz = 0; iz < side; iz++) {
      expect(right[iz]).toBe(left[iz + side * segments]);
    }

    const near = buildChunkHeights(4, 5, segments).heights;
    for (let ix = 0; ix < side; ix++) {
      expect(near[side * ix]).toBe(left[segments + side * ix]);
    }
  });

  it("builds a mesh that samples the same grid as the collider", () => {
    const segments = 8;
    const { positions, colors, indices } = buildChunkGeometryData(6, -2, segments);
    const side = segments + 1;
    expect(positions).toHaveLength(side * side * 3);
    expect(colors).toHaveLength(side * side * 3);
    expect(indices).toHaveLength(segments * segments * 6);

    const heights = buildChunkHeights(6, -2, segments).heights;
    for (let ix = 0; ix < side; ix++) {
      for (let iz = 0; iz < side; iz++) {
        const at = (ix * side + iz) * 3;
        expect(positions[at + 1]).toBe(heights[iz + side * ix]);
      }
    }
  });
});

describe("four-wheeler-3d props", () => {
  const CHUNKS: Array<[number, number]> = [
    [3, 3],
    [-4, 1],
    [0, -6],
    [8, -8],
  ];

  it("grows the same chunk the same way every time", () => {
    for (const [cx, cz] of CHUNKS) {
      expect(propsForChunk(cx, cz)).toEqual(propsForChunk(cx, cz));
    }
  });

  it("never puts a prop on a road, in the lake, or on the hub", () => {
    for (const [cx, cz] of CHUNKS) {
      const { trees, rocks, grass } = propsForChunk(cx, cz);
      for (const prop of [...trees, ...rocks, ...grass]) {
        expect(roadInfluence(prop.x, prop.z).t).toBe(0);
        expect(Math.hypot(prop.x - LAKE.x, prop.z - LAKE.z)).toBeGreaterThan(
          SHORE_RADIUS
        );
        expect(insideHub(prop.x, prop.z)).toBe(false);
        expect(prop.y).toBe(heightAt(prop.x, prop.z));
      }
    }
  });

  it("puts nothing in the middle of the lake", () => {
    const { trees, rocks, grass } = propsForChunk(0, 0);
    expect(trees).toHaveLength(0);
    expect(rocks).toHaveLength(0);
    expect(grass).toHaveLength(0);
  });

  it("leaves a gap in the hub fence on the dock side", () => {
    const fence = hubFenceSegments();
    expect(fence.length).toBeGreaterThan(4);
    const dockSide = fence.filter(
      (segment) => segment.x1 === hubBounds.maxX && segment.x2 === hubBounds.maxX
    );
    expect(dockSide).toHaveLength(2);
    const gap = Math.abs(dockSide[0].z2 - dockSide[1].z1);
    expect(gap).toBe(6);
  });
});
