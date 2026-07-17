/**
 * Hill Climb Racing - Procedural Terrain Generator
 *
 * Uses simplex-noise for smooth, infinite terrain generation.
 */

import { createNoise2D } from 'simplex-noise';
import { TERRAIN } from './constants';

// =============================================================================
// TYPES
// =============================================================================

export interface TerrainPoint {
  x: number;
  y: number;
}

export interface TerrainChunk {
  id: number;
  startX: number;
  endX: number;
  points: TerrainPoint[];
  fuelCanPositions: TerrainPoint[];
  coinPositions: TerrainPoint[];
}

// =============================================================================
// TERRAIN GENERATOR CLASS
// =============================================================================

export class TerrainGenerator {
  private noise2D: ReturnType<typeof createNoise2D>;
  private seed: number;

  constructor(seed: number = Date.now()) {
    this.seed = seed;
    // Create seeded random for noise
    const random = this.createSeededRandom(seed);
    this.noise2D = createNoise2D(random);
  }

  /**
   * Create a seeded random number generator
   */
  private createSeededRandom(seed: number): () => number {
    let s = seed;
    return () => {
      s = Math.sin(s * 9999) * 10000;
      return s - Math.floor(s);
    };
  }

  /**
   * Get terrain height at a given X position.
   *
   * The spawn zone (x < SPAWN_FLAT_UNTIL, including the negative-x chunk) is
   * perfectly flat at SPAWN_Y and blends smoothly into the noise terrain over
   * SPAWN_BLEND_OVER pixels, so the vehicle can never spawn inside a hill.
   */
  getHeightAt(x: number): number {
    const rawHeight = this.getNoiseHeightAt(x);
    const blendStart = TERRAIN.SPAWN_FLAT_UNTIL;
    const blendEnd = TERRAIN.SPAWN_FLAT_UNTIL + TERRAIN.SPAWN_BLEND_OVER;
    if (x <= blendStart) return TERRAIN.SPAWN_Y;
    if (x >= blendEnd) return rawHeight;
    const t = (x - blendStart) / TERRAIN.SPAWN_BLEND_OVER;
    const smooth = t * t * (3 - 2 * t); // smoothstep - no kink at either end
    return TERRAIN.SPAWN_Y * (1 - smooth) + rawHeight * smooth;
  }

  /**
   * Raw noise terrain height, before spawn-zone flattening
   */
  private getNoiseHeightAt(x: number): number {
    // Base noise for large rolling hills
    const baseNoise = this.noise2D(x * TERRAIN.NOISE_SCALE, 0);

    // Detail noise for small bumps
    const detailNoise = this.noise2D(x * TERRAIN.NOISE_SCALE * 4, 100) * 0.3;

    // Combined noise
    const combinedNoise = baseNoise + detailNoise;

    // Calculate difficulty multiplier based on distance
    const distanceFromStart = Math.max(0, x);
    const difficultyMultiplier = Math.min(
      TERRAIN.MAX_AMPLITUDE_MULTIPLIER,
      1 + (distanceFromStart / TERRAIN.DIFFICULTY_SCALE_DISTANCE)
    );

    // Calculate height
    const amplitude = TERRAIN.NOISE_AMPLITUDE * difficultyMultiplier;
    const height = TERRAIN.BASE_Y + combinedNoise * amplitude;

    // Add some steepness variation based on distance
    const steepnessOffset =
      Math.sin(x * TERRAIN.STEEPNESS_INCREASE) *
      amplitude *
      0.3 *
      difficultyMultiplier;

    return height + steepnessOffset;
  }

  /**
   * Generate a terrain chunk
   */
  generateChunk(chunkIndex: number): TerrainChunk {
    const startX = chunkIndex * TERRAIN.CHUNK_WIDTH;
    const endX = startX + TERRAIN.CHUNK_WIDTH;
    const points: TerrainPoint[] = [];

    // Generate terrain points
    const step = TERRAIN.CHUNK_WIDTH / TERRAIN.POINTS_PER_CHUNK;
    for (let i = 0; i <= TERRAIN.POINTS_PER_CHUNK; i++) {
      const x = startX + i * step;
      const y = this.getHeightAt(x);
      points.push({ x, y });
    }

    // Generate fuel can positions
    const fuelCanPositions = this.generateFuelCanPositions(startX, endX, points);

    // Generate coin positions
    const coinPositions = this.generateCoinPositions(startX, endX, points);

    return {
      id: chunkIndex,
      startX,
      endX,
      points,
      fuelCanPositions,
      coinPositions,
    };
  }

  /**
   * Generate fuel can spawn positions for a chunk
   */
  private generateFuelCanPositions(
    startX: number,
    endX: number,
    terrainPoints: TerrainPoint[]
  ): TerrainPoint[] {
    const positions: TerrainPoint[] = [];
    const random = this.createSeededRandom(this.seed + startX);

    // Skip first chunk (starting area)
    if (startX < TERRAIN.CHUNK_WIDTH) return positions;

    // Spawn fuel cans at intervals
    const avgInterval = 300; // Average pixels between fuel cans
    const variance = 100;

    let x = startX + random() * avgInterval;
    while (x < endX) {
      const y = this.getHeightAtFromPoints(x, terrainPoints) - 30;
      positions.push({ x, y });
      x += avgInterval + (random() - 0.5) * variance * 2;
    }

    return positions;
  }

  /**
   * Generate coin spawn positions for a chunk
   */
  private generateCoinPositions(
    startX: number,
    endX: number,
    terrainPoints: TerrainPoint[]
  ): TerrainPoint[] {
    const positions: TerrainPoint[] = [];
    const random = this.createSeededRandom(this.seed + startX + 1000);

    const avgInterval = 150;
    const variance = 50;

    let x = startX + random() * avgInterval;
    while (x < endX) {
      const groundY = this.getHeightAtFromPoints(x, terrainPoints);
      // Vary coin height - some on ground, some in air
      const heightVariation = random() * 80 + 30;
      const y = groundY - heightVariation;
      positions.push({ x, y });
      x += avgInterval + (random() - 0.5) * variance * 2;
    }

    return positions;
  }

  /**
   * Get height from terrain points array (interpolated)
   */
  private getHeightAtFromPoints(x: number, points: TerrainPoint[]): number {
    // Find surrounding points
    for (let i = 0; i < points.length - 1; i++) {
      if (x >= points[i].x && x <= points[i + 1].x) {
        // Linear interpolation
        const t = (x - points[i].x) / (points[i + 1].x - points[i].x);
        return points[i].y + t * (points[i + 1].y - points[i].y);
      }
    }
    return points[points.length - 1].y;
  }

  /**
   * Get the slope angle at a given X position (in radians)
   */
  getSlopeAt(x: number): number {
    const delta = 5;
    const y1 = this.getHeightAt(x - delta);
    const y2 = this.getHeightAt(x + delta);
    return Math.atan2(y2 - y1, delta * 2);
  }
}

// =============================================================================
// TERRAIN RENDERING HELPERS
// =============================================================================

/**
 * Create a canvas path for terrain rendering
 */
export function createTerrainPath(
  ctx: CanvasRenderingContext2D,
  points: TerrainPoint[],
  groundDepth: number = TERRAIN.GROUND_DEPTH
): void {
  if (points.length < 2) return;

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  // Draw the terrain surface
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }

  // Close the path by going down and back
  const lastPoint = points[points.length - 1];
  const firstPoint = points[0];
  ctx.lineTo(lastPoint.x, lastPoint.y + groundDepth);
  ctx.lineTo(firstPoint.x, firstPoint.y + groundDepth);
  ctx.closePath();
}

/**
 * Render terrain with grass effect
 */
export function renderTerrain(
  ctx: CanvasRenderingContext2D,
  points: TerrainPoint[],
  grassColor: string = TERRAIN.GRASS_COLOR,
  dirtColor: string = TERRAIN.DIRT_COLOR
): void {
  if (points.length < 2) return;

  // Create gradient for ground
  const gradient = ctx.createLinearGradient(0, 0, 0, TERRAIN.BASE_Y + 200);
  gradient.addColorStop(0, grassColor);
  gradient.addColorStop(0.1, dirtColor);
  gradient.addColorStop(1, '#3d2817');

  // Fill main terrain
  createTerrainPath(ctx, points);
  ctx.fillStyle = gradient;
  ctx.fill();

  // Draw grass line on top
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.strokeStyle = '#2d5016';
  ctx.lineWidth = 4;
  ctx.stroke();
}
