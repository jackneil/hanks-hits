// Arkanoid Game - State Management
// Zustand store with progress persistence

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { PADDLE, BALL_CONFIG } from "./constants";

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

  // Gameplay
  setPaddleX: (x: number) => void;
  addBall: (ball: Omit<Ball, "id">) => void;
  removeBall: (id: string) => void;
  updateBalls: (balls: Ball[]) => void;
  addScore: (points: number) => void;
  updateMultiplier: (ballCount: number) => void;

  // Settings
  toggleSound: () => void;

  // Progress (required for cloud sync)
  getProgress: () => ArkanoidProgress;
  setProgress: (data: ArkanoidProgress) => void;
};

const defaultProgress: ArkanoidProgress = {
  highScore: 0,
  totalGamesPlayed: 0,
  totalBallsSpawned: 0,
  highestMultiplier: 1,
  lastModified: Date.now(),
};

export const useArkanoidStore = create<State & Actions>()(
  persist(
    (set, get) => ({
      // Initial state
      gameState: "menu",
      score: 0,
      multiplier: 1,
      balls: [],
      wasNewHighScore: false,
      paddleX: 0,
      soundEnabled: true,
      progress: defaultProgress,

      // Game flow
      startGame: () => {
        // Balls rest on the paddle (stuck) until the player launches them, so a
        // new game never auto-launches and burns through the balls with no input.
        const restY = PADDLE.y + PADDLE.height / 2 + BALL_CONFIG.blue.radius;
        set({
          gameState: "playing",
          score: 0,
          multiplier: 1,
          wasNewHighScore: false,
          paddleX: 0,
          balls: [
            // Start with 3 blue balls resting on the paddle, spread out.
            { id: "initial-1", type: "blue", x: -0.06, y: restY, vx: 0, vy: 0, stuck: true, offsetX: -0.06 },
            { id: "initial-2", type: "blue", x: 0, y: restY, vx: 0, vy: 0, stuck: true, offsetX: 0 },
            { id: "initial-3", type: "blue", x: 0.06, y: restY, vx: 0, vy: 0, stuck: true, offsetX: 0.06 },
          ],
        });
      },

      // Release the resting balls upward off the paddle, with a slight outward
      // spread. Positive vy = moving UP toward the walls/maze.
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
        // Clamp to -1 to 1
        const clamped = Math.max(-1, Math.min(1, x));
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

      removeBall: (id: string) => {
        const state = get();
        const newBalls = state.balls.filter((b) => b.id !== id);

        // Game over if no balls left
        if (newBalls.length === 0) {
          get().endGame();
        } else {
          set({ balls: newBalls });
        }
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
      name: "arkanoid-state",
      partialize: (state) => ({
        progress: state.progress,
        soundEnabled: state.soundEnabled,
      }),
    }
  )
);
