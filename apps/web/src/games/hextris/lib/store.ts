import { bindPersistedStore } from "@/lib/owner-bound-progress";
import { createOwnerPersistStorage } from "@/lib/owner-bound-progress/persistStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { stampIfChanged } from "@/shared/lib/progressStamp";
import { defineUntouchedProgress, markSaved, settleOnLoad } from "@/shared/lib/untouchedProgress";
import {
  type GameStatus,
  type Block,
  type FallingBlock,
  type Particle,
  type BlockColor,
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
import { playSound } from "./sounds";

/** One step of the shared fixed-step loop, in ms (60 steps a second). */
const FRAME_MS = 1000 / 60;

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
  /**
   * Game time since the last block, in ms. It counts only while the loop
   * steps, so a pause, the shell's hold or a hidden tab never brings a
   * block early. (It used Date.now(): time under a hold still counted.)
   */
  spawnClock: number;

  // Runs (clips and the result card)
  /** Goes up by one at each start, so a restart is a new run. */
  runId: number;
  /** The best score when this run started: the score to beat. */
  runStartBest: number;
  /** The run that just ended beat the best from before it. */
  lastRunNewBest: boolean;

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

  /** One step of game time (the shared fixed-step loop gives 1000 / 60 ms). */
  update: (stepMs: number) => void;

  getProgress: () => HextrisProgress;
  setProgress: (data: HextrisProgress) => void;
};

const defaultProgress: HextrisProgress = {
  highScore: 0,
  gamesPlayed: 0,
  totalBlocksMatched: 0,
  longestChain: 0,
  soundEnabled: true,
  lastModified: 0, // Untouched until a player action stamps it (shared/lib/progressStamp.ts).
};

// Settings are not progress: a device that changed only a setting holds
// nothing that must win over the account (shared/lib/untouchedProgress.ts).
const UNTOUCHED = defineUntouchedProgress("hextris", { defaults: defaultProgress, ignore: ["soundEnabled"] });

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
    spawnClock: 0,
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
      runId: 0,
      runStartBest: 0,
      lastRunNewBest: false,
      progress: defaultProgress,

      startGame: () => {
        const state = get();
        set({
          ...createInitialState(),
          status: "playing",
          runId: state.runId + 1,
          runStartBest: state.progress.highScore,
          lastRunNewBest: false,
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
          set({ status: "playing" });
        }
      },

      gameOver: () => {
        const state = get();
        playSound("game-over");

        set({
          status: "game-over",
          lastRunNewBest: state.score > state.runStartBest,
          progress: stampIfChanged(state.progress, {
            ...state.progress,
            highScore: Math.max(state.progress.highScore, state.score),
          }),
        });
      },

      rotateLeft: () => {
        const state = get();
        if (state.status !== "playing") return;

        playSound("rotate");
        set({ targetRotation: state.targetRotation - Math.PI / 3 });
      },

      rotateRight: () => {
        const state = get();
        if (state.status !== "playing") return;

        playSound("rotate");
        set({ targetRotation: state.targetRotation + Math.PI / 3 });
      },

      update: (stepMs: number) => {
        const state = get();
        if (state.status !== "playing") return;

        // The old loop called this once per screen frame with a nudge for
        // the frame time, but moved the block a whole `speed` per call: on
        // a 120 Hz screen blocks fell twice as fast. Every motion now scales
        // with the step (1 at 60 steps a second).
        const dt = stepMs / FRAME_MS;
        let {
          rotation,
          stacks,
          fallingBlock,
          particles,
          currentSpeed,
          spawnInterval,
          spawnClock,
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
          rotation += rotationDiff * Math.min(1, ROTATION_SPEED * dt);
        } else {
          rotation = targetRotation;
        }

        // Spawn new block if needed
        spawnClock += stepMs;
        if (!fallingBlock && spawnClock > spawnInterval) {
          fallingBlock = createFallingBlock(nextBlockId++, currentSpeed);
          spawnClock = 0;

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
              x: fallingBlock.x + (dx / dist) * Math.min(dist, fallingBlock.speed * dt),
              y: fallingBlock.y + (dy / dist) * Math.min(dist, fallingBlock.speed * dt),
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
            playSound("land");
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
                spawnClock,
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
              playSound("match");

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
            x: p.x + p.vx * dt,
            y: p.y + p.vy * dt,
            vy: p.vy + 0.1 * dt,
            life: p.life - dt,
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
          spawnClock,
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
      storage: createOwnerPersistStorage("hextris-game-state", "hextris"),
      skipHydration: true,
      name: "hextris-game-state",
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

bindPersistedStore("hextris-game-state", useHextrisStore.persist, () => useHextrisStore.setState({}));
