"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useToyFinderStore, type WishlistItem } from "./lib/store";
import {
  TOY_CATEGORIES,
  AGE_RANGES,
  PRIORITIES,
  CURATED_TOYS,
  getToyById,
  type Toy,
  type ToyCategory,
  type AgeRange,
  type Priority,
} from "./lib/constants";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import { FullscreenButton } from "@/shared/components/FullscreenButton";

const CONFETTI_SYMBOLS = ["&#x2B50;", "&#x1F389;", "&#x2728;", "&#x1F381;"];
const CONFETTI_PIECES = Array.from({ length: 20 }, (_, i) => ({
  id: i,
  left: Math.random() * 100,
  delay: Math.random() * 0.5,
  size: 1 + Math.random() * 1.5,
  symbol: CONFETTI_SYMBOLS[Math.floor(Math.random() * CONFETTI_SYMBOLS.length)],
}));

/**
 * Toy Finder - Kid-friendly toy discovery app
 *
 * Features:
 * - Browse toys by category
 * - Save toy ideas with priority levels
 * - View and manage an idea list
 * - Persistent storage
 */
export function ToyFinder() {
  const store = useToyFinderStore();
  const [confetti, setConfetti] = useState(false);

  // Auth sync for logged-in users
  const { isAuthenticated, syncStatus } = useAuthSync({
    appId: "toy-finder",
    localStorageKey: "toy-finder-progress",
    getState: () => store.getProgress(),
    setState: (data) => store.setProgress(data),
    debounceMs: 2000,
  });

  // Filter toys by category
  const filteredToys = useMemo(() => {
    let toys = CURATED_TOYS;
    if (store.selectedCategory !== "all") {
      toys = toys.filter((t) => t.category === store.selectedCategory);
    }
    if (store.selectedAgeRange !== "all") {
      toys = toys.filter((t) => t.ageRange === store.selectedAgeRange);
    }
    return toys;
  }, [store.selectedCategory, store.selectedAgeRange]);

  // Get wishlist toys with data
  const wishlistToys = useMemo(() => {
    return store.wishlistItems
      .map((item) => {
        const toy = getToyById(item.toyId);
        return toy ? { toy, item } : null;
      })
      .filter(Boolean) as { toy: Toy; item: WishlistItem }[];
  }, [store.wishlistItems]);

  // Handle add to wishlist
  const handleAddToWishlist = (toy: Toy, priority: Priority = "want") => {
    store.addToWishlist(toy, priority);
    store.setAddedToyId(toy.id);
    setConfetti(true);
    setTimeout(() => {
      store.setAddedToyId(null);
      setConfetti(false);
    }, 1500);
  };

  // Category change
  const handleCategoryChange = (category: ToyCategory) => {
    store.setCategory(category);
  };

  const handleAgeRangeChange = (ageRange: AgeRange) => {
    store.setAgeRange(ageRange);
  };

  const showAllToys = () => {
    store.setCategory("all");
    store.setAgeRange("all");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-400 via-blue-500 to-purple-500 p-4 flex flex-col">
      {/* iOS install prompt */}
      <IOSInstallPrompt />

      {/* Fullscreen button */}
      <div className="fixed top-4 right-4 z-50">
        <FullscreenButton />
      </div>

      {/* Header */}
      <header className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="text-3xl hover:scale-110 transition-transform"
            aria-label="Back to home"
          >
            &#x1F3E0;
          </Link>
          <h1 className="text-2xl md:text-3xl font-bold text-white drop-shadow-lg">
            &#x1F381; Toy Finder
          </h1>
        </div>
        <button
          onClick={() => store.setShowWishlist(true)}
          className="btn btn-lg bg-pink-500 hover:bg-pink-600 border-none text-white text-xl shadow-lg gap-2"
          aria-label="View idea list"
        >
          &#x2764;&#xFE0F;
          {store.wishlistItems.length > 0 && (
            <span className="badge badge-warning font-bold">
              {store.wishlistItems.length}
            </span>
          )}
        </button>
      </header>

      <div className="mb-4 border-l-4 border-white/80 bg-white/15 px-4 py-3 text-sm leading-relaxed text-white shadow-sm">
        <p className="font-bold">Idea list, not a store</p>
        <p>
          Prices are only a rough guide. Nothing can be bought here, and a
          grown-up should check before any purchase.
        </p>
      </div>

      {/* Category Tabs */}
      <div className="flex flex-wrap gap-2 justify-center mb-6 overflow-x-auto pb-2">
        {TOY_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => handleCategoryChange(cat.id)}
            className={`btn btn-md rounded-full font-bold transition-all whitespace-nowrap touch-manipulation ${
              store.selectedCategory === cat.id
                ? "bg-yellow-400 text-purple-900 shadow-lg scale-105"
                : "bg-white/80 text-purple-800 hover:bg-white"
            }`}
          >
            <span className="mr-1">{cat.emoji}</span>
            {cat.label}
          </button>
        ))}
      </div>

      {/* Age Filter */}
      <div
        className="flex flex-wrap gap-2 justify-center mb-6"
        aria-label="Filter toys by age range"
      >
        {AGE_RANGES.map((ageRange) => (
          <button
            key={ageRange.id}
            type="button"
            onClick={() => handleAgeRangeChange(ageRange.id)}
            aria-pressed={store.selectedAgeRange === ageRange.id}
            className={`btn btn-sm rounded-full font-bold transition-all whitespace-nowrap touch-manipulation ${
              store.selectedAgeRange === ageRange.id
                ? "bg-emerald-300 text-purple-950 shadow-lg scale-105"
                : "bg-white/80 text-purple-800 hover:bg-white"
            }`}
          >
            {ageRange.label}
          </button>
        ))}
      </div>

      {/* Toy Grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredToys.map((toy) => {
            const isInWishlist = store.isInWishlist(toy.id);
            const isJustAdded = store.addedToyId === toy.id;

            return (
              <div
                key={toy.id}
                className={`bg-white rounded-2xl shadow-lg overflow-hidden transform transition-all hover:scale-105 ${
                  isJustAdded ? "ring-4 ring-yellow-400 scale-105" : ""
                }`}
              >
                {/* Toy Image (Emoji placeholder) */}
                <div className="bg-gradient-to-br from-blue-100 to-purple-100 p-6 text-center relative">
                  <span className="text-6xl md:text-7xl">{toy.emoji}</span>
                  {toy.trending && (
                    <span className="absolute top-2 left-2 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full">
                      &#x1F525; HOT!
                    </span>
                  )}
                  {toy.originalPrice && (
                    <span className="absolute top-2 right-2 bg-green-500 text-white text-xs font-bold px-2 py-1 rounded-full">
                      SALE!
                    </span>
                  )}
                </div>

                {/* Toy Info */}
                <div className="p-3">
                  <h3 className="font-bold text-gray-800 text-sm md:text-base line-clamp-2 min-h-[2.5rem]">
                    {toy.name}
                  </h3>
                  <p className="text-gray-500 text-xs mt-1 line-clamp-2">
                    {toy.description}
                  </p>

                  {/* Price */}
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-lg font-bold text-green-600">
                      ${toy.price.toFixed(2)}
                    </span>
                    {toy.originalPrice && (
                      <span className="text-sm text-gray-400 line-through">
                        ${toy.originalPrice.toFixed(2)}
                      </span>
                    )}
                  </div>

                  {/* Rating */}
                  <div className="flex items-center gap-1 mt-1">
                    {[...Array(5)].map((_, i) => (
                      <span
                        key={i}
                        className={`text-sm ${
                          i < Math.floor(toy.rating)
                            ? "text-yellow-400"
                            : "text-gray-300"
                        }`}
                      >
                        &#x2B50;
                      </span>
                    ))}
                    <span className="text-xs text-gray-500 ml-1">
                      ({toy.rating})
                    </span>
                  </div>

                  {/* Add Button */}
                  <button
                    onClick={() => handleAddToWishlist(toy)}
                    disabled={isInWishlist}
                    className={`btn btn-block mt-3 font-bold rounded-full transition-all ${
                      isJustAdded
                        ? "bg-green-500 text-white"
                        : isInWishlist
                        ? "bg-pink-100 text-pink-600 border-pink-300"
                        : "bg-gradient-to-r from-orange-400 to-pink-500 text-white hover:from-orange-500 hover:to-pink-600 border-none"
                    }`}
                  >
                    {isJustAdded ? (
                      <>&#x2705; SAVED!</>
                    ) : isInWishlist ? (
                      <>&#x2764;&#xFE0F; Saved Idea</>
                    ) : (
                      <>&#x1F4A1; Save Idea</>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Empty state */}
        {filteredToys.length === 0 && (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">&#x1F61E;</div>
            <p className="text-white text-xl">
              No toys found for these filters.
            </p>
            <button
              onClick={showAllToys}
              className="btn btn-lg bg-yellow-400 text-purple-900 mt-4"
            >
              Show All Toys
            </button>
          </div>
        )}
      </div>

      {/* Wishlist Modal */}
      {store.showWishlist && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-lg w-full max-h-[85vh] overflow-hidden shadow-2xl">
            <div className="bg-gradient-to-r from-pink-500 to-purple-500 p-4 flex justify-between items-center">
              <h2 className="text-2xl font-bold text-white">
                &#x1F381; My Idea List
              </h2>
              <button
                onClick={() => store.setShowWishlist(false)}
                className="btn btn-circle btn-sm bg-white/20 text-white border-none hover:bg-white/30 text-lg"
              >
                &#x2715;
              </button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[65vh]">
              {wishlistToys.length === 0 ? (
                <div className="text-center py-8">
                  <div className="text-6xl mb-4">&#x1F622;</div>
                  <p className="text-gray-600 text-lg">
                    Your idea list is empty!
                  </p>
                  <p className="text-gray-500 mt-2">
                    Go find some fun ideas to save.
                  </p>
                  <button
                    onClick={() => store.setShowWishlist(false)}
                    className="btn btn-lg bg-gradient-to-r from-blue-500 to-purple-500 text-white mt-4 border-none"
                  >
                    &#x1F50D; Browse Toys
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {wishlistToys.map(({ toy, item }) => {
                    return (
                      <div
                        key={toy.id}
                        className="bg-gray-50 rounded-2xl p-4 relative flex gap-4"
                      >
                        {/* Remove button */}
                        <button
                          onClick={() => store.removeFromWishlist(toy.id)}
                          className="absolute top-2 right-2 btn btn-circle btn-xs bg-red-100 text-red-500 border-none hover:bg-red-200"
                          aria-label="Remove from idea list"
                        >
                          &#x2715;
                        </button>

                        {/* Toy emoji */}
                        <div className="bg-gradient-to-br from-blue-100 to-purple-100 rounded-xl p-3 flex items-center justify-center">
                          <span className="text-4xl">{toy.emoji}</span>
                        </div>

                        {/* Info */}
                        <div className="flex-1 pr-6">
                          <h3 className="font-bold text-gray-800">
                            {toy.name}
                          </h3>
                          <p className="text-green-600 font-bold">
                            ${toy.price.toFixed(2)}
                          </p>

                          {/* Priority selector */}
                          <div className="flex gap-1 mt-2">
                            {PRIORITIES.map((p) => (
                              <button
                                key={p.id}
                                onClick={() =>
                                  store.updatePriority(toy.id, p.id)
                                }
                                className={`btn btn-xs rounded-full ${
                                  item.priority === p.id
                                    ? `${p.color} text-white`
                                    : "bg-gray-200 text-gray-600"
                                }`}
                              >
                                {p.emoji} {p.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Summary */}
                  <div className="border-t pt-4 mt-4">
                    <div className="flex justify-between text-lg font-bold">
                      <span>Total Items:</span>
                      <span>{wishlistToys.length}</span>
                    </div>
                    <div className="flex justify-between text-green-600 font-bold text-xl mt-2">
                      <span>Estimated Total:</span>
                      <span>
                        $
                        {wishlistToys
                          .reduce((sum, { toy }) => sum + toy.price, 0)
                          .toFixed(2)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-gray-500">
                      Price totals are for planning only. Check with a grown-up
                      before buying anything.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confetti effect */}
      {confetti && (
        <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
          {CONFETTI_PIECES.map((piece) => (
            <div
              key={piece.id}
              className="absolute animate-confetti"
              style={{
                left: `${piece.left}%`,
                top: "-10%",
                animationDelay: `${piece.delay}s`,
                fontSize: `${piece.size}rem`,
              }}
            >
              {piece.symbol}
            </div>
          ))}
        </div>
      )}

      {/* Sync Status */}
      {isAuthenticated && (
        <div className="fixed bottom-2 right-2 text-xs text-white/60">
          {syncStatus === "syncing"
            ? "Saving..."
            : syncStatus === "synced"
            ? "Saved"
            : ""}
        </div>
      )}

      {/* Custom animations */}
      <style>{`
        @keyframes confetti {
          0% {
            transform: translateY(0) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translateY(100vh) rotate(720deg);
            opacity: 0;
          }
        }
        .animate-confetti {
          animation: confetti 2s ease-out forwards;
        }
      `}</style>
    </div>
  );
}

export default ToyFinder;
