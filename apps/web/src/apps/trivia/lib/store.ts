import { bindPersistedStore } from "@/lib/owner-bound-progress";
import { createOwnerPersistStorage } from "@/lib/owner-bound-progress/persistStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { defineUntouchedProgress, markSaved, settleOnLoad } from "@/shared/lib/untouchedProgress";
import { type Difficulty } from "./constants";

export interface TriviaProgress {
  highScore: number;
  totalCorrect: number;
  totalAnswered: number;
  longestStreak: number;
  gamesPlayed: number;
  settings: {
    soundEnabled: boolean;
    difficulty: Difficulty;
  };
  lastModified: number;
}

interface TriviaState extends TriviaProgress {
  // Session state (not persisted)
  currentScore: number;
  currentStreak: number;
  questionIndex: number;
  gameState: "ready" | "playing" | "finished";

  // Actions
  startGame: () => void;
  answerQuestion: (correct: boolean, points: number) => void;
  nextQuestion: () => void;
  endGame: () => void;
  reset: () => void;
  setDifficulty: (difficulty: Difficulty) => void;
  setSoundEnabled: (enabled: boolean) => void;

  // Sync helpers
  getProgress: () => TriviaProgress;
  setProgress: (data: TriviaProgress) => void;
}

const defaultProgress: TriviaProgress = {
  highScore: 0,
  totalCorrect: 0,
  totalAnswered: 0,
  longestStreak: 0,
  gamesPlayed: 0,
  settings: {
    soundEnabled: true,
    difficulty: "8yo",
  },
  lastModified: 0, // Untouched until a player action stamps it (shared/lib/progressStamp.ts).
};

// Settings are not progress: a device that changed only a setting holds
// nothing that must win over the account (shared/lib/untouchedProgress.ts).
const UNTOUCHED = defineUntouchedProgress("trivia", { layout: "flat", defaults: defaultProgress, ignore: ["settings"] });

export const useTriviaStore = create<TriviaState>()(
  persist(
    (set, get) => ({
      ...defaultProgress,

      // Session state
      currentScore: 0,
      currentStreak: 0,
      questionIndex: 0,
      gameState: "ready",

      startGame: () =>
        set({
          gameState: "playing",
          currentScore: 0,
          currentStreak: 0,
          questionIndex: 0,
        }),

      answerQuestion: (correct, points) =>
        set((state) => {
          const newStreak = correct ? state.currentStreak + 1 : 0;
          const newScore = correct ? state.currentScore + points : state.currentScore;

          return {
            currentScore: newScore,
            currentStreak: newStreak,
            totalCorrect: state.totalCorrect + (correct ? 1 : 0),
            totalAnswered: state.totalAnswered + 1,
            longestStreak: Math.max(state.longestStreak, newStreak),
            lastModified: Date.now(),
          };
        }),

      nextQuestion: () =>
        set((state) => ({
          questionIndex: state.questionIndex + 1,
        })),

      endGame: () =>
        set((state) => ({
          gameState: "finished",
          highScore: Math.max(state.highScore, state.currentScore),
          gamesPlayed: state.gamesPlayed + 1,
          lastModified: Date.now(),
        })),

      reset: () =>
        set({
          gameState: "ready",
          currentScore: 0,
          currentStreak: 0,
          questionIndex: 0,
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
          longestStreak: state.longestStreak,
          gamesPlayed: state.gamesPlayed,
          settings: state.settings,
          lastModified: state.lastModified,
        };
      },

      setProgress: (data) => set((state) => ({ ...state, ...data })),
    }),
    {
      storage: createOwnerPersistStorage("trivia-progress", "trivia"),
      skipHydration: true,
      name: "trivia-progress",
      // A save of the code before the sync-time fix gets the real time of
      // its progress. The version stays, so that code still loads a new
      // save (shared/lib/untouchedProgress.ts).
      merge: settleOnLoad(UNTOUCHED),
      partialize: (state) => markSaved({
        highScore: state.highScore,
        totalCorrect: state.totalCorrect,
        totalAnswered: state.totalAnswered,
        longestStreak: state.longestStreak,
        gamesPlayed: state.gamesPlayed,
        settings: state.settings,
        lastModified: state.lastModified,
      }),
    }
  )
);

bindPersistedStore("trivia-progress", useTriviaStore.persist, () => useTriviaStore.setState({}));
