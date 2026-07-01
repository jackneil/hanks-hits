"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useJokeStore } from "./lib/store";
import {
  JOKE_CATEGORIES,
  getRandomJoke,
  fetchDadJoke,
  type JokeCategory,
  type Joke,
} from "./lib/constants";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import { FullscreenButton } from "@/shared/components/FullscreenButton";

/**
 * Joke Generator - Kid-friendly joke app
 *
 * Features:
 * - Random jokes from curated kid-friendly collection
 * - Category filtering
 * - Save favorites
 * - Rate jokes (funny/not funny)
 * - Copy and share
 */
export function JokeGenerator() {
  const store = useJokeStore();
  const [confetti, setConfetti] = useState(false);

  // Auth sync for logged-in users
  const { isAuthenticated, syncStatus } = useAuthSync({
    appId: "joke-generator",
    localStorageKey: "joke-generator-progress",
    getState: () => store.getProgress(),
    setState: (data) => store.setProgress(data),
    debounceMs: 2000,
  });

  // Get a new joke - accepts optional category override to fix race condition
  const getNewJoke = useCallback(async (categoryOverride?: JokeCategory) => {
    store.setLoading(true);
    const category = categoryOverride ?? store.lastCategory;

    try {
      let newJoke: Joke;

      if (category === "dad-jokes") {
        // Fetch from icanhazdadjoke.com API
        newJoke = await fetchDadJoke();
      } else {
        // Get from static collection, avoiding seen jokes
        newJoke = getRandomJoke(category, store.getSeenJokeIds());
      }

      // Mark this joke as seen
      store.markJokeSeen(newJoke.id);
      store.setCurrentJoke(newJoke);
      store.incrementViewed();
    } catch {
      // Fallback on error
      const fallbackJoke = getRandomJoke("all", []);
      store.setCurrentJoke(fallbackJoke);
    } finally {
      store.setLoading(false);
    }
  }, [store]);

  // Initial joke on mount
  useEffect(() => {
    if (!store.currentJoke) {
      getNewJoke();
    }
  }, []);

  // Copy joke to clipboard
  const handleCopy = async () => {
    if (!store.currentJoke) return;
    const text = `${store.currentJoke.setup}\n\n${store.currentJoke.punchline}`;
    try {
      await navigator.clipboard.writeText(text);
      store.setCopiedId(store.currentJoke.id);
      store.incrementCopied();
      setTimeout(() => store.setCopiedId(null), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  // Share joke (uses Web Share API if available)
  const handleShare = async () => {
    if (!store.currentJoke) return;
    const text = `${store.currentJoke.setup}\n\n${store.currentJoke.punchline}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: "Check out this joke!",
          text: text,
        });
        store.incrementShared();
      } catch (err) {
        // User cancelled or error
        console.log("Share cancelled or failed:", err);
      }
    } else {
      // Fallback to copy
      handleCopy();
    }
  };

  // Toggle favorite
  const handleFavorite = () => {
    if (!store.currentJoke) return;
    if (store.isFavorite(store.currentJoke.id)) {
      store.removeFavorite(store.currentJoke.id);
    } else {
      store.addFavorite(store.currentJoke);
      // Quick heart animation
      setConfetti(true);
      setTimeout(() => setConfetti(false), 500);
    }
  };

  // Rate joke - auto-advances to next joke after rating
  const handleRate = (rating: "funny" | "not-funny") => {
    if (!store.currentJoke) return;
    store.rateJoke(store.currentJoke.id, rating);
    if (rating === "funny") {
      setConfetti(true);
      setTimeout(() => setConfetti(false), 800);
    }
    // Show loading feedback quickly, then fetch new joke
    setTimeout(() => {
      store.setLoading(true);
      getNewJoke();
    }, 500);
  };

  // Category change - pass category directly to avoid race condition
  const handleCategoryChange = (category: JokeCategory) => {
    store.setCategory(category);
    getNewJoke(category);  // Pass category directly instead of relying on store state
  };

  const currentRating = store.currentJoke
    ? store.getJokeRating(store.currentJoke.id)
    : null;
  const isFav = store.currentJoke ? store.isFavorite(store.currentJoke.id) : false;

  return (
    <div className="min-h-screen bg-gradient-to-b from-yellow-300 via-yellow-400 to-orange-400 p-4 flex flex-col">
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
          <h1 className="text-2xl md:text-3xl font-bold text-purple-800 drop-shadow-sm">
            Joke Generator
          </h1>
        </div>
        <button
          onClick={() => store.setShowFavorites(true)}
          className="btn btn-circle btn-lg bg-pink-500 hover:bg-pink-600 border-none text-white text-2xl shadow-lg"
          aria-label="View favorites"
        >
          &#x2764;&#xFE0F;
        </button>
      </header>

      {/* Category Pills */}
      <div className="flex flex-wrap gap-2 justify-center mb-6">
        {JOKE_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => handleCategoryChange(cat.id)}
            className={`btn btn-md rounded-full font-bold transition-all touch-manipulation ${
              store.lastCategory === cat.id
                ? "bg-purple-600 text-white shadow-lg scale-105"
                : "bg-white/80 text-purple-800 hover:bg-white"
            }`}
          >
            <span className="mr-1">{cat.emoji}</span>
            {cat.label}
          </button>
        ))}
      </div>

      {/* Joke Card */}
      <div className="flex-1 flex flex-col items-center justify-center">
        <div
          className={`bg-white rounded-3xl shadow-2xl p-6 md:p-8 max-w-lg w-full mx-auto transform transition-all duration-300 ${
            store.isLoading ? "scale-95 opacity-50" : "scale-100"
          }`}
        >
          {store.currentJoke ? (
            <>
              {/* Setup */}
              <p className="text-xl md:text-2xl font-bold text-gray-800 text-center mb-6 leading-relaxed">
                {store.currentJoke.setup}
              </p>

              {/* Punchline - hidden until revealed (only if joke has a punchline) */}
              {store.currentJoke.punchline && (
                <div
                  className={`transition-all duration-500 ease-out ${
                    store.showPunchline
                      ? "opacity-100 translate-y-0 max-h-40"
                      : "opacity-0 translate-y-4 max-h-0 overflow-hidden"
                  }`}
                >
                  <p className="text-xl md:text-2xl font-bold text-purple-600 text-center leading-relaxed">
                    {store.currentJoke.punchline}
                  </p>
                  <div className="text-4xl text-center mt-2">
                    &#x1F389;
                  </div>
                </div>
              )}

              {/* Reveal Button - only show if joke has a punchline to reveal */}
              {!store.showPunchline && store.currentJoke.punchline && (
                <button
                  onClick={() => store.revealPunchline()}
                  className="btn btn-lg w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold text-lg rounded-full border-none hover:scale-105 transition-transform shadow-lg mt-4"
                >
                  &#x1F440; Show Punchline!
                </button>
              )}

              {/* Single-line jokes (no punchline) - show celebration immediately */}
              {!store.currentJoke.punchline && (
                <div className="text-4xl text-center mt-2">
                  &#x1F389;
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-8">
              <div className="text-6xl mb-4 animate-bounce">&#x1F921;</div>
              <p className="text-lg text-gray-600">Loading joke...</p>
            </div>
          )}
        </div>

        {/* Rating Buttons (shown after punchline revealed, or immediately for single-line jokes) */}
        {store.currentJoke && (store.showPunchline || !store.currentJoke.punchline) && (
          <div className="flex gap-4 mt-6 animate-fadeIn">
            <button
              onClick={() => handleRate("funny")}
              className={`btn btn-lg text-xl font-bold rounded-full ${
                currentRating === "funny"
                  ? "bg-green-500 text-white"
                  : "bg-white text-green-600 hover:bg-green-100"
              }`}
            >
              &#x1F44D; Funny!
            </button>
            <button
              onClick={() => handleRate("not-funny")}
              className={`btn btn-lg text-xl font-bold rounded-full ${
                currentRating === "not-funny"
                  ? "bg-gray-500 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-100"
              }`}
            >
              &#x1F44E; Meh
            </button>
          </div>
        )}
      </div>

      {/* Big "Tell Me A Joke" Button */}
      <div className="mt-6 flex justify-center">
        <button
          onClick={() => getNewJoke()}
          disabled={store.isLoading}
          className="btn btn-lg h-16 min-w-64 bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-xl font-bold rounded-full border-none hover:scale-105 active:scale-95 transition-transform shadow-2xl disabled:opacity-50"
        >
          {store.isLoading ? (
            <span className="loading loading-spinner loading-lg" />
          ) : (
            <>&#x1F3A4; TELL ME A JOKE!</>
          )}
        </button>
      </div>

      {/* Action Buttons */}
      {store.currentJoke && (
        <div className="flex justify-center gap-4 mt-4 mb-6">
          <button
            onClick={handleCopy}
            className="btn btn-circle btn-lg bg-blue-500 hover:bg-blue-600 text-white text-xl border-none shadow-lg"
            aria-label="Copy joke"
          >
            {store.copiedId === store.currentJoke.id ? (
              <>&#x2705;</>
            ) : (
              <>&#x1F4CB;</>
            )}
          </button>
          <button
            onClick={handleShare}
            className="btn btn-circle btn-lg bg-green-500 hover:bg-green-600 text-white text-xl border-none shadow-lg"
            aria-label="Share joke"
          >
            &#x1F4E4;
          </button>
          <button
            onClick={handleFavorite}
            className={`btn btn-circle btn-lg text-xl border-none shadow-lg transition-all ${
              isFav
                ? "bg-pink-500 text-white scale-110"
                : "bg-white text-pink-500 hover:bg-pink-100"
            } ${confetti ? "animate-pulse" : ""}`}
            aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
          >
            {isFav ? <>&#x2764;&#xFE0F;</> : <>&#x1F90D;</>}
          </button>
        </div>
      )}

      {/* Favorites Modal */}
      {store.showFavorites && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-lg w-full max-h-[80vh] overflow-hidden shadow-2xl">
            <div className="bg-gradient-to-r from-pink-500 to-purple-500 p-4 flex justify-between items-center">
              <h2 className="text-2xl font-bold text-white">
                &#x2764;&#xFE0F; My Favorites
              </h2>
              <button
                onClick={() => store.setShowFavorites(false)}
                className="btn btn-circle btn-sm bg-white/20 text-white border-none hover:bg-white/30"
              >
                &#x2715;
              </button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[60vh]">
              {store.favorites.length === 0 ? (
                <div className="text-center py-8">
                  <div className="text-6xl mb-4">&#x1F494;</div>
                  <p className="text-gray-600">
                    No favorites yet! Tap the heart to save jokes you love.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {store.favorites.map((joke) => (
                    <div
                      key={joke.id}
                      className="bg-gray-50 rounded-2xl p-4 relative"
                    >
                      <button
                        onClick={() => store.removeFavorite(joke.id)}
                        className="absolute top-2 right-2 btn btn-circle btn-xs bg-red-100 text-red-500 border-none hover:bg-red-200"
                        aria-label="Remove from favorites"
                      >
                        &#x2715;
                      </button>
                      <p className="font-bold text-gray-800 pr-8">{joke.setup}</p>
                      <p className="text-purple-600 mt-2">{joke.punchline}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confetti effect */}
      {confetti && (
        <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
          {[...Array(20)].map((_, i) => (
            <div
              key={i}
              className="absolute animate-confetti"
              style={{
                left: `${Math.random() * 100}%`,
                top: "-10%",
                animationDelay: `${Math.random() * 0.5}s`,
                fontSize: `${1 + Math.random() * 1.5}rem`,
              }}
            >
              {["&#x2B50;", "&#x1F389;", "&#x2728;", "&#x1F31F;"][Math.floor(Math.random() * 4)]}
            </div>
          ))}
        </div>
      )}

      {/* Sync Status */}
      {isAuthenticated && (
        <div className="fixed bottom-2 right-2 text-xs text-purple-800/60">
          {syncStatus === "syncing"
            ? "Saving..."
            : syncStatus === "synced"
            ? "Saved"
            : ""}
        </div>
      )}

      {/* Custom animations */}
      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out;
        }
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

export default JokeGenerator;
