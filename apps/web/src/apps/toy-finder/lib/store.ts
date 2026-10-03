/**
 * Toy Finder Zustand Store
 * Handles wishlist, filtering, and persistence
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { defineUntouchedProgress, markSaved, settleOnLoad } from "@/shared/lib/untouchedProgress";
import type { Toy, ToyCategory, AgeRange, Priority } from "./constants";

// Wishlist item (toy + metadata)
export interface WishlistItem {
  toyId: string;
  priority: Priority;
  addedAt: number;
  notes?: string;
}

// Progress data shape (for sync)
export interface ToyFinderProgress {
  [key: string]: unknown;
  wishlistItems: WishlistItem[];
  recentlyViewed: string[]; // toy IDs, max 20
  lastModified: number;
}

// Store state
interface ToyFinderState extends ToyFinderProgress {
  // Current session state (not persisted)
  selectedCategory: ToyCategory;
  selectedAgeRange: AgeRange;
  showWishlist: boolean;
  addedToyId: string | null; // For "Added!" animation
}

// Store actions
interface ToyFinderActions {
  // Category/filter actions
  setCategory: (category: ToyCategory) => void;
  setAgeRange: (ageRange: AgeRange) => void;

  // Wishlist actions
  addToWishlist: (toy: Toy, priority: Priority) => void;
  removeFromWishlist: (toyId: string) => void;
  updatePriority: (toyId: string, priority: Priority) => void;
  isInWishlist: (toyId: string) => boolean;
  getWishlistItem: (toyId: string) => WishlistItem | undefined;
  setShowWishlist: (show: boolean) => void;

  // Recently viewed
  addToRecentlyViewed: (toyId: string) => void;

  // Animation helpers
  setAddedToyId: (id: string | null) => void;

  // Sync helpers
  getProgress: () => ToyFinderProgress;
  setProgress: (data: ToyFinderProgress) => void;
}

const STORAGE_KEY = "toy-finder-progress";
const MAX_RECENTLY_VIEWED = 20;

const defaultProgress: ToyFinderProgress = {
  wishlistItems: [],
  recentlyViewed: [],
  lastModified: 0, // Untouched until a player action stamps it (shared/lib/progressStamp.ts).
};

const UNTOUCHED = defineUntouchedProgress("toy-finder", {
  layout: "flat",
  defaults: defaultProgress,
  // The items that a player makes (addListItems: an item made here and not
  // saved yet joins progress that the page takes). `max`: the schema's bound
  // (progress-schemas.ts), and for the toys that the kid looked at, the
  // store's own limit (addToRecentlyViewed keeps the newest, at the start).
  lists: {
    wishlistItems: { id: "toyId", max: 500, order: "newestLast", time: "addedAt" },
    recentlyViewed: { max: MAX_RECENTLY_VIEWED, order: "newestFirst" },
  },
});

export const useToyFinderStore = create<ToyFinderState & ToyFinderActions>()(
  persist(
    (set, get) => ({
      // Initial state
      ...defaultProgress,
      selectedCategory: "all",
      selectedAgeRange: "all",
      showWishlist: false,
      addedToyId: null,

      // Category/filter actions
      setCategory: (category) => set({ selectedCategory: category }),
      setAgeRange: (ageRange) => set({ selectedAgeRange: ageRange }),

      // Wishlist actions
      addToWishlist: (toy, priority) => {
        const item: WishlistItem = {
          toyId: toy.id,
          priority,
          addedAt: Date.now(),
        };
        set((state) => ({
          wishlistItems: [...state.wishlistItems.filter(w => w.toyId !== toy.id), item],
          lastModified: Date.now(),
        }));
      },

      removeFromWishlist: (toyId) => {
        if (!get().wishlistItems.some((w) => w.toyId === toyId)) return;
        set((state) => ({
          wishlistItems: state.wishlistItems.filter((w) => w.toyId !== toyId),
          lastModified: Date.now(),
        }));
      },

      updatePriority: (toyId, priority) => {
        const item = get().wishlistItems.find((w) => w.toyId === toyId);
        if (!item || item.priority === priority) return;
        set((state) => ({
          wishlistItems: state.wishlistItems.map((w) =>
            w.toyId === toyId ? { ...w, priority } : w
          ),
          lastModified: Date.now(),
        }));
      },

      isInWishlist: (toyId) => {
        return get().wishlistItems.some((w) => w.toyId === toyId);
      },

      getWishlistItem: (toyId) => {
        return get().wishlistItems.find((w) => w.toyId === toyId);
      },

      setShowWishlist: (show) => set({ showWishlist: show }),

      // Recently viewed
      addToRecentlyViewed: (toyId) => {
        set((state) => {
          // Already the newest one: nothing changes.
          if (state.recentlyViewed[0] === toyId) return {};
          const filtered = state.recentlyViewed.filter((id) => id !== toyId);
          const updated = [toyId, ...filtered].slice(0, MAX_RECENTLY_VIEWED);
          return {
            recentlyViewed: updated,
            lastModified: Date.now(),
          };
        });
      },

      // Animation helpers
      setAddedToyId: (id) => set({ addedToyId: id }),

      // Sync helpers
      getProgress: (): ToyFinderProgress => {
        const state = get();
        return {
          wishlistItems: state.wishlistItems,
          recentlyViewed: state.recentlyViewed,
          lastModified: state.lastModified,
        } as ToyFinderProgress;
      },

      setProgress: (data) => {
        set({
          wishlistItems: data.wishlistItems ?? [],
          recentlyViewed: data.recentlyViewed ?? [],
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
        wishlistItems: state.wishlistItems,
        recentlyViewed: state.recentlyViewed,
        lastModified: state.lastModified,
      }),
    }
  )
);
