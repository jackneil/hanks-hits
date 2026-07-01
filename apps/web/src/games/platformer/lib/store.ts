import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  type GameState,
  type Player as PlayerType,
  type Platform as PlatformType,
  type Collectible as CollectibleType,
  type Particle as ParticleType,
  type Cloud as CloudType,
  type LevelDef,
  PLAYER,
  PHYSICS,
  PLATFORM,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  GROUND,
  COIN,
  STAR,
  LEVELS,
  CAMERA,
} from "./constants";

// Progress data that gets synced to server
// Index signature required for AppProgressData compatibility
export type PlatformerProgress = {
  [key: string]: unknown;
  // Level progress
  levels: {
    [levelId: string]: {
      completed: boolean;
      starsCollected: number; // 0-3
      bestTime: number | null; // milliseconds
      coinsCollected: number;
    };
  };
  // Currencies
  totalStars: number;
  totalCoins: number;
  // Stats
  gamesPlayed: number;
  totalDeaths: number;
  totalJumps: number;
  // Meta
  lastPlayedLevel: string | null;
  lastModified: number;
};

const defaultProgress: PlatformerProgress = {
  levels: {},
  totalStars: 0,
  totalCoins: 0,
  gamesPlayed: 0,
  totalDeaths: 0,
  totalJumps: 0,
  lastPlayedLevel: null,
  lastModified: Date.now(),
};

// Full game state
type PlatformerState = {
  // Game state
  gameState: GameState;
  currentLevelIndex: number;
  currentLevel: LevelDef | null;

  // Player state
  player: PlayerType;

  // Level objects
  platforms: PlatformType[];
  collectibles: CollectibleType[];
  particles: ParticleType[];
  clouds: CloudType[];

  // Scoring
  score: number;
  coinsThisRun: number;
  starsThisRun: number;
  timeElapsed: number;

  // Camera
  cameraX: number;
  groundOffset: number;

  // Flags
  isNewHighScore: boolean;

  // Persisted progress
  progress: PlatformerProgress;

  // Actions
  startGame: (levelIndex?: number) => void;
  jump: () => void;
  moveLeft: () => void;
  moveRight: () => void;
  stopMove: () => void;
  update: (delta: number) => void;
  endGame: (reason: "death" | "complete") => void;
  reset: () => void;
  nextLevel: () => void;

  // Movement state (for continuous movement)
  movingLeft: boolean;
  movingRight: boolean;
  setMovingLeft: (moving: boolean) => void;
  setMovingRight: (moving: boolean) => void;

  // For useAuthSync
  getProgress: () => PlatformerProgress;
  setProgress: (data: PlatformerProgress) => void;
};

// Initialize a level from definition
function initLevel(levelDef: LevelDef): {
  platforms: PlatformType[];
  collectibles: CollectibleType[];
} {
  let collectibleId = 0;

  const platforms: PlatformType[] = levelDef.platforms.map((p) => ({
    x: p.x,
    y: p.y,
    width: p.width,
    type: p.type,
    moveRange: p.moveRange || 0,
    startX: p.x,
    direction: 1,
  }));

  const collectibles: CollectibleType[] = [
    ...levelDef.coins.map((c) => ({
      x: c.x,
      y: c.y,
      type: "coin" as const,
      collected: false,
      id: collectibleId++,
    })),
    ...levelDef.stars.map((s) => ({
      x: s.x,
      y: s.y,
      type: "star" as const,
      collected: false,
      id: collectibleId++,
    })),
  ];

  return { platforms, collectibles };
}

// Initialize clouds
function initClouds(): CloudType[] {
  const clouds: CloudType[] = [];
  for (let i = 0; i < 8; i++) {
    clouds.push({
      x: Math.random() * CANVAS_WIDTH * 3,
      y: Math.random() * 100 + 30,
      scale: Math.random() * 0.5 + 0.5,
      speed: Math.random() * 0.3 + 0.2,
    });
  }
  return clouds;
}

// Default player state
function createDefaultPlayer(): PlayerType {
  return {
    x: PLAYER.START_X,
    y: CANVAS_HEIGHT - GROUND.HEIGHT - PLAYER.HEIGHT,
    velocityX: 0,
    velocityY: 0,
    isJumping: false,
    isGrounded: true,
    facingRight: true,
    coyoteTimer: 0,
    jumpBufferTimer: 0,
  };
}

export const usePlatformerStore = create<PlatformerState>()(
  persist(
    (set, get) => ({
      // Initial state
      gameState: "ready",
      currentLevelIndex: 0,
      currentLevel: LEVELS[0],
      player: createDefaultPlayer(),
      platforms: [],
      collectibles: [],
      particles: [],
      clouds: initClouds(),
      score: 0,
      coinsThisRun: 0,
      starsThisRun: 0,
      timeElapsed: 0,
      cameraX: CAMERA.MIN_X,
      groundOffset: 0,
      isNewHighScore: false,
      progress: defaultProgress,
      movingLeft: false,
      movingRight: false,

      startGame: (levelIndex?: number) => {
        const state = get();
        const lvlIndex = levelIndex ?? state.currentLevelIndex;
        const level = LEVELS[lvlIndex];
        if (!level) return;

        const { platforms, collectibles } = initLevel(level);

        set({
          gameState: "playing",
          currentLevelIndex: lvlIndex,
          currentLevel: level,
          player: createDefaultPlayer(),
          platforms,
          collectibles,
          particles: [],
          clouds: initClouds(),
          score: 0,
          coinsThisRun: 0,
          starsThisRun: 0,
          timeElapsed: 0,
          cameraX: CAMERA.MIN_X,
          groundOffset: 0,
          isNewHighScore: false,
          movingLeft: false,
          movingRight: false,
        });
      },

      jump: () => {
        const state = get();
        if (state.gameState !== "playing") return;

        const { player } = state;

        // Can jump if grounded or within coyote time
        const canJump = player.isGrounded || player.coyoteTimer > 0;

        if (canJump) {
          set({
            player: {
              ...player,
              velocityY: PHYSICS.JUMP_VELOCITY,
              isJumping: true,
              isGrounded: false,
              coyoteTimer: 0,
              jumpBufferTimer: 0,
            },
            progress: {
              ...state.progress,
              totalJumps: state.progress.totalJumps + 1,
              lastModified: Date.now(),
            },
          });
        } else {
          // Set jump buffer if in air
          set({
            player: {
              ...player,
              jumpBufferTimer: PHYSICS.JUMP_BUFFER_TIME,
            },
          });
        }
      },

      moveLeft: () => {
        set({ movingLeft: true, movingRight: false });
      },

      moveRight: () => {
        set({ movingRight: true, movingLeft: false });
      },

      stopMove: () => {
        set({ movingLeft: false, movingRight: false });
      },

      setMovingLeft: (moving: boolean) => set({ movingLeft: moving }),
      setMovingRight: (moving: boolean) => set({ movingRight: moving }),

      update: (delta: number) => {
        const state = get();
        if (state.gameState !== "playing" || !state.currentLevel) return;

        // Normalize delta to ~16ms (60fps)
        const normalizedDelta = Math.min(delta / 16.67, 2);

        let { player, platforms, collectibles, clouds, cameraX, groundOffset } = state;
        const { movingLeft, movingRight, particles } = state;
        const level = state.currentLevel;

        // Update time
        const timeElapsed = state.timeElapsed + delta;

        // ===================
        // UPDATE PLAYER
        // ===================

        // Apply horizontal movement
        if (movingLeft) {
          player = { ...player, velocityX: -PHYSICS.MOVE_SPEED, facingRight: false };
        } else if (movingRight) {
          player = { ...player, velocityX: PHYSICS.MOVE_SPEED, facingRight: true };
        } else {
          // Apply friction
          player = {
            ...player,
            velocityX: player.isGrounded
              ? player.velocityX * PHYSICS.FRICTION
              : player.velocityX * PHYSICS.AIR_RESISTANCE,
          };
        }

        // Apply gravity
        let newVelocityY = player.velocityY + PHYSICS.GRAVITY * normalizedDelta;
        newVelocityY = Math.min(newVelocityY, PHYSICS.MAX_FALL_SPEED);

        // Update position
        let newX = player.x + player.velocityX * normalizedDelta;
        let newY = player.y + newVelocityY * normalizedDelta;

        // Clamp horizontal position
        newX = Math.max(0, Math.min(newX, level.width - PLAYER.WIDTH));

        // Update coyote time
        let coyoteTimer = player.coyoteTimer;
        if (!player.isGrounded && coyoteTimer > 0) {
          coyoteTimer -= delta;
        }

        // Update jump buffer
        let jumpBufferTimer = player.jumpBufferTimer;
        if (jumpBufferTimer > 0) {
          jumpBufferTimer -= delta;
        }

        // Check collision with ground
        const groundY = CANVAS_HEIGHT - GROUND.HEIGHT;
        let isGrounded = false;

        if (newY + PLAYER.HEIGHT >= groundY) {
          newY = groundY - PLAYER.HEIGHT;
          newVelocityY = 0;
          isGrounded = true;
        }

        // ===================
        // UPDATE PLATFORMS
        // ===================

        platforms = platforms.map((p) => {
          if (p.type === "moving") {
            let newPX = p.x + PLATFORM.MOVING_SPEED * p.direction * normalizedDelta;
            let newDirection = p.direction;

            // Reverse at bounds
            if (newPX > p.startX + p.moveRange) {
              newPX = p.startX + p.moveRange;
              newDirection = -1;
            } else if (newPX < p.startX - p.moveRange) {
              newPX = p.startX - p.moveRange;
              newDirection = 1;
            }

            return { ...p, x: newPX, direction: newDirection };
          }
          return p;
        });

        // Check collision with platforms
        const playerLeft = newX;
        const playerRight = newX + PLAYER.HITBOX_WIDTH;
        const playerTop = newY;
        const playerBottom = newY + PLAYER.HEIGHT;

        for (const platform of platforms) {
          const platLeft = platform.x;
          const platRight = platform.x + platform.width;
          const platTop = platform.y;
          const platBottom = platform.y + PLATFORM.HEIGHT;

          // Check if overlapping horizontally
          if (playerRight > platLeft && playerLeft < platRight) {
            // Landing on top of platform
            if (
              player.velocityY >= 0 &&
              playerBottom >= platTop &&
              player.y + PLAYER.HEIGHT <= platTop + 10
            ) {
              newY = platTop - PLAYER.HEIGHT;
              newVelocityY = 0;
              isGrounded = true;
            }
          }
        }

        // Handle coyote time
        if (!isGrounded && player.isGrounded) {
          // Just left ground, start coyote time
          coyoteTimer = PHYSICS.COYOTE_TIME;
        }

        // Handle jump buffer
        if (isGrounded && jumpBufferTimer > 0) {
          // Just landed with buffered jump
          newVelocityY = PHYSICS.JUMP_VELOCITY;
          isGrounded = false;
          jumpBufferTimer = 0;
          // Increment jump count
          set((s) => ({
            progress: {
              ...s.progress,
              totalJumps: s.progress.totalJumps + 1,
              lastModified: Date.now(),
            },
          }));
        }

        player = {
          ...player,
          x: newX,
          y: newY,
          velocityY: newVelocityY,
          isGrounded,
          isJumping: !isGrounded,
          coyoteTimer,
          jumpBufferTimer,
        };

        // ===================
        // CHECK DEATH (fell off bottom)
        // ===================

        if (newY > CANVAS_HEIGHT + 100) {
          get().endGame("death");
          return;
        }

        // ===================
        // COLLECT ITEMS
        // ===================

        let coinsThisRun = state.coinsThisRun;
        let starsThisRun = state.starsThisRun;
        let score = state.score;
        let newParticles = [...particles];

        collectibles = collectibles.map((c) => {
          if (c.collected) return c;

          // Simple circle collision
          const dx = player.x + PLAYER.WIDTH / 2 - c.x;
          const dy = player.y + PLAYER.HEIGHT / 2 - c.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const collectRadius = c.type === "coin" ? COIN.SIZE : STAR.SIZE;

          if (distance < collectRadius + PLAYER.WIDTH / 3) {
            // Collected!
            if (c.type === "coin") {
              coinsThisRun += 1;
              score += COIN.VALUE;
            } else {
              starsThisRun += 1;
              score += STAR.VALUE;
            }

            // Spawn particles
            for (let i = 0; i < 8; i++) {
              newParticles.push({
                x: c.x,
                y: c.y,
                vx: (Math.random() - 0.5) * 8,
                vy: (Math.random() - 0.5) * 8 - 3,
                life: 0.5,
                maxLife: 0.5,
                size: 4,
                color: c.type === "coin" ? COIN.COLOR : STAR.COLOR,
              });
            }

            return { ...c, collected: true };
          }
          return c;
        });

        // ===================
        // CHECK GOAL
        // ===================

        if (player.x >= level.goalX) {
          get().endGame("complete");
          return;
        }

        // ===================
        // UPDATE CAMERA
        // ===================

        const targetCameraX = Math.max(
          CAMERA.MIN_X,
          Math.min(player.x + CAMERA.LOOK_AHEAD, level.width - CANVAS_WIDTH / 2)
        );
        cameraX = cameraX + (targetCameraX - cameraX) * CAMERA.SMOOTHING;

        // ===================
        // UPDATE PARTICLES
        // ===================

        newParticles = newParticles
          .map((p) => ({
            ...p,
            x: p.x + p.vx,
            y: p.y + p.vy,
            vy: p.vy + 0.2, // gravity
            life: p.life - delta / 1000,
          }))
          .filter((p) => p.life > 0);

        // ===================
        // UPDATE CLOUDS
        // ===================

        clouds = clouds.map((cloud) => ({
          ...cloud,
          x: cloud.x - cloud.speed,
        }));

        // Wrap clouds
        clouds = clouds.map((cloud) => {
          if (cloud.x < -100) {
            return {
              ...cloud,
              x: CANVAS_WIDTH * 3 + Math.random() * 200,
              y: Math.random() * 100 + 30,
            };
          }
          return cloud;
        });

        // Update ground scroll
        groundOffset = (groundOffset + 2 * normalizedDelta) % 40;

        set({
          player,
          platforms,
          collectibles,
          particles: newParticles,
          clouds,
          cameraX,
          groundOffset,
          coinsThisRun,
          starsThisRun,
          score,
          timeElapsed,
        });
      },

      endGame: (reason: "death" | "complete") => {
        const state = get();
        const levelId = state.currentLevel?.id || "unknown";

        if (reason === "complete") {
          // Level completed!
          const levelProgress = state.progress.levels[levelId] || {
            completed: false,
            starsCollected: 0,
            bestTime: null,
            coinsCollected: 0,
          };

          const isNewHighScore =
            levelProgress.bestTime === null || state.timeElapsed < levelProgress.bestTime;

          set({
            gameState: "levelComplete",
            isNewHighScore,
            progress: {
              ...state.progress,
              levels: {
                ...state.progress.levels,
                [levelId]: {
                  completed: true,
                  starsCollected: Math.max(levelProgress.starsCollected, state.starsThisRun),
                  bestTime:
                    levelProgress.bestTime === null
                      ? state.timeElapsed
                      : Math.min(levelProgress.bestTime, state.timeElapsed),
                  coinsCollected: levelProgress.coinsCollected + state.coinsThisRun,
                },
              },
              totalStars: state.progress.totalStars + state.starsThisRun,
              totalCoins: state.progress.totalCoins + state.coinsThisRun,
              gamesPlayed: state.progress.gamesPlayed + 1,
              lastPlayedLevel: levelId,
              lastModified: Date.now(),
            },
          });
        } else {
          // Death
          set({
            gameState: "gameOver",
            progress: {
              ...state.progress,
              totalDeaths: state.progress.totalDeaths + 1,
              gamesPlayed: state.progress.gamesPlayed + 1,
              lastPlayedLevel: levelId,
              lastModified: Date.now(),
            },
          });
        }
      },

      reset: () => {
        const state = get();
        set({
          gameState: "ready",
          currentLevelIndex: state.currentLevelIndex,
          player: createDefaultPlayer(),
          platforms: [],
          collectibles: [],
          particles: [],
          score: 0,
          coinsThisRun: 0,
          starsThisRun: 0,
          timeElapsed: 0,
          cameraX: CAMERA.MIN_X,
          isNewHighScore: false,
          movingLeft: false,
          movingRight: false,
        });
      },

      nextLevel: () => {
        const state = get();
        const nextIndex = state.currentLevelIndex + 1;
        if (nextIndex < LEVELS.length) {
          get().startGame(nextIndex);
        } else {
          // All levels complete, go back to first
          get().reset();
        }
      },

      getProgress: () => get().progress,
      setProgress: (data) => set({ progress: data }),
    }),
    {
      name: "hank-platformer-progress",
      partialize: (state) => ({ progress: state.progress }),
    }
  )
);
