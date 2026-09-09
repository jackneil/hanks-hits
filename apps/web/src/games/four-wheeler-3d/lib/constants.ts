/**
 * Shared numbers for Four-Wheeler Adventure 3D.
 *
 * Units are meters and seconds.
 */

/** The world is a 32 x 32 grid of 128 m chunks. */
export const WORLD = {
  SIZE: 4000,
  CHUNK: 128,
  CHUNKS: 32,
} as const;

/*
 * Units and the scale factor (design/games/four-wheeler-3d.md).
 *
 * POSITION: the 2D world is 72,000 x 72,000 units and the 3D world is
 * 4,000 x 4,000 m, so a 2D position converts with
 *   SCALE.POS = 4000 / 72000 = 1/18.
 * Every landmark keeps its proportional place: the lake at the center, the
 * treestands to the east, six plots on spokes about 780 m out (2D: 14,000
 * units), and the hub between them.
 *
 * SPEED: ground speeds do NOT use the position factor. The 2D game runs in
 * units per frame with joke labels (the tractor's 7.14 is labeled "exactly
 * 100 mph"). A literal conversion makes the ATV 190 m/s, which is unplayable
 * in third person. SCALE.SPEED = 0.38 converts a 2D `max` (units per frame)
 * to meters per second and keeps the ORDER and the RATIOS of the whole
 * roster: ATV 21.9 m/s (about 49 mph), UTV 24.6, truck 19.6, race car 42.6,
 * muscle 34.2, moto 28.5, Lambo 35.3, semi 17.1, fire truck 17.5, monster
 * 21.3, RV 19.0, tractor 2.7. Accel and brake use the same factor per second.
 * On foot is fixed at 3 m/s walk and 5 m/s run, because the 2D ratio would be
 * a 1 m/s crawl in 3D.
 */
export const SCALE = {
  POS: 4000 / 72000,
  SPEED: 0.38,
} as const;

/*
 * Performance budget (design/games/four-wheeler-3d.md).
 *
 * These are measured budgets, not arbitrary caps. The streamer keeps a 7 x 7
 * window of chunks around the player, which is 49 chunks, about 450 m of
 * visible ground in every direction. Far fog and the chunk LOD hide the edge.
 * Each chunk is a 32 x 32 grid, so the collider and the mesh both sample the
 * ground every 4 m. Nothing here silently drops world content: chunks outside
 * the window still exist and load again the moment the player rides back.
 */
export const CHUNK_SEGMENTS = 32;
export const CHUNK_VIEW_RADIUS = 3;

/** Beyond this many meters a tree draws as a cheap billboard cone. */
export const TREE_LOD_DISTANCE = 200;

/** The LOD split is only recomputed every this many frames. */
export const LOD_FRAME_INTERVAL = 10;

/** Starting cash, the same as the 2D game. */
export const START_MONEY = 20000;

/** One in-game day lasts this many real minutes. */
export const DAY_MINUTES = 24;

export const FISH_TYPES = [
  "little",
  "middle",
  "big",
  "huge",
  "rainbow",
] as const;
export type FishType = (typeof FISH_TYPES)[number];

export const PLOT_IDS = [
  "plot-1",
  "plot-2",
  "plot-3",
  "plot-4",
  "plot-5",
  "plot-6",
] as const;
export type PlotId = (typeof PLOT_IDS)[number];

export const BUILDING_KINDS = [
  "garage",
  "trophy",
  "house-small",
  "house-medium",
  "house-huge",
] as const;
export type BuildingKind = (typeof BUILDING_KINDS)[number];
