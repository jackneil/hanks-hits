import { bindPersistedStore } from "@/lib/owner-bound-progress";
import { createOwnerPersistStorage } from "@/lib/owner-bound-progress/persistStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { stampIfChanged } from "@/shared/lib/progressStamp";
import { defineUntouchedProgress, markSaved, settleOnLoad } from "@/shared/lib/untouchedProgress";
import {
  type GameStatus,
  type Ball,
  type Brick,
  type PowerUp,
  type Paddle,
  type Particle,
  type PowerUpType,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  PADDLE_WIDTH,
  PADDLE_HEIGHT,
  PADDLE_Y,
  BALL_RADIUS,
  BALL_MAX_SPEED,
  BALL_SPEED_INCREMENT,
  BRICK_WIDTH,
  BRICK_HEIGHT,
  BRICK_PADDING,
  BRICK_OFFSET_TOP,
  BRICK_OFFSET_LEFT,
  POWERUP_WIDTH,
  POWERUP_HEIGHT,
  POWERUP_FALL_SPEED,
  BIG_PADDLE_DURATION,
  SLOW_DURATION,
  STICKY_DURATION,
  BIG_PADDLE_MULTIPLIER,
  INITIAL_LIVES,
  POINTS,
  ROW_COLORS,
  BRICK_COLORS,
  clamp,
  getRandomPowerUp,
  createBall,
} from "./constants";
import { getLevel, getTotalLevels } from "./levels";
import { playSound } from "./sounds";

// Progress data (persisted)
export type BreakoutProgress = {
  highScore: number;
  levelsCompleted: number;
  highestLevel: number;
  totalBricksDestroyed: number;
  gamesPlayed: number;
  powerUpsCollected: number;
  soundEnabled: boolean;
  lastModified: number;
};

// Active power-up timers
type ActivePowerUp = {
  type: PowerUpType;
  expiresAt: number;
};

// Full game state
export type BreakoutGameState = {
  // Game status
  status: GameStatus;
  /**
   * Counts the runs of this page: startGame and restartLevel add one (Play,
   * Play again, and a restart from the header or the pause menu). Gameplay
   * clips read it: a new value while playing is a new run.
   */
  runId: number;
  /**
   * The saved best when this run started. The store raises the saved best
   * at each level card, so the clips' new-best moment reads this one.
   */
  runStartBest: number;

  // Current level
  level: number;

  // Player
  lives: number;
  score: number;

  // Game objects
  paddle: Paddle;
  balls: Ball[];
  bricks: Brick[];
  powerUps: PowerUp[];
  particles: Particle[];

  // Power-up state
  activePowerUps: ActivePowerUp[];
  isSticky: boolean;

  // Ball speed tracking
  currentBallSpeed: number;

  // ID counters
  nextBallId: number;
  nextPowerUpId: number;
  nextParticleId: number;

  // Progress (persisted)
  progress: BreakoutProgress;
};

type BreakoutActions = {
  // Game lifecycle
  startGame: () => void;
  pauseGame: () => void;
  resumeGame: () => void;
  nextLevel: () => void;
  restartLevel: () => void;
  gameOver: () => void;

  // Paddle control
  movePaddle: (x: number) => void;

  // Ball control
  launchBall: () => void;

  // Game loop
  update: () => void;

  // Progress sync
  getProgress: () => BreakoutProgress;
  setProgress: (data: BreakoutProgress) => void;
};

const defaultProgress: BreakoutProgress = {
  highScore: 0,
  levelsCompleted: 0,
  highestLevel: 1,
  totalBricksDestroyed: 0,
  gamesPlayed: 0,
  powerUpsCollected: 0,
  soundEnabled: true,
  lastModified: 0, // Untouched until a player action stamps it (shared/lib/progressStamp.ts).
};

// Settings are not progress: a device that changed only a setting holds
// nothing that must win over the account (shared/lib/untouchedProgress.ts).
const UNTOUCHED = defineUntouchedProgress("breakout", { defaults: defaultProgress, ignore: ["soundEnabled"] });

function createInitialPaddle(): Paddle {
  return {
    x: CANVAS_WIDTH / 2 - PADDLE_WIDTH / 2,
    y: PADDLE_Y,
    width: PADDLE_WIDTH,
    height: PADDLE_HEIGHT,
    baseWidth: PADDLE_WIDTH,
  };
}

/** The ball resting on the paddle; its speed is set at launch (currentBallSpeed). */
function createInitialBall(paddle: Paddle): Ball {
  return {
    id: 1,
    x: paddle.x + paddle.width / 2,
    y: paddle.y - BALL_RADIUS - 1,
    vx: 0,
    vy: 0,
    radius: BALL_RADIUS,
    stuck: true, // Starts on paddle
  };
}

function createBricksFromLevel(levelNum: number): Brick[] {
  const level = getLevel(levelNum);
  const bricks: Brick[] = [];
  let id = 0;

  for (let row = 0; row < level.pattern.length; row++) {
    for (let col = 0; col < level.pattern[row].length; col++) {
      const type = level.pattern[row][col];
      if (!type) continue;

      const x = BRICK_OFFSET_LEFT + col * (BRICK_WIDTH + BRICK_PADDING);
      const y = BRICK_OFFSET_TOP + row * (BRICK_HEIGHT + BRICK_PADDING);

      // Determine color
      let color: string;
      if (type === "normal") {
        color = ROW_COLORS[row % ROW_COLORS.length];
      } else {
        color = BRICK_COLORS[type];
      }

      // Determine hits
      let hitsRemaining = 1;
      if (type === "tough") hitsRemaining = 2;
      if (type === "indestructible") hitsRemaining = Infinity;

      bricks.push({
        id: id++,
        x,
        y,
        width: BRICK_WIDTH,
        height: BRICK_HEIGHT,
        type,
        hitsRemaining,
        color,
        row,
        col,
      });
    }
  }

  return bricks;
}

function createInitialGameState(level: number = 1): Partial<BreakoutGameState> {
  const paddle = createInitialPaddle();
  const levelConfig = getLevel(level);

  return {
    status: "idle",
    runId: 0,
    runStartBest: 0,
    level,
    lives: INITIAL_LIVES,
    score: 0,
    paddle,
    balls: [createInitialBall(paddle)],
    bricks: createBricksFromLevel(level),
    powerUps: [],
    particles: [],
    activePowerUps: [],
    isSticky: false,
    currentBallSpeed: levelConfig.ballSpeed,
    nextBallId: 2,
    nextPowerUpId: 1,
    nextParticleId: 1,
  };
}

export const useBreakoutStore = create<BreakoutGameState & BreakoutActions>()(
  persist(
    (set, get) => ({
      // Initial state
      ...createInitialGameState() as BreakoutGameState,
      progress: defaultProgress,

      // Start a new game
      startGame: () => {
        const state = get();
        const initialState = createInitialGameState(1);
        set({
          ...initialState,
          status: "playing",
          runId: state.runId + 1,
          runStartBest: state.progress.highScore,
          progress: {
            ...state.progress,
            gamesPlayed: state.progress.gamesPlayed + 1,
            lastModified: Date.now(),
          },
        });
      },

      // Pause
      pauseGame: () => {
        const state = get();
        if (state.status === "playing") {
          set({ status: "paused" });
        }
      },

      // Resume
      resumeGame: () => {
        const state = get();
        if (state.status === "paused") {
          set({ status: "playing" });
        }
      },

      // Next level
      nextLevel: () => {
        const state = get();
        const nextLevelNum = Math.min(state.level + 1, getTotalLevels());
        const paddle = createInitialPaddle();
        const levelConfig = getLevel(nextLevelNum);

        set({
          status: "playing",
          level: nextLevelNum,
          paddle,
          balls: [createInitialBall(paddle)],
          bricks: createBricksFromLevel(nextLevelNum),
          powerUps: [],
          particles: [],
          activePowerUps: [],
          isSticky: false,
          currentBallSpeed: levelConfig.ballSpeed,
          nextBallId: 2,
          nextPowerUpId: 1,
          progress: stampIfChanged(state.progress, {
            ...state.progress,
            highestLevel: Math.max(state.progress.highestLevel, nextLevelNum),
          }),
        });
      },

      // Restart current level
      restartLevel: () => {
        const state = get();
        const paddle = createInitialPaddle();
        const levelConfig = getLevel(state.level);

        set({
          status: "playing",
          // A restart is a new run for clips; the level's score starts over.
          runId: state.runId + 1,
          runStartBest: state.progress.highScore,
          paddle,
          balls: [createInitialBall(paddle)],
          bricks: createBricksFromLevel(state.level),
          powerUps: [],
          particles: [],
          activePowerUps: [],
          isSticky: false,
          currentBallSpeed: levelConfig.ballSpeed,
          nextBallId: 2,
          nextPowerUpId: 1,
        });
      },

      // Game over
      gameOver: () => {
        const state = get();
        playSound("game-over");

        set({
          status: "game-over",
          progress: stampIfChanged(state.progress, {
            ...state.progress,
            highScore: Math.max(state.progress.highScore, state.score),
            levelsCompleted: Math.max(state.progress.levelsCompleted, state.level - 1),
          }),
        });
      },

      // Move paddle
      movePaddle: (x: number) => {
        const state = get();
        if (state.status !== "playing" && state.status !== "idle") return;

        const paddleX = clamp(
          x - state.paddle.width / 2,
          0,
          CANVAS_WIDTH - state.paddle.width
        );

        // Move stuck balls with paddle
        const balls = state.balls.map(ball => {
          if (ball.stuck) {
            return {
              ...ball,
              x: paddleX + state.paddle.width / 2,
            };
          }
          return ball;
        });

        set({
          paddle: { ...state.paddle, x: paddleX },
          balls,
        });
      },

      // Launch ball
      launchBall: () => {
        const state = get();

        // Start game if idle
        if (state.status === "idle") {
          set({ status: "playing" });
        }

        if (state.status !== "playing") return;

        // Launch any stuck balls
        const balls = state.balls.map(ball => {
          if (ball.stuck) {
            // Launch upward with slight random angle
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI / 4;
            return {
              ...ball,
              vx: Math.cos(angle) * state.currentBallSpeed,
              vy: Math.sin(angle) * state.currentBallSpeed,
              stuck: false,
            };
          }
          return ball;
        });

        set({ balls });
      },

      // Main game update
      // One fixed step: useGameLoop runs 60 a second, whatever the screen's rate.
      update: () => {
        const state = get();
        if (state.status !== "playing") return;

        const now = Date.now();
        let { balls, bricks, powerUps, particles, paddle, score, lives, activePowerUps, isSticky, nextBallId, nextPowerUpId, nextParticleId, currentBallSpeed, progress } = state;

        // Copy arrays for mutation
        balls = [...balls];
        bricks = [...bricks];
        powerUps = [...powerUps];
        particles = [...particles];
        activePowerUps = [...activePowerUps];

        // Process power-up timers
        const expiredPowerUps = activePowerUps.filter(p => p.expiresAt <= now);
        activePowerUps = activePowerUps.filter(p => p.expiresAt > now);

        for (const expired of expiredPowerUps) {
          if (expired.type === "big-paddle") {
            paddle = {
              ...paddle,
              width: paddle.baseWidth,
              x: clamp(paddle.x, 0, CANVAS_WIDTH - paddle.baseWidth),
            };
          } else if (expired.type === "slow") {
            // Speed returns to normal
            currentBallSpeed = Math.min(currentBallSpeed + 2, BALL_MAX_SPEED);
          } else if (expired.type === "sticky") {
            isSticky = false;
          }
        }

        // Check if big paddle is active
        const hasBigPaddle = activePowerUps.some(p => p.type === "big-paddle");
        if (hasBigPaddle && paddle.width === paddle.baseWidth) {
          paddle = {
            ...paddle,
            width: paddle.baseWidth * BIG_PADDLE_MULTIPLIER,
            x: clamp(paddle.x, 0, CANVAS_WIDTH - paddle.baseWidth * BIG_PADDLE_MULTIPLIER),
          };
        }

        // Check if slow is active
        const hasSlow = activePowerUps.some(p => p.type === "slow");

        // Update balls
        const ballsToRemove: number[] = [];
        const newBalls: Ball[] = [];

        for (let i = 0; i < balls.length; i++) {
          const ball = balls[i];

          // Skip stuck balls
          if (ball.stuck) continue;

          // Apply slow effect to velocity calculation
          const speedMult = hasSlow ? 0.7 : 1;
          let newX = ball.x + ball.vx * speedMult;
          let newY = ball.y + ball.vy * speedMult;
          let newVx = ball.vx;
          let newVy = ball.vy;

          // Wall collisions
          if (newX - ball.radius <= 0) {
            newX = ball.radius;
            newVx = Math.abs(newVx);
            playSound("bounce");
          } else if (newX + ball.radius >= CANVAS_WIDTH) {
            newX = CANVAS_WIDTH - ball.radius;
            newVx = -Math.abs(newVx);
            playSound("bounce");
          }

          // Ceiling collision
          if (newY - ball.radius <= 0) {
            newY = ball.radius;
            newVy = Math.abs(newVy);
            playSound("bounce");
          }

          // Bottom - lose ball
          if (newY + ball.radius >= CANVAS_HEIGHT) {
            ballsToRemove.push(ball.id);
            continue;
          }

          // Paddle collision
          if (
            newY + ball.radius >= paddle.y &&
            newY - ball.radius <= paddle.y + paddle.height &&
            newX + ball.radius >= paddle.x &&
            newX - ball.radius <= paddle.x + paddle.width
          ) {
            // Where on paddle did it hit? (-1 to 1)
            const hitPos = (newX - (paddle.x + paddle.width / 2)) / (paddle.width / 2);

            // Angle: straight up at center, angled at edges
            const maxAngle = Math.PI / 3; // 60 degrees
            const angle = -Math.PI / 2 + hitPos * maxAngle;

            // Calculate new velocity with slight speed increase
            const newSpeed = Math.min(currentBallSpeed + BALL_SPEED_INCREMENT, BALL_MAX_SPEED);

            if (isSticky) {
              // Stick to paddle
              newX = paddle.x + paddle.width / 2 + hitPos * (paddle.width / 2);
              newY = paddle.y - ball.radius - 1;
              newVx = 0;
              newVy = 0;
              balls[i] = { ...ball, x: newX, y: newY, vx: newVx, vy: newVy, stuck: true };
            } else {
              newVx = Math.cos(angle) * newSpeed;
              newVy = Math.sin(angle) * newSpeed;
              newY = paddle.y - ball.radius - 1;
              currentBallSpeed = newSpeed;
              balls[i] = { ...ball, x: newX, y: newY, vx: newVx, vy: newVy };
            }

            playSound("bounce");
            continue;
          }

          // Brick collisions
          for (let j = 0; j < bricks.length; j++) {
            const brick = bricks[j];

            // AABB collision check
            if (
              newX + ball.radius >= brick.x &&
              newX - ball.radius <= brick.x + brick.width &&
              newY + ball.radius >= brick.y &&
              newY - ball.radius <= brick.y + brick.height
            ) {

              // Determine collision side
              const overlapLeft = (newX + ball.radius) - brick.x;
              const overlapRight = (brick.x + brick.width) - (newX - ball.radius);
              const overlapTop = (newY + ball.radius) - brick.y;
              const overlapBottom = (brick.y + brick.height) - (newY - ball.radius);

              const minOverlapX = Math.min(overlapLeft, overlapRight);
              const minOverlapY = Math.min(overlapTop, overlapBottom);

              if (minOverlapX < minOverlapY) {
                newVx = overlapLeft < overlapRight ? -Math.abs(newVx) : Math.abs(newVx);
              } else {
                newVy = overlapTop < overlapBottom ? -Math.abs(newVy) : Math.abs(newVy);
              }

              // Damage brick
              if (brick.type !== "indestructible") {
                bricks[j] = { ...brick, hitsRemaining: brick.hitsRemaining - 1 };

                if (bricks[j].hitsRemaining <= 0) {
                  // Brick destroyed
                  const points = POINTS[brick.type];
                  score += points;
                  progress = { ...progress, totalBricksDestroyed: progress.totalBricksDestroyed + 1 };

                  // Create particles
                  for (let k = 0; k < 8; k++) {
                    const angle = (k / 8) * Math.PI * 2;
                    particles.push({
                      id: nextParticleId++,
                      x: brick.x + brick.width / 2,
                      y: brick.y + brick.height / 2,
                      vx: Math.cos(angle) * (2 + Math.random() * 2),
                      vy: Math.sin(angle) * (2 + Math.random() * 2),
                      color: brick.color,
                      life: 30,
                      maxLife: 30,
                      size: 4,
                    });
                  }

                  // Maybe spawn power-up
                  const levelConfig = getLevel(state.level);
                  if (Math.random() < levelConfig.powerUpChance) {
                    const type = getRandomPowerUp();
                    powerUps.push({
                      id: nextPowerUpId++,
                      x: brick.x + brick.width / 2 - POWERUP_WIDTH / 2,
                      y: brick.y + brick.height,
                      vx: 0,
                      vy: POWERUP_FALL_SPEED,
                      type,
                      width: POWERUP_WIDTH,
                      height: POWERUP_HEIGHT,
                    });
                  }

                  // Handle explosive bricks
                  if (brick.type === "explosive") {
                    // Destroy adjacent bricks
                    for (let adj = 0; adj < bricks.length; adj++) {
                      if (adj === j) continue;
                      const adjBrick = bricks[adj];
                      if (
                        adjBrick.type !== "indestructible" &&
                        Math.abs(adjBrick.row - brick.row) <= 1 &&
                        Math.abs(adjBrick.col - brick.col) <= 1
                      ) {
                        score += POINTS[adjBrick.type];
                        bricks[adj] = { ...adjBrick, hitsRemaining: 0 };
                        progress = { ...progress, totalBricksDestroyed: progress.totalBricksDestroyed + 1 };

                        // Create particles for adjacent
                        for (let k = 0; k < 5; k++) {
                          const angle = (k / 5) * Math.PI * 2;
                          particles.push({
                            id: nextParticleId++,
                            x: adjBrick.x + adjBrick.width / 2,
                            y: adjBrick.y + adjBrick.height / 2,
                            vx: Math.cos(angle) * (3 + Math.random() * 2),
                            vy: Math.sin(angle) * (3 + Math.random() * 2),
                            color: adjBrick.color,
                            life: 25,
                            maxLife: 25,
                            size: 3,
                          });
                        }
                      }
                    }
                  }

                  playSound("break");

                  // Remove destroyed brick
                  bricks = bricks.filter(b => b.hitsRemaining > 0);
                } else {
                  playSound("bounce");
                }
              } else {
                playSound("bounce");
              }

              break;
            }
          }

          balls[i] = { ...ball, x: newX, y: newY, vx: newVx, vy: newVy };
        }

        // Remove lost balls
        balls = balls.filter(b => !ballsToRemove.includes(b.id));

        // Add new balls (from multi-ball)
        balls = [...balls, ...newBalls];

        // Update power-ups
        const powerUpsToRemove: number[] = [];

        for (let i = 0; i < powerUps.length; i++) {
          const powerUp = powerUps[i];
          const newY = powerUp.y + powerUp.vy;

          // Check paddle collision
          if (
            newY + powerUp.height >= paddle.y &&
            newY <= paddle.y + paddle.height &&
            powerUp.x + powerUp.width >= paddle.x &&
            powerUp.x <= paddle.x + paddle.width
          ) {
            // Collected!
            powerUpsToRemove.push(powerUp.id);
            playSound("powerup");
            progress = { ...progress, powerUpsCollected: progress.powerUpsCollected + 1 };

            // Apply power-up effect
            switch (powerUp.type) {
              case "multi-ball": {
                // Triple the balls
                const currentBalls = [...balls];
                for (const ball of currentBalls) {
                  if (ball.stuck) continue;

                  // Create two more balls with different angles
                  const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
                  const baseAngle = Math.atan2(ball.vy, ball.vx);

                  balls.push(createBall(nextBallId++, ball.x, ball.y, speed, baseAngle - Math.PI / 6));
                  balls.push(createBall(nextBallId++, ball.x, ball.y, speed, baseAngle + Math.PI / 6));
                }
                break;
              }
              case "big-paddle":
                // Remove existing big paddle power-up timer and add new one
                activePowerUps = activePowerUps.filter(p => p.type !== "big-paddle");
                activePowerUps.push({ type: "big-paddle", expiresAt: now + BIG_PADDLE_DURATION });
                break;
              case "slow":
                activePowerUps = activePowerUps.filter(p => p.type !== "slow");
                activePowerUps.push({ type: "slow", expiresAt: now + SLOW_DURATION });
                break;
              case "extra-life":
                lives = Math.min(lives + 1, 5); // Cap at 5 lives
                break;
              case "sticky":
                isSticky = true;
                activePowerUps = activePowerUps.filter(p => p.type !== "sticky");
                activePowerUps.push({ type: "sticky", expiresAt: now + STICKY_DURATION });
                break;
            }
          } else if (newY > CANVAS_HEIGHT) {
            // Fell off screen
            powerUpsToRemove.push(powerUp.id);
          } else {
            powerUps[i] = { ...powerUp, y: newY };
          }
        }

        powerUps = powerUps.filter(p => !powerUpsToRemove.includes(p.id));

        // Update particles
        particles = particles
          .map(p => ({
            ...p,
            x: p.x + p.vx,
            y: p.y + p.vy,
            vy: p.vy + 0.1, // Gravity
            life: p.life - 1,
          }))
          .filter(p => p.life > 0);

        // Check if all balls lost
        if (balls.length === 0) {
          lives--;
          playSound("lose-life");

          if (lives <= 0) {
            // Game over
            set({
              balls,
              bricks,
              powerUps,
              particles,
              paddle,
              score,
              lives,
              activePowerUps,
              isSticky,
              currentBallSpeed,
              nextBallId,
              nextPowerUpId,
              nextParticleId,
              progress: stampIfChanged(state.progress, progress),
            });
            get().gameOver();
            return;
          }

          // Reset ball on paddle
          const levelConfig = getLevel(state.level);
          balls = [createInitialBall(paddle)];
          isSticky = false;
          activePowerUps = [];
          paddle = { ...paddle, width: paddle.baseWidth };
          currentBallSpeed = levelConfig.ballSpeed;
        }

        // Check level complete - no breakable bricks left
        const breakableBricks = bricks.filter(b => b.type !== "indestructible");
        if (breakableBricks.length === 0) {
          playSound("level-complete");

          const newProgress = stampIfChanged(state.progress, {
            ...progress,
            highScore: Math.max(progress.highScore, score),
            levelsCompleted: Math.max(progress.levelsCompleted, state.level),
            highestLevel: Math.max(progress.highestLevel, state.level + 1),
          });

          set({
            status: "level-complete",
            balls,
            bricks,
            powerUps,
            particles,
            paddle,
            score,
            lives,
            activePowerUps,
            isSticky,
            currentBallSpeed,
            nextBallId,
            nextPowerUpId,
            nextParticleId,
            progress: newProgress,
          });
          return;
        }

        // Update state
        set({
          balls,
          bricks,
          powerUps,
          particles,
          paddle,
          score,
          lives,
          activePowerUps,
          isSticky,
          currentBallSpeed,
          nextBallId,
          nextPowerUpId,
          nextParticleId,
          // A frame that broke a brick or caught a power-up stamps the totals.
          progress: stampIfChanged(state.progress, progress),
        });
      },

      // Progress sync
      getProgress: () => get().progress,
      setProgress: (data: BreakoutProgress) => set({ progress: data }),
    }),
    {
      storage: createOwnerPersistStorage("breakout-game-state", "breakout"),
      skipHydration: true,
      name: "breakout-game-state",
      // A save of the code before the sync-time fix gets the real time of
      // its progress. The version stays, so that code still loads a new
      // save (shared/lib/untouchedProgress.ts).
      merge: settleOnLoad(UNTOUCHED),
      partialize: (state) => markSaved({
        progress: state.progress,
      }),
    }
  )
);

bindPersistedStore("breakout-game-state", useBreakoutStore.persist, () => useBreakoutStore.setState({}));
