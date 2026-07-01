// store.ts - Cookie Clicker Zustand store with persistence
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  type BuildingId,
  type UpgradeId,
  type AchievementId,
  BUILDINGS,
  UPGRADES,
  ACHIEVEMENTS,
  GAME_CONFIG,
  calculateBuildingCost,
  getBuildingById,
  getUpgradeById,
  getAchievementById,
} from "./constants";

// ============================================================================
// TYPES
// ============================================================================

// Index signature required for AppProgressData compatibility
export interface CookieClickerProgress {
  [key: string]: unknown;
  cookies: number;
  totalCookiesBaked: number;
  totalClicks: number;
  buildings: Record<BuildingId, number>;
  purchasedUpgrades: UpgradeId[];
  unlockedAchievements: AchievementId[];
  soundEnabled: boolean;
  lastTick: number;
  lastModified: number;
}

export type GoldenCookieEffect = "frenzy" | "clickFrenzy" | "lucky";

export interface GoldenCookieState {
  id: string;
  x: number;
  y: number;
  effect: GoldenCookieEffect;
  expiresAt: number;
}

export interface CookieClickerState extends CookieClickerProgress {
  // Computed values (not persisted, recalculated)
  cookiesPerClick: number;
  cookiesPerSecond: number;

  // Active effects
  frenzyMultiplier: number;
  frenzyEndTime: number;
  clickFrenzyMultiplier: number;
  clickFrenzyEndTime: number;

  // UI state
  newAchievements: AchievementId[];
  floatingTexts: Array<{ id: string; x: number; y: number; text: string }>;
  goldenCookie: GoldenCookieState | null;
}

interface CookieClickerActions {
  // Core gameplay
  clickCookie: (x?: number, y?: number) => void;
  tick: () => void;

  // Purchases
  buyBuilding: (buildingId: BuildingId) => boolean;
  buyUpgrade: (upgradeId: UpgradeId) => boolean;

  // Calculations
  calculateCps: () => number;
  calculateClickPower: () => number;
  getBuildingCost: (buildingId: BuildingId) => number;
  canAffordBuilding: (buildingId: BuildingId) => boolean;
  canAffordUpgrade: (upgradeId: UpgradeId) => boolean;
  getAvailableUpgrades: () => UpgradeId[];

  // Achievements
  checkAchievements: () => void;
  clearNewAchievements: () => void;

  // Effects
  spawnGoldenCookie: (effect?: GoldenCookieEffect) => void;
  clickGoldenCookie: () => GoldenCookieEffect | null;
  clearGoldenCookie: () => void;
  activateFrenzy: () => void;
  activateClickFrenzy: () => void;
  addLuckyCookies: () => void;

  // Offline progress
  calculateOfflineProgress: () => number;
  applyOfflineProgress: () => number;

  // Settings
  toggleSound: () => void;

  // Utility
  clearFloatingText: (id: string) => void;
  resetProgress: () => void;
  getProgress: () => CookieClickerProgress;
  setProgress: (data: CookieClickerProgress) => void;
}

// ============================================================================
// DEFAULT STATE
// ============================================================================

const createDefaultBuildings = (): Record<BuildingId, number> => ({
  cursor: 0,
  grandma: 0,
  bakery: 0,
  factory: 0,
  mine: 0,
  bank: 0,
  temple: 0,
  wizardTower: 0,
  spaceship: 0,
  alchemyLab: 0,
});

const defaultProgress: CookieClickerProgress = {
  cookies: 0,
  totalCookiesBaked: 0,
  totalClicks: 0,
  buildings: createDefaultBuildings(),
  purchasedUpgrades: [],
  unlockedAchievements: [],
  soundEnabled: true,
  lastTick: Date.now(),
  lastModified: Date.now(),
};

const GOLDEN_COOKIE_EFFECTS: GoldenCookieEffect[] = [
  "frenzy",
  "clickFrenzy",
  "lucky",
];

// ============================================================================
// STORE
// ============================================================================

export const useCookieClickerStore = create<
  CookieClickerState & CookieClickerActions
>()(
  persist(
    (set, get) => ({
      // State
      ...defaultProgress,
      cookiesPerClick: GAME_CONFIG.BASE_CLICK_VALUE,
      cookiesPerSecond: 0,
      frenzyMultiplier: 1,
      frenzyEndTime: 0,
      clickFrenzyMultiplier: 1,
      clickFrenzyEndTime: 0,
      newAchievements: [],
      floatingTexts: [],
      goldenCookie: null,

      // ========================================================================
      // CORE GAMEPLAY
      // ========================================================================

      clickCookie: (x?: number, y?: number) => {
        const state = get();
        const clickPower = state.calculateClickPower();
        const earned = clickPower * state.clickFrenzyMultiplier;

        // Add floating text
        const floatingText = {
          id: `${Date.now()}-${Math.random()}`,
          x: x ?? 50,
          y: y ?? 50,
          text: `+${Math.floor(earned)}`,
        };

        set((s) => ({
          cookies: s.cookies + earned,
          totalCookiesBaked: s.totalCookiesBaked + earned,
          totalClicks: s.totalClicks + 1,
          floatingTexts: [...s.floatingTexts.slice(-9), floatingText],
          lastModified: Date.now(),
        }));

        // Check achievements after click
        setTimeout(() => get().checkAchievements(), 0);
      },

      tick: () => {
        const state = get();
        const now = Date.now();

        // Check if frenzy effects have expired
        let newFrenzyMultiplier = state.frenzyMultiplier;
        let newClickFrenzyMultiplier = state.clickFrenzyMultiplier;

        if (state.frenzyEndTime > 0 && now >= state.frenzyEndTime) {
          newFrenzyMultiplier = 1;
        }
        if (state.clickFrenzyEndTime > 0 && now >= state.clickFrenzyEndTime) {
          newClickFrenzyMultiplier = 1;
        }

        // Calculate cookies earned this tick
        const cps = state.calculateCps();
        const tickSeconds = GAME_CONFIG.TICK_RATE / 1000;
        const earned = cps * tickSeconds * newFrenzyMultiplier;

        if (earned > 0 || newFrenzyMultiplier !== state.frenzyMultiplier || newClickFrenzyMultiplier !== state.clickFrenzyMultiplier) {
          set((s) => ({
            cookies: s.cookies + earned,
            totalCookiesBaked: s.totalCookiesBaked + earned,
            cookiesPerSecond: cps * newFrenzyMultiplier,
            frenzyMultiplier: newFrenzyMultiplier,
            clickFrenzyMultiplier: newClickFrenzyMultiplier,
            frenzyEndTime: newFrenzyMultiplier === 1 ? 0 : s.frenzyEndTime,
            clickFrenzyEndTime: newClickFrenzyMultiplier === 1 ? 0 : s.clickFrenzyEndTime,
            lastTick: now,
          }));
        }
      },

      // ========================================================================
      // PURCHASES
      // ========================================================================

      buyBuilding: (buildingId: BuildingId) => {
        const state = get();
        const cost = state.getBuildingCost(buildingId);

        if (state.cookies < cost) return false;

        set((s) => ({
          cookies: s.cookies - cost,
          buildings: {
            ...s.buildings,
            [buildingId]: s.buildings[buildingId] + 1,
          },
          lastModified: Date.now(),
        }));

        // Recalculate CPS
        const newCps = get().calculateCps();
        set({ cookiesPerSecond: newCps });

        // Check achievements
        setTimeout(() => get().checkAchievements(), 0);

        return true;
      },

      buyUpgrade: (upgradeId: UpgradeId) => {
        const state = get();
        const upgrade = getUpgradeById(upgradeId);
        if (!upgrade) return false;

        if (state.cookies < upgrade.cost) return false;
        if (state.purchasedUpgrades.includes(upgradeId)) return false;

        set((s) => ({
          cookies: s.cookies - upgrade.cost,
          purchasedUpgrades: [...s.purchasedUpgrades, upgradeId],
          lastModified: Date.now(),
        }));

        // Recalculate CPS and click power
        const newState = get();
        set({
          cookiesPerSecond: newState.calculateCps(),
          cookiesPerClick: newState.calculateClickPower(),
        });

        // Check achievements
        setTimeout(() => get().checkAchievements(), 0);

        return true;
      },

      // ========================================================================
      // CALCULATIONS
      // ========================================================================

      calculateCps: () => {
        const state = get();
        let totalCps = 0;

        // Calculate base CPS from buildings
        for (const building of BUILDINGS) {
          const count = state.buildings[building.id];
          if (count > 0) {
            let buildingCps = building.baseCps * count;

            // Apply building-specific upgrade multipliers
            for (const upgradeId of state.purchasedUpgrades) {
              const upgrade = getUpgradeById(upgradeId);
              if (
                upgrade &&
                upgrade.type === "building" &&
                upgrade.targetBuilding === building.id &&
                upgrade.multiplier
              ) {
                buildingCps *= upgrade.multiplier;
              }
            }

            totalCps += buildingCps;
          }
        }

        // Apply global upgrade multipliers
        for (const upgradeId of state.purchasedUpgrades) {
          const upgrade = getUpgradeById(upgradeId);
          if (upgrade && upgrade.type === "global" && upgrade.globalMultiplier) {
            totalCps *= upgrade.globalMultiplier;
          }
        }

        // Apply achievement bonuses
        let achievementBonus = 0;
        for (const achievementId of state.unlockedAchievements) {
          const achievement = getAchievementById(achievementId);
          if (achievement && achievement.cpsBonus) {
            achievementBonus += achievement.cpsBonus;
          }
        }
        if (achievementBonus > 0) {
          totalCps *= 1 + achievementBonus / 100;
        }

        return totalCps;
      },

      calculateClickPower: () => {
        const state = get();
        let clickPower = GAME_CONFIG.BASE_CLICK_VALUE;

        // Add click upgrade bonuses
        for (const upgradeId of state.purchasedUpgrades) {
          const upgrade = getUpgradeById(upgradeId);
          if (upgrade && upgrade.type === "click" && upgrade.clickBonus) {
            clickPower += upgrade.clickBonus;
          }
        }

        return clickPower;
      },

      getBuildingCost: (buildingId: BuildingId) => {
        const state = get();
        return calculateBuildingCost(buildingId, state.buildings[buildingId]);
      },

      canAffordBuilding: (buildingId: BuildingId) => {
        const state = get();
        return state.cookies >= state.getBuildingCost(buildingId);
      },

      canAffordUpgrade: (upgradeId: UpgradeId) => {
        const state = get();
        const upgrade = getUpgradeById(upgradeId);
        if (!upgrade) return false;
        if (state.purchasedUpgrades.includes(upgradeId)) return false;
        return state.cookies >= upgrade.cost;
      },

      getAvailableUpgrades: () => {
        const state = get();
        return UPGRADES.filter((upgrade) => {
          // Already purchased
          if (state.purchasedUpgrades.includes(upgrade.id)) return false;

          // Check required buildings
          if (upgrade.requiredBuildings) {
            for (const [buildingId, count] of Object.entries(
              upgrade.requiredBuildings
            )) {
              if (state.buildings[buildingId as BuildingId] < count) {
                return false;
              }
            }
          }

          return true;
        }).map((u) => u.id);
      },

      // ========================================================================
      // ACHIEVEMENTS
      // ========================================================================

      checkAchievements: () => {
        const state = get();
        const newlyUnlocked: AchievementId[] = [];

        for (const achievement of ACHIEVEMENTS) {
          // Already unlocked
          if (state.unlockedAchievements.includes(achievement.id)) continue;

          let unlocked = false;

          switch (achievement.condition) {
            case "cookies":
              unlocked = state.totalCookiesBaked >= achievement.threshold;
              break;
            case "clicks":
              unlocked = state.totalClicks >= achievement.threshold;
              break;
            case "cps":
              unlocked = state.calculateCps() >= achievement.threshold;
              break;
            case "building":
              if (achievement.targetBuilding) {
                unlocked =
                  state.buildings[achievement.targetBuilding] >=
                  achievement.threshold;
              }
              break;
            case "upgrades":
              unlocked =
                state.purchasedUpgrades.length >= achievement.threshold;
              break;
          }

          if (unlocked) {
            newlyUnlocked.push(achievement.id);
          }
        }

        if (newlyUnlocked.length > 0) {
          set((s) => ({
            unlockedAchievements: [
              ...s.unlockedAchievements,
              ...newlyUnlocked,
            ],
            newAchievements: [...s.newAchievements, ...newlyUnlocked],
            lastModified: Date.now(),
          }));

          // Recalculate CPS with new achievement bonuses
          const newCps = get().calculateCps();
          set({ cookiesPerSecond: newCps });
        }
      },

      clearNewAchievements: () => {
        set({ newAchievements: [] });
      },

      // ========================================================================
      // EFFECTS (Golden Cookie bonuses)
      // ========================================================================

      spawnGoldenCookie: (effect) => {
        const state = get();
        if (state.goldenCookie) return;

        const selectedEffect =
          effect ??
          GOLDEN_COOKIE_EFFECTS[
            Math.floor(Math.random() * GOLDEN_COOKIE_EFFECTS.length)
          ];

        set({
          goldenCookie: {
            id: `${Date.now()}-${Math.random()}`,
            x: 15 + Math.random() * 70,
            y: 20 + Math.random() * 55,
            effect: selectedEffect,
            expiresAt: Date.now() + GAME_CONFIG.GOLDEN_COOKIE_DURATION,
          },
        });
      },

      clickGoldenCookie: () => {
        const state = get();
        const goldenCookie = state.goldenCookie;
        if (!goldenCookie) return null;

        set({ goldenCookie: null });

        switch (goldenCookie.effect) {
          case "frenzy":
            get().activateFrenzy();
            break;
          case "clickFrenzy":
            get().activateClickFrenzy();
            break;
          case "lucky":
            get().addLuckyCookies();
            break;
        }

        return goldenCookie.effect;
      },

      clearGoldenCookie: () => {
        set({ goldenCookie: null });
      },

      activateFrenzy: () => {
        set({
          frenzyMultiplier: GAME_CONFIG.FRENZY_MULTIPLIER,
          frenzyEndTime: Date.now() + GAME_CONFIG.FRENZY_DURATION,
        });
      },

      activateClickFrenzy: () => {
        set({
          clickFrenzyMultiplier: GAME_CONFIG.CLICK_FRENZY_MULTIPLIER,
          clickFrenzyEndTime: Date.now() + GAME_CONFIG.CLICK_FRENZY_DURATION,
        });
      },

      addLuckyCookies: () => {
        const state = get();
        const cps = state.calculateCps();
        // Lucky gives 15 minutes of production, capped at 10% of bank
        const maxFromProduction = cps * 60 * 15;
        const maxFromBank = state.cookies * 0.1;
        const bonus = Math.min(maxFromProduction, maxFromBank);

        set((s) => ({
          cookies: s.cookies + bonus,
          totalCookiesBaked: s.totalCookiesBaked + bonus,
          lastModified: Date.now(),
        }));
      },

      // ========================================================================
      // OFFLINE PROGRESS
      // ========================================================================

      calculateOfflineProgress: () => {
        const state = get();
        const now = Date.now();
        const offlineMs = now - state.lastTick;

        // Cap at max offline hours
        const maxOfflineMs = GAME_CONFIG.MAX_OFFLINE_HOURS * 60 * 60 * 1000;
        const cappedMs = Math.min(offlineMs, maxOfflineMs);

        const cps = state.calculateCps();
        return cps * (cappedMs / 1000);
      },

      applyOfflineProgress: () => {
        const earned = get().calculateOfflineProgress();

        if (earned > 0) {
          set((s) => ({
            cookies: s.cookies + earned,
            totalCookiesBaked: s.totalCookiesBaked + earned,
            lastTick: Date.now(),
          }));
        }

        return earned;
      },

      // ========================================================================
      // SETTINGS
      // ========================================================================

      toggleSound: () => {
        set((s) => ({
          soundEnabled: !s.soundEnabled,
          lastModified: Date.now(),
        }));
      },

      // ========================================================================
      // UTILITY
      // ========================================================================

      clearFloatingText: (id: string) => {
        set((s) => ({
          floatingTexts: s.floatingTexts.filter((ft) => ft.id !== id),
        }));
      },

      resetProgress: () => {
        set({
          ...defaultProgress,
          cookiesPerClick: GAME_CONFIG.BASE_CLICK_VALUE,
          cookiesPerSecond: 0,
          frenzyMultiplier: 1,
          frenzyEndTime: 0,
          clickFrenzyMultiplier: 1,
          clickFrenzyEndTime: 0,
          newAchievements: [],
          floatingTexts: [],
          goldenCookie: null,
          lastTick: Date.now(),
          lastModified: Date.now(),
        });
      },

      getProgress: () => {
        const s = get();
        return {
          cookies: s.cookies,
          totalCookiesBaked: s.totalCookiesBaked,
          totalClicks: s.totalClicks,
          buildings: s.buildings,
          purchasedUpgrades: s.purchasedUpgrades,
          unlockedAchievements: s.unlockedAchievements,
          soundEnabled: s.soundEnabled,
          lastTick: s.lastTick,
          lastModified: s.lastModified,
        };
      },

      setProgress: (data: CookieClickerProgress) => {
        set({
          ...data,
          cookiesPerClick: GAME_CONFIG.BASE_CLICK_VALUE,
          cookiesPerSecond: 0,
          frenzyMultiplier: 1,
          frenzyEndTime: 0,
          clickFrenzyMultiplier: 1,
          clickFrenzyEndTime: 0,
          newAchievements: [],
          floatingTexts: [],
          goldenCookie: null,
        });

        // Recalculate derived values
        const state = get();
        set({
          cookiesPerSecond: state.calculateCps(),
          cookiesPerClick: state.calculateClickPower(),
        });
      },
    }),
    {
      name: "cookie-clicker-storage",
      partialize: (state) => ({
        cookies: state.cookies,
        totalCookiesBaked: state.totalCookiesBaked,
        totalClicks: state.totalClicks,
        buildings: state.buildings,
        purchasedUpgrades: state.purchasedUpgrades,
        unlockedAchievements: state.unlockedAchievements,
        soundEnabled: state.soundEnabled,
        lastTick: state.lastTick,
        lastModified: state.lastModified,
      }),
    }
  )
);
