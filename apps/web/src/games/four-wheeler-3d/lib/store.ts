import { create } from "zustand";
import { persist } from "zustand/middleware";

import { FISH_TYPES, START_MONEY } from "./constants";

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
};

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
