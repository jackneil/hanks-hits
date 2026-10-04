import { bindPersistedStore } from "@/lib/owner-bound-progress";
import { createOwnerPersistStorage } from "@/lib/owner-bound-progress/persistStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { defineUntouchedProgress, markSaved, settleOnLoad } from "@/shared/lib/untouchedProgress";
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
  // Session state. "paused" is the GameShell's pause (its menu, ESC, a
  // phone that loses focus): the problems stop falling.
  gameState: "ready" | "playing" | "paused" | "gameOver";
  score: number;
  lives: number;
  combo: number;
  wave: number;
  /** Goes up by one at each start, so a restart is a new run (clips). */
  runId: number;
  /** The best score when this run started: the score to beat. */
  runStartBest: number;
  /** The run that just ended beat the best from before it. */
  lastRunNewBest: boolean;

  // Actions
  startGame: (initialLives: number) => void;
  pauseGame: () => void;
  resumeGame: () => void;
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
  lastModified: 0, // Untouched until a player action stamps it (shared/lib/progressStamp.ts).
};

// Settings are not progress: a device that changed only a setting holds
// nothing that must win over the account (shared/lib/untouchedProgress.ts).
const UNTOUCHED = defineUntouchedProgress("math-attack", { layout: "flat", defaults: defaultProgress, ignore: ["settings"] });

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
      runId: 0,
      runStartBest: 0,
      lastRunNewBest: false,

      startGame: (initialLives) =>
        set((state) => ({
          gameState: "playing",
          score: 0,
          lives: initialLives,
          combo: 0,
          wave: 1,
          runId: state.runId + 1,
          runStartBest: state.highScore,
          lastRunNewBest: false,
        })),

      pauseGame: () => {
        if (get().gameState === "playing") set({ gameState: "paused" });
      },

      resumeGame: () => {
        if (get().gameState === "paused") set({ gameState: "playing" });
      },

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
        set((state) => {
          const longestCombo = Math.max(state.longestCombo, state.combo + 1);
          // Only a new longest combo is progress.
          return longestCombo === state.longestCombo
            ? { combo: state.combo + 1 }
            : { combo: state.combo + 1, longestCombo, lastModified: Date.now() };
        }),

      resetCombo: () => set({ combo: 0 }),

      loseLife: () =>
        set((state) => {
          const newLives = state.lives - 1;
          if (newLives <= 0) {
            return {
              lives: 0,
              gameState: "gameOver",
              lastRunNewBest: state.score > state.runStartBest,
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
          lastRunNewBest: state.score > state.runStartBest,
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
        set((state) =>
          state.settings.difficulty === difficulty
            ? {}
            : { settings: { ...state.settings, difficulty }, lastModified: Date.now() }
        ),

      setSoundEnabled: (enabled) =>
        set((state) =>
          state.settings.soundEnabled === enabled
            ? {}
            : { settings: { ...state.settings, soundEnabled: enabled }, lastModified: Date.now() }
        ),

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
        if ((currentState.gameState === "playing" || currentState.gameState === "paused") && data.settings?.difficulty) {
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
      storage: createOwnerPersistStorage("math-attack-progress", "math-attack"),
      skipHydration: true,
      name: "math-attack-progress",
      // A save of the code before the sync-time fix gets the real time of
      // its progress. The version stays, so that code still loads a new
      // save (shared/lib/untouchedProgress.ts).
      merge: settleOnLoad(UNTOUCHED),
      partialize: (state) => markSaved({
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

bindPersistedStore("math-attack-progress", useMathAttackStore.persist, () => useMathAttackStore.setState({}));
