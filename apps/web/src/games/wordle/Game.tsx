"use client";

import { useEffect, useCallback } from "react";
import { useWordleStore, type WordleProgress } from "./lib/store";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { FullscreenButton } from "@/shared/components/FullscreenButton";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import { TutorialModal } from "./components/TutorialModal";
import {
  DIFFICULTY_SETTINGS,
  getDifficultySettings,
  LETTER_COLORS,
  KEYBOARD_ROWS,
  type Difficulty,
} from "./lib/constants";
import { getKeyboardStatus, type LetterStatus } from "./lib/utils";

export function WordleGame() {
  const store = useWordleStore();
  const {
    gameState,
    targetWord,
    guesses,
    results,
    currentGuess,
    currentRow,
    invalidGuess,
    revealedHint,
    gamesPlayed,
    gamesWon,
    currentStreak,
    maxStreak,
    settings,
    startGame,
    addLetter,
    removeLetter,
    submitGuess,
    useHint,
    reset,
    setDifficulty,
    openTutorial,
  } = store;

  // Auth sync
  const { forceSync } = useAuthSync({
    appId: "wordle",
    localStorageKey: "wordle-progress",
    getState: () => store.getProgress() as unknown as Record<string, unknown>,
    setState: (data) => store.setProgress(data as unknown as WordleProgress),
    debounceMs: 2000,
  });

  // Force save immediately on game end (won or lost)
  useEffect(() => {
    if (gameState === "won" || gameState === "lost") {
      forceSync();
    }
  }, [gameState, forceSync]);

  const diffSettings = getDifficultySettings(settings.difficulty);
  const maxGuesses = diffSettings.maxGuesses;
  const keyboardStatus = getKeyboardStatus(guesses, results);

  // Keyboard input
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (gameState !== "playing") return;

      if (e.key === "Enter") {
        submitGuess();
      } else if (e.key === "Backspace") {
        removeLetter();
      } else if (/^[a-zA-Z]$/.test(e.key)) {
        addLetter(e.key);
      }
    },
    [gameState, submitGuess, removeLetter, addLetter]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Get tile status
  const getTileStatus = (row: number, col: number): LetterStatus => {
    if (row < guesses.length) {
      return results[row]?.[col] || "empty";
    }
    if (row === currentRow && col < currentGuess.length) {
      return "tbd";
    }
    return "empty";
  };

  // Get tile letter
  const getTileLetter = (row: number, col: number): string => {
    if (row < guesses.length) {
      return guesses[row]?.[col] || "";
    }
    if (row === currentRow) {
      return currentGuess[col] || "";
    }
    return "";
  };

  // Handle keyboard button click
  const handleKeyClick = (key: string) => {
    if (gameState !== "playing") return;

    if (key === "ENTER") {
      submitGuess();
    } else if (key === "⌫") {
      removeLetter();
    } else {
      addLetter(key);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 text-white">
      <IOSInstallPrompt />
      <FullscreenButton />
      <TutorialModal />

      <div className="container mx-auto px-4 py-6 max-w-lg flex flex-col items-center">
        {/* Header with quit button (shown during gameplay) */}
        {gameState !== "ready" && (
          <div className="w-full flex justify-between items-center mb-4">
            <button
              onClick={reset}
              className="btn btn-ghost btn-sm text-slate-400"
            >
              ← Quit
            </button>
            <h1 className="text-2xl font-bold">📝 Wordle</h1>
            <div className="w-16" /> {/* Spacer for centering */}
          </div>
        )}

        {/* Ready Screen */}
        {gameState === "ready" && (
          <div className="text-center space-y-8 w-full">
            <h1 className="text-5xl font-bold mb-4">📝 Wordle</h1>
            <p className="text-xl text-slate-300">Guess the word!</p>

            {/* Stats */}
            {gamesPlayed > 0 && (
              <div className="bg-white/10 rounded-2xl p-4 grid grid-cols-4 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold">{gamesPlayed}</div>
                  <div className="text-xs text-slate-400">Played</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">
                    {gamesPlayed > 0 ? Math.round((gamesWon / gamesPlayed) * 100) : 0}%
                  </div>
                  <div className="text-xs text-slate-400">Win %</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">{currentStreak}</div>
                  <div className="text-xs text-slate-400">Streak</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">{maxStreak}</div>
                  <div className="text-xs text-slate-400">Max</div>
                </div>
              </div>
            )}

            {/* Age Selector */}
            <div className="space-y-4">
              <div className="text-xl font-bold">How old are you?</div>
              <div className="flex flex-wrap gap-2 justify-center">
                {(Object.keys(DIFFICULTY_SETTINGS) as Difficulty[]).map((diff) => {
                  const s = DIFFICULTY_SETTINGS[diff];
                  const isSelected = settings.difficulty === diff;
                  return (
                    <button
                      key={diff}
                      onClick={() => setDifficulty(diff)}
                      className={`px-4 py-3 rounded-xl font-bold text-base transition-all flex flex-col items-center min-w-[70px] ${
                        isSelected
                          ? `${s.color} text-white scale-110 ring-2 ring-white shadow-lg`
                          : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                      }`}
                    >
                      <span className="text-2xl">{s.emoji}</span>
                      <span>{diff}</span>
                    </button>
                  );
                })}
              </div>
              <div className="text-slate-400 text-sm">
                {diffSettings.wordLength} letters, {maxGuesses} guesses
              </div>
              {settings.difficulty === "99yo" && (
                <div className="text-purple-300 text-sm">
                  Grandpa mode: Big letters, more guesses!
                </div>
              )}
            </div>

            {/* Buttons */}
            <div className="flex flex-col items-center gap-3">
              <button
                onClick={startGame}
                className="btn btn-primary btn-lg text-xl px-12 py-4 rounded-full shadow-lg hover:scale-105 transition-transform"
              >
                🎮 Start Game!
              </button>
              <button
                onClick={openTutorial}
                className="btn btn-ghost btn-sm text-slate-400 hover:text-white"
              >
                ❓ How to Play
              </button>
            </div>
          </div>
        )}

        {/* Playing / Won / Lost */}
        {gameState !== "ready" && (
          <div className="w-full space-y-4">
            {/* Hint */}
            {revealedHint !== null && gameState === "playing" && (
              <div className="text-center text-yellow-400 font-bold">
                💡 Hint: Letter {revealedHint + 1} is &quot;{targetWord[revealedHint]}&quot;
              </div>
            )}

            {/* Grid */}
            <div className="flex flex-col items-center gap-1">
              {Array.from({ length: maxGuesses }).map((_, row) => (
                <div
                  key={row}
                  className={`flex gap-1 ${
                    row === currentRow && invalidGuess ? "animate-shake" : ""
                  }`}
                >
                  {Array.from({ length: targetWord.length }).map((_, col) => {
                    const status = getTileStatus(row, col);
                    const letter = getTileLetter(row, col);
                    const isHinted = revealedHint === col && row === currentRow;

                    return (
                      <div
                        key={col}
                        className={`
                          ${diffSettings.tileSize} ${diffSettings.fontSize}
                          flex items-center justify-center font-bold uppercase
                          border-2 rounded transition-all
                          ${LETTER_COLORS[status]}
                          ${isHinted ? "ring-2 ring-yellow-400" : ""}
                          ${status === "tbd" ? "scale-105" : ""}
                        `}
                      >
                        {letter}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Result Message */}
            {gameState === "won" && (
              <div className="text-center space-y-4">
                <div className="text-3xl font-bold text-green-400 animate-bounce">
                  🎉 You Won!
                </div>
                <div className="text-slate-300">
                  Solved in {guesses.length} {guesses.length === 1 ? "guess" : "guesses"}!
                </div>
                <div className="text-yellow-400">🔥 Streak: {currentStreak}</div>
                <button
                  onClick={reset}
                  className="btn btn-primary btn-lg text-xl px-8 rounded-full"
                >
                  🔄 Play Again
                </button>
              </div>
            )}

            {gameState === "lost" && (
              <div className="text-center space-y-4">
                <div className="text-3xl font-bold text-red-400">
                  😔 Game Over
                </div>
                <div className="text-slate-300">
                  The word was: <span className="font-bold text-white">{targetWord}</span>
                </div>
                <button
                  onClick={reset}
                  className="btn btn-primary btn-lg text-xl px-8 rounded-full"
                >
                  🔄 Try Again
                </button>
              </div>
            )}

            {/* Keyboard */}
            {gameState === "playing" && (
              <div className="space-y-1 mt-4">
                {KEYBOARD_ROWS.map((row, i) => (
                  <div key={i} className="flex justify-center gap-1">
                    {row.map((key) => {
                      const status = keyboardStatus.get(key);
                      const isWide = key === "ENTER" || key === "⌫";

                      return (
                        <button
                          key={key}
                          onClick={() => handleKeyClick(key)}
                          className={`
                            ${diffSettings.keyboardSize}
                            ${isWide ? "px-3" : "px-2"}
                            rounded font-bold uppercase transition-all
                            ${status ? LETTER_COLORS[status] : "bg-slate-600 hover:bg-slate-500"}
                          `}
                        >
                          {key}
                        </button>
                      );
                    })}
                  </div>
                ))}

                {/* Hint Button */}
                {revealedHint === null && (
                  <div className="text-center mt-4">
                    <button
                      onClick={useHint}
                      className="btn btn-outline btn-sm text-yellow-400 border-yellow-400 hover:bg-yellow-400 hover:text-black"
                    >
                      💡 Use Hint (1 per game)
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Shake animation */}
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
          20%, 40%, 60%, 80% { transform: translateX(4px); }
        }
        .animate-shake {
          animation: shake 0.5s ease-in-out;
        }
      `}</style>
    </div>
  );
}

export default WordleGame;
