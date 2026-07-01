import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  type GameStatus,
  type Block,
  type FallingBlock,
  type Particle,
  type BlockColor,
  BLOCK_COLORS,
  HEX_CENTER_X,
  HEX_CENTER_Y,
  HEX_RADIUS,
  BLOCK_HEIGHT,
  MAX_STACK_HEIGHT,
  MATCH_MINIMUM,
  INITIAL_FALL_SPEED,
  MAX_FALL_SPEED,
  SPEED_INCREMENT,
  SPAWN_DISTANCE,
  SPAWN_INTERVAL,
  MIN_SPAWN_INTERVAL,
  POINTS,
  ROTATION_SPEED,
  getSideAngle,
  getRandomColor,
  getRandomSide,
} from "./constants";

// Progress data (persisted)
export type HextrisProgress = {
  highScore: number;
  gamesPlayed: number;
  totalBlocksMatched: number;
  longestChain: number;
  soundEnabled: boolean;
  lastModified: number;
};

// Full game state
export type HextrisGameState = {
  status: GameStatus;
  score: number;

  // Hexagon rotation
  rotation: number; // Current rotation in radians
  targetRotation: number; // Target rotation for smooth animation

  // Blocks
  stacks: Block[][]; // 6 sides, each with array of stacked blocks
  fallingBlock: FallingBlock | null;

  // Particles
  particles: Particle[];

  // Speed
  currentSpeed: number;
  spawnInterval: number;
  lastSpawnTime: number;

  // Counters
  nextBlockId: number;
  nextParticleId: number;
  chainCount: number;

  // Progress
  progress: HextrisProgress;
};

type HextrisActions = {
  startGame: () => void;
  pauseGame: () => void;
  resumeGame: () => void;
  gameOver: () => void;

  rotateLeft: () => void;
  rotateRight: () => void;

  update: (deltaTime: number) => void;

  getProgress: () => HextrisProgress;
  setProgress: (data: HextrisProgress) => void;
};

const defaultProgress: HextrisProgress = {
  highScore: 0,
  gamesPlayed: 0,
  totalBlocksMatched: 0,
  longestChain: 0,
  soundEnabled: true,
  lastModified: Date.now(),
};

function createEmptyStacks(): Block[][] {
  return [[], [], [], [], [], []];
}

function createInitialState(): Partial<HextrisGameState> {
  return {
    status: "idle",
    score: 0,
    rotation: 0,
    targetRotation: 0,
    stacks: createEmptyStacks(),
    fallingBlock: null,
    particles: [],
    currentSpeed: INITIAL_FALL_SPEED,
    spawnInterval: SPAWN_INTERVAL,
    lastSpawnTime: 0,
    nextBlockId: 1,
    nextParticleId: 1,
    chainCount: 0,
  };
}

function createFallingBlock(id: number, speed: number): FallingBlock {
  const targetSide = getRandomSide();
  const sideAngle = getSideAngle(targetSide);
  // Spawn from opposite direction
  const spawnAngle = sideAngle + Math.PI;

  return {
    id,
    color: getRandomColor(),
    x: HEX_CENTER_X + Math.cos(spawnAngle) * SPAWN_DISTANCE,
    y: HEX_CENTER_Y + Math.sin(spawnAngle) * SPAWN_DISTANCE,
    targetSide,
    angle: sideAngle,
    speed,
  };
}

// Audio
let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
  }
  return audioContext;
}

function playSound(type: "rotate" | "land" | "match" | "game-over", enabled: boolean) {
  if (!enabled) return;

  try {
    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    switch (type) {
      case "rotate":
        oscillator.frequency.value = 220;
        oscillator.type = "sine";
        gainNode.gain.value = 0.05;
        oscillator.start();
        oscillator.stop(ctx.currentTime + 0.05);
        break;
      case "land":
        oscillator.frequency.value = 330;
        oscillator.type = "triangle";
        gainNode.gain.value = 0.1;
        oscillator.start();
        oscillator.stop(ctx.currentTime + 0.1);
        break;
      case "match":
        oscillator.frequency.value = 523;
        oscillator.type = "sine";
        gainNode.gain.value = 0.15;
        const now = ctx.currentTime;
        oscillator.frequency.setValueAtTime(523, now);
        oscillator.frequency.setValueAtTime(659, now + 0.05);
        oscillator.frequency.setValueAtTime(784, now + 0.1);
        oscillator.start();
        oscillator.stop(now + 0.2);
        break;
      case "game-over":
        oscillator.frequency.value = 200;
        oscillator.type = "sawtooth";
        gainNode.gain.value = 0.15;
        oscillator.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.5);
        oscillator.start();
        oscillator.stop(ctx.currentTime + 0.5);
        break;
    }
  } catch {
    // Audio not supported
  }
}

function checkMatches(stacks: Block[][]): { side: number; startIndex: number; length: number; color: BlockColor }[] {
  const matches: { side: number; startIndex: number; length: number; color: BlockColor }[] = [];

  for (let side = 0; side < 6; side++) {
    const stack = stacks[side];
    if (stack.length < MATCH_MINIMUM) continue;

    let runStart = 0;
    let runColor = stack[0]?.color;

    for (let i = 1; i <= stack.length; i++) {
      const current = stack[i]?.color;

      if (current !== runColor || i === stack.length) {
        const runLength = i - runStart;
        if (runLength >= MATCH_MINIMUM && runColor) {
          matches.push({
            side,
            startIndex: runStart,
            length: runLength,
            color: runColor,
          });
        }
        runStart = i;
        runColor = current;
      }
    }
  }

  return matches;
}

function removeMatches(
  stacks: Block[][],
  matches: { side: number; startIndex: number; length: number }[]
): Block[][] {
  const newStacks = stacks.map(stack => [...stack]);

  // Sort matches by side and startIndex descending to remove from end first
  const sortedMatches = [...matches].sort((a, b) => {
    if (a.side !== b.side) return a.side - b.side;
    return b.startIndex - a.startIndex;
  });

  for (const match of sortedMatches) {
    newStacks[match.side].splice(match.startIndex, match.length);
  }

  // Update stack indices
  for (let side = 0; side < 6; side++) {
    newStacks[side] = newStacks[side].map((block, index) => ({
      ...block,
      stackIndex: index,
    }));
  }

  return newStacks;
}

export const useHextrisStore = create<HextrisGameState & HextrisActions>()(
  persist(
    (set, get) => ({
      ...createInitialState() as HextrisGameState,
      progress: defaultProgress,

      startGame: () => {
        const state = get();
        set({
          ...createInitialState(),
          status: "playing",
          lastSpawnTime: Date.now(),
          progress: {
            ...state.progress,
            gamesPlayed: state.progress.gamesPlayed + 1,
            lastModified: Date.now(),
          },
        });
      },

      pauseGame: () => {
        const state = get();
        if (state.status === "playing") {
          set({ status: "paused" });
        }
      },

      resumeGame: () => {
        const state = get();
        if (state.status === "paused") {
          set({ status: "playing", lastSpawnTime: Date.now() });
        }
      },

      gameOver: () => {
        const state = get();
        playSound("game-over", state.progress.soundEnabled);

        set({
          status: "game-over",
          progress: {
            ...state.progress,
            highScore: Math.max(state.progress.highScore, state.score),
            lastModified: Date.now(),
          },
        });
      },

      rotateLeft: () => {
        const state = get();
        if (state.status !== "playing") return;

        playSound("rotate", state.progress.soundEnabled);
        set({ targetRotation: state.targetRotation - Math.PI / 3 });
      },

      rotateRight: () => {
        const state = get();
        if (state.status !== "playing") return;

        playSound("rotate", state.progress.soundEnabled);
        set({ targetRotation: state.targetRotation + Math.PI / 3 });
      },

      update: (deltaTime: number) => {
        const state = get();
        if (state.status !== "playing") return;

        const now = Date.now();
        let {
          rotation,
          stacks,
          fallingBlock,
          particles,
          currentSpeed,
          spawnInterval,
          lastSpawnTime,
          nextBlockId,
          nextParticleId,
          chainCount,
          score,
          progress,
        } = state;
        const { targetRotation } = state;

        // Copy arrays
        stacks = stacks.map(stack => [...stack]);
        particles = [...particles];

        // Smooth rotation
        const rotationDiff = targetRotation - rotation;
        if (Math.abs(rotationDiff) > 0.01) {
          rotation += rotationDiff * ROTATION_SPEED * deltaTime;
        } else {
          rotation = targetRotation;
        }

        // Spawn new block if needed
        if (!fallingBlock && now - lastSpawnTime > spawnInterval) {
          fallingBlock = createFallingBlock(nextBlockId++, currentSpeed);
          lastSpawnTime = now;

          // Increase difficulty
          currentSpeed = Math.min(currentSpeed + SPEED_INCREMENT * 100, MAX_FALL_SPEED);
          spawnInterval = Math.max(spawnInterval - 5, MIN_SPAWN_INTERVAL);
        }

        // Update falling block
        if (fallingBlock) {
          // Move toward center
          const dx = HEX_CENTER_X - fallingBlock.x;
          const dy = HEX_CENTER_Y - fallingBlock.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist > 0) {
            fallingBlock = {
              ...fallingBlock,
              x: fallingBlock.x + (dx / dist) * fallingBlock.speed,
              y: fallingBlock.y + (dy / dist) * fallingBlock.speed,
            };
          }

          // Check if block has reached its stack position
          // Account for current rotation
          const normalizedRotation = ((rotation % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
          const rotationSteps = Math.round(normalizedRotation / (Math.PI / 3));
          const effectiveSide = ((fallingBlock.targetSide - rotationSteps) % 6 + 6) % 6;

          const stackHeight = stacks[effectiveSide].length;
          const landingDistance = HEX_RADIUS + BLOCK_HEIGHT / 2 + stackHeight * BLOCK_HEIGHT;

          const blockDist = Math.sqrt(
            Math.pow(fallingBlock.x - HEX_CENTER_X, 2) +
            Math.pow(fallingBlock.y - HEX_CENTER_Y, 2)
          );

          if (blockDist <= landingDistance + 5) {
            // Block landed
            playSound("land", progress.soundEnabled);
            score += POINTS.BLOCK_LAND;

            // Add to stack
            const newBlock: Block = {
              id: fallingBlock.id,
              color: fallingBlock.color,
              side: effectiveSide,
              stackIndex: stackHeight,
            };
            stacks[effectiveSide] = [...stacks[effectiveSide], newBlock];

            // Check for game over
            if (stacks[effectiveSide].length >= MAX_STACK_HEIGHT) {
              set({
                rotation,
                targetRotation,
                stacks,
                fallingBlock: null,
                particles,
                currentSpeed,
                spawnInterval,
                lastSpawnTime,
                nextBlockId,
                nextParticleId,
                chainCount,
                score,
                progress,
              });
              get().gameOver();
              return;
            }

            // Check for matches
            const matches = checkMatches(stacks);

            if (matches.length > 0) {
              playSound("match", progress.soundEnabled);

              // Calculate score
              let matchScore = 0;
              let blocksMatched = 0;

              for (const match of matches) {
                blocksMatched += match.length;
                if (match.length === 3) matchScore += POINTS.MATCH_3;
                else if (match.length === 4) matchScore += POINTS.MATCH_4;
                else matchScore += POINTS.MATCH_5_PLUS;
              }

              // Chain bonus
              chainCount++;
              const chainMultiplier = Math.pow(POINTS.CHAIN_MULTIPLIER, chainCount - 1);
              score += Math.floor(matchScore * chainMultiplier);

              // Create particles for matched blocks
              for (const match of matches) {
                for (let i = match.startIndex; i < match.startIndex + match.length; i++) {
                  const block = stacks[match.side][i];
                  if (!block) continue;

                  const sideAngle = getSideAngle(match.side) + rotation;
                  const distance = HEX_RADIUS + BLOCK_HEIGHT / 2 + i * BLOCK_HEIGHT;
                  const bx = HEX_CENTER_X + Math.cos(sideAngle) * distance;
                  const by = HEX_CENTER_Y + Math.sin(sideAngle) * distance;

                  for (let p = 0; p < 6; p++) {
                    const angle = (p / 6) * Math.PI * 2;
                    particles.push({
                      id: nextParticleId++,
                      x: bx,
                      y: by,
                      vx: Math.cos(angle) * (2 + Math.random() * 2),
                      vy: Math.sin(angle) * (2 + Math.random() * 2),
                      color: block.color,
                      life: 30,
                      maxLife: 30,
                      size: 4,
                    });
                  }
                }
              }

              // Remove matched blocks
              stacks = removeMatches(stacks, matches);

              // Update stats
              progress = {
                ...progress,
                totalBlocksMatched: progress.totalBlocksMatched + blocksMatched,
                longestChain: Math.max(progress.longestChain, chainCount),
                lastModified: Date.now(),
              };
            } else {
              chainCount = 0;
            }

            fallingBlock = null;
          }
        }

        // Update particles
        particles = particles
          .map(p => ({
            ...p,
            x: p.x + p.vx,
            y: p.y + p.vy,
            vy: p.vy + 0.1,
            life: p.life - 1,
          }))
          .filter(p => p.life > 0);

        set({
          rotation,
          targetRotation,
          stacks,
          fallingBlock,
          particles,
          currentSpeed,
          spawnInterval,
          lastSpawnTime,
          nextBlockId,
          nextParticleId,
          chainCount,
          score,
          progress,
        });
      },

      getProgress: () => get().progress,
      setProgress: (data: HextrisProgress) => set({ progress: data }),
    }),
    {
      name: "hextris-game-state",
      partialize: (state) => ({
        progress: state.progress,
      }),
    }
  )
);
