/** Actual stores: coverage is checked against the persist source scan. */
export const persistedStores = [
  {
    file: "apps/drawing-app/lib/store.ts",
    load: async () =>
      (await import("@/apps/drawing-app/lib/store")).useDrawingStore,
  },
  {
    file: "apps/toy-finder/lib/store.ts",
    load: async () =>
      (await import("@/apps/toy-finder/lib/store")).useToyFinderStore,
  },
  {
    file: "apps/joke-generator/lib/store.ts",
    load: async () =>
      (await import("@/apps/joke-generator/lib/store")).useJokeStore,
  },
  {
    file: "apps/drum-machine/lib/store.ts",
    load: async () =>
      (await import("@/apps/drum-machine/lib/store")).useDrumMachineStore,
  },
  {
    file: "apps/trivia/lib/store.ts",
    load: async () => (await import("@/apps/trivia/lib/store")).useTriviaStore,
  },
  {
    file: "apps/virtual-pet/lib/store.ts",
    load: async () =>
      (await import("@/apps/virtual-pet/lib/store")).useVirtualPetStore,
  },
  {
    file: "apps/weather/lib/store.ts",
    load: async () =>
      (await import("@/apps/weather/lib/store")).useWeatherStore,
  },
  {
    file: "games/snake/lib/store.ts",
    load: async () => (await import("@/games/snake/lib/store")).useSnakeStore,
  },
  {
    file: "shared/lib/achievements/store.ts",
    load: async () =>
      (await import("@/shared/lib/achievements/store")).useAchievementsStore,
  },
  {
    file: "games/flappy-bird/lib/store.ts",
    load: async () =>
      (await import("@/games/flappy-bird/lib/store")).useFlappyStore,
  },
  {
    file: "games/bomberman/lib/store.ts",
    load: async () =>
      (await import("@/games/bomberman/lib/store")).useBombermanStore,
  },
  {
    file: "games/chess/lib/store.ts",
    load: async () => (await import("@/games/chess/lib/store")).useChessStore,
  },
  {
    file: "games/breakout/lib/store.ts",
    load: async () =>
      (await import("@/games/breakout/lib/store")).useBreakoutStore,
  },
  {
    file: "games/blitz-bomber/lib/store.ts",
    load: async () =>
      (await import("@/games/blitz-bomber/lib/store")).useBlitzBomberStore,
  },
  {
    file: "games/dino-runner/lib/store.ts",
    load: async () =>
      (await import("@/games/dino-runner/lib/store")).useDinoRunnerStore,
  },
  {
    file: "games/quoridor/lib/store.ts",
    load: async () =>
      (await import("@/games/quoridor/lib/store")).useQuoridorStore,
  },
  {
    file: "games/math-attack/lib/store.ts",
    load: async () =>
      (await import("@/games/math-attack/lib/store")).useMathAttackStore,
  },
  {
    file: "games/arkanoid/lib/store.ts",
    load: async () =>
      (await import("@/games/arkanoid/lib/store")).useArkanoidStore,
  },
  {
    file: "games/oregon-trail/lib/store.ts",
    load: async () =>
      (await import("@/games/oregon-trail/lib/store")).useOregonTrailStore,
  },
  {
    file: "games/memory-match/lib/store.ts",
    load: async () =>
      (await import("@/games/memory-match/lib/store")).useMemoryMatchStore,
  },
  {
    file: "games/checkers/lib/store.ts",
    load: async () =>
      (await import("@/games/checkers/lib/store")).useCheckersStore,
  },
  {
    file: "games/monster-truck/lib/store.ts",
    load: async () =>
      (await import("@/games/monster-truck/lib/store")).useGameStore,
  },
  {
    file: "games/hill-climb/lib/store.ts",
    load: async () =>
      (await import("@/games/hill-climb/lib/store")).useHillClimbStore,
  },
  {
    file: "games/2048/lib/store.ts",
    load: async () => (await import("@/games/2048/lib/store")).use2048Store,
  },
  {
    file: "games/retro-arcade/lib/store.ts",
    load: async () =>
      (await import("@/games/retro-arcade/lib/store")).useRetroArcadeStore,
  },
  {
    file: "games/endless-runner/lib/store.ts",
    load: async () =>
      (await import("@/games/endless-runner/lib/store")).useEndlessRunnerStore,
  },
  {
    file: "games/platformer/lib/store.ts",
    load: async () =>
      (await import("@/games/platformer/lib/store")).usePlatformerStore,
  },
  {
    file: "games/asteroids/lib/store.ts",
    load: async () =>
      (await import("@/games/asteroids/lib/store")).useAsteroidsStore,
  },
  {
    file: "games/space-invaders/lib/store.ts",
    load: async () =>
      (await import("@/games/space-invaders/lib/store")).useSpaceInvadersStore,
  },
  {
    file: "games/cookie-clicker/lib/store.ts",
    load: async () =>
      (await import("@/games/cookie-clicker/lib/store")).useCookieClickerStore,
  },
  {
    file: "games/hextris/lib/store.ts",
    load: async () =>
      (await import("@/games/hextris/lib/store")).useHextrisStore,
  },
  {
    file: "games/wordle/lib/store.ts",
    load: async () => (await import("@/games/wordle/lib/store")).useWordleStore,
  },
  {
    file: "games/four-wheeler-3d/lib/store.ts",
    load: async () =>
      (await import("@/games/four-wheeler-3d/lib/store")).useFourWheeler3dStore,
  },
] as const;
