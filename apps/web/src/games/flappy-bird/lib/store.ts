import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  type GameState,
  type Bird as BirdType,
  type Pipe as PipeType,
  type Medal,
  BIRD,
  PHYSICS,
  PIPE,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  GROUND,
  getMedal,
} from "./constants";

// Progress data that gets synced to server
export type FlappyBirdProgress = {
  highScore: number;
  gamesPlayed: number;
  totalPipes: number;
  medals: {
    bronze: number;
    silver: number;
    gold: number;
    platinum: number;
  };
  lastModified: number;
};

const defaultProgress: FlappyBirdProgress = {
  highScore: 0,
  gamesPlayed: 0,
  totalPipes: 0,
  medals: {
    bronze: 0,
    silver: 0,
    gold: 0,
    platinum: 0,
  },
  lastModified: Date.now(),
};

// Full game state
type FlappyBirdState = {
  // Current game state
  gameState: GameState;
  score: number;
  bird: BirdType;
  pipes: PipeType[];
  groundOffset: number;
  pipeIdCounter: number;
  isNewHighScore: boolean;

  // Persisted progress
  progress: FlappyBirdProgress;

  // Actions
  startGame: () => void;
  flap: () => void;
  update: (delta: number) => void;
  endGame: () => void;
  reset: () => void;

  // For useAuthSync
  getProgress: () => FlappyBirdProgress;
  setProgress: (data: FlappyBirdProgress) => void;
};

// Create a random pipe with gap position
function createPipe(id: number): PipeType {
  const minGapY = PIPE.MIN_HEIGHT + PIPE.GAP / 2;
  const maxGapY = CANVAS_HEIGHT - GROUND.HEIGHT - PIPE.MIN_HEIGHT - PIPE.GAP / 2;
  const gapY = Math.random() * (maxGapY - minGapY) + minGapY;

  return {
    x: CANVAS_WIDTH + 20,
    gapY,
    scored: false,
    id,
  };
}

export const useFlappyStore = create<FlappyBirdState>()(
  persist(
    (set, get) => ({
      // Initial state
      gameState: "ready",
      score: 0,
      bird: {
        y: BIRD.START_Y,
        velocity: 0,
        rotation: 0,
      },
      pipes: [],
      groundOffset: 0,
      pipeIdCounter: 0,
      isNewHighScore: false,
      progress: defaultProgress,

      startGame: () => {
        const state = get();
        set({
          gameState: "playing",
          score: 0,
          bird: {
            y: BIRD.START_Y,
            velocity: PHYSICS.FLAP_VELOCITY,
            rotation: PHYSICS.MAX_ROTATION_UP,
          },
          pipes: [createPipe(state.pipeIdCounter + 1)],
          pipeIdCounter: state.pipeIdCounter + 1,
          isNewHighScore: false,
        });
      },

      flap: () => {
        const state = get();
        if (state.gameState !== "playing") return;

        set({
          bird: {
            ...state.bird,
            velocity: PHYSICS.FLAP_VELOCITY,
            rotation: PHYSICS.MAX_ROTATION_UP,
          },
        });
      },

      update: (delta: number) => {
        const state = get();
        if (state.gameState !== "playing") return;

        // Normalize delta to ~16ms (60fps)
        const normalizedDelta = Math.min(delta / 16.67, 2);

        // Update bird physics
        let newVelocity = state.bird.velocity + PHYSICS.GRAVITY * normalizedDelta;
        newVelocity = Math.min(newVelocity, PHYSICS.MAX_FALL_SPEED);
        const newY = state.bird.y + newVelocity * normalizedDelta;

        // Calculate rotation based on velocity
        let newRotation = state.bird.rotation;
        if (newVelocity < 0) {
          // Going up - tilt up
          newRotation = Math.max(newRotation - PHYSICS.ROTATION_SPEED, PHYSICS.MAX_ROTATION_UP);
        } else {
          // Falling - tilt down
          newRotation = Math.min(newRotation + PHYSICS.ROTATION_SPEED * 0.5, PHYSICS.MAX_ROTATION_DOWN);
        }

        // Update pipes
        let newPipes = state.pipes.map((pipe) => ({
          ...pipe,
          x: pipe.x - PIPE.SPEED * normalizedDelta,
        }));

        // Remove off-screen pipes
        newPipes = newPipes.filter((pipe) => pipe.x > -PIPE.WIDTH);

        // Spawn new pipe if needed
        let newPipeIdCounter = state.pipeIdCounter;
        const lastPipe = newPipes[newPipes.length - 1];
        if (!lastPipe || lastPipe.x < CANVAS_WIDTH - 180) {
          newPipeIdCounter++;
          newPipes.push(createPipe(newPipeIdCounter));
        }

        // Update ground offset for scrolling
        const newGroundOffset = (state.groundOffset + PIPE.SPEED * normalizedDelta) % 24;

        // Check for scoring
        let newScore = state.score;
        newPipes = newPipes.map((pipe) => {
          if (!pipe.scored && pipe.x + PIPE.WIDTH < BIRD.X) {
            newScore++;
            return { ...pipe, scored: true };
          }
          return pipe;
        });

        // Check collisions
        const groundY = CANVAS_HEIGHT - GROUND.HEIGHT;
        const birdTop = newY - BIRD.HITBOX_HEIGHT / 2;
        const birdBottom = newY + BIRD.HITBOX_HEIGHT / 2;
        const birdLeft = BIRD.X - BIRD.HITBOX_WIDTH / 2 + BIRD.HITBOX_OFFSET_X;
        const birdRight = BIRD.X + BIRD.HITBOX_WIDTH / 2 + BIRD.HITBOX_OFFSET_X;

        // Ground/ceiling collision
        if (birdBottom >= groundY || birdTop <= 0) {
          get().endGame();
          return;
        }

        // Pipe collision
        for (const pipe of newPipes) {
          const pipeLeft = pipe.x;
          const pipeRight = pipe.x + PIPE.WIDTH;
          const gapTop = pipe.gapY - PIPE.GAP / 2;
          const gapBottom = pipe.gapY + PIPE.GAP / 2;

          // Check if bird overlaps with pipe horizontally
          if (birdRight > pipeLeft && birdLeft < pipeRight) {
            // Check if bird is in the gap
            if (birdTop < gapTop || birdBottom > gapBottom) {
              get().endGame();
              return;
            }
          }
        }

        set({
          bird: {
            y: newY,
            velocity: newVelocity,
            rotation: newRotation,
          },
          pipes: newPipes,
          groundOffset: newGroundOffset,
          pipeIdCounter: newPipeIdCounter,
          score: newScore,
        });
      },

      endGame: () => {
        const state = get();
        const medal = getMedal(state.score);
        const isNewHighScore = state.score > state.progress.highScore;

        set({
          gameState: "gameOver",
          isNewHighScore,
          progress: {
            ...state.progress,
            highScore: Math.max(state.progress.highScore, state.score),
            gamesPlayed: state.progress.gamesPlayed + 1,
            totalPipes: state.progress.totalPipes + state.score,
            medals: {
              bronze: state.progress.medals.bronze + (medal !== "none" ? 1 : 0),
              silver: state.progress.medals.silver + (medal === "silver" || medal === "gold" || medal === "platinum" ? 1 : 0),
              gold: state.progress.medals.gold + (medal === "gold" || medal === "platinum" ? 1 : 0),
              platinum: state.progress.medals.platinum + (medal === "platinum" ? 1 : 0),
            },
            lastModified: Date.now(),
          },
        });
      },

      reset: () => {
        set({
          gameState: "ready",
          score: 0,
          bird: {
            y: BIRD.START_Y,
            velocity: 0,
            rotation: 0,
          },
          pipes: [],
          groundOffset: 0,
          isNewHighScore: false,
        });
      },

      getProgress: () => get().progress,
      setProgress: (data) => set({ progress: data }),
    }),
    {
      name: "flappy-bird-progress",
      partialize: (state) => ({ progress: state.progress }),
    }
  )
);
