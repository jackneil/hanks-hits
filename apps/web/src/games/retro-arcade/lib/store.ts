import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SystemType } from "./constants";

// Recently played game entry
export interface RecentGame {
  gameId: string;
  name: string;
  system: SystemType;
  lastPlayed: number; // timestamp
}

// Custom ROM metadata (actual ROM stored in IndexedDB or memory)
export interface CustomRom {
  id: string;
  name: string;
  system: SystemType;
  addedAt: number;
  blobUrl?: string; // Runtime blob URL, not persisted
}

// Save state slot
export interface SaveStateSlot {
  slot1?: string; // base64 encoded
  slot2?: string;
  slot3?: string;
  autoSave?: string;
  lastSaved: number;
}

// User settings
export interface ArcadeSettings {
  volume: number;
  autoSaveOnExit: boolean;
  showTouchControls: boolean;
}

// Play statistics
export interface PlayStats {
  totalPlayTime: number; // seconds
  gamesPlayed: number;
  favoriteSystem: SystemType | "";
  lastPlayedAt: number;
}

// Full progress structure for sync
// Index signature added for AppProgressData compatibility
export interface RetroArcadeProgress {
  [key: string]: unknown;
  favorites: string[];
  recentlyPlayed: RecentGame[];
  saveStates: Record<string, SaveStateSlot>;
  customRoms: Omit<CustomRom, "blobUrl">[];
  stats: PlayStats;
  settings: ArcadeSettings;
  lastModified: number;
}

// Store state interface
interface RetroArcadeState {
  // UI state (not persisted)
  currentSystem: SystemType | null;
  currentRomUrl: string | null;
  currentRomName: string | null;
  isPlaying: boolean;
  isLoading: boolean;

  // Persisted data
  favorites: string[];
  recentlyPlayed: RecentGame[];
  saveStates: Record<string, SaveStateSlot>;
  customRoms: CustomRom[];
  stats: PlayStats;
  settings: ArcadeSettings;
  lastModified: number;

  // Actions
  setCurrentSystem: (system: SystemType | null) => void;
  startGame: (romUrl: string, romName: string, system: SystemType) => void;
  stopGame: () => void;
  setLoading: (loading: boolean) => void;

  // Favorites
  addFavorite: (gameId: string) => void;
  removeFavorite: (gameId: string) => void;
  isFavorite: (gameId: string) => boolean;

  // Recently played
  addRecentlyPlayed: (game: Omit<RecentGame, "lastPlayed">) => void;

  // Custom ROMs
  addCustomRom: (rom: CustomRom) => void;
  removeCustomRom: (romId: string) => void;
  getCustomRomsForSystem: (system: SystemType) => CustomRom[];

  // Save states
  saveSaveState: (gameId: string, slot: string, data: string) => void;
  loadSaveState: (gameId: string, slot: string) => string | undefined;

  // Settings
  updateSettings: (settings: Partial<ArcadeSettings>) => void;

  // Stats
  updatePlayTime: (seconds: number) => void;

  // Progress sync
  getProgress: () => RetroArcadeProgress;
  setProgress: (data: RetroArcadeProgress) => void;
}

const defaultSettings: ArcadeSettings = {
  volume: 0.5,
  autoSaveOnExit: true,
  showTouchControls: true,
};

const defaultStats: PlayStats = {
  totalPlayTime: 0,
  gamesPlayed: 0,
  favoriteSystem: "",
  lastPlayedAt: 0,
};

function stripRuntimeBlobUrl(rom: CustomRom): Omit<CustomRom, "blobUrl"> {
  return {
    id: rom.id,
    name: rom.name,
    system: rom.system,
    addedAt: rom.addedAt,
  };
}

export const useRetroArcadeStore = create<RetroArcadeState>()(
  persist(
    (set, get) => ({
      // Initial UI state
      currentSystem: null,
      currentRomUrl: null,
      currentRomName: null,
      isPlaying: false,
      isLoading: false,

      // Initial persisted state
      favorites: [],
      recentlyPlayed: [],
      saveStates: {},
      customRoms: [],
      stats: defaultStats,
      settings: defaultSettings,
      lastModified: Date.now(),

      // UI Actions
      setCurrentSystem: (system) => set({ currentSystem: system }),

      startGame: (romUrl, romName, system) => {
        const state = get();
        // Add to recently played
        state.addRecentlyPlayed({ gameId: `${system}-${romName}`, name: romName, system });
        set({
          currentRomUrl: romUrl,
          currentRomName: romName,
          currentSystem: system,
          isPlaying: true,
          isLoading: false,
        });
      },

      stopGame: () => {
        const state = get();
        const currentRomUrl = state.currentRomUrl;

        // Revoke blob URL if it exists to free memory
        const customRoms = state.customRoms.map((rom) => {
          if (currentRomUrl?.startsWith("blob:") && rom.blobUrl === currentRomUrl) {
            return stripRuntimeBlobUrl(rom);
          }
          return rom;
        });

        if (currentRomUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(currentRomUrl);
        }

        set({
          currentRomUrl: null,
          currentRomName: null,
          isPlaying: false,
          isLoading: false,
          customRoms,
        });
      },

      setLoading: (loading) => set({ isLoading: loading }),

      // Favorites
      addFavorite: (gameId) =>
        set((state) => {
          if (state.favorites.includes(gameId)) {
            return {};
          }

          return {
            favorites: [...state.favorites, gameId],
            lastModified: Date.now(),
          };
        }),

      removeFavorite: (gameId) =>
        set((state) => ({
          favorites: state.favorites.filter((id) => id !== gameId),
          lastModified: Date.now(),
        })),

      isFavorite: (gameId) => get().favorites.includes(gameId),

      // Recently played
      addRecentlyPlayed: (game) =>
        set((state) => {
          const filtered = state.recentlyPlayed.filter((g) => g.gameId !== game.gameId);
          const newRecent = [{ ...game, lastPlayed: Date.now() }, ...filtered].slice(0, 20);

          // Update stats
          const systemCounts: Record<string, number> = {};
          for (const g of newRecent) {
            systemCounts[g.system] = (systemCounts[g.system] || 0) + 1;
          }
          const favoriteSystem =
            (Object.entries(systemCounts).sort((a, b) => b[1] - a[1])[0]?.[0] as SystemType) || "";

          return {
            recentlyPlayed: newRecent,
            stats: {
              ...state.stats,
              gamesPlayed: state.stats.gamesPlayed + 1,
              lastPlayedAt: Date.now(),
              favoriteSystem,
            },
            lastModified: Date.now(),
          };
        }),

      // Custom ROMs
      addCustomRom: (rom) =>
        set((state) => ({
          customRoms: [rom, ...state.customRoms.filter((r) => r.id !== rom.id)],
          lastModified: Date.now(),
        })),

      removeCustomRom: (romId) =>
        set((state) => {
          const rom = state.customRoms.find((r) => r.id === romId);
          if (rom?.blobUrl) {
            URL.revokeObjectURL(rom.blobUrl);
          }
          return {
            customRoms: state.customRoms.filter((r) => r.id !== romId),
            lastModified: Date.now(),
          };
        }),

      getCustomRomsForSystem: (system) => get().customRoms.filter((r) => r.system === system),

      // Save states
      saveSaveState: (gameId, slot, data) =>
        set((state) => ({
          saveStates: {
            ...state.saveStates,
            [gameId]: {
              ...state.saveStates[gameId],
              [slot]: data,
              lastSaved: Date.now(),
            },
          },
          lastModified: Date.now(),
        })),

      loadSaveState: (gameId, slot) => {
        const states = get().saveStates[gameId];
        return states?.[slot as keyof typeof states] as string | undefined;
      },

      // Settings
      updateSettings: (newSettings) =>
        set((state) => ({
          settings: { ...state.settings, ...newSettings },
          lastModified: Date.now(),
        })),

      // Stats
      updatePlayTime: (seconds) =>
        set((state) => ({
          stats: {
            ...state.stats,
            totalPlayTime: state.stats.totalPlayTime + seconds,
          },
          lastModified: Date.now(),
        })),

      // Progress sync
      getProgress: () => {
        const state = get();
        return {
          favorites: state.favorites,
          recentlyPlayed: state.recentlyPlayed,
          saveStates: state.saveStates,
          // Strip blobUrl from customRoms for persistence
          customRoms: state.customRoms.map(stripRuntimeBlobUrl),
          stats: state.stats,
          settings: state.settings,
          lastModified: state.lastModified,
        };
      },

      setProgress: (data) =>
        set({
          favorites: data.favorites || [],
          recentlyPlayed: data.recentlyPlayed || [],
          saveStates: data.saveStates || {},
          customRoms: data.customRoms || [],
          stats: data.stats || defaultStats,
          settings: data.settings || defaultSettings,
          lastModified: data.lastModified || Date.now(),
        }),
    }),
    {
      name: "retro-arcade-progress",
      partialize: (state) => ({
        favorites: state.favorites,
        recentlyPlayed: state.recentlyPlayed,
        saveStates: state.saveStates,
        // Don't persist blobUrls
        customRoms: state.customRoms.map(stripRuntimeBlobUrl),
        stats: state.stats,
        settings: state.settings,
        lastModified: state.lastModified,
      }),
    }
  )
);
