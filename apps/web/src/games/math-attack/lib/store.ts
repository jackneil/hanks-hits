import { create } from "zustand";
import { persist } from "zustand/middleware";
import { type Difficulty, type Operation } from "./constants";

export interface MathAttackProgress {
  highScore: number;
  totalCorrect: number;
  totalAnswered: number;
  longestCombo: number;
  problemsSolved: Record<Operation, number>;
  gamesPlayed: number;
  settings: {
    soundEnabled: boolean;
    difficulty: Difficulty;
  };
  lastModified: number;
}

interface MathAttackState extends MathAttackProgress {
  // Session state
  gameState: "ready" | "playing" | "gameOver";
  score: number;
  lives: number;
  combo: number;
  wave: number;

  // Actions
  startGame: (initialLives: number) => void;
  addScore: (points: number, operation: Operation) => void;
  recordAnswerAttempt: () => void;
  incrementCombo: () => void;
  resetCombo: () => void;
  loseLife: () => void;
  endGame: () => void;
  reset: () => void;
  setDifficulty: (difficulty: Difficulty) => void;
  setSoundEnabled: (enabled: boolean) => void;

  // Sync helpers
  getProgress: () => MathAttackProgress;
  setProgress: (data: MathAttackProgress) => void;
}

const defaultProgress: MathAttackProgress = {
  highScore: 0,
  totalCorrect: 0,
  totalAnswered: 0,
  longestCombo: 0,
  problemsSolved: { "+": 0, "-": 0, "×": 0, "÷": 0 },
  gamesPlayed: 0,
  settings: {
    soundEnabled: true,
    difficulty: "8yo",
  },
  lastModified: Date.now(),
};

export const useMathAttackStore = create<MathAttackState>()(
  persist(
    (set, get) => ({
      ...defaultProgress,

      // Session state
      gameState: "ready",
      score: 0,
      lives: 3,
      combo: 0,
      wave: 1,

      startGame: (initialLives) =>
        set({
          gameState: "playing",
          score: 0,
          lives: initialLives,
          combo: 0,
          wave: 1,
        }),

      addScore: (points, operation) =>
        set((state) => {
          const newProblemsSolved = { ...state.problemsSolved };
          newProblemsSolved[operation] = (newProblemsSolved[operation] || 0) + 1;

          return {
            score: state.score + points,
            totalCorrect: state.totalCorrect + 1,
            totalAnswered: state.totalAnswered + 1,
            problemsSolved: newProblemsSolved,
            lastModified: Date.now(),
          };
        }),

      recordAnswerAttempt: () =>
        set((state) => ({
          totalAnswered: state.totalAnswered + 1,
          lastModified: Date.now(),
        })),

      incrementCombo: () =>
        set((state) => ({
          combo: state.combo + 1,
          longestCombo: Math.max(state.longestCombo, state.combo + 1),
          lastModified: Date.now(),
        })),

      resetCombo: () => set({ combo: 0 }),

      loseLife: () =>
        set((state) => {
          const newLives = state.lives - 1;
          if (newLives <= 0) {
            return {
              lives: 0,
              gameState: "gameOver",
              highScore: Math.max(state.highScore, state.score),
              gamesPlayed: state.gamesPlayed + 1,
              combo: 0,
              lastModified: Date.now(),
            };
          }
          return { lives: newLives, combo: 0 };
        }),

      endGame: () =>
        set((state) => ({
          gameState: "gameOver",
          highScore: Math.max(state.highScore, state.score),
          gamesPlayed: state.gamesPlayed + 1,
          lastModified: Date.now(),
        })),

      reset: () =>
        set({
          gameState: "ready",
          score: 0,
          lives: 3,
          combo: 0,
          wave: 1,
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

      getProgress: () => {
        const state = get();
        return {
          highScore: state.highScore,
          totalCorrect: state.totalCorrect,
          totalAnswered: state.totalAnswered,
          longestCombo: state.longestCombo,
          problemsSolved: state.problemsSolved,
          gamesPlayed: state.gamesPlayed,
          settings: state.settings,
          lastModified: state.lastModified,
        };
      },

      setProgress: (data) => {
        const currentState = get();
        // Don't let cloud sync change difficulty while playing
        // This prevents a race condition where cloud sync overwrites user's selection
        if (currentState.gameState === "playing" && data.settings?.difficulty) {
          set((state) => ({
            ...state,
            ...data,
            settings: { ...data.settings, difficulty: currentState.settings.difficulty },
          }));
        } else {
          set((state) => ({ ...state, ...data }));
        }
      },
    }),
    {
      name: "math-attack-progress",
      partialize: (state) => ({
        highScore: state.highScore,
        totalCorrect: state.totalCorrect,
        totalAnswered: state.totalAnswered,
        longestCombo: state.longestCombo,
        problemsSolved: state.problemsSolved,
        gamesPlayed: state.gamesPlayed,
        settings: state.settings,
        lastModified: state.lastModified,
      }),
    }
  )
);
