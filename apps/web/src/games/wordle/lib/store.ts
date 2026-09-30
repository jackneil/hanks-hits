import { create } from "zustand";
import { persist } from "zustand/middleware";
import { type Difficulty, getDifficultySettings } from "./constants";
import { getRandomWord, isValidWord } from "./words";
import { checkGuess, type LetterStatus } from "./utils";

export interface WordleProgress {
  gamesPlayed: number;
  gamesWon: number;
  currentStreak: number;
  maxStreak: number;
  guessDistribution: number[]; // Index = number of guesses needed to win
  settings: {
    soundEnabled: boolean;
    difficulty: Difficulty;
  };
  lastModified: number;
}

interface WordleState extends WordleProgress {
  // Session state
  gameState: "ready" | "playing" | "won" | "lost";
  targetWord: string;
  guesses: string[];
  results: LetterStatus[][];
  currentGuess: string;
  currentRow: number;
  invalidGuess: boolean;
  revealedHint: number | null; // Index of revealed letter
  showTutorial: boolean;

  // Actions
  startGame: () => void;
  addLetter: (letter: string) => void;
  removeLetter: () => void;
  submitGuess: () => void;
  useHint: () => void;
  reset: () => void;
  setDifficulty: (difficulty: Difficulty) => void;
  setSoundEnabled: (enabled: boolean) => void;
  openTutorial: () => void;
  closeTutorial: () => void;

  // Sync helpers
  getProgress: () => WordleProgress;
  setProgress: (data: WordleProgress) => void;
}

const defaultProgress: WordleProgress = {
  gamesPlayed: 0,
  gamesWon: 0,
  currentStreak: 0,
  maxStreak: 0,
  guessDistribution: [0, 0, 0, 0, 0, 0, 0, 0, 0], // 0-8 guesses
  settings: {
    soundEnabled: true,
    difficulty: "8yo",
  },
  lastModified: Date.now(),
};

export const useWordleStore = create<WordleState>()(
  persist(
    (set, get) => ({
      ...defaultProgress,

      // Session state
      gameState: "ready",
      targetWord: "",
      guesses: [],
      results: [],
      currentGuess: "",
      currentRow: 0,
      invalidGuess: false,
      revealedHint: null,
      showTutorial: false,

      startGame: () => {
        const { settings } = get();
        const diffSettings = getDifficultySettings(settings.difficulty);
        const word = getRandomWord(diffSettings.wordLength);

        set({
          gameState: "playing",
          targetWord: word,
          guesses: [],
          results: [],
          currentGuess: "",
          currentRow: 0,
          invalidGuess: false,
          revealedHint: null,
        });
      },

      addLetter: (letter) => {
        const { gameState, currentGuess, targetWord } = get();
        if (gameState !== "playing") return;
        if (currentGuess.length >= targetWord.length) return;

        set({ currentGuess: currentGuess + letter.toUpperCase(), invalidGuess: false });
      },

      removeLetter: () => {
        const { gameState, currentGuess } = get();
        if (gameState !== "playing") return;
        if (currentGuess.length === 0) return;

        set({ currentGuess: currentGuess.slice(0, -1), invalidGuess: false });
      },

      submitGuess: () => {
        const { gameState, currentGuess, targetWord, guesses, results, currentRow, settings } = get();
        if (gameState !== "playing") return;
        if (currentGuess.length !== targetWord.length) return;

        // Check if word is valid
        if (!isValidWord(currentGuess, targetWord.length)) {
          set({ invalidGuess: true });
          return;
        }

        const result = checkGuess(currentGuess, targetWord);
        const newGuesses = [...guesses, currentGuess];
        const newResults = [...results, result];

        // Check win
        if (currentGuess === targetWord) {
          const newDistribution = [...get().guessDistribution];
          newDistribution[currentRow + 1] = (newDistribution[currentRow + 1] || 0) + 1;

          set({
            gameState: "won",
            guesses: newGuesses,
            results: newResults,
            currentGuess: "",
            gamesPlayed: get().gamesPlayed + 1,
            gamesWon: get().gamesWon + 1,
            currentStreak: get().currentStreak + 1,
            maxStreak: Math.max(get().maxStreak, get().currentStreak + 1),
            guessDistribution: newDistribution,
            lastModified: Date.now(),
          });
          return;
        }

        // Check loss
        const diffSettings = getDifficultySettings(settings.difficulty);
        if (currentRow + 1 >= diffSettings.maxGuesses) {
          set({
            gameState: "lost",
            guesses: newGuesses,
            results: newResults,
            currentGuess: "",
            gamesPlayed: get().gamesPlayed + 1,
            currentStreak: 0,
            lastModified: Date.now(),
          });
          return;
        }

        // Continue game
        set({
          guesses: newGuesses,
          results: newResults,
          currentGuess: "",
          currentRow: currentRow + 1,
        });
      },

      useHint: () => {
        const { gameState, targetWord, results, revealedHint } = get();
        if (gameState !== "playing") return;
        if (revealedHint !== null) return; // Only one hint per game

        // Find a letter that hasn't been guessed correctly yet
        const correctPositions = new Set<number>();
        for (const result of results) {
          result.forEach((status, i) => {
            if (status === "correct") correctPositions.add(i);
          });
        }

        // Find an unrevealed position
        const availablePositions = [];
        for (let i = 0; i < targetWord.length; i++) {
          if (!correctPositions.has(i)) availablePositions.push(i);
        }

        if (availablePositions.length === 0) return;

        const hintPos = availablePositions[Math.floor(Math.random() * availablePositions.length)];
        set({ revealedHint: hintPos });
      },

      reset: () =>
        set({
          gameState: "ready",
          targetWord: "",
          guesses: [],
          results: [],
          currentGuess: "",
          currentRow: 0,
          invalidGuess: false,
          revealedHint: null,
        }),

      setDifficulty: (difficulty) =>
        set((state) => ({
          settings: { ...state.settings, difficulty },
          lastModified: Date.now(),
        })),

      setSoundEnabled: (enabled) =>
        set((state) => ({
          settings: { ...state.settings, soundEnabled: enabled },
          lastModified: Date.now(),
        })),

      openTutorial: () => set({ showTutorial: true }),
      closeTutorial: () => set({ showTutorial: false }),

      getProgress: () => {
        const state = get();
        return {
          gamesPlayed: state.gamesPlayed,
          gamesWon: state.gamesWon,
          currentStreak: state.currentStreak,
          maxStreak: state.maxStreak,
          guessDistribution: state.guessDistribution,
          settings: state.settings,
          lastModified: state.lastModified,
        };
      },

      setProgress: (data) => set((state) => ({ ...state, ...data })),
    }),
    {
      name: "wordle-progress",
      partialize: (state) => ({
        gamesPlayed: state.gamesPlayed,
        gamesWon: state.gamesWon,
        currentStreak: state.currentStreak,
        maxStreak: state.maxStreak,
        guessDistribution: state.guessDistribution,
        settings: state.settings,
        lastModified: state.lastModified,
      }),
    }
  )
);
