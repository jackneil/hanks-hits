import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  type GameState,
  type DifficultyLevel,
  type Plane,
  type Bomb,
  type Building,
  type Explosion,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  PLANE,
  BOMB,
  BUILDING,
  GROUND,
  SCORING,
  generateBuildings,
  getDifficultySettings,
} from "./constants";

// Progress data that gets synced to server
export type BlitzBomberProgress = {
  highScore: number;
  highestLevel: number;
  levelsCompleted: number;
  totalBuildingsDestroyed: number;
  totalBombsDropped: number;
  successfulLandings: number;
  crashes: number;
  gamesPlayed: number;
  settings: {
    soundEnabled: boolean;
    difficulty: DifficultyLevel;
  };
  lastModified: number;
};

const defaultProgress: BlitzBomberProgress = {
  highScore: 0,
  highestLevel: 1,
  levelsCompleted: 0,
  totalBuildingsDestroyed: 0,
  totalBombsDropped: 0,
  successfulLandings: 0,
  crashes: 0,
  gamesPlayed: 0,
  settings: {
    soundEnabled: true,
    difficulty: "normal",
  },
  lastModified: Date.now(),
};

// Full game state
type BlitzBomberState = {
  // Current game state
  gameState: GameState;
  score: number;
  level: number;
  plane: Plane;
  bombs: Bomb[];
  buildings: Building[];
  explosions: Explosion[];
  bombIdCounter: number;
  explosionIdCounter: number;
  isNewHighScore: boolean;
  passCount: number; // Track number of passes for difficulty scaling

  // Persisted progress
  progress: BlitzBomberProgress;

  // Actions
  startGame: () => void;
  dropBomb: () => void;
  update: (delta: number) => void;
  crash: () => void;
  land: () => void;
  reset: () => void;
  nextLevel: () => void;
  setDifficulty: (difficulty: DifficultyLevel) => void;
  setSoundEnabled: (enabled: boolean) => void;

  // For useAuthSync
  getProgress: () => BlitzBomberProgress;
  setProgress: (data: BlitzBomberProgress) => void;
};

function createInitialPlane(): Plane {
  return {
    x: -PLANE.WIDTH,
    y: PLANE.STARTING_Y,
    direction: 1,
  };
}

export const useBlitzBomberStore = create<BlitzBomberState>()(
  persist(
    (set, get) => ({
      // Initial state
      gameState: "ready",
      score: 0,
      level: 1,
      plane: createInitialPlane(),
      bombs: [],
      buildings: [],
      explosions: [],
      bombIdCounter: 0,
      explosionIdCounter: 0,
      isNewHighScore: false,
      passCount: 0,
      progress: defaultProgress,

      startGame: () => {
        const state = get();
        const settings = getDifficultySettings(state.progress.settings.difficulty);

        set({
          gameState: "playing",
          score: 0,
          level: 1,
          plane: createInitialPlane(),
          bombs: [],
          buildings: generateBuildings(settings.buildingCount, settings.maxBuildingHeight),
          explosions: [],
          bombIdCounter: 0,
          explosionIdCounter: 0,
          isNewHighScore: false,
          passCount: 0,
        });
      },

      dropBomb: () => {
        const state = get();
        if (state.gameState !== "playing") return;

        const settings = getDifficultySettings(state.progress.settings.difficulty);

        // Check max bombs on screen
        const activeBombs = state.bombs.filter((b) => !b.destroyed);
        if (activeBombs.length >= settings.bombsAllowed) return;

        const newBomb: Bomb = {
          id: state.bombIdCounter + 1,
          x: state.plane.x + PLANE.WIDTH / 2,
          y: state.plane.y + PLANE.HEIGHT,
          destroyed: false,
        };

        set({
          bombs: [...state.bombs, newBomb],
          bombIdCounter: state.bombIdCounter + 1,
          progress: {
            ...state.progress,
            totalBombsDropped: state.progress.totalBombsDropped + 1,
            lastModified: Date.now(),
          },
        });
      },

      update: (delta: number) => {
        const state = get();
        if (state.gameState !== "playing") return;

        const settings = getDifficultySettings(state.progress.settings.difficulty);
        const normalizedDelta = Math.min(delta / 16.67, 2);

        // Update plane position
        const newPlane = { ...state.plane };
        const planeSpeed = settings.planeSpeed * (1 + state.passCount * 0.05); // Speed increases slightly each pass
        newPlane.x += planeSpeed * newPlane.direction * normalizedDelta;

        // Check for wrap
        let newPassCount = state.passCount;
        if (newPlane.direction === 1 && newPlane.x > CANVAS_WIDTH) {
          newPlane.x = -PLANE.WIDTH;
          newPlane.y += settings.dropAmount;
          newPassCount++;
        } else if (newPlane.direction === -1 && newPlane.x < -PLANE.WIDTH) {
          newPlane.x = CANVAS_WIDTH;
          newPlane.y += settings.dropAmount;
          newPassCount++;
        }

        // Update bombs
        let newBombs = state.bombs
          .map((bomb) => ({
            ...bomb,
            y: bomb.y + BOMB.FALL_SPEED * normalizedDelta,
          }))
          .filter((bomb) => bomb.y < CANVAS_HEIGHT && !bomb.destroyed);

        // Check bomb collisions with buildings
        let newScore = state.score;
        const newBuildings = [...state.buildings];
        let newExplosions = [...state.explosions];
        let explosionIdCounter = state.explosionIdCounter;
        let buildingsDestroyedThisFrame = 0;

        const groundY = CANVAS_HEIGHT - GROUND.HEIGHT;

        newBombs = newBombs.map((bomb) => {
          if (bomb.destroyed) return bomb;

          // Check ground hit
          if (bomb.y + BOMB.HEIGHT >= groundY) {
            return { ...bomb, destroyed: true };
          }

          // Check building hits
          for (let i = 0; i < newBuildings.length; i++) {
            const building = newBuildings[i];
            if (building.height <= 0) continue;

            const buildingTop = groundY - building.height;
            const bombCenterX = bomb.x;
            const bombBottom = bomb.y + BOMB.HEIGHT;

            if (
              bombCenterX >= building.x &&
              bombCenterX <= building.x + building.width &&
              bombBottom >= buildingTop
            ) {
              // Hit! Reduce building height
              const newHeight = Math.max(0, building.height - BUILDING.SEGMENT_HEIGHT);
              newBuildings[i] = { ...building, height: newHeight };

              // Add score
              newScore += SCORING.SEGMENT_DESTROYED;

              // Bonus for fully destroying a building
              if (newHeight <= 0) {
                newScore += SCORING.BUILDING_DESTROYED_BONUS;
                buildingsDestroyedThisFrame++;
              }

              // Create explosion
              newExplosions.push({
                id: ++explosionIdCounter,
                x: bombCenterX,
                y: buildingTop,
                startTime: Date.now(),
              });

              return { ...bomb, destroyed: true };
            }
          }

          return bomb;
        });

        // Remove expired explosions
        const now = Date.now();
        newExplosions = newExplosions.filter(
          (e) => now - e.startTime < 300
        );

        // Check plane collision with buildings
        const planeBottom = newPlane.y + PLANE.HEIGHT;
        const planeLeft = newPlane.x + (PLANE.WIDTH - PLANE.HITBOX_WIDTH) / 2;
        const planeRight = planeLeft + PLANE.HITBOX_WIDTH;

        for (const building of newBuildings) {
          if (building.height <= 0) continue;

          const buildingTop = groundY - building.height;

          if (
            planeRight > building.x &&
            planeLeft < building.x + building.width &&
            planeBottom > buildingTop
          ) {
            // Crash!
            get().crash();
            return;
          }
        }

        // Check win condition
        const allFlat = newBuildings.every((b) => b.height <= 0);
        const lowEnough = newPlane.y > groundY - PLANE.HEIGHT - 20;

        if (allFlat && lowEnough) {
          get().land();
          return;
        }

        // Check if plane hit ground without clearing buildings
        if (planeBottom >= groundY) {
          if (allFlat) {
            get().land();
          } else {
            get().crash();
          }
          return;
        }

        // Update progress if buildings were destroyed
        let newProgress = state.progress;
        if (buildingsDestroyedThisFrame > 0) {
          newProgress = {
            ...state.progress,
            totalBuildingsDestroyed:
              state.progress.totalBuildingsDestroyed + buildingsDestroyedThisFrame,
            lastModified: Date.now(),
          };
        }

        set({
          plane: newPlane,
          bombs: newBombs.filter((b) => !b.destroyed),
          buildings: newBuildings,
          explosions: newExplosions,
          explosionIdCounter,
          score: newScore,
          passCount: newPassCount,
          progress: newProgress,
        });
      },

      crash: () => {
        const state = get();
        const isNewHighScore = state.score > state.progress.highScore;

        set({
          gameState: "crashed",
          isNewHighScore,
          progress: {
            ...state.progress,
            highScore: Math.max(state.progress.highScore, state.score),
            crashes: state.progress.crashes + 1,
            gamesPlayed: state.progress.gamesPlayed + 1,
            lastModified: Date.now(),
          },
        });
      },

      land: () => {
        const state = get();
        const finalScore = state.score + SCORING.LANDING_BONUS;
        const isNewHighScore = finalScore > state.progress.highScore;

        set({
          gameState: "landed",
          score: finalScore,
          isNewHighScore,
          progress: {
            ...state.progress,
            highScore: Math.max(state.progress.highScore, finalScore),
            successfulLandings: state.progress.successfulLandings + 1,
            levelsCompleted: state.progress.levelsCompleted + 1,
            highestLevel: Math.max(state.progress.highestLevel, state.level + 1),
            gamesPlayed: state.progress.gamesPlayed + 1,
            lastModified: Date.now(),
          },
        });
      },

      reset: () => {
        set({
          gameState: "ready",
          score: 0,
          level: 1,
          plane: createInitialPlane(),
          bombs: [],
          buildings: [],
          explosions: [],
          isNewHighScore: false,
          passCount: 0,
        });
      },

      nextLevel: () => {
        const state = get();
        const nextLevel = state.level + 1;
        const settings = getDifficultySettings(state.progress.settings.difficulty);

        // Increase difficulty with each level
        const buildingCount = Math.min(settings.buildingCount + nextLevel - 1, 18);
        const maxHeight = Math.min(settings.maxBuildingHeight + (nextLevel - 1) * 20, 450);

        set({
          gameState: "playing",
          level: nextLevel,
          plane: createInitialPlane(),
          bombs: [],
          buildings: generateBuildings(buildingCount, maxHeight),
          explosions: [],
          passCount: 0,
        });
      },

      setDifficulty: (difficulty: DifficultyLevel) => {
        const state = get();
        set({
          progress: {
            ...state.progress,
            settings: {
              ...state.progress.settings,
              difficulty,
            },
            lastModified: Date.now(),
          },
        });
      },

      setSoundEnabled: (enabled: boolean) => {
        const state = get();
        set({
          progress: {
            ...state.progress,
            settings: {
              ...state.progress.settings,
              soundEnabled: enabled,
            },
            lastModified: Date.now(),
          },
        });
      },

      getProgress: () => get().progress,
      setProgress: (data) => set({ progress: data }),
    }),
    {
      name: "blitz-bomber-progress",
      partialize: (state) => ({ progress: state.progress }),
    }
  )
);
