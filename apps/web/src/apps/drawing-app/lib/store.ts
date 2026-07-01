/**
 * Drawing App Zustand Store
 * Handles tools, colors, saved artworks, and persistence
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
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
      lastModified: Date.now(),

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
        set((state) => ({
          settings: { ...state.settings, ...newSettings },
          lastModified: Date.now(),
        }));
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
        createThumbnail(dataUrl).then((thumbnail) => {
          set((state) => ({
            savedArtworks: state.savedArtworks.map((art) =>
              art.id === id ? { ...art, thumbnail } : art
            ),
          }));
        });

        return id;
      },

      deleteArtwork: (id) => {
        set((state) => ({
          savedArtworks: state.savedArtworks.filter((art) => art.id !== id),
          lastModified: Date.now(),
        }));
      },

      updateArtwork: (id, dataUrl) => {
        const now = new Date().toISOString();
        set((state) => ({
          savedArtworks: state.savedArtworks.map((art) =>
            art.id === id
              ? { ...art, dataUrl, editedAt: now }
              : art
          ),
          lastModified: Date.now(),
        }));

        // Update thumbnail async
        createThumbnail(dataUrl).then((thumbnail) => {
          set((state) => ({
            savedArtworks: state.savedArtworks.map((art) =>
              art.id === id ? { ...art, thumbnail } : art
            ),
          }));
        });
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
          lastModified: Date.now(),
        });
      },
    }),
    {
      name: STORAGE_KEY,
      // Persist everything except transient drawing state
      partialize: (state) => ({
        settings: state.settings,
        stats: state.stats,
        savedArtworks: state.savedArtworks,
        lastModified: state.lastModified,
      }),
    }
  )
);
