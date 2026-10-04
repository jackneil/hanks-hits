import { bindPersistedStore } from "@/lib/owner-bound-progress";
import { createOwnerPersistStorage } from "@/lib/owner-bound-progress/persistStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { defineUntouchedProgress, markSaved, settleOnLoad } from "@/shared/lib/untouchedProgress";
import {
  GRID_WIDTH,
  GRID_HEIGHT,
  BOMB_TIMER,
  EXPLOSION_DURATION,
  DEFAULT_BOMB_COUNT,
  DEFAULT_BLAST_RANGE,
  DEFAULT_SPEED,
  STARTING_LIVES,
  ENEMY_MOVE_INTERVAL,
  type Tile,
  type EnemyType,
  type Direction,
  DIRECTIONS,
  ENEMY_CONFIGS,
  getLevelConfig,
  getRandomPowerUp,
  inBounds,
  isWalkable,
} from "./constants";
import { playSound } from "./sounds";

// Bomb
interface Bomb {
  id: string;
  x: number;
  y: number;
  timer: number;
  range: number;
  ownerId: "player" | string; // player or enemy id
}

// Explosion cell
interface ExplosionCell {
  x: number;
  y: number;
  timer: number;
}

// Enemy
interface Enemy {
  id: string;
  type: EnemyType;
  x: number;
  y: number;
  lastMove: number;
  alive: boolean;
}

// Player
interface Player {
  x: number;
  y: number;
  bombCount: number;
  maxBombs: number;
  blastRange: number;
  speed: number;
  hasKick: boolean;
  hasShield: boolean;
  alive: boolean;
  invincible: number; // invincibility frames after respawn
}

// Progress data
export type BombermanProgress = {
  highScore: number;
  highestLevel: number;
  levelsCompleted: number;
  totalEnemiesDefeated: number;
  totalBlocksDestroyed: number;
  powerUpsCollected: number;
  gamesPlayed: number;
  settings: {
    soundEnabled: boolean;
    difficulty: "easy" | "normal" | "hard";
  };
  lastModified: number;
};

// Game state
export type BombermanState = {
  // Grid
  grid: Tile[][];
  bombs: Bomb[];
  explosions: ExplosionCell[];

  // Entities
  player: Player;
  enemies: Enemy[];

  // Game state
  gameState: "menu" | "playing" | "paused" | "won" | "lost";
  level: number;
  score: number;
  lives: number;
  exitRevealed: boolean;

  // The run: startGame counts it up (a restart during a run is a new run,
  // for the clips), and keeps the saved best from BEFORE the run. The store
  // raises highScore at each level win, so a compare at game over against
  // the saved best always read as a record (and a tie read as one too).
  runId: number;
  bestBeforeRun: number;
  /** True when this run beat the best from before it (set at a win and at game over). */
  isNewHighScore: boolean;

  // Timing
  lastUpdate: number;

  // Progress
  progress: BombermanProgress;
};

type BombermanActions = {
  // Game lifecycle
  startGame: () => void;
  pauseGame: () => void;
  resumeGame: () => void;
  nextLevel: () => void;
  resetGame: () => void;

  // Player actions
  movePlayer: (direction: Direction) => void;
  placeBomb: () => void;

  // Game loop
  update: (deltaTime: number) => void;

  // Progress
  /** The sound switch: a player's choice, so it stamps the time. */
  toggleSound: () => void;
  getProgress: () => BombermanProgress;
  setProgress: (data: BombermanProgress) => void;
};

const defaultProgress: BombermanProgress = {
  highScore: 0,
  highestLevel: 0,
  levelsCompleted: 0,
  totalEnemiesDefeated: 0,
  totalBlocksDestroyed: 0,
  powerUpsCollected: 0,
  gamesPlayed: 0,
  settings: {
    soundEnabled: true,
    difficulty: "normal",
  },
  lastModified: 0, // Untouched until a player action stamps it (shared/lib/progressStamp.ts).
};

// The sound switches did not stamp the time before the sync-time fix.
const UNTOUCHED = defineUntouchedProgress("bomberman", { defaults: defaultProgress, ignore: ["settings"] });

// Generate empty grid
function createEmptyGrid(): Tile[][] {
  const grid: Tile[][] = [];

  for (let y = 0; y < GRID_HEIGHT; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < GRID_WIDTH; x++) {
      // Walls on borders
      if (x === 0 || y === 0 || x === GRID_WIDTH - 1 || y === GRID_HEIGHT - 1) {
        row.push({ type: "wall" });
      }
      // Checkerboard walls
      else if (x % 2 === 0 && y % 2 === 0) {
        row.push({ type: "wall" });
      }
      else {
        row.push({ type: "empty" });
      }
    }
    grid.push(row);
  }

  return grid;
}

// Generate level with blocks and power-ups
function generateLevel(level: number): { grid: Tile[][]; enemies: Enemy[]; exitX: number; exitY: number } {
  const config = getLevelConfig(level);
  const grid = createEmptyGrid();

  // Safe zone around player spawn (top-left)
  const safeZone = new Set(["1,1", "2,1", "1,2"]);

  // Enemy spawn zones (corners away from player)
  const enemySpawnZones = [
    { x: GRID_WIDTH - 2, y: 1 },           // Top-right
    { x: 1, y: GRID_HEIGHT - 2 },           // Bottom-left
    { x: GRID_WIDTH - 2, y: GRID_HEIGHT - 2 }, // Bottom-right
  ];

  // Place destructible blocks
  const emptyTiles: { x: number; y: number }[] = [];
  for (let y = 1; y < GRID_HEIGHT - 1; y++) {
    for (let x = 1; x < GRID_WIDTH - 1; x++) {
      if (grid[y][x].type === "empty" && !safeZone.has(`${x},${y}`)) {
        // Don't block enemy spawns
        const isEnemySpawn = enemySpawnZones.some(z => z.x === x && z.y === y);
        if (!isEnemySpawn && Math.random() < config.blockDensity) {
          const hasPowerUp = Math.random() < config.powerUpChance;
          grid[y][x] = {
            type: "block",
            powerUp: hasPowerUp ? getRandomPowerUp() : undefined,
          };
        } else if (grid[y][x].type === "empty") {
          emptyTiles.push({ x, y });
        }
      }
    }
  }

  // Place exit under a random block
  let exitX = 0, exitY = 0;
  const blocksWithNoItem = [];
  for (let y = 1; y < GRID_HEIGHT - 1; y++) {
    for (let x = 1; x < GRID_WIDTH - 1; x++) {
      if (grid[y][x].type === "block" && !grid[y][x].powerUp) {
        blocksWithNoItem.push({ x, y });
      }
    }
  }

  if (blocksWithNoItem.length > 0) {
    const exitBlock = blocksWithNoItem[Math.floor(Math.random() * blocksWithNoItem.length)];
    exitX = exitBlock.x;
    exitY = exitBlock.y;
    grid[exitY][exitX] = { type: "exit", revealed: false };
  }

  // Spawn enemies
  const enemies: Enemy[] = [];
  let enemyId = 0;

  for (const enemyConfig of config.enemies) {
    for (let i = 0; i < enemyConfig.count; i++) {
      // Try to spawn in a corner zone, or random empty tile
      let spawnX = 0, spawnY = 0;

      if (i < enemySpawnZones.length && grid[enemySpawnZones[i].y][enemySpawnZones[i].x].type === "empty") {
        spawnX = enemySpawnZones[i].x;
        spawnY = enemySpawnZones[i].y;
      } else if (emptyTiles.length > 0) {
        const idx = Math.floor(Math.random() * emptyTiles.length);
        spawnX = emptyTiles[idx].x;
        spawnY = emptyTiles[idx].y;
        emptyTiles.splice(idx, 1);
      } else {
        // Fallback to any corner
        spawnX = GRID_WIDTH - 2;
        spawnY = GRID_HEIGHT - 2;
      }

      enemies.push({
        id: `enemy-${enemyId++}`,
        type: enemyConfig.type,
        x: spawnX,
        y: spawnY,
        lastMove: 0,
        alive: true,
      });
    }
  }

  return { grid, enemies, exitX, exitY };
}

/**
 * A cleared level: the score is banked into the saved best right away, so
 * a kid who quits after a win keeps the record. Both win paths (walking
 * onto the exit, and the frame check) come through here.
 */
function winLevel(state: BombermanState, progress: BombermanProgress) {
  return {
    gameState: "won" as const,
    isNewHighScore: state.score > state.bestBeforeRun,
    progress: {
      ...progress,
      highScore: Math.max(progress.highScore, state.score),
      lastModified: Date.now(),
    },
  };
}

function createInitialState(): Omit<BombermanState, "progress" | "runId"> {
  return {
    grid: createEmptyGrid(),
    bombs: [],
    explosions: [],
    player: {
      x: 1,
      y: 1,
      bombCount: 0,
      maxBombs: DEFAULT_BOMB_COUNT,
      blastRange: DEFAULT_BLAST_RANGE,
      speed: DEFAULT_SPEED,
      hasKick: false,
      hasShield: false,
      alive: true,
      invincible: 0,
    },
    enemies: [],
    gameState: "menu",
    level: 1,
    score: 0,
    lives: STARTING_LIVES,
    exitRevealed: false,
    bestBeforeRun: 0,
    isNewHighScore: false,
    lastUpdate: Date.now(),
  };
}

export const useBombermanStore = create<BombermanState & BombermanActions>()(
  persist(
    (set, get) => ({
      ...createInitialState(),
      runId: 0,
      progress: defaultProgress,

      startGame: () => {
        const { grid, enemies } = generateLevel(1);
        const progress = get().progress;

        set({
          ...createInitialState(),
          grid,
          enemies,
          gameState: "playing",
          runId: get().runId + 1,
          bestBeforeRun: progress.highScore,
          lastUpdate: Date.now(),
          progress: {
            ...progress,
            gamesPlayed: progress.gamesPlayed + 1,
            lastModified: Date.now(),
          },
        });
      },

      pauseGame: () => {
        set({ gameState: "paused" });
      },

      resumeGame: () => {
        set({ gameState: "playing", lastUpdate: Date.now() });
      },

      nextLevel: () => {
        const state = get();
        const nextLevel = state.level + 1;
        const { grid, enemies } = generateLevel(nextLevel);

        set({
          grid,
          enemies,
          bombs: [],
          explosions: [],
          player: {
            ...state.player,
            x: 1,
            y: 1,
            bombCount: 0,
            alive: true,
            invincible: 2000,
          },
          level: nextLevel,
          exitRevealed: false,
          gameState: "playing",
          lastUpdate: Date.now(),
          progress: {
            ...state.progress,
            highestLevel: Math.max(state.progress.highestLevel, nextLevel),
            levelsCompleted: state.progress.levelsCompleted + 1,
            lastModified: Date.now(),
          },
        });
      },

      resetGame: () => {
        set({
          ...createInitialState(),
          gameState: "menu",
        });
      },

      movePlayer: (direction) => {
        const state = get();
        if (state.gameState !== "playing" || !state.player.alive) return;

        const { dx, dy } = DIRECTIONS[direction];
        const newX = state.player.x + dx;
        const newY = state.player.y + dy;

        if (!inBounds(newX, newY)) return;

        const tile = state.grid[newY][newX];

        // Check for bomb blocking
        const bombAtPos = state.bombs.find(b => b.x === newX && b.y === newY);
        if (bombAtPos && !state.player.hasKick) return;

        // Kick bomb if we have the power
        if (bombAtPos && state.player.hasKick) {
          // Push bomb in movement direction
          const pushX = newX + dx;
          const pushY = newY + dy;
          if (inBounds(pushX, pushY)) {
            const pushTile = state.grid[pushY][pushX];
            if (isWalkable(pushTile) && !state.bombs.find(b => b.x === pushX && b.y === pushY)) {
              set({
                bombs: state.bombs.map(b =>
                  b.id === bombAtPos.id ? { ...b, x: pushX, y: pushY } : b
                ),
              });
            }
          }
          return;
        }

        if (!isWalkable(tile)) return;

        playSound("step");

        // Check for power-up collection
        let newProgress = state.progress;
        const newPlayer = { ...state.player, x: newX, y: newY };
        const newGrid = state.grid.map(row => row.map(t => ({ ...t })));

        if (tile.powerUp) {
          playSound("powerup");

          switch (tile.powerUp) {
            case "bomb":
              newPlayer.maxBombs++;
              break;
            case "fire":
              newPlayer.blastRange++;
              break;
            case "speed":
              newPlayer.speed = Math.min(2, newPlayer.speed + 0.2);
              break;
            case "kick":
              newPlayer.hasKick = true;
              break;
            case "shield":
              newPlayer.hasShield = true;
              break;
          }

          newGrid[newY][newX] = { type: "empty" };
          newProgress = {
            ...newProgress,
            powerUpsCollected: newProgress.powerUpsCollected + 1,
            lastModified: Date.now(),
          };
        }

        // Check for exit: the same win as the frame check (the best is banked).
        if (tile.type === "exit" && tile.revealed && state.exitRevealed) {
          const allEnemiesDead = state.enemies.every(e => !e.alive);
          if (allEnemiesDead) {
            playSound("win");
            set({
              player: newPlayer,
              grid: newGrid,
              ...winLevel(state, newProgress),
            });
            return;
          }
        }

        set({
          player: newPlayer,
          grid: newGrid,
          progress: newProgress,
        });
      },

      placeBomb: () => {
        const state = get();
        if (state.gameState !== "playing" || !state.player.alive) return;

        // Check bomb count
        const activeBombs = state.bombs.filter(b => b.ownerId === "player").length;
        if (activeBombs >= state.player.maxBombs) return;

        // Check if there's already a bomb here
        if (state.bombs.some(b => b.x === state.player.x && b.y === state.player.y)) return;

        playSound("place");

        const newBomb: Bomb = {
          id: `bomb-${Date.now()}`,
          x: state.player.x,
          y: state.player.y,
          timer: BOMB_TIMER,
          range: state.player.blastRange,
          ownerId: "player",
        };

        set({
          bombs: [...state.bombs, newBomb],
          player: {
            ...state.player,
            bombCount: state.player.bombCount + 1,
          },
        });
      },

      update: (deltaTime) => {
        const state = get();
        if (state.gameState !== "playing") return;

        let newBombs = [...state.bombs];
        let newExplosions = [...state.explosions];
        const newGrid = state.grid.map(row => row.map(t => ({ ...t })));
        // Copies: the enemies below are moved and killed in place, and the
        // old state (a React render in flight) must not see it.
        const newEnemies = state.enemies.map(e => ({ ...e }));
        let newPlayer = { ...state.player };
        let newScore = state.score;
        const newProgress = { ...state.progress };
        let newExitRevealed = state.exitRevealed;

        // Update player invincibility
        if (newPlayer.invincible > 0) {
          newPlayer.invincible = Math.max(0, newPlayer.invincible - deltaTime);
        }

        // Update bomb timers
        const explodingBombs: Bomb[] = [];
        newBombs = newBombs.map(bomb => {
          const newTimer = bomb.timer - deltaTime;
          if (newTimer <= 0) {
            explodingBombs.push(bomb);
          }
          return { ...bomb, timer: newTimer };
        }).filter(b => b.timer > 0);

        // Process explosions
        for (const bomb of explodingBombs) {
          playSound("explode");

          // Create explosion at bomb center
          newExplosions.push({ x: bomb.x, y: bomb.y, timer: EXPLOSION_DURATION });

          // Spread in four directions
          for (const [, dir] of Object.entries(DIRECTIONS)) {
            for (let i = 1; i <= bomb.range; i++) {
              const nx = bomb.x + dir.dx * i;
              const ny = bomb.y + dir.dy * i;

              if (!inBounds(nx, ny)) break;

              const tile = newGrid[ny][nx];
              if (tile.type === "wall") break;

              if (tile.type === "block") {
                // Destroy block
                if (tile.powerUp) {
                  newGrid[ny][nx] = { type: "empty", powerUp: tile.powerUp };
                } else {
                  newGrid[ny][nx] = { type: "empty" };
                }
                newProgress.totalBlocksDestroyed++;
                newExplosions.push({ x: nx, y: ny, timer: EXPLOSION_DURATION });
                break;
              }

              if (tile.type === "exit") {
                newGrid[ny][nx] = { type: "exit", revealed: true };
                newExitRevealed = true;
                newExplosions.push({ x: nx, y: ny, timer: EXPLOSION_DURATION });
                break;
              }

              // Chain reaction with other bombs
              const chainBomb = newBombs.find(b => b.x === nx && b.y === ny);
              if (chainBomb) {
                // Trigger immediately
                chainBomb.timer = 0;
              }

              newExplosions.push({ x: nx, y: ny, timer: EXPLOSION_DURATION });
            }
          }

          // Return bomb to player's pool
          if (bomb.ownerId === "player") {
            newPlayer.bombCount = Math.max(0, newPlayer.bombCount - 1);
          }
        }

        // Update explosion timers
        newExplosions = newExplosions.map(e => ({
          ...e,
          timer: e.timer - deltaTime,
        })).filter(e => e.timer > 0);

        // Check player collision with explosions
        if (newPlayer.alive && newPlayer.invincible <= 0) {
          const hitByExplosion = newExplosions.some(
            e => e.x === newPlayer.x && e.y === newPlayer.y
          );

          if (hitByExplosion) {
            if (newPlayer.hasShield) {
              newPlayer.hasShield = false;
            } else {
              playSound("death");
              newPlayer.alive = false;
            }
          }
        }

        // Check enemy collision with explosions
        for (const enemy of newEnemies) {
          if (!enemy.alive) continue;

          const hitByExplosion = newExplosions.some(
            e => e.x === enemy.x && e.y === enemy.y
          );

          if (hitByExplosion) {
            enemy.alive = false;
            newScore += ENEMY_CONFIGS[enemy.type].points;
            newProgress.totalEnemiesDefeated++;
          }
        }

        // Enemy AI
        const now = Date.now();
        for (const enemy of newEnemies) {
          if (!enemy.alive) continue;

          const config = ENEMY_CONFIGS[enemy.type];
          const moveInterval = ENEMY_MOVE_INTERVAL / config.speed;

          if (now - enemy.lastMove < moveInterval) continue;
          enemy.lastMove = now;

          // Get valid moves
          const validMoves: { x: number; y: number }[] = [];
          for (const dir of Object.values(DIRECTIONS)) {
            const nx = enemy.x + dir.dx;
            const ny = enemy.y + dir.dy;

            if (!inBounds(nx, ny)) continue;
            if (!isWalkable(newGrid[ny][nx], config.canPassBlocks)) continue;
            if (newBombs.some(b => b.x === nx && b.y === ny)) continue;

            validMoves.push({ x: nx, y: ny });
          }

          if (validMoves.length === 0) continue;

          let chosenMove = validMoves[Math.floor(Math.random() * validMoves.length)];

          // Chase AI
          if (config.ai === "chase" || config.ai === "smart") {
            // Find move that gets closer to player
            let bestDist = Infinity;
            for (const move of validMoves) {
              const dist = Math.abs(move.x - newPlayer.x) + Math.abs(move.y - newPlayer.y);
              if (dist < bestDist) {
                bestDist = dist;
                chosenMove = move;
              }
            }
          }

          enemy.x = chosenMove.x;
          enemy.y = chosenMove.y;
        }

        // Check enemy collision with player
        if (newPlayer.alive && newPlayer.invincible <= 0) {
          const hitByEnemy = newEnemies.some(
            e => e.alive && e.x === newPlayer.x && e.y === newPlayer.y
          );

          if (hitByEnemy) {
            if (newPlayer.hasShield) {
              newPlayer.hasShield = false;
            } else {
              playSound("death");
              newPlayer.alive = false;
            }
          }
        }

        // Handle player death
        let newLives = state.lives;
        let newGameState: "menu" | "playing" | "paused" | "won" | "lost" = state.gameState;
        let isNewHighScore = state.isNewHighScore;

        if (!newPlayer.alive) {
          newLives--;

          if (newLives <= 0) {
            newGameState = "lost";
            isNewHighScore = newScore > state.bestBeforeRun;
            newProgress.highScore = Math.max(newProgress.highScore, newScore);
          } else {
            // Respawn player
            newPlayer = {
              x: 1,
              y: 1,
              bombCount: 0,
              maxBombs: DEFAULT_BOMB_COUNT,
              blastRange: DEFAULT_BLAST_RANGE,
              speed: DEFAULT_SPEED,
              hasKick: false,
              hasShield: false,
              alive: true,
              invincible: 2000,
            };
            newBombs = newBombs.filter(b => b.ownerId !== "player");
          }
        }

        // Check win condition
        const allEnemiesDead = newEnemies.every(e => !e.alive);
        const playerOnExit = newGrid[newPlayer.y][newPlayer.x].type === "exit" &&
          newGrid[newPlayer.y][newPlayer.x].revealed;

        if (allEnemiesDead && playerOnExit && newPlayer.alive) {
          playSound("win");
          const won = winLevel({ ...state, score: newScore }, newProgress);
          newGameState = won.gameState;
          isNewHighScore = won.isNewHighScore;
          newProgress.highScore = won.progress.highScore;
        }

        // Stamp the progress only when a counter changed: a stamp on every
        // frame made the persist middleware write storage sixty times a
        // second and cloud sync see a change with nothing in it.
        const progressChanged =
          newProgress.totalBlocksDestroyed !== state.progress.totalBlocksDestroyed ||
          newProgress.totalEnemiesDefeated !== state.progress.totalEnemiesDefeated ||
          newProgress.highScore !== state.progress.highScore;

        set({
          bombs: newBombs,
          explosions: newExplosions,
          grid: newGrid,
          enemies: newEnemies,
          player: newPlayer,
          score: newScore,
          lives: newLives,
          exitRevealed: newExitRevealed,
          gameState: newGameState,
          isNewHighScore,
          lastUpdate: now,
          progress: progressChanged ? { ...newProgress, lastModified: Date.now() } : state.progress,
        });
      },

      toggleSound: () =>
        set((state) => ({
          progress: {
            ...state.progress,
            settings: { ...state.progress.settings, soundEnabled: !state.progress.settings.soundEnabled },
            lastModified: Date.now(),
          },
        })),

      getProgress: () => get().progress,
      setProgress: (data) => set({ progress: data }),
    }),
    {
      storage: createOwnerPersistStorage("bomberman-state", "bomberman"),
      skipHydration: true,
      name: "bomberman-state",
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

bindPersistedStore("bomberman-state", useBombermanStore.persist, () => useBombermanStore.setState({}));
