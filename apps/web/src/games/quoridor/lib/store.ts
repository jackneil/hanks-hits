import { create } from "zustand";
import { persist } from "zustand/middleware";
import { defineUntouchedProgress, markSaved, settleOnLoad } from "@/shared/lib/untouchedProgress";
import {
  type Player,
  type Position,
  type Wall,
  type WallOrientation,
  type GameStatus,
  type GameMode,
  type Difficulty,
  WALLS_PER_PLAYER,
  createInitialPositions,
  getOpponent,
  positionsEqual,
  getGoalRow,
} from "./constants";
import {
  type GameLogicState,
  getValidMoves,
  isValidWallPlacement,
  applyPawnMove,
  getGameStatus,
  getShortestPathLength,
  getValidWalls,
} from "./quoridorLogic";

// Progress tracking for persistence
export type QuoridorProgress = {
  [key: string]: unknown;
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  currentWinStreak: number;
  bestWinStreak: number;
  totalWallsPlaced: number;
  totalMovesToWin: number;
  fastestWin: number | null;
  // Settings (synced to cloud)
  difficulty: Difficulty;
  gameMode: GameMode;
  lastModified: number;
};

/** The last thing a player did, so the board can show what the computer did. */
export type LastMove =
  | { player: Player; kind: "move"; from: Position }
  | { player: Player; kind: "wall"; wall: Wall };

// Complete game state
export type GameState = {
  /** Transient recording boundary, never part of saved progress. */
  clipRunId: number;
  // Board state
  positions: Record<Player, Position>;
  walls: Wall[];
  wallsRemaining: Record<Player, number>;
  currentPlayer: Player;
  status: GameStatus;
  lastMove: LastMove | null;

  // UI state: wall mode shows a wall the player moves around, then places.
  wallMode: boolean;
  wallOrientation: WallOrientation;
  wallPreview: Wall | null;

  // Game settings
  gameMode: GameMode;
  difficulty: Difficulty;
  /** The shell's pause menu is open: the computer waits. */
  paused: boolean;

  // Stats for current game
  movesThisGame: number;
  wallsPlacedThisGame: number;

  // Progress tracking
  progress: QuoridorProgress;
};

type GameActions = {
  // Core game actions
  movePawn: (to: Position) => void;
  enterWallMode: (preview?: Wall | null) => void;
  exitWallMode: () => void;
  toggleWallOrientation: () => void;
  setWallPreview: (wall: Wall | null) => void;
  /** Places the wall (or the preview), if it is a valid wall. True when it did. */
  placeWall: (wall?: Wall) => boolean;

  // Game control
  newGame: (mode?: GameMode, difficulty?: Difficulty) => void;
  setGameMode: (mode: GameMode) => void;
  setDifficulty: (difficulty: Difficulty) => void;
  pauseGame: () => void;
  resumeGame: () => void;

  // AI
  /** True while the computer is to move. */
  isComputerTurn: () => boolean;
  /** The computer's move, now (the game waits a moment before it calls this). */
  aiMove: (random?: () => number) => void;

  // Stats
  getProgress: () => QuoridorProgress;
  setProgress: (data: QuoridorProgress) => void;

  // Helpers
  getLogicState: () => GameLogicState;
  /** The squares the player to move can step to (none on the computer's turn). */
  humanMoves: () => Position[];
};

const defaultProgress: QuoridorProgress = {
  gamesPlayed: 0,
  gamesWon: 0,
  gamesLost: 0,
  currentWinStreak: 0,
  bestWinStreak: 0,
  totalWallsPlaced: 0,
  totalMovesToWin: 0,
  fastestWin: null,
  difficulty: "easy",
  gameMode: "ai",
  lastModified: 0, // Untouched until a player action stamps it (shared/lib/progressStamp.ts).
};

// The pickers (difficulty, mode) did not stamp the time before the sync-time fix.
const UNTOUCHED = defineUntouchedProgress("quoridor", {
  defaults: defaultProgress,
  ignore: ["difficulty", "gameMode"],
  // getProgress() adds the pickers, which the save keeps beside progress.
  progressOf: (saved) => ({
    ...(saved.progress as object),
    difficulty: saved.difficulty ?? defaultProgress.difficulty,
    gameMode: saved.gameMode ?? defaultProgress.gameMode,
  }),
});

type BoardState = Omit<GameState, "gameMode" | "difficulty" | "progress">;

function createBoardState(): BoardState {
  return {
    clipRunId: 0,
    positions: createInitialPositions(),
    walls: [],
    wallsRemaining: { 1: WALLS_PER_PLAYER, 2: WALLS_PER_PLAYER },
    currentPlayer: 1,
    status: "playing",
    lastMove: null,
    wallMode: false,
    wallOrientation: "horizontal",
    wallPreview: null,
    paused: false,
    movesThisGame: 0,
    wallsPlacedThisGame: 0,
  };
}

/**
 * The computer's choice: a step along its shortest path, or (medium and
 * hard) sometimes a wall that makes the player's path longer. Easy never
 * places walls.
 */
export function chooseAIMove(
  logic: GameLogicState,
  difficulty: Difficulty,
  random: () => number = Math.random
): { kind: "move"; to: Position } | { kind: "wall"; wall: Wall } | null {
  const validMoves = getValidMoves(logic, 2);
  const aiGoal = getGoalRow(2);
  const playerGoal = getGoalRow(1);

  let bestMove: Position | null = null;
  let bestDist = Infinity;
  for (const move of validMoves) {
    const dist = getShortestPathLength(applyPawnMove(logic.positions, 2, move)[2], aiGoal, logic.walls);
    if (dist < bestDist) {
      bestDist = dist;
      bestMove = move;
    }
  }

  if (difficulty !== "easy" && logic.wallsRemaining[2] > 0) {
    const wallChance = difficulty === "hard" ? 0.7 : 0.4;
    if (random() < wallChance) {
      const playerDist = getShortestPathLength(logic.positions[1], playerGoal, logic.walls);
      // Shuffle for variety, and look at 40 of them (the wall check is a BFS each).
      const walls = getValidWalls(logic, 2)
        .map((wall) => ({ wall, key: random() }))
        .sort((a, b) => a.key - b.key)
        .slice(0, 40)
        .map((entry) => entry.wall);
      const slowing = walls.find(
        (wall) => getShortestPathLength(logic.positions[1], playerGoal, [...logic.walls, wall]) > playerDist
      );
      if (slowing) return { kind: "wall", wall: slowing };
    }
  }

  return bestMove ? { kind: "move", to: bestMove } : null;
}

export const useQuoridorStore = create<GameState & GameActions>()(
  persist(
    (set, get) => {
      /** The game is over: count it (a game against the computer only). */
      const finishGame = (status: GameStatus) => {
        const state = get();
        if (status === "playing") return;
        const wallsPlaced = state.progress.totalWallsPlaced + state.wallsPlacedThisGame;
        // A 2-player game on one phone is the kid against the kid: it counts
        // as a game played, never as a win, a loss or a streak (a win there
        // would put a free win on the leaderboard).
        if (state.gameMode === "local") {
          set({
            progress: {
              ...state.progress,
              gamesPlayed: state.progress.gamesPlayed + 1,
              totalWallsPlaced: wallsPlaced,
              lastModified: Date.now(),
            },
          });
          return;
        }
        if (status === "player1-wins") {
          const streak = state.progress.currentWinStreak + 1;
          set({
            progress: {
              ...state.progress,
              gamesPlayed: state.progress.gamesPlayed + 1,
              gamesWon: state.progress.gamesWon + 1,
              currentWinStreak: streak,
              bestWinStreak: Math.max(state.progress.bestWinStreak, streak),
              totalWallsPlaced: wallsPlaced,
              totalMovesToWin: state.progress.totalMovesToWin + state.movesThisGame,
              fastestWin:
                state.progress.fastestWin === null
                  ? state.movesThisGame
                  : Math.min(state.progress.fastestWin, state.movesThisGame),
              lastModified: Date.now(),
            },
          });
        } else {
          set({
            progress: {
              ...state.progress,
              gamesPlayed: state.progress.gamesPlayed + 1,
              gamesLost: state.progress.gamesLost + 1,
              currentWinStreak: 0,
              totalWallsPlaced: wallsPlaced,
              lastModified: Date.now(),
            },
          });
        }
      };

      /** A player may act: the game is on, and it is not the computer's turn. */
      const humanMayAct = () => {
        const state = get();
        return state.status === "playing" && !state.paused && !get().isComputerTurn();
      };

      return {
        ...createBoardState(),
        gameMode: "ai",
        difficulty: "easy",
        progress: defaultProgress,

        getLogicState: (): GameLogicState => {
          const state = get();
          return {
            positions: state.positions,
            walls: state.walls,
            wallsRemaining: state.wallsRemaining,
          };
        },

        isComputerTurn: () => {
          const state = get();
          return state.gameMode === "ai" && state.currentPlayer === 2 && state.status === "playing";
        },

        humanMoves: () => {
          if (!humanMayAct()) return [];
          return getValidMoves(get().getLogicState(), get().currentPlayer);
        },

        movePawn: (to: Position) => {
          if (!humanMayAct()) return;
          const state = get();
          if (!getValidMoves(state.getLogicState(), state.currentPlayer).some((m) => positionsEqual(m, to))) return;

          const positions = applyPawnMove(state.positions, state.currentPlayer, to);
          const status = getGameStatus(positions);
          set({
            positions,
            currentPlayer: getOpponent(state.currentPlayer),
            status,
            lastMove: { player: state.currentPlayer, kind: "move", from: state.positions[state.currentPlayer] },
            wallMode: false,
            wallPreview: null,
            movesThisGame: state.currentPlayer === 1 ? state.movesThisGame + 1 : state.movesThisGame,
          });
          finishGame(status);
        },

        enterWallMode: (preview = null) => {
          if (!humanMayAct()) return;
          const state = get();
          if (state.wallsRemaining[state.currentPlayer] <= 0) return;
          set({
            wallMode: true,
            wallPreview: preview,
            wallOrientation: preview?.orientation ?? state.wallOrientation,
          });
        },

        exitWallMode: () => {
          set({ wallMode: false, wallPreview: null });
        },

        toggleWallOrientation: () => {
          set((state) => {
            const orientation: WallOrientation = state.wallOrientation === "horizontal" ? "vertical" : "horizontal";
            if (!state.wallPreview) return { wallOrientation: orientation };
            // Turn the wall about its own centre (the same groove crossing).
            const p = state.wallPreview;
            const turned: Wall =
              p.orientation === "horizontal"
                ? { row: p.row - 1, col: p.col + 1, orientation: "vertical" }
                : { row: p.row + 1, col: p.col - 1, orientation: "horizontal" };
            return { wallOrientation: orientation, wallPreview: turned };
          });
        },

        setWallPreview: (wall: Wall | null) => {
          set({ wallPreview: wall });
        },

        placeWall: (wall?: Wall) => {
          if (!humanMayAct()) return false;
          const state = get();
          const target = wall ?? state.wallPreview;
          if (!target) return false;
          if (!isValidWallPlacement(state.getLogicState(), target, state.currentPlayer)) return false;

          set({
            walls: [...state.walls, target],
            wallsRemaining: {
              ...state.wallsRemaining,
              [state.currentPlayer]: state.wallsRemaining[state.currentPlayer] - 1,
            },
            currentPlayer: getOpponent(state.currentPlayer),
            lastMove: { player: state.currentPlayer, kind: "wall", wall: target },
            wallMode: false,
            wallPreview: null,
            wallsPlacedThisGame: state.currentPlayer === 1 ? state.wallsPlacedThisGame + 1 : state.wallsPlacedThisGame,
          });
          return true;
        },

        aiMove: (random = Math.random) => {
          if (!get().isComputerTurn() || get().paused) return;
          const state = get();
          const choice = chooseAIMove(state.getLogicState(), state.difficulty, random);
          if (!choice) return;
          if (choice.kind === "wall") {
            set({
              walls: [...state.walls, choice.wall],
              wallsRemaining: { ...state.wallsRemaining, 2: state.wallsRemaining[2] - 1 },
              currentPlayer: 1,
              lastMove: { player: 2, kind: "wall", wall: choice.wall },
            });
            return;
          }
          const positions = applyPawnMove(state.positions, 2, choice.to);
          const status = getGameStatus(positions);
          set({
            positions,
            currentPlayer: 1,
            status,
            lastMove: { player: 2, kind: "move", from: state.positions[2] },
          });
          finishGame(status);
        },

        newGame: (mode?: GameMode, difficulty?: Difficulty) => {
          const state = get();
          const gameMode = mode ?? state.gameMode;
          const nextDifficulty = difficulty ?? state.difficulty;
          // A new choice (the pickers) is a player's change of the synced
          // settings: it stamps the time. The same choice keeps it.
          const changed = gameMode !== state.gameMode || nextDifficulty !== state.difficulty;
          set({
            ...createBoardState(),
            clipRunId: state.clipRunId + 1,
            wallOrientation: state.wallOrientation,
            gameMode,
            difficulty: nextDifficulty,
            ...(changed
              ? { progress: { ...state.progress, gameMode, difficulty: nextDifficulty, lastModified: Date.now() } }
              : {}),
          });
        },

        // The pickers are on the start card: a new choice is a new game, so
        // the computer is never switched on halfway through its own turn.
        setGameMode: (mode: GameMode) => get().newGame(mode),
        setDifficulty: (difficulty: Difficulty) => get().newGame(undefined, difficulty),

        pauseGame: () => set({ paused: true }),
        resumeGame: () => set({ paused: false }),

        getProgress: () => ({
          ...get().progress,
          difficulty: get().difficulty,
          gameMode: get().gameMode,
        }),
        setProgress: (data: QuoridorProgress) =>
          set({
            progress: data,
            difficulty: data.difficulty ?? get().difficulty,
            gameMode: data.gameMode ?? get().gameMode,
          }),
      };
    },
    {
      name: "quoridor-progress",
      // A save of the code before the sync-time fix gets the real time of
      // its progress. The version stays, so that code still loads a new
      // save (shared/lib/untouchedProgress.ts).
      merge: settleOnLoad(UNTOUCHED),
      partialize: (state) =>
        markSaved({
          progress: state.progress,
          difficulty: state.difficulty,
          gameMode: state.gameMode,
        }),
    }
  )
);
