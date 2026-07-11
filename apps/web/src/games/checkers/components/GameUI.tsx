"use client";

import { useState } from "react";
import { type Difficulty, type GameVariant, COLORS, RULE_SETS } from "../lib/constants";
import { countPieces } from "../lib/gameLogic";
import { useCheckersStore } from "../lib/store";

export function GameUI() {
  const board = useCheckersStore((s) => s.board);
  const currentPlayer = useCheckersStore((s) => s.currentPlayer);
  const status = useCheckersStore((s) => s.status);
  const difficulty = useCheckersStore((s) => s.difficulty);
  const isAIThinking = useCheckersStore((s) => s.isAIThinking);
  const progress = useCheckersStore((s) => s.progress);
  const rules = useCheckersStore((s) => s.rules);
  const gameMode = useCheckersStore((s) => s.gameMode);
  const newGame = useCheckersStore((s) => s.newGame);
  const setDifficulty = useCheckersStore((s) => s.setDifficulty);
  const setVariant = useCheckersStore((s) => s.setVariant);
  const setGameMode = useCheckersStore((s) => s.setGameMode);

  const pieces = countPieces(board);
  const [showStats, setShowStats] = useState(false);

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

  const getVariantColor = (v: GameVariant) => {
    if (rules.variant === v) {
      switch (v) {
        case "american":
          return "bg-blue-600";
        case "casual":
          return "bg-green-600";
        case "brazilian":
          return "bg-orange-600";
        case "suicide":
          return "bg-purple-600";
      }
    }
    return "bg-gray-600 hover:bg-gray-500";
  };

  // Get turn indicator text
  const getTurnText = () => {
    if (status !== "playing") {
      if (rules.invertedWinCondition) {
        // Suicide mode - different messaging
        return status === "red-wins" ? "Red Lost All Pieces!" : "Black Lost All Pieces!";
      }
      return status === "red-wins" ? "Red Wins!" : "Black Wins!";
    }

    if (isAIThinking) return "AI Thinking...";

    if (gameMode === "vs-friend") {
      return currentPlayer === "red" ? "Red's Turn" : "Black's Turn";
    } else {
      return currentPlayer === "red" ? "Your Turn!" : "...";
    }
  };

  // Get win message
  const getWinMessage = () => {
    if (rules.invertedWinCondition) {
      // Suicide mode
      if (gameMode === "vs-ai") {
        return status === "red-wins" ? "You Won! (Lost all pieces)" : "AI Won! (Lost all pieces)";
      } else {
        return status === "red-wins" ? "Red Wins! (Lost all pieces)" : "Black Wins! (Lost all pieces)";
      }
    }

    if (gameMode === "vs-ai") {
      return status === "red-wins" ? "Congratulations! You won!" : "Better luck next time!";
    } else {
      return status === "red-wins" ? "Red Wins!" : "Black Wins!";
    }
  };

  return (
    <div className="w-full max-w-lg mx-auto space-y-4">
      {/* Turn indicator */}
      <div className="flex items-center justify-center gap-4 py-3 px-4 bg-gray-800 rounded-lg">
        <div
          className={`flex items-center gap-2 px-3 py-1 rounded ${currentPlayer === "red" ? "bg-red-600" : "bg-gray-700"}`}
        >
          <div className="w-4 h-4 rounded-full" style={{ backgroundColor: COLORS.RED_PIECE }} />
          <span className="font-bold text-white">{pieces.red}</span>
        </div>

        <div className="text-white font-bold text-lg">{getTurnText()}</div>

        <div
          className={`flex items-center gap-2 px-3 py-1 rounded ${currentPlayer === "black" ? "bg-slate-600" : "bg-gray-700"}`}
        >
          <div className="w-4 h-4 rounded-full" style={{ backgroundColor: COLORS.BLACK_PIECE }} />
          <span className="font-bold text-white">{pieces.black}</span>
        </div>
      </div>

      {/* Game Mode Selector */}
      <div className="flex gap-2 justify-center">
        <button
          onClick={() => setGameMode("vs-ai")}
          className={`px-5 py-3 rounded-lg font-bold text-white transition-colors touch-manipulation ${
            gameMode === "vs-ai" ? "bg-blue-600" : "bg-gray-600 hover:bg-gray-500"
          }`}
        >
          vs AI
        </button>
        <button
          onClick={() => setGameMode("vs-friend")}
          className={`px-5 py-3 rounded-lg font-bold text-white transition-colors touch-manipulation ${
            gameMode === "vs-friend" ? "bg-orange-600" : "bg-gray-600 hover:bg-gray-500"
          }`}
        >
          vs Friend
        </button>
      </div>

      {/* Variant Selector */}
      <div className="flex gap-2 justify-center flex-wrap">
        {(Object.keys(RULE_SETS) as GameVariant[]).map((v) => (
          <button
            key={v}
            onClick={() => setVariant(v)}
            title={RULE_SETS[v].description}
            className={`min-h-[44px] px-4 py-2 rounded-lg font-bold text-white transition-colors touch-manipulation text-sm ${getVariantColor(v)}`}
          >
            {RULE_SETS[v].displayName}
          </button>
        ))}
      </div>

      {/* Rules hint */}
      <div className="text-center text-gray-400 text-xs">{rules.description}</div>

      {/* Difficulty selector - only in AI mode */}
      {gameMode === "vs-ai" && (
        <div className="flex gap-2 justify-center flex-wrap">
          {(["easy", "medium", "hard"] as Difficulty[]).map((d) => (
            <button
              key={d}
              onClick={() => setDifficulty(d)}
              className={`px-5 py-3 rounded-lg font-bold text-white transition-colors touch-manipulation ${
                difficulty === d ? getDifficultyColor(d) : "bg-gray-600 hover:bg-gray-500"
              }`}
            >
              {d.charAt(0).toUpperCase() + d.slice(1)}
            </button>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 justify-center flex-wrap">
        <button
          onClick={() => newGame()}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-colors touch-manipulation"
        >
          New Game
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
        <div className="p-4 bg-gray-800 rounded-lg text-white">
          <h3 className="text-lg font-bold mb-2">Your Stats</h3>
          {gameMode === "vs-ai" ? (
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>Games Played: {progress.gamesPlayed}</div>
              <div>Games Won: {progress.gamesWon}</div>
              <div>Win Streak: {progress.currentWinStreak}</div>
              <div>Best Streak: {progress.bestWinStreak}</div>
              <div>Pieces Captured: {progress.totalPiecesCaptured}</div>
              <div>Kings Earned: {progress.totalKingsEarned}</div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>2P Games: {progress.twoPlayerGamesPlayed}</div>
              <div>Red Wins: {progress.twoPlayerRedWins}</div>
              <div>Black Wins: {progress.twoPlayerBlackWins}</div>
            </div>
          )}
        </div>
      )}

      {/* Win/Loss celebration */}
      {status !== "playing" && (
        <div
          className={`p-4 rounded-lg text-center text-white font-bold text-xl ${
            (gameMode === "vs-ai" && status === "red-wins") ||
            (gameMode === "vs-friend" && status === "red-wins")
              ? "bg-green-600"
              : gameMode === "vs-ai"
                ? "bg-red-600"
                : "bg-blue-600"
          }`}
        >
          {getWinMessage()}
          <button
            onClick={() => newGame()}
            className="block mx-auto mt-2 px-4 py-2 bg-white text-gray-800 rounded-lg"
          >
            Play Again
          </button>
        </div>
      )}
    </div>
  );
}
