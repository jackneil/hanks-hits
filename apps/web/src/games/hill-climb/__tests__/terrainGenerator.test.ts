import { describe, it, expect } from "vitest";
import { TerrainGenerator } from "../lib/terrainGenerator";
import { TERRAIN, PHYSICS } from "../lib/constants";

// The vehicle spawns at x=200: chassis y=300, head at y=300+HEAD_OFFSET_Y.
// If terrain can rise above the spawn point the truck starts embedded in a
// hill, Matter ejects it, and the head clips terrain -> instant CRASH on
// every run (2026-07-11 audit). These tests pin the spawn zone flat and safe
// across many seeds, forever.
describe("hill-climb terrain spawn safety", () => {
  const SEEDS = Array.from({ length: 50 }, (_, i) => i * 7919 + 1);

  it("spawn zone is perfectly flat at SPAWN_Y for every seed", () => {
    for (const seed of SEEDS) {
      const gen = new TerrainGenerator(seed);
      for (let x = -800; x <= TERRAIN.SPAWN_FLAT_UNTIL; x += 40) {
        expect(gen.getHeightAt(x)).toBe(TERRAIN.SPAWN_Y);
      }
    }
  });

  it("terrain at spawn stays safely below the driver's head", () => {
    const headY = 300 + PHYSICS.HEAD_OFFSET_Y; // spawn chassis y=300
    for (const seed of SEEDS) {
      const gen = new TerrainGenerator(seed);
      // head bottom edge must be well above the surface at spawn
      expect(gen.getHeightAt(200)).toBeGreaterThan(headY + PHYSICS.HEAD_RADIUS);
    }
  });

  it("blend zone transitions smoothly (no cliff at the seam)", () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const gen = new TerrainGenerator(seed);
      let prev = gen.getHeightAt(TERRAIN.SPAWN_FLAT_UNTIL);
      const step = 10;
      for (
        let x = TERRAIN.SPAWN_FLAT_UNTIL + step;
        x <= TERRAIN.SPAWN_FLAT_UNTIL + TERRAIN.SPAWN_BLEND_OVER;
        x += step
      ) {
        const h = gen.getHeightAt(x);
        // continuity: natural hills reach ~40-50px per 10px, so anything
        // beyond 60 means the flat->noise seam itself jumped (a cliff)
        expect(Math.abs(h - prev)).toBeLessThan(60);
        prev = h;
      }
    }
  });

  it("far terrain still varies (flattening did not kill the hills)", () => {
    const gen = new TerrainGenerator(12345);
    const heights = [];
    for (let x = 2000; x < 6000; x += 100) heights.push(gen.getHeightAt(x));
    const min = Math.min(...heights);
    const max = Math.max(...heights);
    expect(max - min).toBeGreaterThan(50);
  });
});
