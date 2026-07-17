import { create } from "zustand";
import { persist } from "zustand/middleware";

import { emptyWatermarks, evaluate, type Watermarks } from "./evaluate";

/** The synced blob — must match the "achievements" Zod schema exactly. */
export type AchievementsProgress = {
  /** achievement id -> unlockedAt epoch ms */
  unlocked: Record<string, number>;
  lastModified: number;
};

const defaultProgress: AchievementsProgress = { unlocked: {}, lastModified: 0 };

type AchievementsState = {
  progress: AchievementsProgress;
  /** Local-only observation state (persisted, never synced): seeds and
   * per-app last-seen stats so records only "break" when watched. */
  watermarks: Watermarks;
  /** Session-only unlock queue for the celebration toast — deliberately not
   * persisted, so a reload never re-celebrates. */
  celebrationQueue: string[];

  getProgress: () => AchievementsProgress;
  setProgress: (data: AchievementsProgress) => void;
  reportProgress: (appId: string, blob: Record<string, unknown>) => void;
  /** Pops the queue head. Pass the id you EXPECT to be the head — a stale
   * auto-advance timer racing a tap then no-ops instead of double-shifting
   * (which silently skipped the next toast's window). */
  dequeueCelebration: (expectedId?: string) => string | undefined;
  /** Drains the whole queue at once (the "N new trophies!" summary path). */
  clearCelebrations: () => void;
};

export const useAchievementsStore = create<AchievementsState>()(
  persist(
    (set, get) => ({
      progress: defaultProgress,
      watermarks: emptyWatermarks(),
      celebrationQueue: [],

      getProgress: () => get().progress,

      // Server adoption replaces the synced blob but never celebrates it —
      // those unlocks already had their moment on whatever device earned them.
      setProgress: (data) => set({ progress: data }),

      reportProgress: (appId, blob) => {
        // Never evaluate our own synced blob — feedback loop.
        if (appId === "achievements") return;

        const { progress, watermarks, celebrationQueue } = get();
        const unlockedIds = new Set(Object.keys(progress.unlocked));
        const result = evaluate(appId, blob, unlockedIds, watermarks);

        if (result.newUnlocks.length === 0) {
          // Watermarks may still have moved (seeding, higher last-seen best):
          // record them WITHOUT touching lastModified — nothing synced
          // changed. Skip the set() entirely when this app's entry is
          // identical, or a per-second-churn game (cookie-clicker) would
          // rewrite localStorage every observer tick for nothing.
          const prev = watermarks.apps[appId];
          const next = result.watermarks.apps[appId];
          const unchanged =
            prev !== undefined &&
            prev.plays === next.plays &&
            prev.best === next.best &&
            prev.streak === next.streak &&
            prev.hasPlays === next.hasPlays &&
            prev.hasStreak === next.hasStreak &&
            watermarks.playedApps.length === result.watermarks.playedApps.length &&
            watermarks.bestIncreases === result.watermarks.bestIncreases;
          if (!unchanged) set({ watermarks: result.watermarks });
          return;
        }

        const now = Date.now();
        const unlocked = { ...progress.unlocked };
        for (const id of result.newUnlocks) unlocked[id] = now;

        set({
          progress: { unlocked, lastModified: now },
          watermarks: result.watermarks,
          celebrationQueue: [...celebrationQueue, ...result.newUnlocks],
        });
      },

      dequeueCelebration: (expectedId) => {
        const [next, ...rest] = get().celebrationQueue;
        if (next === undefined) return undefined;
        if (expectedId !== undefined && next !== expectedId) return undefined;
        set({ celebrationQueue: rest });
        return next;
      },

      clearCelebrations: () => set({ celebrationQueue: [] }),
    }),
    {
      name: "achievements-progress",
      partialize: (state) => ({
        progress: state.progress,
        watermarks: state.watermarks,
      }),
    }
  )
);

/**
 * Module-level entry point for non-React callers (useAuthSync's observer).
 * Keeping it a plain function avoids coupling the hook to the store's shape.
 */
export function reportProgressToAchievements(
  appId: string,
  blob: Record<string, unknown>
): void {
  useAchievementsStore.getState().reportProgress(appId, blob);
}
