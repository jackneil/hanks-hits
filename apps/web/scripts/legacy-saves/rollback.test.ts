/**
 * Loads src/__tests__/fixtures/new-saves.json (saves of the new store code)
 * with the store code of an OLDER commit, and writes what that code did to
 * src/__tests__/fixtures/rollback-loads.json. rollback.sh unpacks an older
 * commit (default: the merge base with origin/master, the code before this
 * branch) and runs this file against it: a rollback of the deploy, or a tab
 * that still runs the old code.
 *
 * For each save it records:
 * - errors: what the old code logged with console.error on load (a persist
 *   version it cannot migrate loads the defaults and logs an error);
 * - loaded: getProgress() of the old store after the load;
 * - rewritten: the save that the old store writes on its next change.
 * It also plays on (playedOn): the old Oregon Trail store keeps keys that
 * it does not know, so the save it writes after the kid's next change keeps
 * the new code's marker and time.
 * src/__tests__/rollback-safety.test.ts holds the results to the rules.
 */
import { vi } from "vitest";

vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.UTC(2026, 9, 4, 12, 0, 0)));
});

import { it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { use2048Store } from "@/games/2048/lib/store";
import { useArkanoidStore } from "@/games/arkanoid/lib/store";
import { useAsteroidsStore } from "@/games/asteroids/lib/store";
import { useBlitzBomberStore } from "@/games/blitz-bomber/lib/store";
import { useBombermanStore } from "@/games/bomberman/lib/store";
import { useBreakoutStore } from "@/games/breakout/lib/store";
import { useCheckersStore } from "@/games/checkers/lib/store";
import { useChessStore } from "@/games/chess/lib/store";
import { useCookieClickerStore } from "@/games/cookie-clicker/lib/store";
import { useDinoRunnerStore } from "@/games/dino-runner/lib/store";
import { useEndlessRunnerStore } from "@/games/endless-runner/lib/store";
import { useFlappyStore } from "@/games/flappy-bird/lib/store";
import { useFourWheeler3dStore } from "@/games/four-wheeler-3d/lib/store";
import { useHextrisStore } from "@/games/hextris/lib/store";
import { useHillClimbStore } from "@/games/hill-climb/lib/store";
import { useMathAttackStore } from "@/games/math-attack/lib/store";
import { useMemoryMatchStore } from "@/games/memory-match/lib/store";
import { useGameStore as useMonsterTruckStore } from "@/games/monster-truck/lib/store";
import { useOregonTrailStore } from "@/games/oregon-trail/lib/store";
import { usePlatformerStore } from "@/games/platformer/lib/store";
import { useQuoridorStore } from "@/games/quoridor/lib/store";
import { useRetroArcadeStore } from "@/games/retro-arcade/lib/store";
import { useSnakeStore } from "@/games/snake/lib/store";
import { useSpaceInvadersStore } from "@/games/space-invaders/lib/store";
import { useWordleStore } from "@/games/wordle/lib/store";
import { useDrawingStore } from "@/apps/drawing-app/lib/store";
import { useDrumMachineStore } from "@/apps/drum-machine/lib/store";
import { useJokeStore } from "@/apps/joke-generator/lib/store";
import { useToyFinderStore } from "@/apps/toy-finder/lib/store";
import { useTriviaStore } from "@/apps/trivia/lib/store";
import { useVirtualPetStore } from "@/apps/virtual-pet/lib/store";
import { useWeatherStore } from "@/apps/weather/lib/store";
import { useAchievementsStore } from "@/shared/lib/achievements/store";

// Typed loosely on purpose: this file runs against the old store code.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyStore = { getState: () => any; setState: (state: any, replace?: boolean) => void; getInitialState: () => any; persist: { rehydrate: () => Promise<void> | void } };

const STORES: Record<string, unknown> = {
  "2048": use2048Store,
  arkanoid: useArkanoidStore,
  asteroids: useAsteroidsStore,
  "blitz-bomber": useBlitzBomberStore,
  bomberman: useBombermanStore,
  breakout: useBreakoutStore,
  checkers: useCheckersStore,
  chess: useChessStore,
  "cookie-clicker": useCookieClickerStore,
  "dino-runner": useDinoRunnerStore,
  "endless-runner": useEndlessRunnerStore,
  "flappy-bird": useFlappyStore,
  "four-wheeler-3d": useFourWheeler3dStore,
  hextris: useHextrisStore,
  "hill-climb": useHillClimbStore,
  "math-attack": useMathAttackStore,
  "memory-match": useMemoryMatchStore,
  "monster-truck": useMonsterTruckStore,
  "oregon-trail": useOregonTrailStore,
  platformer: usePlatformerStore,
  quoridor: useQuoridorStore,
  "retro-arcade": useRetroArcadeStore,
  snake: useSnakeStore,
  "space-invaders": useSpaceInvadersStore,
  wordle: useWordleStore,
  "drawing-app": useDrawingStore,
  "drum-machine": useDrumMachineStore,
  "joke-generator": useJokeStore,
  "toy-finder": useToyFinderStore,
  trivia: useTriviaStore,
  "virtual-pet": useVirtualPetStore,
  weather: useWeatherStore,
  achievements: useAchievementsStore,
};

type NewSaves = Record<string, { key: string; saves: Record<string, { raw: string }> }>;

/** When the kid plays on, on the old code (a week after the new code's saves). */
const PLAYED_ON_AT = Date.UTC(2026, 9, 10, 9, 0, 0);

it("loads the new saves with the old store code", async () => {
  const fixtures = join(__dirname, "../../src/__tests__/fixtures");
  const input = JSON.parse(readFileSync(join(fixtures, "new-saves.json"), "utf8")).saves as NewSaves;
  const errors: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" ").slice(0, 200));
  });
  const out: Record<string, Record<string, unknown>> = {};
  for (const [appId, entry] of Object.entries(input)) {
    const store = STORES[appId] as AnyStore | undefined;
    if (!store) throw new Error(`the old code has no store for ${appId}`);
    out[appId] = {};
    for (const [name, save] of Object.entries(entry.saves)) {
      errors.length = 0;
      store.setState(store.getInitialState(), true);
      localStorage.clear();
      localStorage.setItem(entry.key, save.raw);
      await store.persist.rehydrate();
      const loaded = JSON.parse(JSON.stringify(store.getState().getProgress()));
      const loadErrors = [...errors];
      store.setState({});
      out[appId][name] = {
        errors: loadErrors,
        loaded,
        rewritten: localStorage.getItem(entry.key),
      };
    }
    store.setState(store.getInitialState(), true);
    localStorage.clear();
  }

  // The kid plays on, on the old code, a week after the new code's save.
  const playedOn: Record<string, unknown> = {};
  {
    const store = STORES["oregon-trail"] as AnyStore;
    const entry = input["oregon-trail"];
    vi.setSystemTime(new Date(PLAYED_ON_AT));
    store.setState(store.getInitialState(), true);
    localStorage.clear();
    localStorage.setItem(entry.key, entry.saves.played.raw);
    await store.persist.rehydrate();
    store.getState().setPace("grueling");
    store.getState().rest();
    playedOn["oregon-trail"] = {
      at: PLAYED_ON_AT,
      loaded: JSON.parse(JSON.stringify(store.getState().getProgress())),
      rewritten: localStorage.getItem(entry.key),
    };
    store.setState(store.getInitialState(), true);
    localStorage.clear();
  }
  spy.mockRestore();
  writeFileSync(
    join(fixtures, "rollback-loads.json"),
    JSON.stringify(
      {
        note: "Generated by apps/web/scripts/legacy-saves/rollback.sh: the new saves loaded by the store code of an older commit. Do not edit by hand.",
        commit: process.env.LEGACY_COMMIT ?? "working tree",
        loads: out,
        playedOn,
      },
      null,
      2
    ) + "\n"
  );
});
