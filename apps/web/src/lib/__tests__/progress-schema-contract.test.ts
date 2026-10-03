import { describe, expect, it } from "vitest";

import { validateProgress } from "@/lib/progress-schemas";
import type { ValidAppId } from "@hank-neil/db/schema";

/**
 * Store-shape <-> schema contract: every synced store's real getProgress()
 * output must validate against its registered schema. The failure class is
 * silent in dev and loud in prod: a schema describing a shape the store
 * never syncs 400s EVERY signed-in save. joke-generator and weather both
 * shipped that way (schemas required favoriteJokes / favoriteLocations that
 * no store ever produced) — this table stops the next one.
 */
const STORES: [ValidAppId, () => Promise<{ getProgress: () => unknown }>][] = [
  ["2048", () => import("@/games/2048/lib/store").then((m) => m.use2048Store.getState())],
  ["arkanoid", () => import("@/games/arkanoid/lib/store").then((m) => m.useArkanoidStore.getState())],
  ["asteroids", () => import("@/games/asteroids/lib/store").then((m) => m.useAsteroidsStore.getState())],
  ["blitz-bomber", () => import("@/games/blitz-bomber/lib/store").then((m) => m.useBlitzBomberStore.getState())],
  ["bomberman", () => import("@/games/bomberman/lib/store").then((m) => m.useBombermanStore.getState())],
  ["breakout", () => import("@/games/breakout/lib/store").then((m) => m.useBreakoutStore.getState())],
  ["checkers", () => import("@/games/checkers/lib/store").then((m) => m.useCheckersStore.getState())],
  ["chess", () => import("@/games/chess/lib/store").then((m) => m.useChessStore.getState())],
  ["cookie-clicker", () => import("@/games/cookie-clicker/lib/store").then((m) => m.useCookieClickerStore.getState())],
  ["dino-runner", () => import("@/games/dino-runner/lib/store").then((m) => m.useDinoRunnerStore.getState())],
  ["endless-runner", () => import("@/games/endless-runner/lib/store").then((m) => m.useEndlessRunnerStore.getState())],
  ["flappy-bird", () => import("@/games/flappy-bird/lib/store").then((m) => m.useFlappyStore.getState())],
  ["hextris", () => import("@/games/hextris/lib/store").then((m) => m.useHextrisStore.getState())],
  ["hill-climb", () => import("@/games/hill-climb/lib/store").then((m) => m.useHillClimbStore.getState())],
  ["math-attack", () => import("@/games/math-attack/lib/store").then((m) => m.useMathAttackStore.getState())],
  ["memory-match", () => import("@/games/memory-match/lib/store").then((m) => m.useMemoryMatchStore.getState())],
  ["monster-truck", () => import("@/games/monster-truck/lib/store").then((m) => m.useGameStore.getState())],
  ["oregon-trail", () => import("@/games/oregon-trail/lib/store").then((m) => m.useOregonTrailStore.getState())],
  ["platformer", () => import("@/games/platformer/lib/store").then((m) => m.usePlatformerStore.getState())],
  ["quoridor", () => import("@/games/quoridor/lib/store").then((m) => m.useQuoridorStore.getState())],
  ["retro-arcade", () => import("@/games/retro-arcade/lib/store").then((m) => m.useRetroArcadeStore.getState())],
  ["snake", () => import("@/games/snake/lib/store").then((m) => m.useSnakeStore.getState())],
  ["space-invaders", () => import("@/games/space-invaders/lib/store").then((m) => m.useSpaceInvadersStore.getState())],
  ["wordle", () => import("@/games/wordle/lib/store").then((m) => m.useWordleStore.getState())],
  ["drawing-app", () => import("@/apps/drawing-app/lib/store").then((m) => m.useDrawingStore.getState())],
  ["drum-machine", () => import("@/apps/drum-machine/lib/store").then((m) => m.useDrumMachineStore.getState())],
  ["joke-generator", () => import("@/apps/joke-generator/lib/store").then((m) => m.useJokeStore.getState())],
  ["toy-finder", () => import("@/apps/toy-finder/lib/store").then((m) => m.useToyFinderStore.getState())],
  ["trivia", () => import("@/apps/trivia/lib/store").then((m) => m.useTriviaStore.getState())],
  ["virtual-pet", () => import("@/apps/virtual-pet/lib/store").then((m) => m.useVirtualPetStore.getState())],
  ["weather", () => import("@/apps/weather/lib/store").then((m) => m.useWeatherStore.getState())],
  ["achievements", () => import("@/shared/lib/achievements").then((m) => m.useAchievementsStore.getState())],
];

describe("progress schema contract: every store's getProgress() validates", () => {
  it.each(STORES.map(([appId]) => [appId] as const))("%s", async (appId) => {
    const entry = STORES.find(([id]) => id === appId)!;
    const state = await entry[1]();
    const result = validateProgress(appId, state.getProgress());
    expect(result).toEqual(expect.objectContaining({ success: true }));
  });

  it("joke-generator with real saved content (regression for the favoriteJokes drift)", async () => {
    const result = validateProgress("joke-generator", {
      favorites: [
        {
          id: "j1",
          setup: "Why did the bicycle fall over?",
          punchline: "It was two-tired!",
          category: "silly",
          savedAt: Date.now(),
        },
      ],
      ratings: [{ jokeId: "j1", rating: "funny", ratedAt: Date.now() }],
      seenJokeIds: ["j1", "j2"],
      lastCategory: "all",
      jokesViewed: 5,
      jokesCopied: 1,
      jokesShared: 0,
      lastModified: Date.now(),
    });
    expect(result).toEqual(expect.objectContaining({ success: true }));
  });

  it("toy-finder with a real wishlist entry (regression for the wishlist drift)", async () => {
    const result = validateProgress("toy-finder", {
      wishlistItems: [
        { toyId: "toy-42", priority: "high", addedAt: Date.now(), notes: "birthday!" },
        { toyId: "toy-7", priority: "low", addedAt: Date.now() },
      ],
      recentlyViewed: ["toy-42", "toy-7", "toy-9"],
      lastModified: Date.now(),
    });
    expect(result).toEqual(expect.objectContaining({ success: true }));
  });

  it("weather with a real saved location (regression for the favoriteLocations drift)", async () => {
    const result = validateProgress("weather", {
      savedLocations: [
        { name: "New York", latitude: 40.7128, longitude: -74.006, country: "United States", admin1: "New York" },
      ],
      units: "fahrenheit",
      lastLocation: { name: "London", latitude: 51.5, longitude: -0.12 },
      lastModified: Date.now(),
    });
    expect(result).toEqual(expect.objectContaining({ success: true }));
  });
});

describe("every value that a picker offers passes the schema (review wave 4)", () => {
  it("math-attack: every age of the picker (6 and 10 were once refused)", async () => {
    const { DIFFICULTY_SETTINGS } = await import("@/games/math-attack/lib/constants");
    const { useMathAttackStore } = await import("@/games/math-attack/lib/store");
    const ages = Object.keys(DIFFICULTY_SETTINGS);
    expect(ages).toEqual(expect.arrayContaining(["6yo", "10yo"]));
    for (const age of ages) {
      const progress = useMathAttackStore.getState().getProgress();
      const result = validateProgress("math-attack", {
        ...progress,
        settings: { ...progress.settings, difficulty: age },
        lastModified: Date.now(),
      });
      expect(result, age).toEqual(expect.objectContaining({ success: true }));
    }
  });

  it("drum-machine: a beat as long as the + button allows passes; a longer one does not", async () => {
    const { MAX_PATTERN_STEPS } = await import("@/apps/drum-machine/lib/constants");
    const { useDrumMachineStore } = await import("@/apps/drum-machine/lib/store");
    const beat = (steps: number) => ({
      id: "b1",
      name: "Long beat",
      kitId: "hip-hop",
      bpm: 120,
      pattern: { kick: new Array(steps).fill(false), snare: new Array(steps).fill(true) },
      patternLength: steps,
      createdAt: new Date().toISOString(),
    });
    const progress = useDrumMachineStore.getState().getProgress();
    // The old + button had no limit: 4 taps made an 80-step beat.
    for (const steps of [16, 80, MAX_PATTERN_STEPS]) {
      const result = validateProgress("drum-machine", { ...progress, savedBeats: [beat(steps)], lastModified: Date.now() });
      expect(result, String(steps)).toEqual(expect.objectContaining({ success: true }));
    }
    const tooLong = validateProgress("drum-machine", {
      ...progress,
      savedBeats: [beat(MAX_PATTERN_STEPS + 16)],
      lastModified: Date.now(),
    });
    expect(tooLong.success).toBe(false);
  });
});

