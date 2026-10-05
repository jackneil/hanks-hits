import { bindPersistedStore } from "@/lib/owner-bound-progress";
import { createOwnerPersistStorage } from "@/lib/owner-bound-progress/persistStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { sameProgress } from "@/shared/lib/progressStamp";
import { defineUntouchedProgress, markSaved, settleOnLoad } from "@/shared/lib/untouchedProgress";
import type { SystemType } from "./constants";

// Recently played game entry
export interface RecentGame {
  gameId: string;
  name: string;
  system: SystemType;
  lastPlayed: number; // timestamp
}

/**
 * The ROM of the game that plays: a URL on this site (a catalog game, from
 * /api/roms) or the file that the kid uploaded.
 *
 * An uploaded ROM stays a File (a Blob) and never becomes a stored "blob:"
 * URL. EmulatorJS 4.2.3 revokes a "blob:" game URL after it reads the ROM
 * (data/src/emulator.js, downloadFile). The emulator page is on this site, so
 * that revoke kills the link for the whole site. EmulatorView makes a new
 * object URL each time the emulator starts and revokes that URL when that
 * start ends, so Start over and a second start never use a dead link.
 */
export type RomSource = string | Blob;

// An uploaded ROM. The name and the console persist; the file stays only in
// memory for this visit (the "Your ROMs" list plays it again).
export interface CustomRom {
  id: string;
  name: string;
  system: SystemType;
  addedAt: number;
  /** The uploaded file. In memory only: never persisted, never synced. */
  file?: Blob;
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
  customRoms: Omit<CustomRom, "file">[];
  stats: PlayStats;
  settings: ArcadeSettings;
  lastModified: number;
}

// Store state interface
interface RetroArcadeState {
  // UI state (not persisted)
  currentSystem: SystemType | null;
  /** The ROM that plays (see RomSource). */
  currentRom: RomSource | null;
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
  startGame: (rom: RomSource, romName: string, system: SystemType) => void;
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

const UNTOUCHED = defineUntouchedProgress("retro-arcade", {
  layout: "flat",
  defaults: {
    favorites: [],
    recentlyPlayed: [],
    customRoms: [],
    stats: defaultStats,
    settings: defaultSettings,
    lastModified: 0,
  } satisfies RetroArcadeProgress,
  // Settings are not progress (shared/lib/untouchedProgress.ts).
  ignore: ["settings"],
  // The items that a player makes (addListItems: an item made here and not
  // saved yet joins progress that the page takes). `max` is the schema's
  // bound (progress-schemas.ts). addFavorite adds at the end; addCustomRom
  // adds at the start.
  lists: {
    favorites: { max: 500, order: "newestLast" },
    customRoms: { id: "id", max: 500, order: "newestFirst", time: "addedAt" },
  },
});

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

function stripRuntimeFile(rom: CustomRom): Omit<CustomRom, "file"> {
  return {
    id: rom.id,
    name: rom.name,
    system: rom.system,
    addedAt: rom.addedAt,
  };
}

// Immutable ROM-list changes invalidate this projection; loading/pause updates do not.
const persistedRomMetadata = new WeakMap<CustomRom[], Omit<CustomRom, "file">[]>();
function romMetadataForSave(roms: CustomRom[]): Omit<CustomRom, "file">[] {
  let metadata = persistedRomMetadata.get(roms);
  if (!metadata) {
    metadata = roms.map(stripRuntimeFile);
    persistedRomMetadata.set(roms, metadata);
  }
  return metadata;
}

/**
 * The ROM list after a cloud pull (setProgress). The cloud list gives the
 * names; the files stay in memory for this visit only, so the cloud never
 * has them. Each cloud entry gets the file of the same ROM on this page: the
 * same id, else the same console and name (the same game, see addCustomRom).
 * An upload of this visit that the cloud does not list yet stays, with its
 * file, before the cloud entries. An entry without a file that the cloud
 * does not list goes. Without this merge, a pull in the middle of a visit
 * shows every upload as "Expired".
 */
export function mergeCustomRoms(
  cloudRoms: readonly Omit<CustomRom, "file">[],
  current: readonly CustomRom[]
): CustomRom[] {
  const withFile = current.filter((rom) => rom.file);
  const used = new Set<CustomRom>();
  const take = (match: (rom: CustomRom) => boolean) => {
    const found = withFile.find((rom) => !used.has(rom) && match(rom));
    if (found) used.add(found);
    return found;
  };
  const merged = cloudRoms.map((entry): CustomRom => {
    const rom = stripRuntimeFile(entry);
    const local =
      take((r) => r.id === rom.id) ?? take((r) => r.system === rom.system && r.name === rom.name);
    return local ? { ...rom, file: local.file } : rom;
  });
  return [...withFile.filter((rom) => !used.has(rom)), ...merged];
}

export const useRetroArcadeStore = create<RetroArcadeState>()(
  persist(
    (set, get) => ({
      // Initial UI state
      currentSystem: null,
      currentRom: null,
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
      lastModified: 0, // Untouched until a player action stamps it (shared/lib/progressStamp.ts).

      // UI Actions
      setCurrentSystem: (system) => set({ currentSystem: system }),

      startGame: (rom, romName, system) => {
        const state = get();
        // Add to recently played
        state.addRecentlyPlayed({ gameId: `${system}-${romName}`, name: romName, system });
        set({
          currentRom: rom,
          currentRomName: romName,
          currentSystem: system,
          isPlaying: true,
          isLoading: false,
          restartNonce: 0,
        });
      },

      restartGame: () => {
        const state = get();
        if (!state.currentRom || !state.currentRomName || !state.currentSystem) return;
        set({
          isPlaying: true,
          isLoading: false,
          restartNonce: state.restartNonce + 1,
        });
      },

      // The store holds no object URL, so there is nothing to revoke here.
      // EmulatorView revokes the URL of each start when that start ends. An
      // uploaded file stays in customRoms, so "Your ROMs" can play it again.
      stopGame: () =>
        set({
          currentRom: null,
          currentRomName: null,
          isPlaying: false,
          isLoading: false,
        }),

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
        set((state) =>
          state.favorites.includes(gameId)
            ? { favorites: state.favorites.filter((id) => id !== gameId), lastModified: Date.now() }
            : {}
        ),

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

      // Custom ROMs. A new upload of a name on the same console replaces the
      // old entry: the saves of both are the same game (gameId is console +
      // name), and the list does not grow with each upload.
      addCustomRom: (rom) =>
        set((state) => {
          const customRoms = [
            rom,
            ...state.customRoms.filter(
              (r) => r.id !== rom.id && !(r.system === rom.system && r.name === rom.name)
            ),
          ];
          // Only the names sync: a new file for the same ROM keeps the time.
          const synced = sameProgress(customRoms.map(stripRuntimeFile), state.customRoms.map(stripRuntimeFile));
          return synced ? { customRoms } : { customRoms, lastModified: Date.now() };
        }),

      removeCustomRom: (romId) =>
        set((state) =>
          state.customRoms.some((r) => r.id === romId)
            ? { customRoms: state.customRoms.filter((r) => r.id !== romId), lastModified: Date.now() }
            : {}
        ),

      getCustomRomsForSystem: (system) => get().customRoms.filter((r) => r.system === system),

      // Settings
      updateSettings: (newSettings) =>
        set((state) => {
          const settings = { ...state.settings, ...newSettings };
          return sameProgress(settings, state.settings) ? {} : { settings, lastModified: Date.now() };
        }),

      // Stats
      updatePlayTime: (seconds) =>
        set((state) =>
          seconds > 0
            ? {
                stats: {
                  ...state.stats,
                  totalPlayTime: state.stats.totalPlayTime + seconds,
                },
                lastModified: Date.now(),
              }
            : {}
        ),

      // Progress sync
      getProgress: () => {
        const state = get();
        return {
          favorites: state.favorites,
          recentlyPlayed: state.recentlyPlayed,
          // The uploaded files stay in memory; only their names sync.
          customRoms: state.customRoms.map(stripRuntimeFile),
          stats: state.stats,
          settings: state.settings,
          lastModified: state.lastModified,
        };
      },

      // Reads only the known fields, so a legacy "saveStates" field in cloud
      // progress is dropped here. The uploaded files of this visit stay
      // (mergeCustomRoms).
      setProgress: (data) =>
        set((state) => ({
          favorites: data.favorites || [],
          recentlyPlayed: data.recentlyPlayed || [],
          customRoms: mergeCustomRoms(data.customRoms || [], state.customRoms),
          stats: data.stats || defaultStats,
          settings: data.settings || defaultSettings,
          // Taking progress is not a player action: it keeps the time it gets.
          lastModified: typeof data.lastModified === "number" ? data.lastModified : 0,
        })),
    }),
    {
      storage: createOwnerPersistStorage("retro-arcade-progress", "retro-arcade"),
      skipHydration: true,
      name: "retro-arcade-progress",
      // Version 1: save states left localStorage (they are in IndexedDB now).
      version: RETRO_ARCADE_STORAGE_VERSION,
      migrate: (persisted) => dropLegacySaveStates(persisted),
      // A save of the code before the sync-time fix gets the real time of
      // its progress. The version stays, so that code still loads a new
      // save (shared/lib/untouchedProgress.ts).
      merge: settleOnLoad(UNTOUCHED),
      partialize: (state) =>
        markSaved({
          favorites: state.favorites,
          recentlyPlayed: state.recentlyPlayed,
          // Never persist the uploaded files
          customRoms: romMetadataForSave(state.customRoms),
          stats: state.stats,
          settings: state.settings,
          lastModified: state.lastModified,
        }),
    }
  )
);

bindPersistedStore("retro-arcade-progress", useRetroArcadeStore.persist, () => useRetroArcadeStore.setState({}));
