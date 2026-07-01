import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  type Direction,
  type Position,
  type GameStatus,
  type SpeedSetting,
  type ControlMode,
  type FoodType,
  GRID_SIZE,
  OPPOSITE_DIRECTIONS,
  POINTS_PER_FOOD,
  positionsEqual,
  calculateNewHead,
  isValidPosition,
  wrapPosition,
  getValidFoodPosition,
  getRandomFoodType,
  getInitialSnake,
} from "./constants";

export type SnakeProgress = {
  highScore: number;
  longestSnake: number;
  gamesPlayed: number;
  totalFoodEaten: number;
  speed: SpeedSetting;
  wraparoundWalls: boolean;
  controlMode: ControlMode;
  soundEnabled: boolean;
  lastModified: number;
};

export type SnakeGameState = {
  // Game board
  gridSize: number;

  // Snake
  snake: Position[];
  direction: Direction;
  nextDirection: Direction;

  // Food
  food: Position;
  foodType: FoodType;

  // Game state
  status: GameStatus;

  // Score
  score: number;

  // Progress (persisted)
  progress: SnakeProgress;
};

type SnakeGameActions = {
  // Game actions
  startGame: () => void;
  pauseGame: () => void;
  resumeGame: () => void;
  setDirection: (dir: Direction) => void;
  tick: () => void;
  reset: () => void;

  // Settings
  setSpeed: (speed: SpeedSetting) => void;
  setWraparound: (enabled: boolean) => void;
  setControlMode: (mode: ControlMode) => void;
  setSoundEnabled: (enabled: boolean) => void;

  // Progress sync
  getProgress: () => SnakeProgress;
  setProgress: (data: SnakeProgress) => void;
};

const defaultProgress: SnakeProgress = {
  highScore: 0,
  longestSnake: 3,
  gamesPlayed: 0,
  totalFoodEaten: 0,
  speed: "slow",
  wraparoundWalls: true, // Kid-friendly default
  controlMode: "buttons",
  soundEnabled: true,
  lastModified: Date.now(),
};

function createInitialGameState(): Pick<
  SnakeGameState,
  "snake" | "direction" | "nextDirection" | "food" | "foodType" | "status" | "score"
> {
  const snake = getInitialSnake(GRID_SIZE);
  return {
    snake,
    direction: "right",
    nextDirection: "right",
    food: getValidFoodPosition(snake, GRID_SIZE),
    foodType: getRandomFoodType(),
    status: "idle",
    score: 0,
  };
}

export const useSnakeStore = create<SnakeGameState & SnakeGameActions>()(
  persist(
    (set, get) => ({
      // Initial state
      gridSize: GRID_SIZE,
      ...createInitialGameState(),
      progress: defaultProgress,

      // Start a new game
      startGame: () => {
        const initialState = createInitialGameState();
        set({
          ...initialState,
          status: "playing",
        });
      },

      // Pause the game
      pauseGame: () => {
        const state = get();
        if (state.status === "playing") {
          set({ status: "paused" });
        }
      },

      // Resume the game
      resumeGame: () => {
        const state = get();
        if (state.status === "paused") {
          set({ status: "playing" });
        }
      },

      // Set direction (with 180-degree turn prevention)
      setDirection: (dir: Direction) => {
        const state = get();
        if (state.status !== "playing") return;

        // Prevent 180-degree turns
        if (OPPOSITE_DIRECTIONS[dir] === state.direction) return;

        set({ nextDirection: dir });
      },

      // Game tick - the main game loop logic
      tick: () => {
        const state = get();
        if (state.status !== "playing") return;

        // Update direction from buffer
        const direction = state.nextDirection;

        // Calculate new head position
        const head = state.snake[0];
        let newHead = calculateNewHead(head, direction);

        // Handle wall collision
        if (!isValidPosition(newHead, state.gridSize)) {
          if (state.progress.wraparoundWalls) {
            // Wraparound mode - appear on opposite side
            newHead = wrapPosition(newHead, state.gridSize);
          } else {
            // Game over - hit wall
            const progress = get().progress;
            set({
              status: "game-over",
              direction,
              progress: {
                ...progress,
                gamesPlayed: progress.gamesPlayed + 1,
                highScore: Math.max(progress.highScore, state.score),
                longestSnake: Math.max(progress.longestSnake, state.snake.length),
                lastModified: Date.now(),
              },
            });
            return;
          }
        }

        const willEat = positionsEqual(newHead, state.food);
        const collisionSnake = willEat ? state.snake : state.snake.slice(0, -1);

        // Check self collision. On non-eating moves, the current tail vacates.
        if (collisionSnake.some(segment => positionsEqual(segment, newHead))) {
          const progress = get().progress;
          set({
            status: "game-over",
            direction,
            progress: {
              ...progress,
              gamesPlayed: progress.gamesPlayed + 1,
              highScore: Math.max(progress.highScore, state.score),
              longestSnake: Math.max(progress.longestSnake, state.snake.length),
              lastModified: Date.now(),
            },
          });
          return;
        }

        // Move snake - add new head
        const newSnake = [newHead, ...state.snake];

        // Check food collision
        if (willEat) {
          // Ate food - don't remove tail (snake grows)
          const newScore = state.score + POINTS_PER_FOOD;
          const progress = get().progress;

          set({
            snake: newSnake,
            direction,
            score: newScore,
            food: getValidFoodPosition(newSnake, state.gridSize),
            foodType: getRandomFoodType(),
            progress: {
              ...progress,
              totalFoodEaten: progress.totalFoodEaten + 1,
              highScore: Math.max(progress.highScore, newScore),
              longestSnake: Math.max(progress.longestSnake, newSnake.length),
              lastModified: Date.now(),
            },
          });
        } else {
          // No food - remove tail (snake moves without growing)
          newSnake.pop();
          set({
            snake: newSnake,
            direction,
          });
        }
      },

      // Reset to initial state
      reset: () => {
        set(createInitialGameState());
      },

      // Settings
      setSpeed: (speed: SpeedSetting) => {
        set((state) => ({
          progress: {
            ...state.progress,
            speed,
            lastModified: Date.now(),
          },
        }));
      },

      setWraparound: (enabled: boolean) => {
        set((state) => ({
          progress: {
            ...state.progress,
            wraparoundWalls: enabled,
            lastModified: Date.now(),
          },
        }));
      },

      setControlMode: (mode: ControlMode) => {
        set((state) => ({
          progress: {
            ...state.progress,
            controlMode: mode,
            lastModified: Date.now(),
          },
        }));
      },

      setSoundEnabled: (enabled: boolean) => {
        set((state) => ({
          progress: {
            ...state.progress,
            soundEnabled: enabled,
            lastModified: Date.now(),
          },
        }));
      },

      // Progress sync
      getProgress: () => get().progress,
      setProgress: (data: SnakeProgress) => set({ progress: data }),
    }),
    {
      name: "snake-game-state",
      partialize: (state) => ({
        progress: state.progress,
      }),
    }
  )
);
