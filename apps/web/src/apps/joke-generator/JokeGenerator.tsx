"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { AppNotesSlot } from "@/shared/components/AppNotesSlot";
import { useShortViewport } from "@/shared/hooks/useShortViewport";

/** The punchline's opening transition (duration-500), plus one frame. */
const PUNCHLINE_OPEN_MS = 520;

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
  // A phone held sideways: the joke and its buttons side by side.
  const short = useShortViewport();
  // The punchline opens under the setup: when its 500 ms opening is done,
  // scroll it into view, so a long joke never hides it under the fold of
  // the card.
  const punchlineRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!store.showPunchline) return;
    const timer = setTimeout(
      () => punchlineRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }),
      PUNCHLINE_OPEN_MS
    );
    return () => clearTimeout(timer);
  }, [store.showPunchline]);
  const [confetti, setConfetti] = useState(false);

  // Auth sync for logged-in users
  const { isAuthenticated, syncStatus, ready, synced } = useAuthSync({
    appId: "joke-generator",
    localStorageKey: "joke-generator-progress",
    getState: () => store.getProgress(),
    setState: (data) => store.setProgress(data),
    debounceMs: 2000,
  });

  // Get a new joke. It reads the store when it runs (getState), so it is one
  // stable function: `store` is the whole state, a new object on every set.
  // The category override still wins, for a tap that sets the category and
  // asks for a joke in one go.
  // `automatic`: the first joke of the page, which shows by itself (it
  // counts as progress only in a store that the kid already changed, and
  // only on the account's progress: `synced`).
  const getNewJoke = useCallback(async (categoryOverride?: JokeCategory, automatic = false, synced = true) => {
    const jokes = useJokeStore.getState();
    jokes.setLoading(true);
    const category = categoryOverride ?? jokes.lastCategory;

    try {
      let newJoke: Joke;

      if (category === "dad-jokes") {
        // Fetch from icanhazdadjoke.com API
        newJoke = await fetchDadJoke();
      } else {
        // Get from static collection, avoiding seen jokes
        newJoke = getRandomJoke(category, jokes.getSeenJokeIds());
      }

      // Mark this joke as seen
      jokes.markJokeSeen(newJoke.id, automatic, synced);
      jokes.setCurrentJoke(newJoke);
      jokes.incrementViewed(automatic, synced);
    } catch {
      // Fallback on error
      const fallbackJoke = getRandomJoke("all", []);
      jokes.setCurrentJoke(fallbackJoke);
    } finally {
      jokes.setLoading(false);
    }
  }, []);

  // The first joke, once the sync is ready: it counts on the account's
  // progress, not on an old copy on this device. When the account cannot be
  // reached (READY_FALLBACK_MS) or for a guest, it shows on the device's
  // copy and keeps the time (`synced` is false).
  useEffect(() => {
    if (ready && !useJokeStore.getState().currentJoke) {
      getNewJoke(undefined, true, synced);
    }
  }, [ready, synced, getNewJoke]);

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

  // The joke card: the setup, the punchline, and Show Punchline.
  const card = (
    <div className="flex-1 min-h-0 flex items-center justify-center">
      <div
        className={`bg-white rounded-3xl shadow-2xl p-5 md:p-8 short:p-3 max-w-lg w-full mx-auto max-h-full flex flex-col transform transition-all duration-300 ${
          store.isLoading ? "scale-95 opacity-50" : "scale-100"
        }`}
      >
        {store.currentJoke ? (
          <>
            {/* Setup + punchline scroll inside the card if the joke is long */}
            <div data-testid="joke-text" className="flex-1 min-h-0 overflow-y-auto">
              <div className="min-h-full flex flex-col justify-center">
                <p className="text-xl md:text-2xl font-bold text-gray-800 text-center mb-6 leading-relaxed short:mb-2 short:text-lg short:leading-snug">
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
                    <p
                      ref={punchlineRef}
                      data-testid="joke-punchline"
                      className="text-xl md:text-2xl font-bold text-purple-600 text-center leading-relaxed short:text-lg short:leading-snug"
                    >
                      {store.currentJoke.punchline}
                    </p>
                    <div className="text-4xl text-center mt-2 short:mt-1 short:text-2xl">&#x1F389;</div>
                  </div>
                )}

                {/* Single-line jokes (no punchline) - show celebration immediately */}
                {!store.currentJoke.punchline && (
                  <div className="text-4xl text-center mt-2 short:mt-1 short:text-2xl">&#x1F389;</div>
                )}
              </div>
            </div>

            {/* Reveal Button - only show if joke has a punchline to reveal */}
            {!store.showPunchline && store.currentJoke.punchline && (
              <button
                onClick={() => store.revealPunchline()}
                className="flex-shrink-0 btn btn-lg w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold text-lg rounded-full border-none hover:scale-105 transition-transform shadow-lg mt-4 short:btn-md short:mt-2"
              >
                &#x1F440; Show Punchline!
              </button>
            )}
          </>
        ) : (
          <div className="text-center py-8 short:py-4">
            <div className="text-6xl mb-4 animate-bounce short:text-4xl short:mb-2">&#x1F921;</div>
            <p className="text-lg text-gray-600">Loading joke...</p>
          </div>
        )}
      </div>
    </div>
  );

  // Funny / Meh, after the punchline (or at once for a one-line joke).
  const rating = store.currentJoke && (store.showPunchline || !store.currentJoke.punchline) && (
    <div className="flex-shrink-0 flex gap-4 justify-center animate-fadeIn short:gap-2">
      <button
        onClick={() => handleRate("funny")}
        className={`btn btn-lg text-xl font-bold rounded-full short:btn-md short:flex-1 short:text-base ${
          currentRating === "funny"
            ? "bg-green-500 text-white"
            : "bg-white text-green-600 hover:bg-green-100"
        }`}
      >
        &#x1F44D; Funny!
      </button>
      <button
        onClick={() => handleRate("not-funny")}
        className={`btn btn-lg text-xl font-bold rounded-full short:btn-md short:flex-1 short:text-base ${
          currentRating === "not-funny"
            ? "bg-gray-500 text-white"
            : "bg-white text-gray-600 hover:bg-gray-100"
        }`}
      >
        &#x1F44E; Meh
      </button>
    </div>
  );

  // The big "Tell Me A Joke" button.
  const tell = (
    <div className="flex shrink-0 justify-center">
      <button
        onClick={() => getNewJoke()}
        disabled={store.isLoading}
        className="btn btn-lg h-16 min-w-64 short:h-12 short:min-w-0 short:w-full short:text-lg bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-xl font-bold rounded-full border-none hover:scale-105 active:scale-95 transition-transform shadow-2xl disabled:opacity-50"
      >
        {store.isLoading ? (
          <span className="loading loading-spinner loading-lg" />
        ) : (
          <>&#x1F3A4; TELL ME A JOKE!</>
        )}
      </button>
    </div>
  );

  // Copy, share, and favorite.
  const actions = store.currentJoke && (
    <div className="flex shrink-0 justify-center gap-4 short:gap-3">
      <button
        onClick={handleCopy}
        className="btn btn-circle btn-lg short:btn-md bg-blue-500 hover:bg-blue-600 text-white text-xl border-none shadow-lg"
        aria-label="Copy joke"
      >
        {store.copiedId === store.currentJoke.id ? <>&#x2705;</> : <>&#x1F4CB;</>}
      </button>
      <button
        onClick={handleShare}
        className="btn btn-circle btn-lg short:btn-md bg-green-500 hover:bg-green-600 text-white text-xl border-none shadow-lg"
        aria-label="Share joke"
      >
        &#x1F4E4;
      </button>
      <button
        onClick={handleFavorite}
        className={`btn btn-circle btn-lg short:btn-md text-xl border-none shadow-lg transition-all ${
          isFav
            ? "bg-pink-500 text-white scale-110"
            : "bg-white text-pink-500 hover:bg-pink-100"
        } ${confetti ? "animate-pulse" : ""}`}
        aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
      >
        {isFav ? <>&#x2764;&#xFE0F;</> : <>&#x1F90D;</>}
      </button>
    </div>
  );

  return (
    // Upright the root is min-h-full: it fills the GameShell play box and
    // grows past it when the box is squeezed (the install sheet at the
    // bottom of the screen), so the box scrolls and the joke buttons stay
    // reachable. Sideways it is h-full: the card keeps to the screen and
    // scrolls its own text, so the punchline never opens below the screen.
    <div
      className={`${short ? "h-full" : "min-h-full"} bg-gradient-to-b from-yellow-300 via-yellow-400 to-orange-400 p-3 md:p-4 flex flex-col overflow-hidden`}
    >
      {/* iOS install prompt */}
      <IOSInstallPrompt />
      {/* A trophy shows here, as part of the page, never over the buttons. */}
      <AppNotesSlot className="mb-2" />

      {/* The kinds of joke in one row that scrolls sideways (two rows of
          pills pushed the joke off a phone held sideways), and the
          favorites button beside them. */}
      <div className="mb-3 flex shrink-0 items-center gap-2 short:mb-2">
        <div data-testid="joke-categories" className="-my-1 flex min-w-0 flex-1 gap-2 overflow-x-auto py-1">
          {JOKE_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => handleCategoryChange(cat.id)}
              aria-pressed={store.lastCategory === cat.id}
              className={`btn btn-md shrink-0 rounded-full font-bold transition-all touch-manipulation ${
                store.lastCategory === cat.id
                  ? "bg-purple-600 text-white shadow-lg"
                  : "bg-white/80 text-purple-800 hover:bg-white"
              }`}
            >
              <span className="mr-1">{cat.emoji}</span>
              {cat.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => store.setShowFavorites(true)}
          className="btn btn-circle btn-md shrink-0 bg-pink-500 hover:bg-pink-600 border-none text-white text-xl shadow-lg"
          aria-label="View favorites"
        >
          &#x2764;&#xFE0F;
        </button>
      </div>

      {short ? (
        // Sideways: the joke card gets the whole left side; the big button,
        // Funny / Meh and the actions stand in a column on the right (the
        // card was a 35 px sliver under the button, and Funny / Meh under
        // the card pushed the punchline off the screen).
        <div data-testid="joke-sideways" className="flex min-h-0 flex-1 gap-3">
          <div className="flex min-w-0 flex-1 flex-col">{card}</div>
          {/* justify-center-safe: while a trophy row takes height, the
              column scrolls from its top instead of cutting the big button. */}
          <div className="flex w-56 shrink-0 flex-col justify-center-safe gap-3 overflow-y-auto">
            {tell}
            {rating}
            {actions}
          </div>
        </div>
      ) : (
        <>
          {/* Joke Card + rating (flexible middle - the card scrolls its own text) */}
          <div className="flex-1 min-h-0 flex flex-col gap-3 md:gap-4">
            {card}
            {rating}
          </div>
          <div className="mt-3 md:mt-4">{tell}</div>
          {actions && <div className="mt-3">{actions}</div>}
        </>
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
                className="btn btn-circle btn-md bg-white/20 text-white border-none hover:bg-white/30"
                aria-label="Close favorites"
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
                        className="absolute top-1 right-1 btn btn-circle h-11 w-11 min-h-11 bg-red-100 text-red-500 border-none hover:bg-red-200"
                        aria-label="Remove from favorites"
                      >
                        &#x2715;
                      </button>
                      <p className="font-bold text-gray-800 pr-12">{joke.setup}</p>
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
