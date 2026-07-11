import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  type Card,
  type Difficulty,
  type ThemeId,
  DIFFICULTIES,
  THEMES,
  TIMING,
  createCards,
  calculateStars,
} from "./constants";

// Progress that gets saved to database
// Index signature required for AppProgressData compatibility
export type MemoryMatchProgress = {
  [key: string]: unknown;
  updatedAt: number;
  bestTimes: {
    easy: number | null;
    medium: number | null;
    hard: number | null;
    expert: number | null;
  };
  totalMatches: number;
  gamesPlayed: number;
  gamesWon: number;
  perfectGames: number;
  favoriteTheme: ThemeId;
  soundEnabled: boolean;
  unlockedThemes: ThemeId[];
  // Settings (synced to cloud)
  difficulty: Difficulty;
  theme: ThemeId;
};

// Current game state
export type GameState = {
  // Game board
  cards: Card[];
  flippedCards: number[]; // indices of currently flipped cards (max 2)
  matchedPairs: number;
  moves: number;

  // Timer
  timeStarted: number | null;
  timeEnded: number | null;
  currentTime: number;
  // Transient (never persisted): the wall-clock instant the GameShell paused
  // the timer, or null when running. The elapsed time is anchored to
  // timeStarted, so resuming shifts timeStarted to exclude the paused span.
  pausedAt: number | null;

  // Settings
  difficulty: Difficulty;
  theme: ThemeId;

  // Game status
  isPlaying: boolean;
  isWon: boolean;
  isProcessing: boolean; // true when checking for match

  // Progress
  progress: MemoryMatchProgress;
};

type GameActions = {
  // Core actions
  flipCard: (cardIndex: number) => void;
  newGame: (difficulty?: Difficulty, theme?: ThemeId) => void;
  setDifficulty: (difficulty: Difficulty) => void;
  setTheme: (theme: ThemeId) => void;
  toggleSound: () => void;
  tick: () => void;
  pauseTimer: () => void;
  resumeTimer: () => void;

  // Progress
  getProgress: () => MemoryMatchProgress;
  setProgress: (data: MemoryMatchProgress) => void;
  isThemeUnlocked: (theme: ThemeId) => boolean;
};

const defaultProgress: MemoryMatchProgress = {
  updatedAt: Date.now(),
  bestTimes: {
    easy: null,
    medium: null,
    hard: null,
    expert: null,
  },
  totalMatches: 0,
  gamesPlayed: 0,
  gamesWon: 0,
  perfectGames: 0,
  favoriteTheme: "animals",
  soundEnabled: true,
  unlockedThemes: ["animals"],
  difficulty: "medium",
  theme: "animals",
};

export const useMemoryMatchStore = create<GameState & GameActions>()(
  persist(
    (set, get) => ({
      // Initial state
      cards: createCards("medium", "animals"),
      flippedCards: [],
      matchedPairs: 0,
      moves: 0,
      timeStarted: null,
      timeEnded: null,
      currentTime: 0,
      pausedAt: null,
      difficulty: "medium",
      theme: "animals",
      isPlaying: false,
      isWon: false,
      isProcessing: false,
      progress: defaultProgress,

      flipCard: (cardIndex: number) => {
        const state = get();

        // Can't flip if processing, won, or card already matched/flipped
        if (state.isProcessing || state.isWon) return;

        const card = state.cards[cardIndex];
        if (!card || card.isFlipped || card.isMatched) return;

        // Can't flip more than 2 cards
        if (state.flippedCards.length >= 2) return;

        // Start timer on first flip
        const timeStarted = state.timeStarted ?? Date.now();
        const isPlaying = true;

        // Flip the card
        const newCards = [...state.cards];
        newCards[cardIndex] = { ...card, isFlipped: true };
        const newFlippedCards = [...state.flippedCards, cardIndex];

        set({
          cards: newCards,
          flippedCards: newFlippedCards,
          timeStarted,
          isPlaying,
        });

        // If we now have 2 cards flipped, check for match
        if (newFlippedCards.length === 2) {
          set({ isProcessing: true, moves: state.moves + 1 });

          const firstCard = newCards[newFlippedCards[0]];
          const secondCard = newCards[newFlippedCards[1]];

          if (firstCard.imageId === secondCard.imageId) {
            // Match found!
            setTimeout(() => {
              const currentState = get();
              const matchedCards = [...currentState.cards];
              matchedCards[newFlippedCards[0]] = {
                ...matchedCards[newFlippedCards[0]],
                isMatched: true,
              };
              matchedCards[newFlippedCards[1]] = {
                ...matchedCards[newFlippedCards[1]],
                isMatched: true,
              };

              const newMatchedPairs = currentState.matchedPairs + 1;
              const totalPairs = DIFFICULTIES[currentState.difficulty].pairs;
              const isWon = newMatchedPairs >= totalPairs;

              if (isWon) {
                const timeEnded = Date.now();
                const elapsedTime = timeEnded - (currentState.timeStarted ?? timeEnded);
                const moves = currentState.moves;
                const stars = calculateStars(moves, totalPairs);
                const isPerfect = stars === 3;

                // Update progress
                const newProgress = { ...currentState.progress };
                newProgress.updatedAt = Date.now();
                newProgress.gamesPlayed += 1;
                newProgress.gamesWon += 1;
                newProgress.totalMatches += newMatchedPairs;
                if (isPerfect) newProgress.perfectGames += 1;
                newProgress.favoriteTheme = currentState.theme;

                // Update best time
                const bestKey = currentState.difficulty;
                const currentBest = newProgress.bestTimes[bestKey];
                if (currentBest === null || elapsedTime < currentBest) {
                  newProgress.bestTimes[bestKey] = elapsedTime;
                }

                // Unlock themes based on total wins
                const totalWins = newProgress.gamesWon;
                Object.values(THEMES).forEach((themeConfig) => {
                  if (
                    totalWins >= themeConfig.unlockCondition &&
                    !newProgress.unlockedThemes.includes(themeConfig.id)
                  ) {
                    newProgress.unlockedThemes.push(themeConfig.id);
                  }
                });

                set({
                  cards: matchedCards,
                  flippedCards: [],
                  matchedPairs: newMatchedPairs,
                  isProcessing: false,
                  isWon: true,
                  isPlaying: false,
                  timeEnded,
                  currentTime: elapsedTime,
                  progress: newProgress,
                });
              } else {
                set({
                  cards: matchedCards,
                  flippedCards: [],
                  matchedPairs: newMatchedPairs,
                  isProcessing: false,
                });
              }
            }, TIMING.MATCH_CELEBRATION_MS);
          } else {
            // No match - flip cards back after delay
            setTimeout(() => {
              const currentState = get();
              const resetCards = [...currentState.cards];
              resetCards[newFlippedCards[0]] = {
                ...resetCards[newFlippedCards[0]],
                isFlipped: false,
              };
              resetCards[newFlippedCards[1]] = {
                ...resetCards[newFlippedCards[1]],
                isFlipped: false,
              };

              set({
                cards: resetCards,
                flippedCards: [],
                isProcessing: false,
              });
            }, TIMING.MISMATCH_DELAY_MS);
          }
        }
      },

      newGame: (difficulty?: Difficulty, theme?: ThemeId) => {
        const state = get();
        const newDifficulty = difficulty ?? state.difficulty;
        const newTheme = theme ?? state.theme;

        set({
          cards: createCards(newDifficulty, newTheme),
          flippedCards: [],
          matchedPairs: 0,
          moves: 0,
          timeStarted: null,
          timeEnded: null,
          currentTime: 0,
          pausedAt: null,
          difficulty: newDifficulty,
          theme: newTheme,
          isPlaying: false,
          isWon: false,
          isProcessing: false,
        });
      },

      setDifficulty: (difficulty: Difficulty) => {
        get().newGame(difficulty, get().theme);
      },

      setTheme: (theme: ThemeId) => {
        const state = get();
        if (state.isThemeUnlocked(theme)) {
          state.newGame(state.difficulty, theme);
        }
      },

      toggleSound: () => {
        set((state) => ({
          progress: {
            ...state.progress,
            soundEnabled: !state.progress.soundEnabled,
            updatedAt: Date.now(),
          },
        }));
      },

      tick: () => {
        const state = get();
        // Freeze the displayed time while the GameShell has the timer paused.
        if (
          state.isPlaying &&
          state.timeStarted &&
          !state.isWon &&
          state.pausedAt === null
        ) {
          set({ currentTime: Date.now() - state.timeStarted });
        }
      },

      // Driven by the GameShell (ESC, pause button, pause-on-blur). The timer is
      // anchored to timeStarted (elapsed = now - timeStarted), so simply halting
      // the tick interval would NOT pause it: on resume it would jump forward and
      // the recorded time would include the pause. Instead we record pausedAt and,
      // on resume, slide timeStarted forward by the paused duration.
      pauseTimer: () => {
        const state = get();
        if (
          state.isPlaying &&
          state.timeStarted !== null &&
          !state.isWon &&
          state.pausedAt === null
        ) {
          set({ pausedAt: Date.now() });
        }
      },

      resumeTimer: () => {
        const state = get();
        if (state.pausedAt === null) return;
        if (state.timeStarted !== null) {
          const newTimeStarted = state.timeStarted + (Date.now() - state.pausedAt);
          set({
            timeStarted: newTimeStarted,
            pausedAt: null,
            currentTime: Date.now() - newTimeStarted,
          });
        } else {
          set({ pausedAt: null });
        }
      },

      getProgress: () => ({
        ...get().progress,
        difficulty: get().difficulty,
        theme: get().theme,
      }),

      setProgress: (data: MemoryMatchProgress) => {
        set({
          progress: data,
          difficulty: data.difficulty ?? get().difficulty,
          theme: data.theme ?? get().theme,
        });
      },

      isThemeUnlocked: (theme: ThemeId) => {
        return get().progress.unlockedThemes.includes(theme);
      },
    }),
    {
      name: "memory-match-progress",
      partialize: (state) => ({
        progress: state.progress,
        difficulty: state.difficulty,
        theme: state.theme,
      }),
    }
  )
);
