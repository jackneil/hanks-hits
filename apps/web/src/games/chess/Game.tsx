"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { Chessboard } from "react-chessboard";
import { Square } from "chess.js";
import { useChessStore } from "./lib/store";
import {
  type Difficulty,
  COLORS,
  PIECE_UNICODE,
  getRandomMessage,
} from "./lib/constants";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";

export function ChessGame() {
  const store = useChessStore();
  const [showStats, setShowStats] = useState(false);

  // Sync with auth system
  const { isAuthenticated, syncStatus, forceSync } = useAuthSync({
    appId: "chess",
    localStorageKey: "hank-chess-state",
    getState: () => store.getProgress(),
    setState: (data) => store.setProgress(data),
    debounceMs: 2000,
  });

  // Force save immediately on game end
  useEffect(() => {
    if (["checkmate", "stalemate", "draw", "resigned"].includes(store.status)) {
      forceSync();
    }
  }, [store.status, forceSync]);

  // Board orientation based on player color
  const boardOrientation = store.playerColor === "white" ? "white" : "black";

  // Calculate custom square styles for highlighting
  const customSquareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};

    // Highlight selected square
    if (store.selectedSquare) {
      styles[store.selectedSquare] = {
        backgroundColor: COLORS.SELECTED,
      };
    }

    // Highlight legal moves
    for (const square of store.legalMoves) {
      styles[square] = {
        background: `radial-gradient(circle, ${COLORS.VALID_MOVE}80 25%, transparent 25%)`,
        borderRadius: "50%",
      };
    }

    // Highlight last move
    if (store.lastMove) {
      styles[store.lastMove.from] = {
        ...styles[store.lastMove.from],
        backgroundColor: COLORS.LAST_MOVE,
      };
      styles[store.lastMove.to] = {
        ...styles[store.lastMove.to],
        backgroundColor: COLORS.LAST_MOVE,
      };
    }

    // Highlight king in check
    if (store.kingInCheck) {
      styles[store.kingInCheck] = {
        ...styles[store.kingInCheck],
        backgroundColor: COLORS.CHECK,
      };
    }

    return styles;
  }, [store.selectedSquare, store.legalMoves, store.lastMove, store.kingInCheck]);

  // Handle piece drop (drag and drop)
  const onPieceDrop = useCallback(
    ({ sourceSquare, targetSquare }: { piece: { isSparePiece: boolean; position: string; pieceType: string }; sourceSquare: string; targetSquare: string | null }): boolean => {
      if (!targetSquare) return false;
      return store.makeMove(sourceSquare as Square, targetSquare as Square);
    },
    [store]
  );

  // Handle square click
  const onSquareClick = useCallback(
    ({ square }: { piece: { pieceType: string } | null; square: string }) => {
      store.selectSquare(square as Square);
    },
    [store]
  );

  // Get turn display text
  const getTurnText = () => {
    if (store.status !== "playing") {
      if (store.status === "checkmate") {
        const winner = store.game.turn() === "w" ? "Black" : "White";
        if (store.gameMode === "ai") {
          return winner === (store.playerColor === "white" ? "White" : "Black")
            ? getRandomMessage("win")
            : getRandomMessage("lose");
        }
        return `${winner} wins by checkmate!`;
      }
      if (store.status === "stalemate") return getRandomMessage("draw");
      if (store.status === "draw") return getRandomMessage("draw");
      if (store.status === "resigned") return getRandomMessage("lose");
    }

    if (store.isAIThinking) return "AI is thinking...";

    const turn = store.game.turn() === "w" ? "White" : "Black";
    if (store.game.isCheck()) {
      return `${turn}'s turn - CHECK!`;
    }
    return `${turn}'s turn`;
  };

  // Get piece display for captured pieces
  const getPieceSymbol = (piece: string, color: "w" | "b"): string => {
    const key = `${color}${piece.toUpperCase()}`;
    return PIECE_UNICODE[key] || piece;
  };

  const getDifficultyColor = (d: Difficulty) => {
    switch (d) {
      case "easy":
        return "bg-green-500 hover:bg-green-600";
      case "medium":
        return "bg-yellow-500 hover:bg-yellow-600";
      case "hard":
        return "bg-red-500 hover:bg-red-600";
    }
  };

  // Chessboard options for react-chessboard v5
  const chessboardOptions = useMemo(() => ({
    position: store.fen,
    boardOrientation: boardOrientation as "white" | "black",
    squareStyles: customSquareStyles,
    boardStyle: {
      borderRadius: "8px",
      boxShadow: "0 5px 15px rgba(0,0,0,0.5)",
    },
    darkSquareStyle: { backgroundColor: COLORS.DARK_SQUARE },
    lightSquareStyle: { backgroundColor: COLORS.LIGHT_SQUARE },
    allowDragging: store.status === "playing" && !store.isAIThinking,
    onPieceDrop,
    onSquareClick,
  }), [store.fen, boardOrientation, customSquareStyles, store.status, store.isAIThinking, onPieceDrop, onSquareClick]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-800 to-emerald-950 p-4 flex flex-col items-center justify-center gap-4">
      {/* iOS install prompt */}
      <IOSInstallPrompt />


      <header className="text-center">
        <h1 className="text-4xl font-bold text-white mb-2">Chess</h1>
        <p className="text-emerald-200">Think ahead and capture the king!</p>
      </header>

      {/* Turn indicator */}
      <div
        className={`px-6 py-3 rounded-lg font-bold text-xl text-white ${
          store.status !== "playing"
            ? store.status === "checkmate" &&
              store.game.turn() !== (store.playerColor === "white" ? "w" : "b")
              ? "bg-green-600"
              : "bg-red-600"
            : store.isAIThinking
            ? "bg-yellow-600"
            : store.game.isCheck()
            ? "bg-orange-600"
            : "bg-gray-700"
        }`}
      >
        {getTurnText()}
      </div>

      {/* Captured pieces - opponent's (top) */}
      <div className="w-full max-w-lg flex justify-between text-2xl">
        <div className="flex flex-wrap gap-1 bg-gray-800/50 px-3 py-1 rounded min-h-[2rem]">
          {store.capturedPieces[store.playerColor === "white" ? "black" : "white"]
            .map((p, i) => (
              <span key={i}>{getPieceSymbol(p, store.playerColor === "white" ? "w" : "b")}</span>
            ))}
        </div>
      </div>

      {/* Chess board */}
      <div className="w-full max-w-lg">
        <Chessboard options={chessboardOptions} />
      </div>

      {/* Captured pieces - player's (bottom) */}
      <div className="w-full max-w-lg flex justify-between text-2xl">
        <div className="flex flex-wrap gap-1 bg-gray-800/50 px-3 py-1 rounded min-h-[2rem]">
          {store.capturedPieces[store.playerColor]
            .map((p, i) => (
              <span key={i}>{getPieceSymbol(p, store.playerColor === "white" ? "b" : "w")}</span>
            ))}
        </div>
      </div>

      {/* Game mode selector */}
      <div className="flex gap-2 flex-wrap justify-center">
        <button
          onClick={() => store.newGame({ mode: "ai" })}
          className={`px-5 py-3 rounded-lg font-bold text-white transition-colors touch-manipulation ${
            store.gameMode === "ai" ? "bg-blue-600" : "bg-gray-600 hover:bg-gray-500"
          }`}
        >
          vs AI
        </button>
        <button
          onClick={() => store.newGame({ mode: "local" })}
          className={`px-5 py-3 rounded-lg font-bold text-white transition-colors touch-manipulation ${
            store.gameMode === "local" ? "bg-blue-600" : "bg-gray-600 hover:bg-gray-500"
          }`}
        >
          vs Friend
        </button>
      </div>

      {/* Difficulty selector (only for AI mode) */}
      {store.gameMode === "ai" && (
        <div className="flex gap-2 flex-wrap justify-center">
          {(["easy", "medium", "hard"] as Difficulty[]).map((d) => (
            <button
              key={d}
              onClick={() => {
                store.setDifficulty(d);
                store.newGame({ difficulty: d });
              }}
              className={`px-5 py-3 rounded-lg font-bold text-white transition-colors touch-manipulation ${
                store.difficulty === d ? getDifficultyColor(d) : "bg-gray-600 hover:bg-gray-500"
              }`}
            >
              {d.charAt(0).toUpperCase() + d.slice(1)}
            </button>
          ))}
        </div>
      )}

      {/* Color selector (only for AI mode) */}
      {store.gameMode === "ai" && (
        <div className="flex gap-2 flex-wrap justify-center">
          <button
            onClick={() => store.newGame({ playerColor: "white" })}
            className={`px-5 py-3 rounded-lg font-bold transition-colors touch-manipulation ${
              store.playerColor === "white"
                ? "bg-white text-gray-800"
                : "bg-gray-600 text-white hover:bg-gray-500"
            }`}
          >
            Play as White
          </button>
          <button
            onClick={() => store.newGame({ playerColor: "black" })}
            className={`px-5 py-3 rounded-lg font-bold transition-colors touch-manipulation ${
              store.playerColor === "black"
                ? "bg-gray-900 text-white"
                : "bg-gray-600 text-white hover:bg-gray-500"
            }`}
          >
            Play as Black
          </button>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap justify-center">
        <button
          onClick={() => store.newGame()}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-colors touch-manipulation"
        >
          New Game
        </button>
        <button
          onClick={() => store.undoMove()}
          disabled={store.status !== "playing" || store.game.history().length === 0}
          className="px-6 py-3 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-600 disabled:opacity-50 text-white font-bold rounded-lg transition-colors touch-manipulation"
        >
          Undo
        </button>
        <button
          onClick={() => store.resign()}
          disabled={store.status !== "playing"}
          className="px-6 py-3 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 disabled:opacity-50 text-white font-bold rounded-lg transition-colors touch-manipulation"
        >
          Resign
        </button>
        <button
          onClick={() => setShowStats(!showStats)}
          className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg transition-colors touch-manipulation"
        >
          Stats
        </button>
      </div>

      {/* Stats panel */}
      {showStats && (
        <div className="p-4 bg-gray-800 rounded-lg text-white w-full max-w-lg">
          <h3 className="text-lg font-bold mb-2">Your Stats</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>Games Played: {store.progress.gamesPlayed}</div>
            <div>Games Won: {store.progress.gamesWon}</div>
            <div>Games Lost: {store.progress.gamesLost}</div>
            <div>Games Drawn: {store.progress.gamesDrawn}</div>
            <div>Win Streak: {store.progress.currentWinStreak}</div>
            <div>Best Streak: {store.progress.bestWinStreak}</div>
            <div>Pieces Captured: {store.progress.totalPiecesCaptured}</div>
            <div>Checkmates: {store.progress.totalCheckmates}</div>
          </div>
          <div className="mt-4 border-t border-gray-600 pt-2">
            <h4 className="font-bold mb-1">By Difficulty</h4>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="text-green-400">
                Easy: {store.progress.easyWins}W / {store.progress.easyLosses}L
              </div>
              <div className="text-yellow-400">
                Medium: {store.progress.mediumWins}W / {store.progress.mediumLosses}L
              </div>
              <div className="text-red-400">
                Hard: {store.progress.hardWins}W / {store.progress.hardLosses}L
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Promotion modal */}
      {store.showPromotion && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-xl">
            <h3 className="text-xl font-bold text-white mb-4 text-center">
              Choose a piece
            </h3>
            <div className="flex gap-4">
              {["q", "r", "b", "n"].map((piece) => (
                <button
                  key={piece}
                  onClick={() => store.handlePromotion(piece)}
                  className="w-16 h-16 bg-white hover:bg-gray-200 rounded-lg text-4xl flex items-center justify-center transition-colors"
                >
                  {getPieceSymbol(piece, store.playerColor === "white" ? "w" : "b")}
                </button>
              ))}
            </div>
            <button
              onClick={() => store.cancelPromotion()}
              className="mt-4 w-full py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Game over celebration/message */}
      {store.status !== "playing" && (
        <div
          className={`fixed bottom-4 left-1/2 -translate-x-1/2 px-8 py-4 rounded-xl text-xl font-bold text-white ${
            store.status === "checkmate" &&
            store.game.turn() !== (store.playerColor === "white" ? "w" : "b")
              ? "bg-green-600"
              : "bg-red-600"
          }`}
        >
          {store.status === "checkmate" && (
            <span>
              {store.game.turn() !== (store.playerColor === "white" ? "w" : "b") && store.gameMode === "ai"
                ? "You Win!"
                : store.gameMode === "ai"
                ? "You Lost!"
                : `${store.game.turn() === "w" ? "Black" : "White"} Wins!`}
            </span>
          )}
          {store.status === "stalemate" && <span>Stalemate!</span>}
          {store.status === "draw" && <span>Draw!</span>}
          {store.status === "resigned" && <span>You Resigned</span>}
        </div>
      )}

      {/* Sync status indicator */}
      {isAuthenticated && (
        <div className="fixed bottom-2 right-2 text-xs text-emerald-300/60">
          {syncStatus === "syncing" ? "Saving..." : syncStatus === "synced" ? "Saved" : ""}
        </div>
      )}
    </div>
  );
}

export default ChessGame;
