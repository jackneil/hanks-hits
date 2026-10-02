import { create } from "zustand";
import { createJSONStorage, persist, type PersistStorage } from "zustand/middleware";
import {
  type GameState,
  type Player as PlayerType,
  type Obstacle as ObstacleType,
  type CoinType,
  type Cloud,
  type CharacterId,
  PLAYER,
  PHYSICS,
  OBSTACLE,
  COIN,
  SPEED,
  SCORING,
  CANVAS_WIDTH,
  CHARACTERS,
  MAX_STEPS_PER_UPDATE,
  STEP_MS,
} from "./constants";
import {
  SPAWN_X,
  coinRect,
  gapAfter,
  obstacleRect,
  overlaps,
  runnerCoinBox,
  runnerHitbox,
  stepJump,
} from "./geometry";

// Progress data that gets synced to server
// Index signature required for AppProgressData compatibility
export type EndlessRunnerProgress = {
  [key: string]: unknown;
  highScore: number;
  totalDistance: number;
  totalCoins: number;
  coinsCollected: number;
  gamesPlayed: number;
  unlockedCharacters: CharacterId[];
  selectedCharacter: CharacterId;
  lastModified: number;
};

const defaultProgress: EndlessRunnerProgress = {
  highScore: 0,
  totalDistance: 0,
  totalCoins: 0,
  coinsCollected: 0,
  gamesPlayed: 0,
  unlockedCharacters: ["speedy-sam"],
  selectedCharacter: "speedy-sam",
  lastModified: Date.now(),
};

// Full game state
export type EndlessRunnerState = {
  // Current game state
  gameState: GameState;
  score: number;
  distance: number;
  coinsThisRun: number;
  player: PlayerType;
  obstacles: ObstacleType[];
  coins: CoinType[];
  clouds: Cloud[];
  groundOffset: number;
  currentSpeed: number;
  obstacleIdCounter: number;
  /**
   * Where the front of the next obstacle goes. It scrolls with the world,
   * and the obstacle appears when it reaches SPAWN_X, so the clear road
   * behind every obstacle is exactly what gapAfter() planned for it.
   */
  nextObstacleX: number;
  coinIdCounter: number;
  /**
   * DUCK is held down (a key, a thumb button or the duck zone). The runner
   * ducks whenever it is on the ground while this is true: a DUCK pressed
   * in the air ducks on landing, and a jump from a duck lands ducked.
   */
  duckHeld: boolean;
  isNewHighScore: boolean;
  lastMilestone: number;

  // Persisted progress
  progress: EndlessRunnerProgress;

  // Actions
  startGame: () => void;
  jump: () => void;
  startDuck: () => void;
  stopDuck: () => void;
  update: (delta: number) => void;
  endGame: () => void;
  reset: () => void;
  unlockCharacter: (id: CharacterId) => boolean;
  selectCharacter: (id: CharacterId) => void;

  // For useAuthSync
  getProgress: () => EndlessRunnerProgress;
  setProgress: (data: EndlessRunnerProgress) => void;
};

// Create initial clouds
function createInitialClouds(): Cloud[] {
  const clouds: Cloud[] = [];
  for (let i = 0; i < 5; i++) {
    clouds.push({
      x: Math.random() * CANVAS_WIDTH * 1.5,
      y: 30 + Math.random() * 80,
      scale: 0.5 + Math.random() * 0.5,
      speed: 0.2 + Math.random() * 0.3,
    });
  }
  return clouds;
}

// Spawn a new obstacle
function createObstacle(id: number, x: number): ObstacleType {
  // 70% ground obstacles, 30% air obstacles (more forgiving for kids)
  const isGround = Math.random() < 0.7;

  if (isGround) {
    return {
      x,
      type: "ground",
      width: OBSTACLE.GROUND_WIDTH,
      height: OBSTACLE.GROUND_HEIGHT,
      id,
    };
  } else {
    return {
      x,
      type: "air",
      width: OBSTACLE.AIR_WIDTH,
      height: OBSTACLE.AIR_HEIGHT,
      id,
    };
  }
}

// Spawn coins in a pattern
function createCoins(startId: number, obstacleX: number): CoinType[] {
  if (Math.random() > COIN.SPAWN_CHANCE) return [];

  const coins: CoinType[] = [];
  const pattern = Math.floor(Math.random() * 3); // 0: line, 1: arc, 2: single
  const startX = obstacleX - COIN.LEAD; // Coins appear before obstacles

  if (pattern === 0) {
    // Line of 3 coins
    const y = [COIN.LOW_Y, COIN.MID_Y, COIN.HIGH_Y][Math.floor(Math.random() * 3)];
    for (let i = 0; i < 3; i++) {
      coins.push({
        x: startX + i * 40,
        y,
        collected: false,
        id: startId + i,
      });
    }
  } else if (pattern === 1) {
    // Arc pattern (3 coins)
    coins.push({ x: startX, y: COIN.LOW_Y, collected: false, id: startId });
    coins.push({ x: startX + 40, y: COIN.HIGH_Y, collected: false, id: startId + 1 });
    coins.push({ x: startX + 80, y: COIN.LOW_Y, collected: false, id: startId + 2 });
  } else {
    // Single high-value position
    coins.push({
      x: startX + 40,
      y: COIN.HIGH_Y,
      collected: false,
      id: startId,
    });
  }

  return coins;
}

/** What the store keeps in localStorage. */
type PersistedRunner = { progress: EndlessRunnerProgress };

/**
 * localStorage for the store that writes only when the progress changes.
 * persist writes after every set, and the game loop sets the store on every
 * frame of a run (60 to 120 times a second), but the progress changes only
 * at the end of a run and with a character. Each write turns the progress
 * into a string on the main thread (review wave 2, 2026-10-02). When the
 * key is gone (a sign-out clears it), the next set writes it again, as
 * before. Unavailable storage (the server) gives undefined, like persist's
 * own default.
 */
export function progressStorage(): PersistStorage<PersistedRunner> | undefined {
  let local: Storage;
  try {
    local = window.localStorage;
  } catch {
    return undefined;
  }
  const json = createJSONStorage<PersistedRunner>(() => local);
  if (!json) return undefined;
  // The progress object last written. Every change to the progress makes a
  // new object, so the same object means the same data.
  let saved: EndlessRunnerProgress | null = null;
  return {
    getItem: (name) => json.getItem(name),
    setItem: (name, value) => {
      if (value.state.progress === saved && local.getItem(name) !== null) return;
      json.setItem(name, value);
      // Only after the write: a failed write is tried again at the next set.
      saved = value.state.progress;
    },
    removeItem: (name) => {
      saved = null;
      return json.removeItem(name);
    },
  };
}

export const useEndlessRunnerStore = create<EndlessRunnerState>()(
  persist(
    (set, get) => ({
      // Initial state
      gameState: "ready",
      score: 0,
      distance: 0,
      coinsThisRun: 0,
      player: {
        y: PLAYER.GROUND_Y,
        velocity: 0,
        isDucking: false,
        isJumping: false,
      },
      obstacles: [],
      coins: [],
      clouds: createInitialClouds(),
      groundOffset: 0,
      currentSpeed: SPEED.INITIAL,
      obstacleIdCounter: 0,
      nextObstacleX: SPAWN_X,
      coinIdCounter: 0,
      duckHeld: false,
      isNewHighScore: false,
      lastMilestone: 0,
      progress: defaultProgress,

      startGame: () => {
        const firstObstacleX = SPAWN_X;
        const firstObstacle = createObstacle(1, firstObstacleX);
        const firstCoins = createCoins(1, firstObstacleX);

        set({
          gameState: "playing",
          score: 0,
          distance: 0,
          coinsThisRun: 0,
          player: {
            y: PLAYER.GROUND_Y,
            velocity: 0,
            isDucking: false,
            isJumping: false,
          },
          obstacles: [firstObstacle],
          coins: firstCoins,
          clouds: createInitialClouds(),
          groundOffset: 0,
          currentSpeed: SPEED.INITIAL,
          obstacleIdCounter: 1,
          nextObstacleX: firstObstacle.x + firstObstacle.width + gapAfter(SPEED.INITIAL, Math.random()),
          coinIdCounter: firstCoins.length > 0 ? firstCoins[firstCoins.length - 1].id : 0,
          duckHeld: false,
          isNewHighScore: false,
          lastMilestone: 0,
        });
      },

      // A jump works from a duck too: the runner stands up into the jump,
      // and lands ducked again if DUCK is still held. (A kid holding DUCK
      // who taps JUMP for a crate used to get nothing.)
      jump: () => {
        const state = get();
        if (state.gameState !== "playing") return;
        if (state.player.isJumping) return;

        set({
          player: {
            ...state.player,
            velocity: PHYSICS.JUMP_VELOCITY,
            isJumping: true,
            isDucking: false,
          },
        });
      },

      // DUCK is a hold: it ducks now on the ground, or on landing when it is
      // pressed in the air (a touch hold fires once, so a press in the air
      // was lost and the kid landed standing under the next purple bar).
      startDuck: () => {
        const state = get();
        if (state.gameState !== "playing") return;

        set({
          duckHeld: true,
          player: {
            ...state.player,
            isDucking: !state.player.isJumping,
          },
        });
      },

      stopDuck: () => {
        const state = get();
        set({
          duckHeld: false,
          player: {
            ...state.player,
            isDucking: false,
          },
        });
      },

      update: (delta: number) => {
        const state = get();
        if (state.gameState !== "playing") return;

        // Game time in steps (STEP_MS each), capped for a slow frame
        const normalizedDelta = Math.min(delta / STEP_MS, MAX_STEPS_PER_UPDATE);

        // Update player physics
        let newY = state.player.y;
        let newVelocity = state.player.velocity;
        let newIsJumping = state.player.isJumping;
        let newIsDucking = state.player.isDucking;

        if (state.player.isJumping) {
          const next = stepJump(newY, newVelocity, normalizedDelta);
          newY = next.y;
          newVelocity = next.velocity;
          if (next.landed) {
            newIsJumping = false;
            // A DUCK held in the air ducks on landing.
            newIsDucking = state.duckHeld;
          }
        }

        // Update speed (gradual increase)
        let newSpeed = state.currentSpeed;
        if (newSpeed < SPEED.MAX) {
          newSpeed = Math.min(newSpeed + SPEED.INCREASE_RATE * normalizedDelta, SPEED.MAX);
        }

        // Update ground offset for scrolling effect
        const newGroundOffset = (state.groundOffset + newSpeed * normalizedDelta) % 40;

        // Update obstacles
        const scroll = newSpeed * normalizedDelta;
        let newObstacles = state.obstacles.map((obs) => ({
          ...obs,
          x: obs.x - scroll,
        }));

        // Remove off-screen obstacles
        newObstacles = newObstacles.filter((obs) => obs.x > -obs.width);

        // Spawn the next obstacle when its planned spot scrolls in. The road
        // behind each one is planned in steps (gapAfter), so after any jump
        // the runner lands with time to react, at every speed. (The old rule
        // re-rolled a pixel threshold every frame and put obstacles about
        // 85 px apart.)
        let newObstacleIdCounter = state.obstacleIdCounter;
        let newNextObstacleX = state.nextObstacleX - scroll;
        let newCoinIdCounter = state.coinIdCounter;

        // Update coins (before new ones join, so a new obstacle's coins sit
        // exactly COIN.LEAD in front of it)
        let newCoins = state.coins.map((coin) => ({
          ...coin,
          x: coin.x - scroll,
        }));

        if (newNextObstacleX <= SPAWN_X) {
          newObstacleIdCounter++;
          const newObstacleX = newNextObstacleX;
          const newObstacle = createObstacle(newObstacleIdCounter, newObstacleX);
          newObstacles.push(newObstacle);
          newNextObstacleX = newObstacle.x + newObstacle.width + gapAfter(newSpeed, Math.random());

          // Spawn coins with new obstacle
          const obstacleCoins = createCoins(newCoinIdCounter + 1, newObstacleX);
          if (obstacleCoins.length > 0) {
            newCoins.push(...obstacleCoins);
            newCoinIdCounter = obstacleCoins[obstacleCoins.length - 1].id;
          }
        }

        // Remove off-screen coins
        newCoins = newCoins.filter((coin) => coin.x > -COIN.SIZE && !coin.collected);

        // Update clouds (parallax - slower than ground)
        const newClouds = state.clouds.map((cloud) => {
          let newX = cloud.x - cloud.speed * normalizedDelta;
          if (newX < -100) {
            newX = CANVAS_WIDTH + 100;
          }
          return { ...cloud, x: newX };
        });

        // Update distance
        const newDistance = state.distance + newSpeed * normalizedDelta * SCORING.DISTANCE_MULTIPLIER;

        // Check for coin collection
        let newCoinsThisRun = state.coinsThisRun;
        const pose = { y: newY, isDucking: newIsDucking };
        const coinBox = runnerCoinBox(pose);

        newCoins = newCoins.map((coin) => {
          if (coin.collected) return coin;
          if (overlaps(coinBox, coinRect(coin))) {
            newCoinsThisRun += COIN.VALUE;
            return { ...coin, collected: true };
          }
          return coin;
        });

        // Check for obstacle collision: the same boxes Game.tsx draws, and
        // the runner's forgiving hitbox.
        const hitbox = runnerHitbox(pose);
        for (const obs of newObstacles) {
          if (overlaps(hitbox, obstacleRect(obs))) {
            get().endGame();
            return;
          }
        }

        // Check milestones
        let newMilestone = state.lastMilestone;
        const distanceMeters = Math.floor(newDistance);
        for (const milestone of SCORING.MILESTONES) {
          if (distanceMeters >= milestone && state.lastMilestone < milestone) {
            newMilestone = milestone;
            // Could trigger celebration here
          }
        }

        set({
          player: {
            ...state.player,
            y: newY,
            velocity: newVelocity,
            isJumping: newIsJumping,
            isDucking: newIsDucking,
          },
          obstacles: newObstacles,
          coins: newCoins,
          clouds: newClouds,
          groundOffset: newGroundOffset,
          currentSpeed: newSpeed,
          distance: newDistance,
          score: Math.floor(newDistance),
          coinsThisRun: newCoinsThisRun,
          obstacleIdCounter: newObstacleIdCounter,
          nextObstacleX: newNextObstacleX,
          coinIdCounter: newCoinIdCounter,
          lastMilestone: newMilestone,
        });
      },

      endGame: () => {
        const state = get();
        const finalScore = Math.floor(state.distance);
        const isNewHighScore = finalScore > state.progress.highScore;

        set({
          gameState: "gameOver",
          isNewHighScore,
          progress: {
            ...state.progress,
            highScore: Math.max(state.progress.highScore, finalScore),
            totalDistance: state.progress.totalDistance + state.distance,
            totalCoins: state.progress.totalCoins + state.coinsThisRun,
            coinsCollected: state.progress.coinsCollected + state.coinsThisRun,
            gamesPlayed: state.progress.gamesPlayed + 1,
            lastModified: Date.now(),
          },
        });
      },

      reset: () => {
        set({
          gameState: "ready",
          score: 0,
          distance: 0,
          coinsThisRun: 0,
          player: {
            y: PLAYER.GROUND_Y,
            velocity: 0,
            isDucking: false,
            isJumping: false,
          },
          obstacles: [],
          nextObstacleX: SPAWN_X,
          duckHeld: false,
          coins: [],
          clouds: createInitialClouds(),
          groundOffset: 0,
          currentSpeed: SPEED.INITIAL,
          isNewHighScore: false,
          lastMilestone: 0,
        });
      },

      unlockCharacter: (id: CharacterId) => {
        const state = get();
        const character = CHARACTERS[id];
        if (!character) return false;
        if (state.progress.unlockedCharacters.includes(id)) return false;
        if (state.progress.totalCoins < character.cost) return false;

        set({
          progress: {
            ...state.progress,
            totalCoins: state.progress.totalCoins - character.cost,
            unlockedCharacters: [...state.progress.unlockedCharacters, id],
            lastModified: Date.now(),
          },
        });
        return true;
      },

      selectCharacter: (id: CharacterId) => {
        const state = get();
        if (!state.progress.unlockedCharacters.includes(id)) return;

        set({
          progress: {
            ...state.progress,
            selectedCharacter: id,
            lastModified: Date.now(),
          },
        });
      },

      getProgress: () => get().progress,
      setProgress: (data) => set({ progress: data }),
    }),
    {
      name: "endless-runner-storage",
      storage: progressStorage(),
      partialize: (state) => ({ progress: state.progress }),
    }
  )
);
