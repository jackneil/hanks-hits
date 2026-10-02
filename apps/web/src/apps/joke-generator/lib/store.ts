/**
 * Joke Generator Zustand Store
 * Handles favorites, ratings, stats, and persistence
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { automaticStamp } from "@/shared/lib/progressStamp";
import { defineUntouchedProgress, markSaved, settleOnLoad } from "@/shared/lib/untouchedProgress";
import type { Joke, JokeCategory, Rating } from "./constants";

// Saved joke in favorites
export interface SavedJoke {
  id: string;
  setup: string;
  punchline: string;
  category: Exclude<JokeCategory, "all">;
  savedAt: number;
}

// Rating record
export interface JokeRating {
  jokeId: string;
  rating: Rating;
  ratedAt: number;
}

// Progress data shape (for sync)
// Index signature required for AppProgressData compatibility
export interface JokeGeneratorProgress {
  [key: string]: unknown;
  favorites: SavedJoke[];
  ratings: JokeRating[];
  seenJokeIds: string[];  // Track seen jokes to avoid repeats
  lastCategory: JokeCategory;
  jokesViewed: number;
  jokesCopied: number;
  jokesShared: number;
  lastModified: number;
}

// Store state
interface JokeStoreState extends JokeGeneratorProgress {
  // Current session state (not persisted)
  currentJoke: Joke | null;
  showPunchline: boolean;
  isLoading: boolean;
  showFavorites: boolean;
  copiedId: string | null;
}

// Store actions
interface JokeStoreActions {
  // Joke actions
  setCurrentJoke: (joke: Joke) => void;
  revealPunchline: () => void;
  hidePunchline: () => void;
  setLoading: (loading: boolean) => void;

  // Category
  setCategory: (category: JokeCategory) => void;

  // Favorites
  addFavorite: (joke: Joke) => void;
  removeFavorite: (jokeId: string) => void;
  isFavorite: (jokeId: string) => boolean;
  setShowFavorites: (show: boolean) => void;

  // Ratings
  rateJoke: (jokeId: string, rating: Rating) => void;
  getJokeRating: (jokeId: string) => Rating | null;

  // Stats
  /**
   * `automatic`: the joke showed by itself (the first joke of a page), see
   * automaticStamp. `synced`: the progress is the account's (useAuthSync).
   */
  incrementViewed: (automatic?: boolean, synced?: boolean) => void;
  incrementCopied: () => void;
  incrementShared: () => void;
  setCopiedId: (id: string | null) => void;

  // Seen jokes tracking
  markJokeSeen: (jokeId: string, automatic?: boolean, synced?: boolean) => void;
  getSeenJokeIds: () => string[];
  resetSeenJokes: () => void;

  // Sync helpers
  getProgress: () => JokeGeneratorProgress;
  setProgress: (data: JokeGeneratorProgress) => void;
}

const STORAGE_KEY = "joke-generator-progress";

const defaultProgress: JokeGeneratorProgress = {
  favorites: [],
  ratings: [],
  seenJokeIds: [],
  lastCategory: "all",
  jokesViewed: 0,
  jokesCopied: 0,
  jokesShared: 0,
  lastModified: 0, // Untouched until a player action stamps it (shared/lib/progressStamp.ts).
};

// The first joke of a page shows by itself: before the sync-time fix it
// stamped the time of an untouched store (one seen joke, one view). Every
// later joke is a tap on "next joke", a player's change: a store with more
// than one view holds the kid's reading and is not untouched.
const UNTOUCHED = defineUntouchedProgress("joke-generator", {
  layout: "flat",
  defaults: defaultProgress,
  // The category picker is a setting, not progress.
  ignore: ["lastCategory"],
  // The items that a player makes: a guest's items join the account's at
  // sign-in (foldGuestProgress). `max` is the schema's bound (progress-schemas.ts).
  lists: { favorites: { id: "id", max: 500 }, ratings: { id: "jokeId", max: 2000 }, seenJokeIds: { max: 5000 } },
  within: {
    jokesViewed: (value) => value === undefined || (typeof value === "number" && value <= 1),
    seenJokeIds: (value) => value === undefined || (Array.isArray(value) && value.length <= 1),
  },
});

export const useJokeStore = create<JokeStoreState & JokeStoreActions>()(
  persist(
    (set, get) => ({
      // Initial state
      ...defaultProgress,
      currentJoke: null,
      showPunchline: false,
      isLoading: false,
      showFavorites: false,
      copiedId: null,

      // Joke actions
      setCurrentJoke: (joke) => {
        set({
          currentJoke: joke,
          showPunchline: false,
          copiedId: null,
        });
      },

      revealPunchline: () => set({ showPunchline: true }),
      hidePunchline: () => set({ showPunchline: false }),
      setLoading: (loading) => set({ isLoading: loading }),

      // Category
      setCategory: (category) => {
        if (get().lastCategory === category) return;
        set({
          lastCategory: category,
          lastModified: Date.now(),
        });
      },

      // Favorites
      addFavorite: (joke) => {
        const saved: SavedJoke = {
          id: joke.id,
          setup: joke.setup,
          punchline: joke.punchline,
          category: joke.category,
          savedAt: Date.now(),
        };
        set((state) => ({
          favorites: [...state.favorites, saved],
          lastModified: Date.now(),
        }));
      },

      removeFavorite: (jokeId) => {
        if (!get().favorites.some((f) => f.id === jokeId)) return;
        set((state) => ({
          favorites: state.favorites.filter((f) => f.id !== jokeId),
          lastModified: Date.now(),
        }));
      },

      isFavorite: (jokeId) => {
        return get().favorites.some((f) => f.id === jokeId);
      },

      setShowFavorites: (show) => set({ showFavorites: show }),

      // Ratings
      rateJoke: (jokeId, rating) => {
        set((state) => ({
          ratings: [
            ...state.ratings.filter((r) => r.jokeId !== jokeId),
            { jokeId, rating, ratedAt: Date.now() },
          ],
          lastModified: Date.now(),
        }));
      },

      getJokeRating: (jokeId) => {
        const rating = get().ratings.find((r) => r.jokeId === jokeId);
        return rating?.rating ?? null;
      },

      // Stats
      incrementViewed: (automatic = false, synced = true) => {
        set((state) => ({
          jokesViewed: state.jokesViewed + 1,
          lastModified: automatic ? automaticStamp(state.lastModified, synced) : Date.now(),
        }));
      },

      incrementCopied: () => {
        set((state) => ({
          jokesCopied: state.jokesCopied + 1,
          lastModified: Date.now(),
        }));
      },

      incrementShared: () => {
        set((state) => ({
          jokesShared: state.jokesShared + 1,
          lastModified: Date.now(),
        }));
      },

      setCopiedId: (id) => set({ copiedId: id }),

      // Seen jokes tracking
      markJokeSeen: (jokeId, automatic = false, synced = true) => {
        set((state) => {
          if (state.seenJokeIds.includes(jokeId)) return state;
          return {
            seenJokeIds: [...state.seenJokeIds, jokeId],
            lastModified: automatic ? automaticStamp(state.lastModified, synced) : Date.now(),
          };
        });
      },

      getSeenJokeIds: () => get().seenJokeIds,

      resetSeenJokes: () => {
        if (get().seenJokeIds.length === 0) return;
        set({ seenJokeIds: [], lastModified: Date.now() });
      },

      // Sync helpers
      getProgress: (): JokeGeneratorProgress => {
        const state = get();
        return {
          favorites: state.favorites,
          ratings: state.ratings,
          seenJokeIds: state.seenJokeIds,
          lastCategory: state.lastCategory,
          jokesViewed: state.jokesViewed,
          jokesCopied: state.jokesCopied,
          jokesShared: state.jokesShared,
          lastModified: state.lastModified,
        } as JokeGeneratorProgress;
      },

      setProgress: (data) => {
        set({
          favorites: data.favorites ?? [],
          ratings: data.ratings ?? [],
          seenJokeIds: data.seenJokeIds ?? [],
          lastCategory: data.lastCategory ?? "all",
          jokesViewed: data.jokesViewed ?? 0,
          jokesCopied: data.jokesCopied ?? 0,
          jokesShared: data.jokesShared ?? 0,
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
      // Only persist progress data, not session state
      partialize: (state) => markSaved({
        favorites: state.favorites,
        ratings: state.ratings,
        seenJokeIds: state.seenJokeIds,
        lastCategory: state.lastCategory,
        jokesViewed: state.jokesViewed,
        jokesCopied: state.jokesCopied,
        jokesShared: state.jokesShared,
        lastModified: state.lastModified,
      }),
    }
  )
);
