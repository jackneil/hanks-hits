/**
 * Hill Climb Racing - Zustand Store
 *
 * Game state management with localStorage persistence.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { FUEL, NITRO, VEHICLES, UPGRADES, STAGES, type UpgradeType } from './constants';

// =============================================================================
// TYPES
// =============================================================================

export interface VehicleUpgrades {
  engine: number; // 0-5 (upgrade level)
  suspension: number;
  tires: number;
  fuelTank: number;
  nitro: number;
}

// Progress type for cloud sync
// Index signature required for AppProgressData compatibility
export type HillClimbProgress = {
  [key: string]: unknown;
  coins: number;
  totalCoinsEarned: number;
  bestDistance: number;
  bestDistancePerStage: Record<string, number>;
  currentVehicleId: string;
  unlockedVehicles: string[];
  vehicleUpgrades: Record<string, VehicleUpgrades>;
  currentStageId: string;
  unlockedStages: string[];
  leanSensitivity: number;
  soundEnabled: boolean;
  musicEnabled: boolean;
  lastModified: number;
};

export interface GameState {
  // Currency
  coins: number;
  totalCoinsEarned: number;

  // Current run state
  isPlaying: boolean;
  isGameOver: boolean;
  isPaused: boolean;
  pauseScreen: 'menu' | 'settings';
  gameOverReason: 'head' | 'fuel' | null;
  distance: number;
  fuel: number;
  nitro: number; // Runtime nitro level (0-100)
  sessionCoins: number;
  sessionFlips: number;
  sessionAirtime: number;

  // Combo
  combo: number;
  comboTimer: number;

  // Records
  bestDistance: number;
  bestDistancePerStage: Record<string, number>;

  // Vehicles
  currentVehicleId: string;
  unlockedVehicles: string[];
  vehicleUpgrades: Record<string, VehicleUpgrades>;

  // Stage
  currentStageId: string;
  unlockedStages: string[];

  // Settings
  soundEnabled: boolean;
  musicEnabled: boolean;
  leanSensitivity: number; // 0.5 to 2.0, default 1.0
}

export interface GameActions {
  // Run actions
  startRun: () => void;
  endRun: (reason: 'head' | 'fuel') => void;
  restartRun: () => void;
  updateDistance: (distance: number) => void;

  // Pause actions
  pauseGame: () => void;
  resumeGame: () => void;
  setPauseScreen: (screen: 'menu' | 'settings') => void;

  // Fuel actions
  consumeFuel: (amount: number) => void;
  collectFuel: () => void;

  // Nitro actions
  consumeNitro: (amount: number) => void;
  refillNitro: (amount: number) => void;

  // Scoring actions
  addCoins: (amount: number, isSession?: boolean) => void;
  addFlip: () => void;
  addAirtime: (seconds: number) => void;
  incrementCombo: () => void;
  resetCombo: () => void;

  // Progression actions
  unlockVehicle: (vehicleId: string) => boolean;
  selectVehicle: (vehicleId: string) => void;
  purchaseUpgrade: (vehicleId: string, upgradeType: UpgradeType) => boolean;
  selectStage: (stageId: string) => void;

  // Utility actions
  getVehicleStats: (vehicleId: string) => {
    torque: number;
    grip: number;
    weight: number;
    fuelEfficiency: number;
    airControl: number;
    maxFuel: number;
    nitroDuration: number; // Multiplier for drain rate (higher = longer)
    nitroRecharge: number; // Multiplier for refill rate (higher = faster)
  };
  toggleSound: () => void;
  toggleMusic: () => void;
  setLeanSensitivity: (value: number) => void;
  resetProgress: () => void;

  // Cloud sync
  getProgress: () => HillClimbProgress;
  setProgress: (data: HillClimbProgress) => void;
}

// =============================================================================
// INITIAL STATE
// =============================================================================

const initialState: GameState = {
  // Currency
  coins: 0,
  totalCoinsEarned: 0,

  // Current run
  isPlaying: false,
  isGameOver: false,
  isPaused: false,
  pauseScreen: 'menu',
  gameOverReason: null,
  distance: 0,
  fuel: FUEL.INITIAL_FUEL,
  nitro: NITRO.MAX,
  sessionCoins: 0,
  sessionFlips: 0,
  sessionAirtime: 0,

  // Combo
  combo: 0,
  comboTimer: 0,

  // Records
  bestDistance: 0,
  bestDistancePerStage: {},

  // Vehicles
  currentVehicleId: 'jeep',
  unlockedVehicles: ['jeep'],
  vehicleUpgrades: {
    jeep: { engine: 0, suspension: 0, tires: 0, fuelTank: 0, nitro: 0 },
  },

  // Stage
  currentStageId: 'countryside',
  unlockedStages: ['countryside'],

  // Settings
  soundEnabled: true,
  musicEnabled: true,
  leanSensitivity: 1.0,
};

function getUnlockedStagesForDistance(existingStages: string[], bestDistance: number): string[] {
  const unlocked = new Set(existingStages);

  for (const stage of STAGES) {
    if (bestDistance >= stage.unlockDistance) {
      unlocked.add(stage.id);
    }
  }

  return STAGES.filter((stage) => unlocked.has(stage.id)).map((stage) => stage.id);
}

// =============================================================================
// STORE
// =============================================================================

export const useHillClimbStore = create<GameState & GameActions>()(
  persist(
    (set, get) => ({
      ...initialState,

      // =========================================================================
      // RUN ACTIONS
      // =========================================================================

      startRun: () => {
        const state = get();
        const maxFuel = get().getVehicleStats(state.currentVehicleId).maxFuel;

        set({
          isPlaying: true,
          isGameOver: false,
          gameOverReason: null,
          distance: 0,
          fuel: maxFuel,
          nitro: NITRO.MAX,
          sessionCoins: 0,
          sessionFlips: 0,
          sessionAirtime: 0,
          combo: 0,
          comboTimer: 0,
        });
      },

      endRun: (reason) => {
        const state = get();

        // Update best distance
        const newBestDistance = Math.max(state.bestDistance, state.distance);
        const stageKey = state.currentStageId;
        const currentStageBest = state.bestDistancePerStage[stageKey] || 0;
        const newStageBest = Math.max(currentStageBest, state.distance);

        set({
          isPlaying: false,
          isGameOver: true,
          gameOverReason: reason,
          bestDistance: newBestDistance,
          bestDistancePerStage: {
            ...state.bestDistancePerStage,
            [stageKey]: newStageBest,
          },
          unlockedStages: getUnlockedStagesForDistance(state.unlockedStages, newBestDistance),
        });
      },

      restartRun: () => {
        get().startRun();
      },

      updateDistance: (distance) => {
        set({ distance: Math.max(get().distance, distance) });
      },

      // =========================================================================
      // PAUSE ACTIONS
      // =========================================================================

      pauseGame: () => {
        set({ isPaused: true, pauseScreen: 'menu' });
      },

      resumeGame: () => {
        set({ isPaused: false, pauseScreen: 'menu' });
      },

      setPauseScreen: (screen) => {
        set({ pauseScreen: screen });
      },

      // =========================================================================
      // FUEL ACTIONS
      // =========================================================================

      consumeFuel: (amount) => {
        const state = get();
        const newFuel = Math.max(0, state.fuel - amount);

        if (newFuel <= 0 && state.isPlaying) {
          get().endRun('fuel');
        } else {
          set({ fuel: newFuel });
        }
      },

      collectFuel: () => {
        const state = get();
        const maxFuel = get().getVehicleStats(state.currentVehicleId).maxFuel;
        set({ fuel: Math.min(maxFuel, state.fuel + FUEL.CAN_REFILL) });
      },

      // =========================================================================
      // NITRO ACTIONS
      // =========================================================================

      consumeNitro: (amount) => {
        set((state) => ({
          nitro: Math.max(0, state.nitro - amount),
        }));
      },

      refillNitro: (amount) => {
        set((state) => ({
          nitro: Math.min(NITRO.MAX, state.nitro + amount),
        }));
      },

      // =========================================================================
      // SCORING ACTIONS
      // =========================================================================

      addCoins: (amount, isSession = true) => {
        const state = get();
        const finalAmount = Math.floor(amount * (1 + state.combo * 0.1)); // Combo bonus

        set({
          coins: state.coins + finalAmount,
          totalCoinsEarned: state.totalCoinsEarned + finalAmount,
          sessionCoins: isSession
            ? state.sessionCoins + finalAmount
            : state.sessionCoins,
        });
      },

      addFlip: () => {
        set((state) => ({ sessionFlips: state.sessionFlips + 1 }));
        get().incrementCombo();
      },

      addAirtime: (seconds) => {
        set((state) => ({ sessionAirtime: state.sessionAirtime + seconds }));
      },

      incrementCombo: () => {
        set((state) => ({
          combo: Math.min(state.combo + 1, 10),
          comboTimer: 2, // Reset timer
        }));
      },

      resetCombo: () => {
        set({ combo: 0, comboTimer: 0 });
      },

      // =========================================================================
      // PROGRESSION ACTIONS
      // =========================================================================

      unlockVehicle: (vehicleId) => {
        const state = get();
        const vehicle = VEHICLES.find((v) => v.id === vehicleId);

        if (!vehicle) return false;
        if (state.unlockedVehicles.includes(vehicleId)) return false;
        if (state.coins < vehicle.cost) return false;

        set({
          coins: state.coins - vehicle.cost,
          unlockedVehicles: [...state.unlockedVehicles, vehicleId],
          vehicleUpgrades: {
            ...state.vehicleUpgrades,
            [vehicleId]: { engine: 0, suspension: 0, tires: 0, fuelTank: 0, nitro: 0 },
          },
        });

        return true;
      },

      selectVehicle: (vehicleId) => {
        const state = get();
        if (state.unlockedVehicles.includes(vehicleId)) {
          set({ currentVehicleId: vehicleId });
        }
      },

      purchaseUpgrade: (vehicleId, upgradeType) => {
        const state = get();
        const upgrades = state.vehicleUpgrades[vehicleId];

        if (!upgrades) return false;

        const currentLevel = upgrades[upgradeType];
        const upgradeConfig = UPGRADES[upgradeType];

        if (currentLevel >= upgradeConfig.levels.length) return false;

        const nextLevel = upgradeConfig.levels[currentLevel];
        if (state.coins < nextLevel.cost) return false;

        set({
          coins: state.coins - nextLevel.cost,
          vehicleUpgrades: {
            ...state.vehicleUpgrades,
            [vehicleId]: {
              ...upgrades,
              [upgradeType]: currentLevel + 1,
            },
          },
        });

        return true;
      },

      selectStage: (stageId) => {
        const state = get();
        const stage = STAGES.find((s) => s.id === stageId);
        if (!stage) return;

        const unlockedStages = getUnlockedStagesForDistance(state.unlockedStages, state.bestDistance);
        if (unlockedStages.includes(stageId)) {
          set({ currentStageId: stageId, unlockedStages });
        }
      },

      // =========================================================================
      // UTILITY ACTIONS
      // =========================================================================

      getVehicleStats: (vehicleId) => {
        const state = get();
        const vehicle = VEHICLES.find((v) => v.id === vehicleId);
        const upgrades = state.vehicleUpgrades[vehicleId] || {
          engine: 0,
          suspension: 0,
          tires: 0,
          fuelTank: 0,
          nitro: 0,
        };

        if (!vehicle) {
          return {
            torque: 1,
            grip: 1,
            weight: 1,
            fuelEfficiency: 1,
            airControl: 1,
            maxFuel: FUEL.MAX_FUEL,
            nitroDuration: 1,
            nitroRecharge: 1,
          };
        }

        // Calculate upgrade multipliers
        const engineMult =
          upgrades.engine > 0
            ? UPGRADES.engine.levels[upgrades.engine - 1].multiplier
            : 1;
        const suspensionMult =
          upgrades.suspension > 0
            ? UPGRADES.suspension.levels[upgrades.suspension - 1].multiplier
            : 1;
        const tiresMult =
          upgrades.tires > 0
            ? UPGRADES.tires.levels[upgrades.tires - 1].multiplier
            : 1;
        const fuelTankMult =
          upgrades.fuelTank > 0
            ? UPGRADES.fuelTank.levels[upgrades.fuelTank - 1].multiplier
            : 1;
        const nitroLevel = upgrades.nitro || 0;
        const nitroDurationMult =
          nitroLevel > 0
            ? UPGRADES.nitro.levels[nitroLevel - 1].durationMult
            : 1;
        const nitroRechargeMult =
          nitroLevel > 0
            ? UPGRADES.nitro.levels[nitroLevel - 1].rechargeMult
            : 1;

        return {
          torque: vehicle.torque * engineMult,
          grip: vehicle.grip * tiresMult,
          weight: vehicle.weight,
          fuelEfficiency: vehicle.fuelEfficiency,
          airControl: vehicle.airControl * suspensionMult,
          maxFuel: FUEL.MAX_FUEL * fuelTankMult,
          nitroDuration: nitroDurationMult,
          nitroRecharge: nitroRechargeMult,
        };
      },

      toggleSound: () => {
        set((state) => ({ soundEnabled: !state.soundEnabled }));
      },

      toggleMusic: () => {
        set((state) => ({ musicEnabled: !state.musicEnabled }));
      },

      setLeanSensitivity: (value) => {
        // Clamp between 0.5 and 2.0
        const clamped = Math.max(0.5, Math.min(2.0, value));
        set({ leanSensitivity: clamped });
      },

      resetProgress: () => {
        set(initialState);
      },

      // Cloud sync
      getProgress: () => {
        const state = get();
        return {
          coins: state.coins,
          totalCoinsEarned: state.totalCoinsEarned,
          bestDistance: state.bestDistance,
          bestDistancePerStage: state.bestDistancePerStage,
          currentVehicleId: state.currentVehicleId,
          unlockedVehicles: state.unlockedVehicles,
          vehicleUpgrades: state.vehicleUpgrades,
          currentStageId: state.currentStageId,
          unlockedStages: state.unlockedStages,
          leanSensitivity: state.leanSensitivity,
          soundEnabled: state.soundEnabled,
          musicEnabled: state.musicEnabled,
          lastModified: Date.now(),
        };
      },

      setProgress: (data) => {
        const unlockedStages = getUnlockedStagesForDistance(data.unlockedStages, data.bestDistance);

        set({
          coins: data.coins,
          totalCoinsEarned: data.totalCoinsEarned,
          bestDistance: data.bestDistance,
          bestDistancePerStage: data.bestDistancePerStage,
          currentVehicleId: data.currentVehicleId,
          unlockedVehicles: data.unlockedVehicles,
          vehicleUpgrades: data.vehicleUpgrades,
          currentStageId: unlockedStages.includes(data.currentStageId)
            ? data.currentStageId
            : initialState.currentStageId,
          unlockedStages,
          leanSensitivity: data.leanSensitivity,
          soundEnabled: data.soundEnabled,
          musicEnabled: data.musicEnabled,
        });
      },
    }),
    {
      name: 'hill-climb-storage',
      partialize: (state) => ({
        // Only persist these fields
        coins: state.coins,
        totalCoinsEarned: state.totalCoinsEarned,
        bestDistance: state.bestDistance,
        bestDistancePerStage: state.bestDistancePerStage,
        currentVehicleId: state.currentVehicleId,
        unlockedVehicles: state.unlockedVehicles,
        vehicleUpgrades: state.vehicleUpgrades,
        currentStageId: state.currentStageId,
        unlockedStages: state.unlockedStages,
        leanSensitivity: state.leanSensitivity,
        soundEnabled: state.soundEnabled,
        musicEnabled: state.musicEnabled,
      }),
    }
  )
);
