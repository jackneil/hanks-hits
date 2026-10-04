import { bindPersistedStore } from "@/lib/owner-bound-progress";
import { createOwnerPersistStorage } from "@/lib/owner-bound-progress/persistStorage";
// Arkanoid Game - State Management
// Zustand store with progress persistence

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { PADDLE, BALL_CONFIG, LIVES, PADDLE_LIMIT, SPARKS_PER_TOUCH } from "./constants";
import { defineUntouchedProgress, markSaved, settleOnLoad } from "@/shared/lib/untouchedProgress";

export type BallType = "blue" | "orange" | "yellow-dot";

export type Ball = {
  id: string;
  type: BallType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  // When true the ball rests on the paddle and waits for the player to launch
  // it, instead of auto-launching the moment the game starts.
  stuck?: boolean;
  // Horizontal offset from the paddle center while stuck (keeps the resting
  // balls spread out and following the paddle so the player can aim).
  offsetX?: number;
  // The splits this ball may still cause (SPARKS_PER_TOUCH after the paddle
  // touches it). None when absent.
  sparks?: number;
};

export type GameState = "menu" | "playing" | "paused" | "gameOver";

export type ArkanoidProgress = {
  highScore: number;
  totalGamesPlayed: number;
  totalBallsSpawned: number;
  highestMultiplier: number;
  lastModified: number;
};

type State = {
  // Game state
  gameState: GameState;
  score: number;
  multiplier: number;
  balls: Ball[];
  wasNewHighScore: boolean;
  /** Tries left in this run (a lost life puts new balls on the paddle). */
  lives: number;
  /** Goes up at every start: a new value while playing is a new run. */
  runId: number;

  // Paddle
  paddleX: number; // -1 to 1 (normalized)

  // Settings
  soundEnabled: boolean;

  // Progress (saved)
  progress: ArkanoidProgress;
};

type Actions = {
  // Game flow
  startGame: () => void;
  launchBall: () => void;
  pauseGame: () => void;
  resumeGame: () => void;
  endGame: () => void;
  /** Every ball fell: lose a life and put new balls on the paddle, or end the run. */
  loseLife: () => void;

  // Gameplay
  setPaddleX: (x: number) => void;
  addBall: (ball: Omit<Ball, "id">) => void;
  updateBalls: (balls: Ball[]) => void;
  addScore: (points: number) => void;
  updateMultiplier: (ballCount: number) => void;

  // Settings
  toggleSound: () => void;

  // Progress (required for cloud sync)
  getProgress: () => ArkanoidProgress;
  setProgress: (data: ArkanoidProgress) => void;
};

/** Three balls resting on the paddle, waiting for a launch. */
function restingBalls(paddleX: number): Ball[] {
  const restY = PADDLE.y + PADDLE.height / 2 + BALL_CONFIG.blue.radius;
  return [-0.08, 0, 0.08].map((offsetX, i) => ({
    id: `rest-${Date.now()}-${i}`,
    type: "blue" as const,
    x: paddleX + offsetX,
    y: restY,
    vx: 0,
    vy: 0,
    stuck: true,
    offsetX,
  }));
}

const defaultProgress: ArkanoidProgress = {
  highScore: 0,
  totalGamesPlayed: 0,
  totalBallsSpawned: 0,
  highestMultiplier: 1,
  lastModified: 0, // Untouched until a player action stamps it (shared/lib/progressStamp.ts).
};

const UNTOUCHED = defineUntouchedProgress("arkanoid", { defaults: defaultProgress });

export const useArkanoidStore = create<State & Actions>()(
  persist(
    (set, get) => ({
      // Initial state
      gameState: "menu",
      score: 0,
      multiplier: 1,
      balls: [],
      wasNewHighScore: false,
      lives: LIVES,
      runId: 0,
      paddleX: 0,
      soundEnabled: true,
      progress: defaultProgress,

      // Game flow
      startGame: () => {
        set({
          gameState: "playing",
          score: 0,
          multiplier: 1,
          wasNewHighScore: false,
          lives: LIVES,
          runId: get().runId + 1,
          paddleX: 0,
          balls: restingBalls(0),
        });
      },

      loseLife: () => {
        const state = get();
        if (state.gameState !== "playing") return;
        if (state.lives <= 1) {
          set({ lives: 0, balls: [] });
          get().endGame();
          return;
        }
        set({ lives: state.lives - 1, multiplier: 1, balls: restingBalls(state.paddleX) });
      },

      launchBall: () => {
        const state = get();
        if (state.gameState !== "playing") return;
        if (!state.balls.some((b) => b.stuck)) return;

        const launched = state.balls.map((ball) => {
          if (!ball.stuck) return ball;
          const offset = ball.offsetX ?? 0;
          return {
            ...ball,
            stuck: false,
            vx: offset * 8, // outward spread from the paddle center
            vy: 1.4, // launch upward
            sparks: SPARKS_PER_TOUCH, // a launch is a paddle touch
          };
        });
        set({ balls: launched });
      },

      pauseGame: () => {
        if (get().gameState === "playing") {
          set({ gameState: "paused" });
        }
      },

      resumeGame: () => {
        if (get().gameState === "paused") {
          set({ gameState: "playing" });
        }
      },

      endGame: () => {
        const state = get();
        const newProgress = { ...state.progress };
        let isNewHighScore = false;

        // Update progress
        if (state.score > newProgress.highScore) {
          newProgress.highScore = state.score;
          isNewHighScore = true;
        }
        if (state.multiplier > newProgress.highestMultiplier) {
          newProgress.highestMultiplier = state.multiplier;
        }
        newProgress.totalGamesPlayed += 1;
        newProgress.lastModified = Date.now();

        set({
          gameState: "gameOver",
          progress: newProgress,
          wasNewHighScore: isNewHighScore,
        });
      },

      // Gameplay
      setPaddleX: (x: number) => {
        const clamped = Math.max(-PADDLE_LIMIT, Math.min(PADDLE_LIMIT, x));
        set({ paddleX: clamped });
      },

      addBall: (ball: Omit<Ball, "id">) => {
        const state = get();
        const id = `ball-${Date.now()}-${Math.random()}`;
        const newBall = { ...ball, id };

        set({
          balls: [...state.balls, newBall],
          progress: {
            ...state.progress,
            totalBallsSpawned: state.progress.totalBallsSpawned + 1,
            lastModified: Date.now(),
          },
        });
      },

      updateBalls: (balls: Ball[]) => {
        set({ balls });
      },

      addScore: (points: number) => {
        const state = get();
        const finalPoints = Math.floor(points * state.multiplier);
        set({ score: state.score + finalPoints });
      },

      updateMultiplier: (ballCount: number) => {
        let mult = 1;
        if (ballCount >= 50) mult = 10;
        else if (ballCount >= 20) mult = 5;
        else if (ballCount >= 10) mult = 2;

        set({ multiplier: mult });
      },

      // Settings
      toggleSound: () => {
        set({ soundEnabled: !get().soundEnabled });
      },

      // Progress (required for cloud sync)
      getProgress: () => get().progress,
      setProgress: (data: ArkanoidProgress) => {
        set({ progress: data });
      },
    }),
    {
      storage: createOwnerPersistStorage("arkanoid-state", "arkanoid"),
      skipHydration: true,
      name: "arkanoid-state",
      // A save of the code before the sync-time fix gets the real time of
      // its progress. The version stays, so that code still loads a new
      // save (shared/lib/untouchedProgress.ts).
      merge: settleOnLoad(UNTOUCHED),
      partialize: (state) => markSaved({
        progress: state.progress,
        soundEnabled: state.soundEnabled,
      }),
    }
  )
);

bindPersistedStore("arkanoid-state", useArkanoidStore.persist, () => useArkanoidStore.setState({}));
