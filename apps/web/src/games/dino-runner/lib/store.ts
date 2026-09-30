import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  type GameState,
  type Obstacle,
  type ObstacleType,
  type CloudData,
  GROUND_Y,
  DINO,
  GRAVITY,
  JUMP_VELOCITY,
  MAX_JUMP_VELOCITY,
  JUMP_HOLD_MULTIPLIER,
  INITIAL_SPEED,
  MAX_SPEED,
  SPEED_INCREMENT,
  SCORE_INCREMENT,
  MILESTONE_INTERVAL,
  DAY_NIGHT_INTERVAL,
  CANVAS_WIDTH,
  CLOUD,
  checkCollision,
  getRandomObstacleType,
  createObstacle,
  getRandomSpawnGap,
  createCloud,
} from "./constants";

/**
 * The most milliseconds one update step may cover (three 60 fps frames).
 * A frame after a stall (a throttled tab, a slow phone, a hold that just
 * ended) moves the world by this much at most, never by the whole stall.
 */
export const MAX_FRAME_MS = 50;

// ============================================
// PROGRESS TYPE (persisted)
// ============================================
export type DinoRunnerProgress = {
  highScore: number;
  gamesPlayed: number;
  totalDistance: number;
  longestRun: number;
  milestonesReached: number;
  soundEnabled: boolean;
  lastModified: number;
};

// ============================================
// GAME STATE TYPE
// ============================================
export type DinoRunnerGameState = {
  // Game state
  gameState: GameState;
  score: number;
  speed: number;
  isNight: boolean;

  // Dino state
  dinoY: number;
  dinoVelocity: number;
  isDucking: boolean;
  isJumping: boolean;
  isHoldingJump: boolean;
  legFrame: number; // For running animation

  // Obstacles
  obstacles: Obstacle[];
  nextObstacleDistance: number;

  // Clouds (background decoration)
  clouds: CloudData[];
  nextCloudDistance: number;

  // Ground scroll offset
  groundOffset: number;

  // Visual effects
  milestoneFlash: boolean;
  flashTimer: number;

  // Current run stats
  runStartTime: number;
  currentRunDistance: number;

  // Progress (persisted)
  progress: DinoRunnerProgress;
};

// ============================================
// ACTIONS TYPE
// ============================================
type DinoRunnerActions = {
  // Game actions
  startGame: () => void;
  gameOver: () => void;
  reset: () => void;
  update: (delta: number) => void;

  // Input actions
  jump: () => void;
  releaseJump: () => void;
  duck: (ducking: boolean) => void;

  // Settings
  setSoundEnabled: (enabled: boolean) => void;

  // Progress sync
  getProgress: () => DinoRunnerProgress;
  setProgress: (data: DinoRunnerProgress) => void;
};

// ============================================
// DEFAULT PROGRESS
// ============================================
const defaultProgress: DinoRunnerProgress = {
  highScore: 0,
  gamesPlayed: 0,
  totalDistance: 0,
  longestRun: 0,
  milestonesReached: 0,
  soundEnabled: true,
  lastModified: Date.now(),
};

// ============================================
// INITIAL GAME STATE
// ============================================
function createInitialGameState(): Omit<DinoRunnerGameState, "progress"> {
  return {
    gameState: "idle",
    score: 0,
    speed: INITIAL_SPEED,
    isNight: false,

    dinoY: GROUND_Y - DINO.HEIGHT,
    dinoVelocity: 0,
    isDucking: false,
    isJumping: false,
    isHoldingJump: false,
    legFrame: 0,

    obstacles: [],
    nextObstacleDistance: 400,

    clouds: [
      createCloud(200),
      createCloud(500),
      createCloud(750),
    ],
    nextCloudDistance: 900,

    groundOffset: 0,

    milestoneFlash: false,
    flashTimer: 0,

    runStartTime: 0,
    currentRunDistance: 0,
  };
}

// ============================================
// STORE
// ============================================
export const useDinoRunnerStore = create<DinoRunnerGameState & DinoRunnerActions>()(
  persist(
    (set, get) => ({
      ...createInitialGameState(),
      progress: defaultProgress,

      // Start a new game
      startGame: () => {
        const initialState = createInitialGameState();
        set({
          ...initialState,
          gameState: "playing",
          runStartTime: Date.now(),
        });
      },

      // Game over
      gameOver: () => {
        const state = get();
        const runDuration = Date.now() - state.runStartTime;
        const finalScore = Math.floor(state.score);

        set((s) => ({
          gameState: "game-over",
          progress: {
            ...s.progress,
            highScore: Math.max(s.progress.highScore, finalScore),
            gamesPlayed: s.progress.gamesPlayed + 1,
            totalDistance: s.progress.totalDistance + state.currentRunDistance,
            longestRun: Math.max(s.progress.longestRun, runDuration),
            lastModified: Date.now(),
          },
        }));
      },

      // Reset to idle
      reset: () => {
        set({
          ...createInitialGameState(),
          gameState: "idle",
        });
      },

      // Main update loop
      update: (rawDelta: number) => {
        const state = get();
        if (state.gameState !== "playing") return;

        // One step covers MAX_FRAME_MS at most: a frame after a stall (a
        // throttled tab, a slow phone) must not run the dino into the
        // next obstacle in one giant step.
        const delta = Math.min(rawDelta, MAX_FRAME_MS);
        // Normalize delta (target 60fps)
        const normalizedDelta = delta / 16.67;

        // Update speed (ramp up over time)
        const newSpeed = Math.min(state.speed + SPEED_INCREMENT * normalizedDelta, MAX_SPEED);

        // Update score
        const newScore = state.score + SCORE_INCREMENT * normalizedDelta * (newSpeed / INITIAL_SPEED);

        // Check for milestone flash
        const previousMilestone = Math.floor(state.score / MILESTONE_INTERVAL);
        const currentMilestone = Math.floor(newScore / MILESTONE_INTERVAL);
        let milestoneFlash = state.milestoneFlash;
        let flashTimer = state.flashTimer;
        let milestonesReached = state.progress.milestonesReached;

        if (currentMilestone > previousMilestone) {
          milestoneFlash = true;
          flashTimer = 200; // Flash duration in ms
          milestonesReached++;
        }

        // Update flash timer
        if (flashTimer > 0) {
          flashTimer -= delta;
          if (flashTimer <= 0) {
            milestoneFlash = false;
            flashTimer = 0;
          }
        }

        // Check for day/night toggle
        const previousDayNight = Math.floor(state.score / DAY_NIGHT_INTERVAL);
        const currentDayNight = Math.floor(newScore / DAY_NIGHT_INTERVAL);
        const isNight = currentDayNight % 2 === 1;

        // Update dino physics
        let dinoY = state.dinoY;
        let dinoVelocity = state.dinoVelocity;
        let isJumping = state.isJumping;

        // Apply gravity
        if (isJumping || dinoY < GROUND_Y - DINO.HEIGHT) {
          // Add extra velocity if holding jump (variable height jump)
          if (state.isHoldingJump && dinoVelocity < 0) {
            dinoVelocity += JUMP_HOLD_MULTIPLIER * normalizedDelta;
          }

          dinoVelocity += GRAVITY * normalizedDelta;
          dinoY += dinoVelocity * normalizedDelta;

          // Land on ground
          const groundLevel = GROUND_Y - (state.isDucking ? DINO.DUCK_HEIGHT : DINO.HEIGHT);
          if (dinoY >= groundLevel) {
            dinoY = groundLevel;
            dinoVelocity = 0;
            isJumping = false;
          }
        }

        // Update leg animation frame
        const legFrame = (state.legFrame + 0.3 * normalizedDelta) % 2;

        // Update ground offset
        const groundOffset = (state.groundOffset + newSpeed * normalizedDelta) % 2400;

        // Update obstacles
        let obstacles = state.obstacles.map((obs) => ({
          ...obs,
          x: obs.x - newSpeed * normalizedDelta,
        }));

        // Remove off-screen obstacles
        obstacles = obstacles.filter((obs) => obs.x + obs.width > -50);

        // Spawn new obstacles
        let nextObstacleDistance = state.nextObstacleDistance - newSpeed * normalizedDelta;
        if (nextObstacleDistance <= 0) {
          const type = getRandomObstacleType(newScore);
          const newObstacle = createObstacle(type, CANVAS_WIDTH + 50);
          obstacles.push(newObstacle);
          nextObstacleDistance = getRandomSpawnGap(newSpeed);
        }

        // Update clouds
        let clouds = state.clouds.map((cloud) => ({
          ...cloud,
          x: cloud.x - newSpeed * CLOUD.SPEED_RATIO * normalizedDelta,
        }));

        // Remove off-screen clouds
        clouds = clouds.filter((cloud) => cloud.x + cloud.width > -50);

        // Spawn new clouds
        let nextCloudDistance = state.nextCloudDistance - newSpeed * normalizedDelta;
        if (nextCloudDistance <= 0) {
          clouds.push(createCloud(CANVAS_WIDTH + 50));
          nextCloudDistance = CLOUD.MIN_GAP + Math.random() * (CLOUD.MAX_GAP - CLOUD.MIN_GAP);
        }

        // Check collisions
        const dinoHeight = state.isDucking ? DINO.DUCK_HEIGHT : DINO.HEIGHT;
        for (const obstacle of obstacles) {
          if (checkCollision(DINO.X, dinoY, DINO.WIDTH, dinoHeight, obstacle)) {
            get().gameOver();
            return;
          }
        }

        // Update distance
        const currentRunDistance = state.currentRunDistance + newSpeed * normalizedDelta;

        // Apply updates
        set({
          score: newScore,
          speed: newSpeed,
          isNight,
          dinoY,
          dinoVelocity,
          isJumping,
          legFrame,
          groundOffset,
          obstacles,
          nextObstacleDistance,
          clouds,
          nextCloudDistance,
          milestoneFlash,
          flashTimer,
          currentRunDistance,
          progress: {
            ...state.progress,
            milestonesReached,
          },
        });
      },

      // Jump
      jump: () => {
        const state = get();

        // Can't jump while ducking on ground
        if (state.isDucking && !state.isJumping) return;

        if (!state.isJumping && state.gameState === "playing") {
          set({
            dinoVelocity: JUMP_VELOCITY,
            isJumping: true,
            isHoldingJump: true,
            isDucking: false, // Stop ducking when jumping
          });
        }
      },

      // Release jump (for variable height)
      releaseJump: () => {
        set({ isHoldingJump: false });
      },

      // Duck
      duck: (ducking: boolean) => {
        const state = get();

        // If in air and ducking, apply fast fall
        if (ducking && state.isJumping) {
          set({
            isDucking: true,
            dinoVelocity: Math.max(state.dinoVelocity, 8), // Fast fall
          });
        } else if (!state.isJumping) {
          // On ground, just duck
          set({
            isDucking: ducking,
            dinoY: ducking
              ? GROUND_Y - DINO.DUCK_HEIGHT
              : GROUND_Y - DINO.HEIGHT,
          });
        } else if (!ducking) {
          // Release duck in air
          set({ isDucking: false });
        }
      },

      // Settings
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
      setProgress: (data: DinoRunnerProgress) => set({ progress: data }),
    }),
    {
      name: "dino-runner-progress",
      partialize: (state) => ({
        progress: state.progress,
      }),
    }
  )
);
