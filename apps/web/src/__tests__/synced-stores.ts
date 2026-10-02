/**
 * Every store that useAuthSync syncs, for the tests of the progress time
 * (store-default-timestamp, legacy-save-migration, progress-stamp-fuzz,
 * page-load-untouched). store-default-timestamp.test.ts fails when a
 * useAuthSync caller in src is missing here, so a new game cannot skip the
 * time rules.
 */
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
import { useAdventureSession } from "@/games/four-wheeler-3d/lib/adventureSession";
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

export type SyncedStore = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getState: () => any;
  setState: (state: unknown, replace?: boolean) => void;
  getInitialState: () => unknown;
  persist: {
    getOptions: () => { name?: string; version?: number };
    rehydrate: () => Promise<void> | void;
  };
};

export type SyncedStoreEntry = {
  appId: string;
  /** The localStorage key (the persist name). */
  key: string;
  store: SyncedStore;
  timeKey: "lastModified" | "updatedAt";
  /** Back to the state of a page load with nothing saved. */
  reset: () => void;
};

function entry(
  appId: string,
  key: string,
  store: unknown,
  timeKey: "lastModified" | "updatedAt" = "lastModified"
): SyncedStoreEntry {
  const typed = store as SyncedStore;
  return {
    appId,
    key,
    store: typed,
    timeKey,
    reset: () => {
      if (appId === "four-wheeler-3d") useAdventureSession.getState().reset();
      typed.setState(typed.getInitialState(), true);
    },
  };
}

export const SYNCED_STORES: readonly SyncedStoreEntry[] = [
  entry("2048", "2048-game-state", use2048Store),
  entry("arkanoid", "arkanoid-state", useArkanoidStore),
  entry("asteroids", "asteroids-game-state", useAsteroidsStore),
  entry("blitz-bomber", "blitz-bomber-progress", useBlitzBomberStore),
  entry("bomberman", "bomberman-state", useBombermanStore),
  entry("breakout", "breakout-game-state", useBreakoutStore),
  entry("checkers", "checkers-progress", useCheckersStore),
  entry("chess", "hank-chess-state", useChessStore),
  entry("cookie-clicker", "cookie-clicker-storage", useCookieClickerStore),
  entry("dino-runner", "dino-runner-progress", useDinoRunnerStore),
  entry("endless-runner", "endless-runner-storage", useEndlessRunnerStore),
  entry("flappy-bird", "flappy-bird-progress", useFlappyStore),
  entry("four-wheeler-3d", "four-wheeler-3d-game-state", useFourWheeler3dStore),
  entry("hextris", "hextris-game-state", useHextrisStore),
  entry("hill-climb", "hill-climb-storage", useHillClimbStore),
  entry("math-attack", "math-attack-progress", useMathAttackStore),
  entry("memory-match", "memory-match-progress", useMemoryMatchStore, "updatedAt"),
  entry("monster-truck", "monster-truck-save", useMonsterTruckStore),
  entry("oregon-trail", "oregon-trail-storage", useOregonTrailStore),
  entry("platformer", "hank-platformer-progress", usePlatformerStore),
  entry("quoridor", "quoridor-progress", useQuoridorStore),
  entry("retro-arcade", "retro-arcade-progress", useRetroArcadeStore),
  entry("snake", "snake-game-state", useSnakeStore),
  entry("space-invaders", "space-invaders-progress", useSpaceInvadersStore),
  entry("wordle", "wordle-progress", useWordleStore),
  entry("drawing-app", "drawing-app-progress", useDrawingStore),
  entry("drum-machine", "drum-machine-state", useDrumMachineStore),
  entry("joke-generator", "joke-generator-progress", useJokeStore),
  entry("toy-finder", "toy-finder-progress", useToyFinderStore),
  entry("trivia", "trivia-progress", useTriviaStore),
  entry("virtual-pet", "virtual-pet-state", useVirtualPetStore),
  entry("weather", "weather-app-progress", useWeatherStore),
  entry("achievements", "achievements-progress", useAchievementsStore),
];

export const syncedStore = (appId: string): SyncedStoreEntry => {
  const found = SYNCED_STORES.find((candidate) => candidate.appId === appId);
  if (!found) throw new Error(`no synced store for ${appId}`);
  return found;
};
