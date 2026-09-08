import { create } from "zustand";
import { persist } from "zustand/middleware";

import { FISH_TYPES, START_MONEY } from "./constants";
import {
  advanceClock,
  rollWeather,
  updateSnowLevel,
  type Weather,
} from "./dayNight";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Everything that syncs to the cloud. The index signature keeps the type
 * compatible with AppProgressData, the same way monster-truck does it.
 */
export type FourWheeler3dProgress = {
  [key: string]: unknown;
  money: number;
  totalEarned: number;
  ownedVehicles: string[]; // vehicle ids
  currentVehicle: string;
  paint: string; // hex color
  trophies: number; // skulls on the wall
  fishCaught: Record<string, number>; // little, middle, big, huge, rainbow
  biggestFish: string;
  bestRaceTimeMs: number; // 0 = none
  racesWon: number;
  airPoints: number;
  land: Record<string, { size: number; slots: string[] }>; // plot id -> built
  hunger: number; // 0..100
  day: number;
  timeOfDay: number; // 0..24
  weather: string;
  settings: { soundEnabled: boolean; tiltEnabled: boolean; helmetCam: boolean };
  lastModified: number;
};

/** What the player is controlling right now. */
export type RideMode = "vehicle" | "foot";

export interface FourWheeler3dState {
  progress: FourWheeler3dProgress;

  // Session-only state. `partialize` keeps all of this out of storage.
  isPaused: boolean;
  hasStarted: boolean;
  mode: RideMode;
  hint: string | null;
  /**
   * How deep the snow lies, 0 to 1. It is session only on purpose: a fresh
   * ride starts on clear ground rather than in yesterday's drifts.
   */
  snowLevel: number;

  /**
   * The live clock, 0 to 24. This is the one every part of the scene reads.
   * It is session state so a ticking minute hand never touches the saved
   * progress, which is polled and uploaded whenever it changes.
   */
  clock: number;

  /** Real seconds since the clock was last written into progress. */
  clockSinceFlush: number;
}

export interface FourWheeler3dActions {
  // Cloud sync
  getProgress: () => FourWheeler3dProgress;
  setProgress: (data: FourWheeler3dProgress) => void;

  // Economy
  addMoney: (delta: number) => void;

  // Session
  setPaused: (paused: boolean) => void;
  setHasStarted: (started: boolean) => void;
  setMode: (mode: RideMode) => void;
  setHint: (hint: string | null) => void;
  resetSession: () => void;

  /**
   * Move the world clock forward by `dtSeconds` of real time. One real second
   * is one game minute. At midnight the day counts up and the weather rolls.
   *
   * Only the session clock moves on a normal tick. Progress is written on a
   * day rollover and once per game hour, so the cloud sync is not woken by a
   * minute hand it does not need to save.
   */
  tick: (dtSeconds: number) => void;

  /** Copy the saved clock into the session clock, on mount. */
  seedClock: () => void;

  /** Write the live clock into progress. Used on pause and on leaving. */
  flushClock: () => void;

  /** Jump the clock, used by the development ?tod= parameter. */
  setTimeOfDay: (timeOfDay: number) => void;

  // Settings
  updateSettings: (
    partial: Partial<FourWheeler3dProgress["settings"]>
  ) => void;
}

// ============================================================================
// DEFAULTS
// ============================================================================

export const defaultProgress: FourWheeler3dProgress = {
  money: START_MONEY,
  totalEarned: 0,
  ownedVehicles: ["atv"],
  currentVehicle: "atv",
  paint: "#e63946",
  trophies: 0,
  fishCaught: Object.fromEntries(FISH_TYPES.map((type) => [type, 0])),
  biggestFish: "",
  bestRaceTimeMs: 0,
  racesWon: 0,
  airPoints: 0,
  land: {},
  hunger: 0,
  day: 1,
  timeOfDay: 8,
  weather: "sunny",
  settings: { soundEnabled: true, tiltEnabled: false, helmetCam: false },
  lastModified: 0,
};

const defaultSession = {
  isPaused: false,
  hasStarted: false,
  mode: "vehicle" as RideMode,
  hint: null,
  snowLevel: 0,
  clock: defaultProgress.timeOfDay,
  clockSinceFlush: 0,
};

/**
 * One game hour of real time. The clock is saved this often, plus whenever a
 * new day starts, the game is paused, or the page goes away.
 */
const CLOCK_FLUSH_SECONDS = 60;

/** A fresh copy, so no two stores ever share the nested objects. */
function createDefaultProgress(): FourWheeler3dProgress {
  return {
    ...defaultProgress,
    ownedVehicles: [...defaultProgress.ownedVehicles],
    fishCaught: { ...defaultProgress.fishCaught },
    land: {},
    settings: { ...defaultProgress.settings },
  };
}

// ============================================================================
// STORE
// ============================================================================

export const useFourWheeler3dStore = create<
  FourWheeler3dState & FourWheeler3dActions
>()(
  persist(
    (set, get) => ({
      progress: createDefaultProgress(),
      ...defaultSession,

      getProgress: () => get().progress,

      setProgress: (data) => set({ progress: data }),

      addMoney: (delta) =>
        set((state) => ({
          progress: {
            ...state.progress,
            // Money never goes below zero. Hunger and repairs take carried
            // cash only, so the kid can never owe anything.
            money: Math.max(0, state.progress.money + delta),
            totalEarned:
              delta > 0
                ? state.progress.totalEarned + delta
                : state.progress.totalEarned,
            lastModified: Date.now(),
          },
        })),

      tick: (dtSeconds) =>
        set((state) => {
          const { timeOfDay, newDay } = advanceClock(state.clock, dtSeconds);
          const weather = newDay
            ? rollWeather(Math.random)
            : (state.progress.weather as Weather);
          const snowLevel = updateSnowLevel(state.snowLevel, weather, dtSeconds);

          // A new day is real news: the day counts up, the weather changes,
          // and the kid gets a hint about it. That is worth a save.
          if (newDay) {
            return {
              clock: timeOfDay,
              clockSinceFlush: 0,
              snowLevel,
              hint: `🌤️ A new day! It is ${weather}.`,
              progress: {
                ...state.progress,
                timeOfDay,
                day: state.progress.day + 1,
                weather,
                lastModified: Date.now(),
              },
            };
          }

          const sinceFlush = state.clockSinceFlush + dtSeconds;
          if (sinceFlush >= CLOCK_FLUSH_SECONDS) {
            return {
              clock: timeOfDay,
              clockSinceFlush: 0,
              snowLevel,
              progress: {
                ...state.progress,
                timeOfDay,
                lastModified: Date.now(),
              },
            };
          }

          // The usual tick: the session clock moves, nothing is saved.
          return { clock: timeOfDay, clockSinceFlush: sinceFlush, snowLevel };
        }),

      seedClock: () =>
        set((state) => ({
          clock: state.progress.timeOfDay,
          clockSinceFlush: 0,
        })),

      flushClock: () =>
        set((state) => {
          if (state.clock === state.progress.timeOfDay) return {};
          return {
            clockSinceFlush: 0,
            progress: {
              ...state.progress,
              timeOfDay: state.clock,
              lastModified: Date.now(),
            },
          };
        }),

      setTimeOfDay: (timeOfDay) =>
        set((state) => {
          const wrapped = ((timeOfDay % 24) + 24) % 24;
          return {
            clock: wrapped,
            clockSinceFlush: 0,
            progress: { ...state.progress, timeOfDay: wrapped },
          };
        }),

      setPaused: (paused) => set({ isPaused: paused }),
      setHasStarted: (started) => set({ hasStarted: started }),
      setMode: (mode) => set({ mode }),
      setHint: (hint) => set({ hint }),

      // Clears the run only. Money, vehicles, land and trophies stay saved.
      resetSession: () => set({ ...defaultSession }),

      updateSettings: (partial) =>
        set((state) => ({
          progress: {
            ...state.progress,
            settings: { ...state.progress.settings, ...partial },
            lastModified: Date.now(),
          },
        })),
    }),
    {
      name: "four-wheeler-3d-game-state",
      partialize: (state) => ({ progress: state.progress }),
    }
  )
);
