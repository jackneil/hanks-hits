import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Bounded calls to real game actions with synthetic scenes/time. These are not
// measured browser frames or a 120 Hz benchmark. Games with durable changes
// must save those changes, while transient steps must make zero physical writes.
const loops = [
  {
    id: "blitz-bomber",
    async load() {
      const { useBlitzBomberStore: store } =
        await import("@/games/blitz-bomber/lib/store");
      return {
        store,
        prime: () => store.setState({}),
        prepare: () => {
          store.getState().startGame();
        },
        step: (update: number) => {
          void update;
          store.getState().update(1000 / 120);
        },
        observe: () => JSON.stringify(store.getState().plane),
      };
    },
  },
  {
    id: "flappy-bird",
    async load() {
      const { useFlappyStore: store } =
        await import("@/games/flappy-bird/lib/store");
      return {
        store,
        prime: () => store.setState({}),
        prepare: () => {
          store.getState().startGame();
        },
        step: (update: number) => {
          void update;
          if (store.getState().bird.y > 250) store.getState().flap();
          store.getState().update(1000 / 120);
        },
        observe: () => JSON.stringify(store.getState().bird),
      };
    },
  },
  {
    id: "hextris",
    async load() {
      const { useHextrisStore: store } =
        await import("@/games/hextris/lib/store");
      return {
        store,
        prime: () => store.setState({}),
        prepare: () => {
          store.getState().startGame();
        },
        step: (update: number) => {
          void update;
          store.getState().update(1000 / 120);
        },
        observe: () => JSON.stringify(store.getState().spawnClock),
      };
    },
  },
  {
    id: "dino-runner",
    async load() {
      const { useDinoRunnerStore: store } =
        await import("@/games/dino-runner/lib/store");
      return {
        store,
        prime: () => store.setState({}),
        prepare: () => {
          store.getState().startGame();
        },
        step: (update: number) => {
          void update;
          store.getState().update(1000 / 120);
        },
        observe: () => JSON.stringify(store.getState().groundOffset),
      };
    },
  },
  {
    id: "asteroids",
    async load() {
      const { useAsteroidsStore: store } =
        await import("@/games/asteroids/lib/store");
      return {
        store,
        prime: () => store.setState({}),
        prepare: () => {
          store.getState().startGame();
          store.getState().setInput({ thrusting: true });
        },
        step: (update: number) => {
          void update;
          store.getState().update();
        },
        observe: () => JSON.stringify(store.getState().ship),
      };
    },
  },
  {
    id: "space-invaders",
    async load() {
      const { useSpaceInvadersStore: store } =
        await import("@/games/space-invaders/lib/store");
      return {
        store,
        prime: () => store.setState({}),
        prepare: () => {
          store.getState().startGame();
        },
        step: (update: number) => {
          void update;
          store.getState().update();
        },
        observe: () => JSON.stringify(store.getState().aliens),
      };
    },
  },
  {
    id: "bomberman",
    async load() {
      const { useBombermanStore: store } =
        await import("@/games/bomberman/lib/store");
      return {
        store,
        prime: () => store.setState({}),
        prepare: () => {
          store.getState().startGame();
        },
        step: (update: number) => {
          void update;
          store.getState().update(1000 / 120);
        },
        observe: () => JSON.stringify(store.getState().enemies),
      };
    },
  },
  {
    id: "breakout",
    async load() {
      const { useBreakoutStore: store } =
        await import("@/games/breakout/lib/store");
      return {
        store,
        prime: () => store.setState({}),
        prepare: () => {
          store.getState().startGame();
          store.getState().launchBall();
        },
        step: (update: number) => {
          void update;
          store.getState().update();
        },
        observe: () => JSON.stringify(store.getState().balls),
      };
    },
  },
  {
    id: "snake",
    async load() {
      const { useSnakeStore: store } = await import("@/games/snake/lib/store");
      return {
        store,
        prime: () => store.setState({}),
        prepare: () => {
          store.getState().startGame();
          store.setState({ food: { x: 0, y: 0 } });
        },
        step: (update: number) => {
          void update;
          store.getState().tick();
        },
        observe: () => JSON.stringify(store.getState().snake),
      };
    },
  },
  {
    id: "platformer",
    async load() {
      const { usePlatformerStore: store } =
        await import("@/games/platformer/lib/store");
      return {
        store,
        prime: () => store.setState({}),
        prepare: () => {
          store.getState().startGame();
          store.getState().setMovingRight(true);
        },
        step: (update: number) => {
          void update;
          store.getState().update(1000 / 120);
        },
        observe: () => JSON.stringify(store.getState().player),
      };
    },
  },
  {
    id: "endless-runner",
    async load() {
      const { useEndlessRunnerStore: store } =
        await import("@/games/endless-runner/lib/store");
      return {
        store,
        prime: () => store.setState({}),
        prepare: () => {
          store.getState().startGame();
          store.setState({ obstacles: [], coins: [], nextObstacleX: 1e9 });
        },
        step: (update: number) => {
          void update;
          store.getState().update(1000 / 120);
        },
        observe: () => JSON.stringify(store.getState().distance),
      };
    },
  },
  {
    id: "four-wheeler-3d",
    async load() {
      const { useFourWheeler3dStore: store } =
        await import("@/games/four-wheeler-3d/lib/store");
      return {
        store,
        prime: () => store.setState({}),
        prepare: () => {
          store.getState().seedClock();
        },
        step: (update: number) => {
          void update;
          store.getState().tick(1 / 120);
        },
        observe: () => JSON.stringify(store.getState().clock),
      };
    },
  },
  {
    id: "memory-match",
    async load() {
      const { useMemoryMatchStore: store } =
        await import("@/games/memory-match/lib/store");
      return {
        store,
        prime: () => store.setState({}),
        prepare: () => {
          store.getState().newGame();
          store.getState().flipCard(0);
        },
        step: (update: number) => {
          void update;
          vi.setSystemTime(100000 + (update + 1) * 100);
          store.getState().tick();
        },
        observe: () => JSON.stringify(store.getState().currentTime),
      };
    },
  },
];

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(100000);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("real gameplay actions only save changed progress", () => {
  for (const entry of loops)
    it(entry.id, async () => {
      const { store, prime, prepare, step, observe } = await entry.load();
      const { ownerBoundProgress: authority } =
        await import("@/lib/owner-bound-progress");
      const key = store.persist.getOptions().name!;
      await authority.updateSession("unauthenticated");
      await authority.whenHydrated(key);
      expect(store.persist.hasHydrated()).toBe(true);
      prepare();
      prime();
      const progress = () => JSON.stringify(store.getState().getProgress());
      const writes = vi.spyOn(localStorage, "setItem");
      let movingSteps = 0;
      let transientSteps = 0;
      for (let update = 0; update < 120; update++) {
        const before = progress();
        const motion = observe();
        writes.mockClear();
        vi.setSystemTime(
          100000 +
            (update + 1) *
              (["asteroids", "space-invaders", "breakout"].includes(entry.id)
                ? 1000 / 60
                : 1000 / 120),
        );
        step(update);
        if (observe() !== motion) movingSteps++;
        if (before === progress()) {
          transientSteps++;
          expect(
            writes,
            `unchanged progress at update ${update}`,
          ).toHaveBeenCalledTimes(0);
        } else expect(writes.mock.calls.length).toBeGreaterThan(0);
        const saved = JSON.parse(authority.readScoped(key)!).state;
        expect(saved.progress ?? saved).toMatchObject(JSON.parse(progress()));
      }
      // Alien/grid enemies move on coarse timers, not every frame.
      expect(movingSteps).toBeGreaterThanOrEqual(
        ["space-invaders", "bomberman"].includes(entry.id) ? 2 : 60,
      );
      expect(transientSteps).toBeGreaterThan(100);
    });
});
