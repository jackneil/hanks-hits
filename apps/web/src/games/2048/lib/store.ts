import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  type Direction,
  type GameStatus,
  copyGrid,
} from "./constants";
import { stampIfChanged } from "@/shared/lib/progressStamp";
import { defineUntouchedProgress, markSaved, settleOnLoad } from "@/shared/lib/untouchedProgress";
import {
  slideTiles,
  spawnTile,
  hasValidMoves,
  hasWon,
  getHighestTile,
  initializeGrid,
} from "./gameLogic";

// Move history snapshot for undo
type MoveSnapshot = {
  grid: number[][];
  score: number;
};

// Progress saved to localStorage/DB
export type Game2048Progress = {
  highScore: number;
  highestTile: number;
  gamesPlayed: number;
  gamesWon: number;
  lastModified: number;
};

// Current game state
export type GameState = {
  // Grid and tiles
  grid: number[][];

  // Scoring
  score: number;
  highScore: number;

  // Game status
  status: GameStatus;
  keepPlaying: boolean; // Continue after winning

  // Animation tracking
  newTilePosition: { row: number; col: number } | null;
  mergedPositions: { row: number; col: number }[];

  // Undo support
  moveHistory: MoveSnapshot[];
  canUndo: boolean;

  // Stats
  highestTile: number;
  gamesPlayed: number;
  gamesWon: number;

  // Progress for sync
  progress: Game2048Progress;
};

type GameActions = {
  // Game actions
  move: (direction: Direction) => void;
  newGame: () => void;
  undo: () => void;
  continueAfterWin: () => void;

  // Animation helpers
  clearAnimationState: () => void;

  // Progress sync
  getProgress: () => Game2048Progress;
  setProgress: (data: Game2048Progress) => void;
};

const MAX_UNDO_HISTORY = 5;

// Time 0: untouched until a player action stamps it (shared/lib/progressStamp.ts).
const defaultProgress: Game2048Progress = {
  highScore: 0,
  highestTile: 0,
  gamesPlayed: 0,
  gamesWon: 0,
  lastModified: 0,
};

const UNTOUCHED = defineUntouchedProgress("2048", { defaults: defaultProgress });

export const use2048Store = create<GameState & GameActions>()(
  persist(
    (set, get) => ({
      // Initial state
      grid: initializeGrid(),
      score: 0,
      highScore: 0,
      status: "playing",
      keepPlaying: false,
      newTilePosition: null,
      mergedPositions: [],
      moveHistory: [],
      canUndo: false,
      highestTile: 2,
      gamesPlayed: 0,
      gamesWon: 0,
      progress: defaultProgress,

      move: (direction: Direction) => {
        const state = get();

        // Can't move if game over (unless won and keep playing)
        if (state.status === "game-over") return;
        if (state.status === "won" && !state.keepPlaying) return;

        // Slide tiles
        const result = slideTiles(state.grid, direction);

        // If no tiles moved, do nothing
        if (!result.moved) return;

        // Save current state for undo
        const snapshot: MoveSnapshot = {
          grid: copyGrid(state.grid),
          score: state.score,
        };
        const newHistory = [...state.moveHistory, snapshot].slice(-MAX_UNDO_HISTORY);

        // Calculate new score
        const newScore = state.score + result.scoreGained;
        const newHighScore = Math.max(state.highScore, newScore);

        // Spawn new tile
        const spawnResult = spawnTile(result.grid);
        const newGrid = spawnResult ? spawnResult.grid : result.grid;
        const newTilePos = spawnResult ? spawnResult.position : null;

        // Check game status
        const currentHighest = getHighestTile(newGrid);
        let newStatus: GameStatus = state.status;
        let newGamesWon = state.gamesWon;

        // Check for win (only if not already won/continuing)
        if (!state.keepPlaying && state.status !== "won" && hasWon(newGrid)) {
          newStatus = "won";
          newGamesWon = state.gamesWon + 1;
        }
        // Check for game over
        else if (!hasValidMoves(newGrid)) {
          newStatus = "game-over";
        }

        set({
          grid: newGrid,
          score: newScore,
          highScore: newHighScore,
          status: newStatus,
          newTilePosition: newTilePos,
          mergedPositions: result.mergedPositions,
          moveHistory: newHistory,
          canUndo: newHistory.length > 0,
          highestTile: Math.max(state.highestTile, currentHighest),
          gamesWon: newGamesWon,
          // A move that beats no record keeps the time of the last change.
          progress: stampIfChanged(state.progress, {
            highScore: newHighScore,
            highestTile: Math.max(state.highestTile, currentHighest),
            gamesPlayed: state.gamesPlayed,
            gamesWon: newGamesWon,
            lastModified: state.progress.lastModified,
          }),
        });
      },

      newGame: () => {
        const state = get();
        const newGamesPlayed = state.gamesPlayed + 1;

        set({
          grid: initializeGrid(),
          score: 0,
          status: "playing",
          keepPlaying: false,
          newTilePosition: null,
          mergedPositions: [],
          moveHistory: [],
          canUndo: false,
          gamesPlayed: newGamesPlayed,
          progress: {
            ...state.progress,
            gamesPlayed: newGamesPlayed,
            lastModified: Date.now(),
          },
        });
      },

      undo: () => {
        const state = get();

        if (state.moveHistory.length === 0) return;

        const lastSnapshot = state.moveHistory[state.moveHistory.length - 1];
        const newHistory = state.moveHistory.slice(0, -1);

        set({
          grid: lastSnapshot.grid,
          score: lastSnapshot.score,
          status: "playing",
          keepPlaying: state.keepPlaying,
          newTilePosition: null,
          mergedPositions: [],
          moveHistory: newHistory,
          canUndo: newHistory.length > 0,
        });
      },

      continueAfterWin: () => {
        set({
          status: "playing",
          keepPlaying: true,
        });
      },

      clearAnimationState: () => {
        set({
          newTilePosition: null,
          mergedPositions: [],
        });
      },

      getProgress: () => get().progress,

      setProgress: (data: Game2048Progress) => {
        set({
          progress: data,
          highScore: data.highScore,
          highestTile: data.highestTile,
          gamesPlayed: data.gamesPlayed,
          gamesWon: data.gamesWon,
        });
      },
    }),
    {
      name: "2048-game-state",
      // A save of the code before the sync-time fix gets the real time of
      // its progress. The version stays, so that code still loads a new
      // save (shared/lib/untouchedProgress.ts).
      merge: settleOnLoad(UNTOUCHED),
      partialize: (state) => markSaved({
        grid: state.grid,
        score: state.score,
        highScore: state.highScore,
        status: state.status,
        keepPlaying: state.keepPlaying,
        highestTile: state.highestTile,
        gamesPlayed: state.gamesPlayed,
        gamesWon: state.gamesWon,
        progress: state.progress,
      }),
    }
  )
);
