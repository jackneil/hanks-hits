"use client";

import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import { useMemoryMatchStore } from "./lib/store";
import {
  type Difficulty,
  type ThemeId,
  DIFFICULTIES,
  THEMES,
  formatTime,
  calculateStars,
} from "./lib/constants";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { FullscreenButton } from "@/shared/components/FullscreenButton";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";

// Card component with flip animation
function Card({
  imageId,
  isFlipped,
  isMatched,
  onClick,
  disabled,
}: {
  imageId: string;
  isFlipped: boolean;
  isMatched: boolean;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || isFlipped || isMatched}
      className={`
        relative aspect-square w-full min-h-[60px]
        perspective-1000 cursor-pointer
        transition-transform duration-200
        ${!disabled && !isFlipped && !isMatched ? "hover:scale-105 active:scale-95" : ""}
        ${isMatched ? "opacity-80" : ""}
        disabled:cursor-default
      `}
      style={{ perspective: "1000px" }}
      aria-label={isFlipped || isMatched ? imageId : "Hidden card"}
    >
      <div
        className={`
          relative w-full h-full transition-transform duration-400 ease-in-out
          ${isFlipped || isMatched ? "rotate-y-180" : ""}
        `}
        style={{
          transformStyle: "preserve-3d",
          transform: isFlipped || isMatched ? "rotateY(180deg)" : "rotateY(0deg)",
          transition: "transform 0.4s ease-in-out",
        }}
      >
        {/* Card Back */}
        <div
          className={`
            absolute inset-0 rounded-xl
            bg-gradient-to-br from-blue-500 to-blue-700
            border-4 border-blue-400
            flex items-center justify-center
            shadow-lg
            ${!isFlipped && !isMatched ? "animate-pulse-subtle" : ""}
          `}
          style={{ backfaceVisibility: "hidden" }}
        >
          <span className="text-4xl md:text-5xl opacity-30">?</span>
        </div>

        {/* Card Front */}
        <div
          className={`
            absolute inset-0 rounded-xl
            bg-gradient-to-br from-white to-gray-100
            border-4 ${isMatched ? "border-green-400 shadow-green-400/50" : "border-amber-400"}
            flex items-center justify-center
            shadow-lg
            ${isMatched ? "shadow-xl" : ""}
          `}
          style={{
            backfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
          }}
        >
          <span className="text-4xl md:text-6xl select-none">{imageId}</span>
          {isMatched && (
            <div className="absolute top-1 right-1 text-green-500 text-xl">
              &#10003;
            </div>
          )}
        </div>
      </div>

      {/* Match celebration effect */}
      {isMatched && (
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 rounded-xl bg-green-400/20 animate-ping" />
        </div>
      )}
    </button>
  );
}

// Stats bar component
function StatsBar({
  moves,
  time,
  matchedPairs,
  totalPairs,
}: {
  moves: number;
  time: number;
  matchedPairs: number;
  totalPairs: number;
}) {
  return (
    <div className="flex justify-center gap-4 md:gap-8 text-white text-lg md:text-xl font-bold">
      <div className="flex items-center gap-2 bg-black/30 px-4 py-2 rounded-full">
        <span className="text-amber-400">&#128064;</span>
        <span>{moves} moves</span>
      </div>
      <div className="flex items-center gap-2 bg-black/30 px-4 py-2 rounded-full">
        <span className="text-blue-400">&#9203;</span>
        <span>{formatTime(time)}</span>
      </div>
      <div className="flex items-center gap-2 bg-black/30 px-4 py-2 rounded-full">
        <span className="text-green-400">&#10003;</span>
        <span>
          {matchedPairs}/{totalPairs}
        </span>
      </div>
    </div>
  );
}

// Difficulty selector
function DifficultySelector({
  current,
  onChange,
  disabled,
}: {
  current: Difficulty;
  onChange: (d: Difficulty) => void;
  disabled: boolean;
}) {
  const difficulties: Difficulty[] = ["easy", "medium", "hard", "expert"];

  return (
    <div className="flex flex-wrap justify-center gap-2">
      {difficulties.map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          disabled={disabled}
          className={`
            px-5 py-3 rounded-full font-bold text-sm md:text-base touch-manipulation
            transition-all duration-200
            ${
              current === d
                ? "bg-amber-400 text-black scale-105"
                : "bg-black/30 text-white hover:bg-black/50"
            }
            disabled:opacity-50 disabled:cursor-not-allowed
          `}
        >
          {DIFFICULTIES[d].name}
        </button>
      ))}
    </div>
  );
}

// Theme selector
function ThemeSelector({
  current,
  onChange,
  unlockedThemes,
  totalWins,
  disabled,
}: {
  current: ThemeId;
  onChange: (t: ThemeId) => void;
  unlockedThemes: ThemeId[];
  totalWins: number;
  disabled: boolean;
}) {
  const themes: ThemeId[] = ["animals", "vehicles", "emojis", "dinosaurs"];

  return (
    <div className="flex flex-wrap justify-center gap-2">
      {themes.map((t) => {
        const theme = THEMES[t];
        const isUnlocked = unlockedThemes.includes(t);
        const winsNeeded = theme.unlockCondition - totalWins;

        return (
          <button
            key={t}
            onClick={() => isUnlocked && onChange(t)}
            disabled={disabled || !isUnlocked}
            className={`
              px-5 py-3 rounded-full font-bold text-sm md:text-base touch-manipulation
              transition-all duration-200 flex items-center gap-2
              ${
                current === t
                  ? "bg-amber-400 text-black scale-105"
                  : isUnlocked
                  ? "bg-black/30 text-white hover:bg-black/50"
                  : "bg-black/50 text-gray-500 cursor-not-allowed"
              }
            `}
            title={
              isUnlocked
                ? theme.name
                : `Win ${winsNeeded} more game${winsNeeded !== 1 ? "s" : ""} to unlock`
            }
          >
            <span>{theme.emoji}</span>
            <span>{theme.name}</span>
            {!isUnlocked && <span className="text-xs">&#128274;</span>}
          </button>
        );
      })}
    </div>
  );
}

// Win modal
function WinModal({
  moves,
  time,
  pairs,
  bestTime,
  isNewBest,
  onNewGame,
}: {
  moves: number;
  time: number;
  pairs: number;
  bestTime: number | null;
  isNewBest: boolean;
  onNewGame: () => void;
}) {
  const stars = calculateStars(moves, pairs);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gradient-to-br from-purple-600 to-blue-600 rounded-3xl p-8 max-w-md w-full text-center shadow-2xl animate-bounce-in">
        {/* Celebration header */}
        <div className="text-6xl mb-4">&#127881;</div>
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-2">
          You Won!
        </h2>

        {isNewBest && (
          <div className="bg-amber-400 text-black px-4 py-2 rounded-full inline-block mb-4 font-bold animate-pulse">
            &#11088; New Best Time! &#11088;
          </div>
        )}

        {/* Stars */}
        <div className="text-5xl mb-4">
          {[1, 2, 3].map((s) => (
            <span
              key={s}
              className={s <= stars ? "text-amber-400" : "text-gray-500"}
            >
              &#11088;
            </span>
          ))}
        </div>

        {/* Stats */}
        <div className="bg-black/30 rounded-xl p-4 mb-6 text-white">
          <div className="flex justify-around text-lg">
            <div>
              <div className="text-3xl font-bold">{moves}</div>
              <div className="text-sm opacity-80">Moves</div>
            </div>
            <div>
              <div className="text-3xl font-bold">{formatTime(time)}</div>
              <div className="text-sm opacity-80">Time</div>
            </div>
          </div>
          {bestTime !== null && !isNewBest && (
            <div className="mt-3 text-sm opacity-70">
              Best: {formatTime(bestTime)}
            </div>
          )}
        </div>

        {/* Play again button */}
        <button
          onClick={onNewGame}
          className="bg-green-500 hover:bg-green-600 text-white font-bold text-xl px-8 py-4 rounded-full transition-all duration-200 hover:scale-105 active:scale-95 shadow-lg"
        >
          &#128260; Play Again
        </button>
      </div>
    </div>
  );
}

// Main game component
export function MemoryMatchGame() {
  const store = useMemoryMatchStore();
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  // Auth sync
  const { isAuthenticated, syncStatus, forceSync } = useAuthSync({
    appId: "memory-match",
    localStorageKey: "memory-match-progress",
    getState: () => store.getProgress(),
    setState: (data) => store.setProgress(data),
    debounceMs: 2000,
  });

  // Force save immediately on win
  useEffect(() => {
    if (store.isWon) {
      forceSync();
    }
  }, [store.isWon, forceSync]);

  // Client-side hydration
  useEffect(() => {
    // Start a new game on first load to ensure cards are shuffled
    store.newGame();
  }, []);

  // Timer tick
  useEffect(() => {
    if (!isClient) return;

    const interval = setInterval(() => {
      store.tick();
    }, 100);

    return () => clearInterval(interval);
  }, [isClient, store]);

  // Keyboard support
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "n" || e.key === "N") {
        store.newGame();
      }
    },
    [store]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (!isClient) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-800 to-purple-900 flex items-center justify-center">
        <div className="text-white text-2xl">Loading...</div>
      </div>
    );
  }

  const config = DIFFICULTIES[store.difficulty];
  const totalPairs = config.pairs;
  const previousBestTime = store.progress.bestTimes[store.difficulty];
  const isNewBest =
    store.isWon &&
    store.currentTime > 0 &&
    (previousBestTime === null ||
      store.currentTime <= previousBestTime);

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-800 to-purple-900 p-4 flex flex-col items-center gap-4 md:gap-6">
      {/* iOS install prompt */}
      <IOSInstallPrompt />

      {/* Fullscreen button */}
      <div className="fixed top-4 right-4 z-50">
        <FullscreenButton />
      </div>

      {/* Header */}
      <header className="text-center">
        <h1 className="text-3xl md:text-5xl font-bold text-white mb-1">
          &#129504; Memory Match
        </h1>
        <p className="text-blue-200 text-sm md:text-base">
          Find all the matching pairs!
        </p>
      </header>

      {/* Difficulty selector */}
      <DifficultySelector
        current={store.difficulty}
        onChange={(d) => store.setDifficulty(d)}
        disabled={store.isPlaying && !store.isWon}
      />

      {/* Theme selector */}
      <ThemeSelector
        current={store.theme}
        onChange={(t) => store.setTheme(t)}
        unlockedThemes={store.progress.unlockedThemes}
        totalWins={store.progress.gamesWon}
        disabled={store.isPlaying && !store.isWon}
      />

      {/* Stats bar */}
      <StatsBar
        moves={store.moves}
        time={store.currentTime}
        matchedPairs={store.matchedPairs}
        totalPairs={totalPairs}
      />

      {/* Card grid */}
      <div
        className="w-full max-w-2xl mx-auto"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${config.cols}, 1fr)`,
          gap: "0.5rem",
        }}
      >
        {store.cards.map((card, index) => (
          <Card
            key={card.id}
            imageId={card.imageId}
            isFlipped={card.isFlipped}
            isMatched={card.isMatched}
            onClick={() => store.flipCard(index)}
            disabled={store.isProcessing}
          />
        ))}
      </div>

      {/* New game button */}
      <button
        onClick={() => store.newGame()}
        className="bg-amber-400 hover:bg-amber-500 text-black font-bold text-lg px-6 py-3 rounded-full transition-all duration-200 hover:scale-105 active:scale-95 shadow-lg"
      >
        &#128260; New Game
      </button>

      {/* Stats summary */}
      <div className="text-white/70 text-sm text-center">
        <div>
          Games played: {store.progress.gamesPlayed} | Wins:{" "}
          {store.progress.gamesWon}
        </div>
        {previousBestTime !== null && (
          <div>Best time ({config.name}): {formatTime(previousBestTime)}</div>
        )}
      </div>

      {/* Win modal */}
      {store.isWon && (
        <WinModal
          moves={store.moves}
          time={store.currentTime}
          pairs={totalPairs}
          bestTime={previousBestTime}
          isNewBest={isNewBest}
          onNewGame={() => store.newGame()}
        />
      )}

      {/* Sync status */}
      {isAuthenticated && (
        <div className="fixed bottom-2 right-2 text-xs text-white/40">
          {syncStatus === "syncing"
            ? "Saving..."
            : syncStatus === "synced"
            ? "Saved"
            : ""}
        </div>
      )}

      {/* Sound toggle (placeholder for future) */}
      <button
        onClick={() => store.toggleSound()}
        className="fixed bottom-2 left-2 text-2xl opacity-50 hover:opacity-100 transition-opacity"
        title={store.progress.soundEnabled ? "Sound On" : "Sound Off"}
      >
        {store.progress.soundEnabled ? "\u{1F50A}" : "\u{1F507}"}
      </button>
    </div>
  );
}

export default MemoryMatchGame;
