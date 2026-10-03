import { create } from "zustand";
import { persist } from "zustand/middleware";
import { sameProgress } from "@/shared/lib/progressStamp";
import { defineUntouchedProgress, markSaved, settleOnLoad } from "@/shared/lib/untouchedProgress";
import {
  type PieceType,
  type Player,
  type Position,
  type Move,
  type Difficulty,
  type GameStatus,
  type GameVariant,
  type GameMode,
  type RuleSet,
  RULE_SETS,
  createInitialBoard,
  getOpponent,
  positionsEqual,
  getDefaultRuleSet,
} from "./constants";
import {
  getValidMovesForPiece,
  executeMove,
  checkGameStatus,
  getSelectablePieces,
} from "./gameLogic";
import { getAIMove } from "./ai";

export type CheckersProgress = {
  [key: string]: unknown;
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  totalPiecesCaptured: number;
  totalKingsEarned: number;
  longestJumpChain: number;
  currentWinStreak: number;
  bestWinStreak: number;
  easyWins: number;
  easyLosses: number;
  mediumWins: number;
  mediumLosses: number;
  hardWins: number;
  hardLosses: number;
  // 2-player stats
  twoPlayerGamesPlayed: number;
  twoPlayerRedWins: number;
  twoPlayerBlackWins: number;
  // Settings (synced to cloud)
  difficulty: Difficulty;
  variant: GameVariant;
  gameMode: GameMode;
  lastModified: number;
};

export type GameState = {
  /** Transient recording boundary, never part of saved progress. */
  clipRunId: number;
  board: PieceType[][];
  currentPlayer: Player;
  selectedPiece: Position | null;
  validMoves: Move[];
  lastMove: Move | null;
  status: GameStatus;
  difficulty: Difficulty;
  /** The shell's pause menu is open: the computer waits. */
  paused: boolean;
  piecesCapturedThisGame: number;
  kingsEarnedThisGame: number;
  longestChainThisGame: number;
  progress: CheckersProgress;
  // New for variants and 2-player
  rules: RuleSet;
  gameMode: GameMode;
};

type GameActions = {
  selectPiece: (pos: Position) => void;
  makeMove: (to: Position) => void;
  newGame: (options?: { difficulty?: Difficulty; variant?: GameVariant; mode?: GameMode }) => void;
  setDifficulty: (difficulty: Difficulty) => void;
  setVariant: (variant: GameVariant) => void;
  setGameMode: (mode: GameMode) => void;
  pauseGame: () => void;
  resumeGame: () => void;
  /** True while the computer is to move. */
  isComputerTurn: () => boolean;
  /**
   * The computer's move, now. The game calls it after a short wait, from a
   * timer that belongs to that turn: a new game or a pause cancels it.
   */
  aiMove: () => void;
  recordWin: (winner: Player) => void;
  getProgress: () => CheckersProgress;
  setProgress: (data: CheckersProgress) => void;
};

const defaultProgress: CheckersProgress = {
  gamesPlayed: 0,
  gamesWon: 0,
  gamesLost: 0,
  totalPiecesCaptured: 0,
  totalKingsEarned: 0,
  longestJumpChain: 0,
  currentWinStreak: 0,
  bestWinStreak: 0,
  easyWins: 0,
  easyLosses: 0,
  mediumWins: 0,
  mediumLosses: 0,
  hardWins: 0,
  hardLosses: 0,
  twoPlayerGamesPlayed: 0,
  twoPlayerRedWins: 0,
  twoPlayerBlackWins: 0,
  difficulty: "easy",
  variant: "american",
  gameMode: "vs-ai",
  lastModified: 0, // Untouched until a player action stamps it (shared/lib/progressStamp.ts).
};

// The difficulty picker did not stamp the time before the sync-time fix.
// getProgress() adds the difficulty, which the save keeps beside progress.
const UNTOUCHED = defineUntouchedProgress("checkers", {
  defaults: defaultProgress,
  ignore: ["difficulty", "variant", "gameMode"],
  progressOf: (saved) => ({
    ...defaultProgress,
    ...(saved.progress as object),
    difficulty: saved.difficulty ?? defaultProgress.difficulty,
  }),
});

export const useCheckersStore = create<GameState & GameActions>()(
  persist(
    (set, get) => ({
      clipRunId: 0,
      board: createInitialBoard(),
      currentPlayer: "red",
      selectedPiece: null,
      validMoves: [],
      lastMove: null,
      status: "playing",
      difficulty: "easy",
      paused: false,
      piecesCapturedThisGame: 0,
      kingsEarnedThisGame: 0,
      longestChainThisGame: 0,
      progress: defaultProgress,
      rules: getDefaultRuleSet(),
      gameMode: "vs-ai",

      isComputerTurn: () => {
        const state = get();
        return state.gameMode === "vs-ai" && state.currentPlayer === "black" && state.status === "playing";
      },

      selectPiece: (pos) => {
        const state = get();
        if (state.status !== "playing" || state.paused) return;

        // In AI mode, only human player (red) can select
        // In 2-player mode, current player can select their pieces
        if (state.gameMode === "vs-ai" && state.currentPlayer !== "red") return;

        const piece = state.board[pos.row][pos.col];
        // Check piece belongs to current player
        const playerPrefix = state.currentPlayer;
        if (!piece || !piece.startsWith(playerPrefix)) return;

        const selectables = getSelectablePieces(state.board, state.currentPlayer, state.rules);
        if (!selectables.some((p) => positionsEqual(p, pos))) return;

        const moves = getValidMovesForPiece(state.board, pos.row, pos.col, state.rules);
        set({ selectedPiece: pos, validMoves: moves });
      },

      makeMove: (to) => {
        const state = get();
        if (!state.selectedPiece || state.status !== "playing" || state.paused || get().isComputerTurn()) return;
        const move = state.validMoves.find((m) => positionsEqual(m.to, to));
        if (!move) return;

        const newBoard = executeMove(state.board, move);
        const capturesCount = move.captures.length;
        const newCaptured = state.piecesCapturedThisGame + capturesCount;
        const newLongestChain = Math.max(state.longestChainThisGame, capturesCount);

        let newKingsEarned = state.kingsEarnedThisGame;
        const landedPiece = newBoard[move.to.row][move.to.col];
        const originalPiece = state.board[move.from.row][move.from.col];
        if (landedPiece && landedPiece.includes("king") && originalPiece && !originalPiece.includes("king")) {
          newKingsEarned++;
        }

        const nextPlayer = getOpponent(state.currentPlayer);
        const newStatus = checkGameStatus(newBoard, nextPlayer, state.rules);

        set({
          board: newBoard,
          currentPlayer: nextPlayer,
          selectedPiece: null,
          validMoves: [],
          lastMove: move,
          status: newStatus,
          piecesCapturedThisGame: newCaptured,
          kingsEarnedThisGame: newKingsEarned,
          longestChainThisGame: newLongestChain,
        });

        // Handle game over (the computer's turn is the game's own timer)
        if (newStatus !== "playing") {
          const winner = newStatus === "red-wins" ? "red" : "black";
          get().recordWin(winner);
        }
      },

      aiMove: () => {
        if (!get().isComputerTurn() || get().paused) return;
        const state = get();
        const move = getAIMove(state.board, "black", state.difficulty, state.rules);
        if (!move) {
          // No moves: the game is over.
          const status = checkGameStatus(state.board, "black", state.rules);
          set({ status });
          if (status === "red-wins" || status === "black-wins") get().recordWin(status === "red-wins" ? "red" : "black");
          return;
        }
        const board = executeMove(state.board, move);
        const status = checkGameStatus(board, "red", state.rules);
        set({ board, currentPlayer: "red", lastMove: move, status, selectedPiece: null, validMoves: [] });
        if (status === "red-wins" || status === "black-wins") get().recordWin(status === "red-wins" ? "red" : "black");
      },

      newGame: (options) => {
        const state = get();
        const newVariant = options?.variant ?? state.progress.variant;
        const newMode = options?.mode ?? state.gameMode;
        const newDifficulty = options?.difficulty ?? state.difficulty;
        // A new choice (the pickers) is a player's change of the synced
        // settings: it stamps the time. The same choice keeps it.
        const synced = state.getProgress();
        const chosen = { ...synced, difficulty: newDifficulty, variant: newVariant, gameMode: newMode };
        const progress = sameProgress(synced, chosen, ["lastModified"])
          ? state.progress
          : { ...state.progress, difficulty: newDifficulty, variant: newVariant, gameMode: newMode, lastModified: Date.now() };

        set({
          clipRunId: get().clipRunId + 1,
          progress,
          board: createInitialBoard(),
          currentPlayer: "red",
          selectedPiece: null,
          validMoves: [],
          lastMove: null,
          status: "playing",
          difficulty: newDifficulty,
          paused: false,
          piecesCapturedThisGame: 0,
          kingsEarnedThisGame: 0,
          longestChainThisGame: 0,
          rules: RULE_SETS[newVariant],
          gameMode: newMode,
        });
      },

      // The pickers are on the start card: a new choice is a new game, so
      // the rules never change and the computer is never switched on in
      // the middle of one.
      setDifficulty: (difficulty) => get().newGame({ difficulty }),

      setVariant: (variant) => get().newGame({ variant }),

      setGameMode: (mode) => get().newGame({ mode }),

      pauseGame: () => set({ paused: true }),
      resumeGame: () => set({ paused: false }),

      recordWin: (winner: Player) => {
        const state = get();

        if (state.gameMode === "vs-ai") {
          // AI mode: red = human
          if (winner === "red") {
            // Human won
            const diff = state.difficulty;
            const newStreak = state.progress.currentWinStreak + 1;
            const diffKey = `${diff}Wins` as keyof CheckersProgress;
            set({
              progress: {
                ...state.progress,
                gamesPlayed: state.progress.gamesPlayed + 1,
                gamesWon: state.progress.gamesWon + 1,
                totalPiecesCaptured: state.progress.totalPiecesCaptured + state.piecesCapturedThisGame,
                totalKingsEarned: state.progress.totalKingsEarned + state.kingsEarnedThisGame,
                longestJumpChain: Math.max(state.progress.longestJumpChain, state.longestChainThisGame),
                currentWinStreak: newStreak,
                bestWinStreak: Math.max(state.progress.bestWinStreak, newStreak),
                [diffKey]: (state.progress[diffKey] as number) + 1,
                lastModified: Date.now(),
              },
            });
          } else {
            // Human lost (AI won)
            const diff = state.difficulty;
            const diffKey = `${diff}Losses` as keyof CheckersProgress;
            set({
              progress: {
                ...state.progress,
                gamesPlayed: state.progress.gamesPlayed + 1,
                gamesLost: state.progress.gamesLost + 1,
                totalPiecesCaptured: state.progress.totalPiecesCaptured + state.piecesCapturedThisGame,
                totalKingsEarned: state.progress.totalKingsEarned + state.kingsEarnedThisGame,
                longestJumpChain: Math.max(state.progress.longestJumpChain, state.longestChainThisGame),
                currentWinStreak: 0,
                [diffKey]: (state.progress[diffKey] as number) + 1,
                lastModified: Date.now(),
              },
            });
          }
        } else {
          // 2-player mode
          set({
            progress: {
              ...state.progress,
              twoPlayerGamesPlayed: state.progress.twoPlayerGamesPlayed + 1,
              twoPlayerRedWins: state.progress.twoPlayerRedWins + (winner === "red" ? 1 : 0),
              twoPlayerBlackWins: state.progress.twoPlayerBlackWins + (winner === "black" ? 1 : 0),
              lastModified: Date.now(),
            },
          });
        }
      },

      getProgress: () => ({
        ...get().progress,
        difficulty: get().difficulty,
        variant: get().rules.variant,
        gameMode: get().gameMode,
      }),
      setProgress: (data) =>
        set({
          progress: {
            ...defaultProgress,
            ...data,
          },
          difficulty: data.difficulty ?? get().difficulty,
          rules: RULE_SETS[data.variant ?? "american"],
          gameMode: data.gameMode ?? get().gameMode,
        }),
    }),
    {
      name: "checkers-progress",
      version: 2,
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as Partial<{ progress: Partial<CheckersProgress>; difficulty: Difficulty }>;
        if (version < 2) {
          // Migrate from v1 to v2: add new fields
          return {
            ...state,
            progress: {
              ...defaultProgress,
              ...state.progress,
              twoPlayerGamesPlayed: 0,
              twoPlayerRedWins: 0,
              twoPlayerBlackWins: 0,
              variant: "american" as GameVariant,
              gameMode: "vs-ai" as GameMode,
            },
          };
        }
        return state;
      },
      partialize: (state) =>
        markSaved({
          progress: state.progress,
          difficulty: state.difficulty,
        }),
      // The saved rules and mode live in progress: a reload starts the
      // board with them (it started American vs the computer, whatever the
      // kid had picked, until the next New Game). A save of the code before
      // the sync-time fix first gets the real time of its progress; the
      // version stays, so that code still loads a new save
      // (shared/lib/untouchedProgress.ts).
      merge: settleOnLoad<GameState & GameActions>(UNTOUCHED, (persisted, current) => {
        const saved = persisted as Partial<Pick<GameState, "progress" | "difficulty">> | undefined;
        const progress = { ...defaultProgress, ...current.progress, ...saved?.progress };
        return {
          ...current,
          ...saved,
          progress,
          rules: RULE_SETS[progress.variant] ?? getDefaultRuleSet(),
          gameMode: progress.gameMode === "vs-friend" ? "vs-friend" : "vs-ai",
        };
      }),
    }
  )
);
