/**
 * Drawing App Zustand Store
 * Handles tools, colors, saved artworks, and persistence
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { sameProgress } from "@/shared/lib/progressStamp";
import { defineUntouchedProgress, markSaved, settleOnLoad } from "@/shared/lib/untouchedProgress";
import type { DrawingTool } from "./constants";
import {
  STORAGE_KEY,
  BASIC_COLORS,
  SIZE_PRESETS,
  MAX_SAVED_ARTWORKS,
} from "./constants";

// Saved artwork structure
export interface SavedArtwork {
  id: string;
  name: string;
  thumbnail: string; // Base64 small preview
  dataUrl: string; // Full image data
  createdAt: string;
  editedAt: string;
}

// Settings structure
export interface DrawingSettings {
  defaultColor: string;
  defaultSize: number;
  defaultTool: DrawingTool;
  soundEnabled: boolean;
  showGrid: boolean;
}

// Stats structure
export interface DrawingStats {
  artworksCreated: number;
  totalDrawTime: number;
}

// Progress data shape (for sync)
export interface DrawingAppProgress {
  [key: string]: unknown;
  settings: DrawingSettings;
  stats: DrawingStats;
  savedArtworks?: SavedArtwork[];
  lastModified: number;
}

// Current session state (not synced)
interface SessionState {
  tool: DrawingTool;
  color: string;
  brushSize: number;
  isDrawing: boolean;
}

// Store state
interface DrawingStoreState extends SessionState {
  // Persisted settings
  settings: DrawingSettings;
  stats: DrawingStats;
  savedArtworks: SavedArtwork[];
  lastModified: number;

  // Gallery state
  showGallery: boolean;
  selectedArtwork: SavedArtwork | null;
}

// Store actions
interface DrawingStoreActions {
  // Tool actions
  setTool: (tool: DrawingTool) => void;
  setColor: (color: string) => void;
  setBrushSize: (size: number) => void;
  setIsDrawing: (drawing: boolean) => void;

  // Settings actions
  updateSettings: (settings: Partial<DrawingSettings>) => void;
  toggleSound: () => void;
  toggleGrid: () => void;

  // Artwork actions
  saveArtwork: (dataUrl: string, name?: string) => string;
  deleteArtwork: (id: string) => void;
  updateArtwork: (id: string, dataUrl: string) => void;
  getArtwork: (id: string) => SavedArtwork | undefined;

  // Gallery actions
  setShowGallery: (show: boolean) => void;
  setSelectedArtwork: (artwork: SavedArtwork | null) => void;

  // Stats actions
  incrementArtworksCreated: () => void;
  addDrawTime: (seconds: number) => void;

  // Sync helpers
  getProgress: () => DrawingAppProgress;
  setProgress: (data: DrawingAppProgress) => void;
}

const defaultSettings: DrawingSettings = {
  defaultColor: BASIC_COLORS[4].hex, // Blue
  defaultSize: SIZE_PRESETS.medium,
  defaultTool: "brush",
  soundEnabled: true,
  showGrid: false,
};

const defaultStats: DrawingStats = {
  artworksCreated: 0,
  totalDrawTime: 0,
};

const UNTOUCHED = defineUntouchedProgress("drawing-app", {
  layout: "flat",
  defaults: { settings: defaultSettings, stats: defaultStats, savedArtworks: [], lastModified: 0 },
  // Settings are not progress (shared/lib/untouchedProgress.ts).
  ignore: ["settings"],
  // The items that a player makes (addListItems: an item made here and not
  // saved yet joins progress that the page takes). saveArtwork adds at the
  // start and drops the oldest past MAX_SAVED_ARTWORKS (the schema's bound).
  lists: { savedArtworks: { id: "id", max: MAX_SAVED_ARTWORKS, order: "newestFirst", time: "createdAt" } },
});

// Generate unique ID
function generateId(): string {
  return `art_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Create thumbnail from full image
function createThumbnail(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const maxSize = 200;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxSize) {
          height = (height * maxSize) / width;
          width = maxSize;
        }
      } else {
        if (height > maxSize) {
          width = (width * maxSize) / height;
          height = maxSize;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      } else {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/**
 * The small picture of a saved artwork, made after the save. It syncs with
 * the artwork, so a new picture stamps the time.
 */
function withThumbnail(id: string, thumbnail: string) {
  return (state: DrawingStoreState): Partial<DrawingStoreState> => {
    const artwork = state.savedArtworks.find((art) => art.id === id);
    if (!artwork || artwork.thumbnail === thumbnail) return {};
    return {
      savedArtworks: state.savedArtworks.map((art) => (art.id === id ? { ...art, thumbnail } : art)),
      lastModified: Date.now(),
    };
  };
}

export const useDrawingStore = create<DrawingStoreState & DrawingStoreActions>()(
  persist(
    (set, get) => ({
      // Initial session state
      tool: "brush",
      color: BASIC_COLORS[4].hex, // Blue
      brushSize: SIZE_PRESETS.medium,
      isDrawing: false,

      // Initial persisted state
      settings: defaultSettings,
      stats: defaultStats,
      savedArtworks: [],
      lastModified: 0, // Untouched until a player action stamps it (shared/lib/progressStamp.ts).

      // Gallery state
      showGallery: false,
      selectedArtwork: null,

      // Tool actions
      setTool: (tool) => set({ tool }),

      setColor: (color) => set({ color }),

      setBrushSize: (size) => set({ brushSize: size }),

      setIsDrawing: (drawing) => set({ isDrawing: drawing }),

      // Settings actions
      updateSettings: (newSettings) => {
        set((state) => {
          const settings = { ...state.settings, ...newSettings };
          return sameProgress(settings, state.settings) ? {} : { settings, lastModified: Date.now() };
        });
      },

      toggleSound: () => {
        set((state) => ({
          settings: { ...state.settings, soundEnabled: !state.settings.soundEnabled },
          lastModified: Date.now(),
        }));
      },

      toggleGrid: () => {
        set((state) => ({
          settings: { ...state.settings, showGrid: !state.settings.showGrid },
          lastModified: Date.now(),
        }));
      },

      // Artwork actions
      saveArtwork: (dataUrl, name) => {
        const id = generateId();
        const now = new Date().toISOString();
        const defaultName = `My Art ${get().savedArtworks.length + 1}`;

        // Create artwork synchronously with placeholder thumbnail
        const newArtwork: SavedArtwork = {
          id,
          name: name || defaultName,
          thumbnail: dataUrl, // Will be replaced async
          dataUrl,
          createdAt: now,
          editedAt: now,
        };

        // Add to state immediately
        set((state) => {
          const artworks = [newArtwork, ...state.savedArtworks];
          // Limit to max artworks
          if (artworks.length > MAX_SAVED_ARTWORKS) {
            artworks.pop();
          }
          return {
            savedArtworks: artworks,
            stats: {
              ...state.stats,
              artworksCreated: state.stats.artworksCreated + 1,
            },
            lastModified: Date.now(),
          };
        });

        // Create thumbnail async and update
        createThumbnail(dataUrl).then((thumbnail) => set(withThumbnail(id, thumbnail)));

        return id;
      },

      deleteArtwork: (id) => {
        set((state) =>
          state.savedArtworks.some((art) => art.id === id)
            ? { savedArtworks: state.savedArtworks.filter((art) => art.id !== id), lastModified: Date.now() }
            : {}
        );
      },

      updateArtwork: (id, dataUrl) => {
        const now = new Date().toISOString();
        set((state) =>
          state.savedArtworks.some((art) => art.id === id)
            ? {
                savedArtworks: state.savedArtworks.map((art) =>
                  art.id === id
                    ? { ...art, dataUrl, editedAt: now }
                    : art
                ),
                lastModified: Date.now(),
              }
            : {}
        );

        // Update thumbnail async
        createThumbnail(dataUrl).then((thumbnail) => set(withThumbnail(id, thumbnail)));
      },

      getArtwork: (id) => {
        return get().savedArtworks.find((art) => art.id === id);
      },

      // Gallery actions
      setShowGallery: (show) => set({ showGallery: show }),

      setSelectedArtwork: (artwork) => set({ selectedArtwork: artwork }),

      // Stats actions
      incrementArtworksCreated: () => {
        set((state) => ({
          stats: {
            ...state.stats,
            artworksCreated: state.stats.artworksCreated + 1,
          },
          lastModified: Date.now(),
        }));
      },

      addDrawTime: (seconds) => {
        if (seconds <= 0) return;
        set((state) => ({
          stats: {
            ...state.stats,
            totalDrawTime: state.stats.totalDrawTime + seconds,
          },
          lastModified: Date.now(),
        }));
      },

      // Sync helpers
      getProgress: (): DrawingAppProgress => {
        const state = get();
        return {
          settings: state.settings,
          stats: state.stats,
          savedArtworks: state.savedArtworks,
          lastModified: state.lastModified,
        };
      },

      setProgress: (data) => {
        set({
          settings: data.settings ?? defaultSettings,
          stats: data.stats ?? defaultStats,
          savedArtworks: data.savedArtworks ?? get().savedArtworks,
          // Taking progress is not a player action: it keeps the time it gets.
          lastModified: typeof data.lastModified === "number" ? data.lastModified : 0,
        });
      },
    }),
    {
      name: STORAGE_KEY,
      // A save of the code before the sync-time fix gets the real time of
      // its progress. The version stays, so that code still loads a new
      // save (shared/lib/untouchedProgress.ts).
      merge: settleOnLoad(UNTOUCHED),
      // Persist everything except transient drawing state
      partialize: (state) => markSaved({
        settings: state.settings,
        stats: state.stats,
        savedArtworks: state.savedArtworks,
        lastModified: state.lastModified,
      }),
    }
  )
);
