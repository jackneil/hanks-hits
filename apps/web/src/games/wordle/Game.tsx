"use client";

import { useCallback, useEffect } from "react";

import { GameStartOverlay, GameStartOverlayButton } from "@/shared/components/GameStartOverlay";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import { ResultCard, ResultLine } from "@/shared/components/ResultCard";
import { ResultChip } from "@/shared/components/ResultChip";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { usePlayBox } from "@/shared/hooks/usePlayBox";
import { usePointerTap, useRestartGrace } from "@/shared/lib/input";
import { keyBelongsToTarget } from "@/shared/lib/keyboardTarget";
import { PICKER_GRID, pickerCellClass } from "@/shared/lib/pickerGrid";

import { TutorialModal } from "./components/TutorialModal";
import { DIFFICULTY_SETTINGS, getDifficultySettings, KEYBOARD_ROWS, LETTER_COLORS, type Difficulty } from "./lib/constants";
import { EDGE, GAP, HINT_ROW, KEY_GAP, RESULT_CARD_ROOM, TILE_GAP, wordleLayout } from "./lib/layout";
import { useWordleStore, type WordleProgress } from "./lib/store";
import { getKeyboardStatus, type LetterStatus } from "./lib/utils";

/** The spoken names of the two action keys. */
export const KEY_LABELS = { delete: "Delete", enter: "Enter" } as const;

/** The result chip's words, read out loud first. */
export function resultText({
  won,
  word,
  guesses,
  streak,
}: {
  won: boolean;
  word: string;
  guesses: number;
  streak: number;
}): string {
  if (won) {
    const tries = guesses === 1 ? "1 guess" : `${guesses} guesses`;
    return `You won! You found ${word} in ${tries}. Your streak is ${streak}.`;
  }
  return `Good try! The word was ${word}.`;
}

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
    if (gameState === "won" || gameState === "lost") forceSync();
  }, [gameState, forceSync]);

  const diffSettings = getDifficultySettings(settings.difficulty);
  const maxGuesses = diffSettings.maxGuesses;
  const keyboardStatus = getKeyboardStatus(guesses, results);
  const playing = gameState === "playing";
  const over = gameState === "won" || gameState === "lost";

  // The play box, fitted: the grid takes the height the keyboard leaves.
  const box = usePlayBox({ fit: true });
  const layout = wordleLayout(box, { rows: maxGuesses, cols: targetWord.length || diffSettings.wordLength }, over);

  const playAgain = useCallback(() => {
    reset();
    startGame();
  }, [reset, startGame]);

  // Enter at a result plays again after the chip's short grace (the Enter
  // that sent the last guess must not skip the result), and a held key's
  // repeats never count.
  const grace = useRestartGrace(undefined, gameState);

  // A physical keyboard types too.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // A focused button or link owns its own Space and Enter: never swallow them.
      if (keyBelongsToTarget(e)) return;
      if (gameState === "won" || gameState === "lost") {
        if (e.key === "Enter" && grace.accept(e)) {
          e.preventDefault();
          playAgain();
        }
        return;
      }
      if (gameState !== "playing") return;
      if (e.key === "Enter") submitGuess();
      else if (e.key === "Backspace") removeLetter();
      else if (/^[a-zA-Z]$/.test(e.key)) addLetter(e.key);
    },
    [gameState, grace, playAgain, submitGuess, removeLetter, addLetter]
  );
  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // The on-screen keys: one handler on the keyboard, on pointerdown, so two
  // thumbs can type fast (a second finger's tap makes no click) and one tap
  // is one letter.
  const keyboardTap = usePointerTap<HTMLDivElement>((event) => {
    const key = (event.target as Element | null)?.closest?.("[data-key]")?.getAttribute("data-key");
    if (!key || useWordleStore.getState().gameState !== "playing") return;
    if (key === "ENTER") submitGuess();
    else if (key === "⌫") removeLetter();
    else addLetter(key);
  });

  const getTileStatus = (row: number, col: number): LetterStatus => {
    if (row < guesses.length) return results[row]?.[col] || "empty";
    if (row === currentRow && col < currentGuess.length) return "tbd";
    return "empty";
  };
  const getTileLetter = (row: number, col: number): string => {
    if (row < guesses.length) return guesses[row]?.[col] || "";
    if (row === currentRow) return currentGuess[col] || "";
    return "";
  };

  const grid = (
    <div data-testid="wordle-grid" className="flex shrink-0 flex-col items-center" style={{ gap: TILE_GAP }}>
      {Array.from({ length: maxGuesses }).map((_, row) => (
        <div key={row} className={`flex ${row === currentRow && invalidGuess ? "animate-shake" : ""}`} style={{ gap: TILE_GAP }}>
          {Array.from({ length: targetWord.length }).map((_, col) => {
            const status = getTileStatus(row, col);
            const isHinted = revealedHint === col && row === currentRow;
            return (
              <div
                key={col}
                className={`flex items-center justify-center rounded border-2 font-bold uppercase transition-colors ${LETTER_COLORS[status]} ${
                  isHinted ? "ring-2 ring-yellow-400" : ""
                }`}
                style={{ width: layout.tile, height: layout.tile, fontSize: Math.round(layout.tile * 0.55) }}
              >
                {getTileLetter(row, col)}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );

  const hintRow = (
    <div className="flex shrink-0 items-center justify-center" style={{ height: HINT_ROW, width: layout.keyboard.width }}>
      {revealedHint === null ? (
        <button
          type="button"
          onClick={useHint}
          className="btn min-h-11 h-11 border-2 border-yellow-400 bg-transparent px-4 text-base text-yellow-300 hover:bg-yellow-400 hover:text-black"
        >
          💡 Use my hint
        </button>
      ) : (
        <div className="text-center text-base font-bold text-yellow-300">
          💡 Letter {revealedHint + 1} is &quot;{targetWord[revealedHint]}&quot;
        </div>
      )}
    </div>
  );

  const keyboard = (
    <div
      data-testid="wordle-keyboard"
      {...keyboardTap}
      className="grid shrink-0 touch-none select-none [-webkit-touch-callout:none]"
      style={{
        gridTemplateColumns: `repeat(${layout.cols}, ${layout.key}px)`,
        gridAutoRows: `${layout.key}px`,
        gap: KEY_GAP,
      }}
    >
      {KEYBOARD_ROWS.flat().map((key) => {
        const status = keyboardStatus.get(key);
        const label = key === "ENTER" ? KEY_LABELS.enter : key === "⌫" ? KEY_LABELS.delete : key;
        return (
          <button
            key={key}
            type="button"
            data-key={key}
            aria-label={label}
            className={`flex items-center justify-center rounded-lg text-xl font-bold uppercase ${
              key === "ENTER" ? "bg-green-600 text-white" : status ? LETTER_COLORS[status] : "bg-slate-600 text-white"
            }`}
          >
            <span aria-hidden="true">{key === "ENTER" ? "↵" : key}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div
      data-testid="wordle-root"
      data-layout={layout.sideways ? "sideways" : "upright"}
      className={`relative flex h-full w-full items-center justify-center bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 text-white ${
        layout.sideways && !over ? "flex-row" : "flex-col"
      } ${over ? "justify-start" : ""}`}
      style={{ padding: EDGE, gap: GAP, paddingTop: over ? EDGE + RESULT_CARD_ROOM : EDGE }}
    >
      <IOSInstallPrompt />
      <TutorialModal />

      {/* Shared start screen. It covers the page (it portals to
          document.body), so the card, the age picker and the Play button
          never clip on a phone. The "How to play" button lives in the picker
          slot: the old ❓ button sat under the overlay and could not be
          reached before the first Play. */}
      {gameState === "ready" && (
        <GameStartOverlay
          title="Wordle"
          emoji="📝"
          subtitle="Guess the secret word!"
          touchHints={["🔤 Tap the letters to spell a word", "↵ Tap the green key to send your guess", "🟩 Green means the letter is right"]}
          keyboardHints={["🔤 Type letters to spell a word", "↩️ Press Enter to send your guess", "🟩 Green means the letter is right"]}
          startLabel="🎮 Start Game!"
          // Built from the same list the buttons render, so the voice can
          // never name a choice the card does not show.
          spokenChoices={`Pick how old you are: ${(Object.keys(DIFFICULTY_SETTINGS) as Difficulty[])
            .map((diff) => DIFFICULTY_SETTINGS[diff].label)
            .join(", ")}. Tap How to Play to learn the rules.`}
          onStart={() => startGame()}
        >
          {gamesPlayed > 0 && (
            <div className="text-base font-medium opacity-90">
              🔥 Streak: {currentStreak} · 🏆 Best Streak: {maxStreak} · 🎯 {Math.round((gamesWon / gamesPlayed) * 100)}% won
            </div>
          )}
          <div className="text-sm font-bold opacity-80">How old are you?</div>
          {/* Three short choices to a row (shared/lib/pickerGrid.ts), so
              every age is on screen with the heading on a phone upright;
              two columns put "99yo" and How to Play under the fold. */}
          <div data-testid="age-picker" className={PICKER_GRID}>
            {(Object.keys(DIFFICULTY_SETTINGS) as Difficulty[]).map((diff, index, all) => (
              <GameStartOverlayButton
                key={diff}
                onClick={() => setDifficulty(diff)}
                aria-pressed={settings.difficulty === diff}
                className={`${settings.difficulty === diff ? "btn-primary" : ""} ${pickerCellClass(index, all.length)}`}
              >
                {DIFFICULTY_SETTINGS[diff].emoji} {diff}
              </GameStartOverlayButton>
            ))}
          </div>
          <div className="text-xs opacity-70">
            {diffSettings.wordLength} letters, {maxGuesses} guesses
          </div>
          <GameStartOverlayButton onClick={() => openTutorial()}>❓ How to Play</GameStartOverlayButton>
        </GameStartOverlay>
      )}

      {gameState !== "ready" && grid}

      {playing && (
        <div className="flex shrink-0 flex-col items-center" style={{ gap: GAP }}>
          {hintRow}
          {keyboard}
        </div>
      )}

      {gameState === "won" && (
        <ResultCard testId="wordle-result-card" title="🎉 You won!">
          <ResultLine big>
            {targetWord} in {guesses.length} {guesses.length === 1 ? "guess" : "guesses"}
          </ResultLine>
          <ResultLine>🔥 Streak {currentStreak}</ResultLine>
        </ResultCard>
      )}
      {gameState === "lost" && (
        <ResultCard testId="wordle-result-card" title="Good try!">
          <ResultLine big>The word was {targetWord}</ResultLine>
        </ResultCard>
      )}

      {/* The result chip: read it to me, Play again (a new word at the same
          age, with no start card), the leaderboard. Mounted only at a
          result, so its grace starts then. */}
      {over && (
        <ResultChip
          resultText={resultText({ won: gameState === "won", word: targetWord, guesses: guesses.length, streak: currentStreak })}
          appId="wordle"
          onRestart={playAgain}
          keyboardHint="Enter"
        />
      )}

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
