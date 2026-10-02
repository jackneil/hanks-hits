/**
 * Writes src/__tests__/fixtures/legacy-saves.json: the localStorage saves
 * that the code of commit 86a1fe0 (before the sync-time fix) wrote, for
 * every synced store. generate.sh unpacks that commit's src and runs this
 * file against it, so the saves come from the old store code, not from a
 * guess. src/__tests__/legacy-save-migration.test.ts loads them into the
 * new stores.
 *
 * Each store gets these saves (all with synthetic data):
 * - untouched: the page loaded, and a screen change wrote the save.
 * - played: a player action changed the progress.
 * - automatic: what the old page did by itself on load (only some stores).
 * - preference: a setting whose old setter did not stamp the time (only
 *   some stores).
 * - more: further saves a kid really makes in some stores (`extra`): 20
 *   jokes read with "next joke", 10 daily visits to a pet that the kid never
 *   fed, a drum beat longer than the server took.
 *
 * The clock: the store modules load at LOAD_TIME, the player plays at
 * PLAY_TIME, and an automatic change runs at AUTOMATIC_TIME.
 */
import { vi } from "vitest";

const LOAD_TIME = Date.UTC(2026, 8, 1, 12, 0, 0);
const PLAY_TIME = Date.UTC(2026, 8, 1, 12, 5, 0);
const AUTOMATIC_TIME = Date.UTC(2026, 8, 1, 13, 0, 0);

vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date(Date.UTC(2026, 8, 1, 12, 0, 0)));
  // Seeded Math.random (ids, the 2048 board), so two runs write the same file.
  let seed = 20260901;
  Math.random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
});

import { it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

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
import { riderResume } from "@/games/four-wheeler-3d/lib/rideTransitions";
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

// The stores are typed loosely on purpose: this file runs against the old
// store code, and the actions it calls exist there.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyStore = { getState: () => any; setState: (state: any, replace?: boolean) => void; getInitialState: () => any };
type Scenario = (store: AnyStore) => void;
type Entry = {
  key: string;
  store: unknown;
  played: Scenario;
  automatic?: Scenario;
  preference?: Scenario;
  extra?: Record<string, Scenario>;
};

const DAY = 24 * 60 * 60 * 1000;

const s = <T,>(store: T) => store as unknown as AnyStore;

const ENTRIES: Record<string, Entry> = {
  "2048": { key: "2048-game-state", store: use2048Store, played: (st) => st.getState().newGame() },
  arkanoid: {
    key: "arkanoid-state",
    store: useArkanoidStore,
    played: (st) => {
      st.getState().startGame();
      st.getState().addScore(120);
      st.getState().endGame();
    },
  },
  asteroids: {
    key: "asteroids-game-state",
    store: useAsteroidsStore,
    played: (st) => {
      st.getState().startGame();
      st.setState({ score: 450 });
      st.getState().gameOver();
    },
    // Game.tsx's sound switch: setProgress with no new time.
    preference: (st) => st.getState().setProgress({ ...st.getState().progress, soundEnabled: false }),
  },
  "blitz-bomber": {
    key: "blitz-bomber-progress",
    store: useBlitzBomberStore,
    played: (st) => {
      st.getState().startGame();
      st.setState({ score: 300 });
      st.getState().crash();
    },
  },
  bomberman: {
    key: "bomberman-state",
    store: useBombermanStore,
    played: (st) => st.getState().startGame(),
    // Game.tsx and BombermanGameShell.tsx: setProgress with no new time.
    preference: (st) => {
      const progress = st.getState().progress;
      st.getState().setProgress({ ...progress, settings: { ...progress.settings, soundEnabled: false } });
    },
  },
  breakout: {
    key: "breakout-game-state",
    store: useBreakoutStore,
    played: (st) => {
      st.getState().startGame();
      st.setState({ score: 250 });
      st.getState().gameOver();
    },
  },
  checkers: {
    key: "checkers-progress",
    store: useCheckersStore,
    played: (st) => st.getState().recordWin("red"),
    preference: (st) => st.getState().setDifficulty("hard"),
  },
  chess: {
    key: "hank-chess-state",
    store: useChessStore,
    played: (st) => st.getState().recordWin(),
    preference: (st) => st.getState().setDifficulty("hard"),
  },
  "cookie-clicker": {
    key: "cookie-clicker-storage",
    store: useCookieClickerStore,
    played: (st) => {
      for (let i = 0; i < 20; i++) st.getState().clickCookie();
      vi.advanceTimersByTime(10);
    },
    // Game.tsx on load: the offline catch-up and the rates.
    automatic: (st) => {
      st.getState().applyOfflineProgress();
      st.setState({ cookiesPerSecond: st.getState().calculateCps(), cookiesPerClick: st.getState().calculateClickPower() });
    },
  },
  "dino-runner": {
    key: "dino-runner-progress",
    store: useDinoRunnerStore,
    played: (st) => {
      st.getState().startGame();
      st.setState({ score: 120, currentRunDistance: 80 });
      st.getState().gameOver();
    },
  },
  "endless-runner": {
    key: "endless-runner-storage",
    store: useEndlessRunnerStore,
    played: (st) => {
      st.getState().startGame();
      st.setState({ score: 300, distance: 100, coinsThisRun: 5 });
      st.getState().endGame();
    },
  },
  "flappy-bird": {
    key: "flappy-bird-progress",
    store: useFlappyStore,
    played: (st) => {
      st.getState().startGame();
      st.setState({ score: 12 });
      st.getState().endGame();
    },
  },
  "four-wheeler-3d": {
    key: "four-wheeler-3d-game-state",
    store: useFourWheeler3dStore,
    played: (st) => st.getState().addMoney(250),
    // AdventureRuntime.tsx saveRiderPosition() on pagehide, before the ride
    // started (the farm flush is empty with no farm on screen).
    automatic: (st) => {
      const state = st.getState();
      const session = useAdventureSession.getState();
      const rider = riderResume(state.progress.adventure, state.mode, session);
      const active = state.progress.adventure.activeVehicleId;
      const driving = rider.mode !== "foot" && active && state.progress.adventure.fleet[active];
      state.updateProgress((p: { adventure: Record<string, unknown> & { fleet: Record<string, object> } }) => ({
        ...p,
        adventure: {
          ...p.adventure,
          rider,
          ...(driving && active
            ? {
                fleet: {
                  ...p.adventure.fleet,
                  [active]: { ...p.adventure.fleet[active], position: rider.position, heading: rider.heading, parked: false },
                },
              }
            : {}),
        },
      }));
    },
  },
  hextris: {
    key: "hextris-game-state",
    store: useHextrisStore,
    played: (st) => {
      st.getState().startGame();
      st.setState({ score: 400 });
      st.getState().gameOver();
    },
  },
  "hill-climb": {
    key: "hill-climb-storage",
    store: useHillClimbStore,
    played: (st) => {
      st.getState().addCoins(100, false);
      st.getState().startRun();
      st.setState({ distance: 320 });
      st.getState().endRun("fuel");
    },
    preference: (st) => st.getState().toggleSound(),
  },
  "math-attack": {
    key: "math-attack-progress",
    store: useMathAttackStore,
    played: (st) => {
      st.getState().startGame(3);
      st.getState().addScore(10, "+");
      st.getState().endGame();
    },
  },
  "memory-match": {
    key: "memory-match-progress",
    store: useMemoryMatchStore,
    // A won game: each pair flipped, with the match check's timer.
    played: (st) => {
      const pairs = new Map<string, number[]>();
      (st.getState().cards as Array<{ imageId: string }>).forEach((card, index) =>
        pairs.set(card.imageId, [...(pairs.get(card.imageId) ?? []), index])
      );
      for (const [first, second] of pairs.values()) {
        st.getState().flipCard(first);
        st.getState().flipCard(second);
        vi.advanceTimersByTime(2_000);
      }
    },
    preference: (st) => st.getState().setDifficulty("hard"),
    extra: { sound: (st) => st.getState().toggleSound() },
  },
  "monster-truck": {
    key: "monster-truck-save",
    store: useMonsterTruckStore,
    played: (st) => {
      st.getState().addCoins(50);
      st.getState().collectStar();
    },
    preference: (st) => st.getState().toggleSound(),
  },
  "oregon-trail": {
    key: "oregon-trail-storage",
    store: useOregonTrailStore,
    played: (st) => {
      st.getState().startGame("Synthetic Kid", "farmer", ["Synthetic A", "Synthetic B"], "april");
      st.getState().buySupply("food", 100);
      st.getState().leaveStore();
    },
    // The title screen's first tap: a phase, and nothing of a journey.
    preference: (st) => st.getState().setPhase("setup_name"),
  },
  platformer: {
    key: "hank-platformer-progress",
    store: usePlatformerStore,
    played: (st) => {
      st.getState().startGame(0);
      st.getState().endGame("death");
    },
  },
  quoridor: {
    key: "quoridor-progress",
    store: useQuoridorStore,
    played: (st) =>
      st.setState({
        progress: { ...st.getState().progress, gamesPlayed: 2, gamesWon: 1, lastModified: Date.now() },
      }),
    preference: (st) => st.getState().setDifficulty("hard"),
  },
  "retro-arcade": {
    key: "retro-arcade-progress",
    store: useRetroArcadeStore,
    played: (st) => st.getState().addFavorite("nes-Synthetic Quest"),
  },
  snake: {
    key: "snake-game-state",
    store: useSnakeStore,
    // Two games (a game over needs a wall, and the walls wrap by default).
    played: (st) =>
      st.setState({
        progress: { ...st.getState().progress, highScore: 40, gamesPlayed: 2, totalFoodEaten: 4, longestSnake: 7, lastModified: Date.now() },
      }),
    preference: (st) => st.getState().setSpeed("fast"),
  },
  "space-invaders": {
    key: "space-invaders-progress",
    store: useSpaceInvadersStore,
    played: (st) => st.getState().nextWave(),
  },
  wordle: {
    key: "wordle-progress",
    store: useWordleStore,
    // A won game: the kid types the word.
    played: (st) => {
      st.getState().startGame();
      for (const letter of st.getState().targetWord as string) st.getState().addLetter(letter);
      st.getState().submitGuess();
    },
    preference: (st) => st.getState().setDifficulty("12yo"),
  },
  "drawing-app": {
    key: "drawing-app-progress",
    store: useDrawingStore,
    played: (st) => st.getState().saveArtwork("data:image/png;base64,AAAA", "Synthetic art"),
  },
  "drum-machine": {
    key: "drum-machine-state",
    store: useDrumMachineStore,
    played: (st) => st.getState().saveBeat("Synthetic beat"),
    extra: {
      // The "+" button had no limit: 4 taps make an 80-step beat.
      "long-beat": (st) => {
        for (let i = 0; i < 4; i++) st.getState().extendPattern();
        st.getState().saveBeat("Synthetic long beat");
      },
    },
    // DrumMachine.tsx's sound switch: setProgress with no new time.
    preference: (st) => {
      const progress = st.getState().progress;
      st.getState().setProgress({ ...progress, settings: { ...progress.settings, soundEnabled: false } });
    },
  },
  "joke-generator": {
    key: "joke-generator-progress",
    store: useJokeStore,
    played: (st) =>
      st.getState().addFavorite({ id: "synthetic-1", setup: "Synthetic setup?", punchline: "Synthetic!", category: "animals" }),
    // JokeGenerator.tsx on load: the first joke shows by itself.
    automatic: (st) => {
      st.getState().markJokeSeen("synthetic-2");
      st.getState().incrementViewed();
    },
    extra: {
      // The kid taps "next joke" 20 times (each tap stamped the time).
      reading: (st) => {
        for (let i = 0; i < 20; i++) {
          vi.advanceTimersByTime(1_000);
          st.getState().markJokeSeen(`synthetic-read-${i}`);
          st.getState().incrementViewed();
        }
      },
    },
  },
  "toy-finder": {
    key: "toy-finder-progress",
    store: useToyFinderStore,
    played: (st) => st.getState().addToWishlist({ id: "synthetic-truck" }, "high"),
  },
  trivia: {
    key: "trivia-progress",
    store: useTriviaStore,
    played: (st) => {
      st.getState().startGame();
      st.getState().answerQuestion(true, 10);
      st.getState().endGame();
    },
  },
  "virtual-pet": {
    key: "virtual-pet-state",
    store: useVirtualPetStore,
    played: (st) => st.getState().renamePet("Synthetic"),
    // VirtualPet.tsx on load: the time update.
    automatic: (st) => st.getState().updateFromTime(),
    extra: {
      // The page opens on 10 days in a row; the kid never feeds or names
      // the pet. Each time update stamped the time.
      visits: (st) => {
        for (let day = 0; day < 10; day++) {
          vi.setSystemTime(new Date(PLAY_TIME + day * DAY));
          st.getState().updateFromTime();
        }
      },
    },
    // VirtualPet.tsx's sound switch: setProgress with no new time.
    preference: (st) => {
      const progress = st.getState().progress;
      st.getState().setProgress({ ...progress, settings: { ...progress.settings, soundEnabled: false } });
    },
  },
  weather: {
    key: "weather-app-progress",
    store: useWeatherStore,
    played: (st) => st.getState().addSavedLocation({ name: "Synthetic Town", latitude: 35.1, longitude: -80.8 }),
  },
  achievements: {
    key: "achievements-progress",
    store: useAchievementsStore,
    played: (st) => st.getState().reportProgress("snake", { gamesPlayed: 1, highScore: 5 }),
  },
};

function capture(entry: Entry, scenario: Scenario, at: number): unknown {
  const store = s(entry.store);
  vi.setSystemTime(new Date(LOAD_TIME));
  useAdventureSession.getState().reset();
  store.setState(store.getInitialState(), true);
  localStorage.removeItem(entry.key);
  vi.setSystemTime(new Date(at));
  scenario(store);
  const raw = localStorage.getItem(entry.key);
  if (raw === null) throw new Error(`${entry.key}: the scenario wrote no save`);
  return JSON.parse(raw);
}

it("writes the saves of the old store code", () => {
  const saves: Record<string, Record<string, unknown>> = {};
  for (const [appId, entry] of Object.entries(ENTRIES)) {
    // The played save comes last: the old Memory Match changed its default
    // progress in place on a win, so a capture after it starts from that.
    saves[appId] = {
      key: entry.key,
      // A screen change (any set) writes the whole save.
      untouched: capture(entry, (store) => store.setState({}), PLAY_TIME),
      ...(entry.automatic ? { automatic: capture(entry, entry.automatic, AUTOMATIC_TIME) } : {}),
      ...(entry.preference ? { preference: capture(entry, entry.preference, PLAY_TIME) } : {}),
      ...Object.fromEntries(
        Object.entries(entry.extra ?? {}).map(([name, scenario]) => [name, capture(entry, scenario, PLAY_TIME)])
      ),
      played: capture(entry, entry.played, PLAY_TIME),
    };
  }
  const out =
    process.env.LEGACY_SAVES_OUT ?? join(__dirname, "../../src/__tests__/fixtures/legacy-saves.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    JSON.stringify(
      {
        note: "Generated by apps/web/scripts/legacy-saves/generate.sh from the store code of a commit before the sync-time fix. Do not edit by hand.",
        commit: process.env.LEGACY_COMMIT ?? "working tree",
        loadTime: LOAD_TIME,
        playTime: PLAY_TIME,
        automaticTime: AUTOMATIC_TIME,
        saves,
      },
      null,
      2
    ) + "\n"
  );
});
