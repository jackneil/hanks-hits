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
//
// Save states are NOT part of the progress. They stay on this device in
// IndexedDB (lib/saveStates.ts). Progress from before that change can still
// carry a "saveStates" field (in localStorage or in the cloud); setProgress
// and the persist migration below drop it.
export interface RetroArcadeProgress {
  [key: string]: unknown;
  favorites: string[];
  recentlyPlayed: RecentGame[];
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
  restartNonce: number;

  // Persisted data
  favorites: string[];
  recentlyPlayed: RecentGame[];
  customRoms: CustomRom[];
  stats: PlayStats;
  settings: ArcadeSettings;
  lastModified: number;

  // Actions
  setCurrentSystem: (system: SystemType | null) => void;
  startGame: (romUrl: string, romName: string, system: SystemType) => void;
  stopGame: () => void;
  /** Relaunches the selected ROM without changing saved progress. */
  restartGame: () => void;
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

/** The version of the localStorage data. Version 0 kept save states in it. */
export const RETRO_ARCADE_STORAGE_VERSION = 1;

/**
 * Removes the "saveStates" field of version 0 data. That field held base64
 * save states in localStorage. The old message code turned the EmulatorJS
 * save object into an empty string, so the field holds no usable state.
 */
export function dropLegacySaveStates(persisted: unknown): PersistedArcade {
  if (!persisted || typeof persisted !== "object") return {} as PersistedArcade;
  const { saveStates: _legacy, ...rest } = persisted as Record<string, unknown>;
  void _legacy;
  // Zustand merges this over the defaults, so a missing field keeps its default.
  return rest as PersistedArcade;
}

/** What goes to localStorage (see partialize below). */
type PersistedArcade = Pick<
  RetroArcadeProgress,
  "favorites" | "recentlyPlayed" | "customRoms" | "stats" | "settings" | "lastModified"
>;

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
      restartNonce: 0,

      // Initial persisted state
      favorites: [],
      recentlyPlayed: [],
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
          restartNonce: 0,
        });
      },

      restartGame: () => {
        const state = get();
        if (!state.currentRomUrl || !state.currentRomName || !state.currentSystem) return;
        set({
          isPlaying: true,
          isLoading: false,
          restartNonce: state.restartNonce + 1,
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
          // Strip blobUrl from customRoms for persistence
          customRoms: state.customRoms.map(stripRuntimeBlobUrl),
          stats: state.stats,
          settings: state.settings,
          lastModified: state.lastModified,
        };
      },

      // Reads only the known fields, so a legacy "saveStates" field in cloud
      // progress is dropped here.
      setProgress: (data) =>
        set({
          favorites: data.favorites || [],
          recentlyPlayed: data.recentlyPlayed || [],
          customRoms: data.customRoms || [],
          stats: data.stats || defaultStats,
          settings: data.settings || defaultSettings,
          lastModified: data.lastModified || Date.now(),
        }),
    }),
    {
      name: "retro-arcade-progress",
      // Version 1: save states left localStorage (they are in IndexedDB now).
      version: RETRO_ARCADE_STORAGE_VERSION,
      migrate: (persisted) => dropLegacySaveStates(persisted),
      partialize: (state) => ({
        favorites: state.favorites,
        recentlyPlayed: state.recentlyPlayed,
        // Don't persist blobUrls
        customRoms: state.customRoms.map(stripRuntimeBlobUrl),
        stats: state.stats,
        settings: state.settings,
        lastModified: state.lastModified,
      }),
    }
  )
);
