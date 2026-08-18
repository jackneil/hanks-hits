import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Chess, Square, Move } from "chess.js";
import {
  type Difficulty,
  type GameMode,
  type GameStatus,
  AI_CONFIG,
} from "./constants";
import {
  createGame,
  getAIMove,
  getCapturedPieces,
  getLastMove,
  getKingInCheckSquare,
} from "./chessLogic";

export type ChessProgress = {
  [key: string]: unknown;
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  gamesDrawn: number;
  totalPiecesCaptured: number;
  totalCheckmates: number;
  currentWinStreak: number;
  bestWinStreak: number;
  easyWins: number;
  easyLosses: number;
  mediumWins: number;
  mediumLosses: number;
  hardWins: number;
  hardLosses: number;
  // Settings (synced to cloud)
  difficulty: Difficulty;
  gameMode: GameMode;
  playerColor: "white" | "black";
  lastModified: number;
};

export type GameState = {
  // Chess.js instance (not persisted)
  game: Chess;
  fen: string;

  // Game settings
  gameMode: GameMode;
  difficulty: Difficulty;
  playerColor: "white" | "black";

  // Game state
  status: GameStatus;
  isAIThinking: boolean;
  selectedSquare: Square | null;
  legalMoves: Square[];
  lastMove: { from: Square; to: Square } | null;
  kingInCheck: Square | null;
  capturedPieces: { white: string[]; black: string[] };

  // UI state
  message: string | null;
  showPromotion: boolean;
  pendingPromotion: { from: Square; to: Square } | null;

  // Progress tracking
  progress: ChessProgress;

  // Identifies the active board so delayed AI work cannot mutate a newer game.
  gameGeneration: number;
};

type GameActions = {
  // Game actions
  selectSquare: (square: Square) => void;
  makeMove: (from: Square, to: Square, promotion?: string) => boolean;
  handlePromotion: (piece: string) => void;
  cancelPromotion: () => void;
  triggerAIMove: () => void;
  undoMove: () => void;

  // Game control
  newGame: (options?: { mode?: GameMode; difficulty?: Difficulty; playerColor?: "white" | "black" }) => void;
  setDifficulty: (difficulty: Difficulty) => void;
  setGameMode: (mode: GameMode) => void;
  resign: () => void;

  // Progress
  recordWin: () => void;
  recordLoss: () => void;
  recordDraw: () => void;
  getProgress: () => ChessProgress;
  setProgress: (data: ChessProgress) => void;

  // Helpers
  clearMessage: () => void;
  updateGameState: () => void;
};

const defaultProgress: ChessProgress = {
  gamesPlayed: 0,
  gamesWon: 0,
  gamesLost: 0,
  gamesDrawn: 0,
  totalPiecesCaptured: 0,
  totalCheckmates: 0,
  currentWinStreak: 0,
  bestWinStreak: 0,
  easyWins: 0,
  easyLosses: 0,
  mediumWins: 0,
  mediumLosses: 0,
  hardWins: 0,
  hardLosses: 0,
  difficulty: "easy",
  gameMode: "ai",
  playerColor: "white",
  lastModified: Date.now(),
};

export const useChessStore = create<GameState & GameActions>()(
  persist(
    (set, get) => ({
      // Initial state
      game: createGame(),
      fen: new Chess().fen(),
      gameMode: "ai",
      difficulty: "easy",
      playerColor: "white",
      status: "playing",
      isAIThinking: false,
      selectedSquare: null,
      legalMoves: [],
      lastMove: null,
      kingInCheck: null,
      capturedPieces: { white: [], black: [] },
      message: null,
      showPromotion: false,
      pendingPromotion: null,
      progress: defaultProgress,
      gameGeneration: 0,

      selectSquare: (square) => {
        const state = get();
        if (state.status !== "playing" || state.isAIThinking) return;
        if (state.showPromotion) return;

        const game = state.game;
        const turn = game.turn();
        const playerTurn = state.gameMode === "local" ||
          (state.playerColor === "white" ? turn === "w" : turn === "b");

        if (!playerTurn) return;

        // If clicking on a legal move destination
        if (state.selectedSquare && state.legalMoves.includes(square)) {
          get().makeMove(state.selectedSquare, square);
          return;
        }

        // Try to select a piece
        const piece = game.get(square);
        if (piece && piece.color === turn) {
          const moves = game.moves({ square, verbose: true });
          set({
            selectedSquare: square,
            legalMoves: moves.map((m) => m.to),
          });
        } else {
          set({ selectedSquare: null, legalMoves: [] });
        }
      },

      makeMove: (from, to, promotion) => {
        const state = get();
        const game = state.game;

        // Check if this is a pawn promotion
        const piece = game.get(from);
        if (piece?.type === "p") {
          const targetRank = piece.color === "w" ? "8" : "1";
          if (to.endsWith(targetRank) && !promotion) {
            set({
              showPromotion: true,
              pendingPromotion: { from, to },
            });
            return false;
          }
        }

        try {
          const move = game.move({ from, to, promotion: promotion || undefined });
          if (move) {
            get().updateGameState();

            // Check for captures
            if (move.captured) {
              set((s) => ({
                progress: {
                  ...s.progress,
                  totalPiecesCaptured: s.progress.totalPiecesCaptured + 1,
                },
              }));
            }

            // Check game end conditions
            if (game.isCheckmate()) {
              const winner = game.turn() === "w" ? "black" : "white";
              set({ status: "checkmate" });
              if (state.gameMode === "ai") {
                if (winner === state.playerColor) {
                  get().recordWin();
                } else {
                  get().recordLoss();
                }
              }
            } else if (game.isStalemate()) {
              set({ status: "stalemate" });
              if (state.gameMode === "ai") {
                get().recordDraw();
              }
            } else if (game.isDraw()) {
              set({ status: "draw" });
              if (state.gameMode === "ai") {
                get().recordDraw();
              }
            } else if (state.gameMode === "ai") {
              // Trigger AI move if it's AI's turn
              const aiColor = state.playerColor === "white" ? "b" : "w";
              if (game.turn() === aiColor) {
                setTimeout(() => get().triggerAIMove(), AI_CONFIG.MOVE_DELAY_MS);
              }
            }

            return true;
          }
        } catch {
          // Invalid move
        }
        return false;
      },

      handlePromotion: (piece) => {
        const state = get();
        if (!state.pendingPromotion) return;

        const { from, to } = state.pendingPromotion;
        set({
          showPromotion: false,
          pendingPromotion: null,
        });
        get().makeMove(from, to, piece);
      },

      cancelPromotion: () => {
        set({
          showPromotion: false,
          pendingPromotion: null,
        });
      },

      triggerAIMove: () => {
        const state = get();
        if (state.status !== "playing") return;
        const scheduledGeneration = state.gameGeneration;

        set({ isAIThinking: true });

        setTimeout(() => {
          const currentState = get();
          if (
            currentState.gameGeneration !== scheduledGeneration ||
            currentState.status !== "playing" ||
            currentState.gameMode !== "ai"
          ) {
            return;
          }

          const game = currentState.game;
          const aiColor = currentState.playerColor === "white" ? "b" : "w";
          if (game.turn() !== aiColor) {
            set({ isAIThinking: false });
            return;
          }
          const aiMove = getAIMove(game, currentState.difficulty);

          if (!aiMove) {
            set({ isAIThinking: false });
            return;
          }

          try {
            game.move(aiMove);
            get().updateGameState();

            // Check game end
            if (game.isCheckmate()) {
              set({ status: "checkmate" });
              get().recordLoss();
            } else if (game.isStalemate()) {
              set({ status: "stalemate" });
              get().recordDraw();
            } else if (game.isDraw()) {
              set({ status: "draw" });
              get().recordDraw();
            }
          } catch {
            // AI move failed
          }

          set({ isAIThinking: false });
        }, 300);
      },

      undoMove: () => {
        const state = get();
        if (state.status !== "playing") return;

        const game = state.game;

        // In AI mode, undo twice (player + AI move)
        if (state.gameMode === "ai" && game.history().length >= 2) {
          game.undo();
          game.undo();
        } else if (state.gameMode === "local" && game.history().length >= 1) {
          game.undo();
        }

        get().updateGameState();
      },

      newGame: (options) => {
        const state = get();
        const mode = options?.mode ?? state.gameMode;
        const difficulty = options?.difficulty ?? state.difficulty;
        const playerColor = options?.playerColor ?? state.playerColor;

        const newGameInstance = createGame();

        set({
          game: newGameInstance,
          fen: newGameInstance.fen(),
          gameMode: mode,
          difficulty,
          playerColor,
          status: "playing",
          isAIThinking: false,
          selectedSquare: null,
          legalMoves: [],
          lastMove: null,
          kingInCheck: null,
          capturedPieces: { white: [], black: [] },
          message: null,
          showPromotion: false,
          pendingPromotion: null,
          gameGeneration: state.gameGeneration + 1,
        });

        // If player is black, AI moves first
        if (mode === "ai" && playerColor === "black") {
          setTimeout(() => get().triggerAIMove(), AI_CONFIG.MOVE_DELAY_MS);
        }
      },

      setDifficulty: (difficulty) => set({ difficulty }),
      setGameMode: (mode) => set({ gameMode: mode }),

      resign: () => {
        const state = get();
        if (state.status !== "playing") return;

        set({ status: "resigned" });
        if (state.gameMode === "ai") {
          get().recordLoss();
        }
      },

      recordWin: () => {
        set((state) => {
          const diff = state.difficulty;
          const newStreak = state.progress.currentWinStreak + 1;
          const diffWinKey = `${diff}Wins` as keyof ChessProgress;
          return {
            progress: {
              ...state.progress,
              gamesPlayed: state.progress.gamesPlayed + 1,
              gamesWon: state.progress.gamesWon + 1,
              totalCheckmates: state.progress.totalCheckmates + 1,
              currentWinStreak: newStreak,
              bestWinStreak: Math.max(state.progress.bestWinStreak, newStreak),
              [diffWinKey]: (state.progress[diffWinKey] as number) + 1,
              lastModified: Date.now(),
            },
          };
        });
      },

      recordLoss: () => {
        set((state) => {
          const diff = state.difficulty;
          const diffLossKey = `${diff}Losses` as keyof ChessProgress;
          return {
            progress: {
              ...state.progress,
              gamesPlayed: state.progress.gamesPlayed + 1,
              gamesLost: state.progress.gamesLost + 1,
              currentWinStreak: 0,
              [diffLossKey]: (state.progress[diffLossKey] as number) + 1,
              lastModified: Date.now(),
            },
          };
        });
      },

      recordDraw: () => {
        set((state) => ({
          progress: {
            ...state.progress,
            gamesPlayed: state.progress.gamesPlayed + 1,
            gamesDrawn: state.progress.gamesDrawn + 1,
            lastModified: Date.now(),
          },
        }));
      },

      getProgress: () => ({
        ...get().progress,
        difficulty: get().difficulty,
        gameMode: get().gameMode,
        playerColor: get().playerColor,
      }),
      setProgress: (data) => set({
        progress: data,
        difficulty: data.difficulty ?? get().difficulty,
        gameMode: data.gameMode ?? get().gameMode,
        playerColor: data.playerColor ?? get().playerColor,
      }),

      clearMessage: () => set({ message: null }),

      updateGameState: () => {
        const game = get().game;
        set({
          fen: game.fen(),
          lastMove: getLastMove(game),
          kingInCheck: getKingInCheckSquare(game),
          capturedPieces: getCapturedPieces(game),
          selectedSquare: null,
          legalMoves: [],
        });
      },
    }),
    {
      name: "hank-chess-state",
      partialize: (state) => ({
        progress: state.progress,
        difficulty: state.difficulty,
        gameMode: state.gameMode,
        playerColor: state.playerColor,
      }),
    }
  )
);
