"use client";

import { useState, useEffect, useRef } from "react";
import { useQuoridorStore } from "./lib/store";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import {
  type Position,
  type Wall,
  type WallOrientation,
  type Difficulty,
  type GameMode,
  BOARD_SIZE,
  COLORS,
  SHADOWS,
  Z_INDEX,
  PLAYER1_GOAL_ROW,
  PLAYER2_GOAL_ROW,
  positionsEqual,
} from "./lib/constants";
import { isValidWallPlacement } from "./lib/quoridorLogic";

export function QuoridorGame() {
  const store = useQuoridorStore();
  const [showStats, setShowStats] = useState(false);

  // Onboarding modal - show for first-time players
  const [showOnboarding, setShowOnboarding] = useState(() => {
    if (typeof window === "undefined") return false;
    return !localStorage.getItem("quoridor-onboarding-seen");
  });

  // Invalid wall placement feedback
  const [invalidFlash, setInvalidFlash] = useState<{
    row: number;
    col: number;
    orientation: WallOrientation;
  } | null>(null);
  const invalidTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (invalidTimeoutRef.current) clearTimeout(invalidTimeoutRef.current);
    };
  }, []);

  const dismissOnboarding = () => {
    localStorage.setItem("quoridor-onboarding-seen", "true");
    setShowOnboarding(false);
  };

  const handleInvalidPlacement = (row: number, col: number, orientation: WallOrientation) => {
    if (invalidTimeoutRef.current) {
      clearTimeout(invalidTimeoutRef.current);
    }
    setInvalidFlash({ row, col, orientation });
    invalidTimeoutRef.current = setTimeout(() => setInvalidFlash(null), 400);
  };

  // Sync with auth system
  const { isAuthenticated, syncStatus, forceSync } = useAuthSync({
    appId: "quoridor",
    localStorageKey: "quoridor-progress",
    getState: () => store.getProgress(),
    setState: (data) => store.setProgress(data),
    debounceMs: 2000,
  });

  // Force save immediately on game end
  useEffect(() => {
    if (store.status === "player1-wins" || store.status === "player2-wins") {
      forceSync();
    }
  }, [store.status, forceSync]);

  const handleSquareClick = (row: number, col: number) => {
    const pos: Position = { row, col };

    // If pawn is selected and this is a valid move, make the move
    if (store.selectedPawn && store.validMoves.some((m) => positionsEqual(m, pos))) {
      store.movePawn(pos);
      return;
    }

    // If clicking on current player's pawn, select it
    const currentPlayerPos = store.positions[store.currentPlayer];
    if (positionsEqual(currentPlayerPos, pos)) {
      store.selectPawn();
      return;
    }

    // If in wall mode, try to place wall at this position
    if (store.wallMode) {
      const wall: Wall = {
        row: store.wallOrientation === "horizontal" ? row : row,
        col: store.wallOrientation === "vertical" ? col : col,
        orientation: store.wallOrientation,
      };
      if (
        isValidWallPlacement(store.getLogicState(), wall, store.currentPlayer)
      ) {
        store.placeWall(wall);
      }
    }
  };

  const handleGrooveClick = (
    row: number,
    col: number,
    orientation: WallOrientation
  ) => {
    if (!store.wallMode) return;

    const wall: Wall = { row, col, orientation };
    if (isValidWallPlacement(store.getLogicState(), wall, store.currentPlayer)) {
      store.placeWall(wall);
    } else {
      handleInvalidPlacement(row, col, orientation);
    }
  };

  const handleGrooveHover = (
    row: number,
    col: number,
    orientation: WallOrientation
  ) => {
    if (!store.wallMode) return;

    const wall: Wall = { row, col, orientation };
    const isValid = isValidWallPlacement(
      store.getLogicState(),
      wall,
      store.currentPlayer
    );
    store.setWallPreview(isValid ? wall : null);
  };

  const renderSquare = (row: number, col: number) => {
    const pos: Position = { row, col };
    const isPlayer1 = positionsEqual(store.positions[1], pos);
    const isPlayer2 = positionsEqual(store.positions[2], pos);
    const isValidMove = store.validMoves.some((m) => positionsEqual(m, pos));
    const isCurrentPlayerPawn =
      positionsEqual(store.positions[store.currentPlayer], pos) &&
      store.status === "playing";

    // Goal row indicators
    const isPlayer1Goal = row === PLAYER1_GOAL_ROW; // Top row - P1 destination
    const isPlayer2Goal = row === PLAYER2_GOAL_ROW; // Bottom row - P2 destination

    return (
      <div
        key={`square-${row}-${col}`}
        className={`
          relative flex items-center justify-center rounded-sm
          transition-[background-color,box-shadow] duration-150
          ${isValidMove ? "cursor-pointer" : ""}
          ${isCurrentPlayerPawn && !store.isAIThinking ? "cursor-pointer" : ""}
        `}
        style={{
          backgroundColor: COLORS.BOARD_LIGHT,
          boxShadow: SHADOWS.SQUARE_RAISED,
          aspectRatio: "1",
          zIndex: Z_INDEX.SQUARES,
          // Goal row indicators - subtle colored border
          borderTop: isPlayer1Goal ? `3px solid ${COLORS.PLAYER1}` : undefined,
          borderBottom: isPlayer2Goal ? `3px solid ${COLORS.PLAYER2}` : undefined,
        }}
        onClick={() => handleSquareClick(row, col)}
      >
        {/* Valid move indicator */}
        {isValidMove && !isPlayer1 && !isPlayer2 && (
          <div
            className="absolute w-1/3 h-1/3 rounded-full animate-pulse"
            style={{
              backgroundColor: COLORS.VALID_MOVE,
              opacity: 0.7,
              zIndex: Z_INDEX.VALID_MOVES,
            }}
          />
        )}

        {/* Player 1 pawn - 3D gradient */}
        {isPlayer1 && (
          <div
            className={`
              w-3/4 h-3/4 rounded-full
              ${store.selectedPawn && store.currentPlayer === 1 ? "ring-4 ring-yellow-400" : ""}
              transition-[transform,box-shadow] duration-200
            `}
            style={{
              background: `radial-gradient(circle at 30% 30%, ${COLORS.PLAYER1_LIGHT}, ${COLORS.PLAYER1})`,
              boxShadow: SHADOWS.PAWN,
              zIndex: Z_INDEX.PAWNS,
            }}
          />
        )}

        {/* Player 2 pawn - 3D gradient */}
        {isPlayer2 && (
          <div
            className={`
              w-3/4 h-3/4 rounded-full
              ${store.selectedPawn && store.currentPlayer === 2 ? "ring-4 ring-yellow-400" : ""}
              transition-[transform,box-shadow] duration-200
            `}
            style={{
              background: `radial-gradient(circle at 30% 30%, ${COLORS.PLAYER2_LIGHT}, ${COLORS.PLAYER2})`,
              boxShadow: SHADOWS.PAWN,
              zIndex: Z_INDEX.PAWNS,
            }}
          />
        )}
      </div>
    );
  };

  const renderHorizontalGroove = (row: number, col: number) => {
    // Horizontal walls block between row-1 and row (placed at row 1-8)
    const hasWall = store.walls.some(
      (w) => w.orientation === "horizontal" && w.row === row && w.col === col
    );
    const hasWallLeft = store.walls.some(
      (w) => w.orientation === "horizontal" && w.row === row && w.col === col - 1
    );
    const isPreview =
      store.wallPreview?.orientation === "horizontal" &&
      store.wallPreview?.row === row &&
      (store.wallPreview?.col === col || store.wallPreview?.col === col - 1);

    // Check if this groove is being flash-invalid
    const isInvalid =
      invalidFlash?.orientation === "horizontal" &&
      invalidFlash?.row === row &&
      (invalidFlash?.col === col || invalidFlash?.col === col - 1);

    const hasAnyWall = hasWall || hasWallLeft;

    return (
      <div
        key={`hgroove-${row}-${col}`}
        className="relative"
        style={{ zIndex: Z_INDEX.GROOVES }}
      >
        {/* Visual groove */}
        <div
          className={`
            w-full h-full
            ${isInvalid ? "animate-shake" : ""}
            transition-[background-color,box-shadow] duration-150
          `}
          style={{
            backgroundColor: isInvalid
              ? COLORS.WALL_INVALID
              : hasAnyWall
              ? COLORS.WALL
              : isPreview
              ? COLORS.WALL_PREVIEW
              : COLORS.GROOVE,
            boxShadow: hasAnyWall ? SHADOWS.WALL_RAISED : SHADOWS.GROOVE_SUNKEN,
            minHeight: "10px",
            zIndex: hasAnyWall ? Z_INDEX.WALLS : Z_INDEX.GROOVES,
          }}
        />

        {/* Expanded touch target - invisible hitbox */}
        {store.wallMode && (
          <div
            className="absolute cursor-pointer"
            style={{
              top: "-6px",
              bottom: "-6px",
              left: "0",
              right: "0",
              zIndex: Z_INDEX.TOUCH_TARGETS,
            }}
            onClick={() => handleGrooveClick(row, col, "horizontal")}
            onTouchStart={() => handleGrooveHover(row, col, "horizontal")}
            onMouseEnter={() => handleGrooveHover(row, col, "horizontal")}
            onMouseLeave={() => store.setWallPreview(null)}
            onTouchEnd={() => store.setWallPreview(null)}
          />
        )}

        {/* Non-wall-mode click handler on visual groove */}
        {!store.wallMode && (
          <div
            className="absolute inset-0"
            onClick={() => handleGrooveClick(row, col, "horizontal")}
          />
        )}
      </div>
    );
  };

  const renderVerticalGroove = (row: number, col: number) => {
    // Vertical walls block between col-1 and col (placed at col 1-8)
    const hasWall = store.walls.some(
      (w) => w.orientation === "vertical" && w.col === col && w.row === row
    );
    const hasWallAbove = store.walls.some(
      (w) => w.orientation === "vertical" && w.col === col && w.row === row - 1
    );
    const isPreview =
      store.wallPreview?.orientation === "vertical" &&
      store.wallPreview?.col === col &&
      (store.wallPreview?.row === row || store.wallPreview?.row === row - 1);

    // Check if this groove is being flash-invalid
    const isInvalid =
      invalidFlash?.orientation === "vertical" &&
      invalidFlash?.col === col &&
      (invalidFlash?.row === row || invalidFlash?.row === row - 1);

    const hasAnyWall = hasWall || hasWallAbove;

    return (
      <div
        key={`vgroove-${row}-${col}`}
        className="relative"
        style={{ zIndex: Z_INDEX.GROOVES }}
      >
        {/* Visual groove */}
        <div
          className={`
            w-full h-full
            ${isInvalid ? "animate-shake" : ""}
            transition-[background-color,box-shadow] duration-150
          `}
          style={{
            backgroundColor: isInvalid
              ? COLORS.WALL_INVALID
              : hasAnyWall
              ? COLORS.WALL
              : isPreview
              ? COLORS.WALL_PREVIEW
              : COLORS.GROOVE,
            boxShadow: hasAnyWall ? SHADOWS.WALL_RAISED : SHADOWS.GROOVE_SUNKEN,
            minWidth: "10px",
            zIndex: hasAnyWall ? Z_INDEX.WALLS : Z_INDEX.GROOVES,
          }}
        />

        {/* Expanded touch target - invisible hitbox */}
        {store.wallMode && (
          <div
            className="absolute cursor-pointer"
            style={{
              top: "0",
              bottom: "0",
              left: "-6px",
              right: "-6px",
              zIndex: Z_INDEX.TOUCH_TARGETS,
            }}
            onClick={() => handleGrooveClick(row, col, "vertical")}
            onTouchStart={() => handleGrooveHover(row, col, "vertical")}
            onMouseEnter={() => handleGrooveHover(row, col, "vertical")}
            onMouseLeave={() => store.setWallPreview(null)}
            onTouchEnd={() => store.setWallPreview(null)}
          />
        )}

        {/* Non-wall-mode click handler on visual groove */}
        {!store.wallMode && (
          <div
            className="absolute inset-0"
            onClick={() => handleGrooveClick(row, col, "vertical")}
          />
        )}
      </div>
    );
  };

  const renderIntersection = (row: number, col: number) => {
    // Check if any wall is CENTERED at this intersection
    // A horizontal wall at (row, col) has center at (row, col+1), so check col-1
    const hasHorizontalWall = store.walls.some(
      (w) =>
        w.orientation === "horizontal" &&
        w.row === row &&
        w.col === col - 1
    );
    // A vertical wall at (row, col) has center at (row+1, col), so check row-1
    const hasVerticalWall = store.walls.some(
      (w) =>
        w.orientation === "vertical" &&
        w.col === col &&
        w.row === row - 1
    );

    // Check for wall preview centered at this intersection
    const isPreviewHorizontal =
      store.wallPreview?.orientation === "horizontal" &&
      store.wallPreview?.row === row &&
      store.wallPreview?.col === col - 1;
    const isPreviewVertical =
      store.wallPreview?.orientation === "vertical" &&
      store.wallPreview?.col === col &&
      store.wallPreview?.row === row - 1;

    const hasWall = hasHorizontalWall || hasVerticalWall;
    const isPreview = isPreviewHorizontal || isPreviewVertical;

    return (
      <div
        key={`intersection-${row}-${col}`}
        style={{
          backgroundColor: hasWall
            ? COLORS.WALL
            : isPreview
            ? COLORS.WALL_PREVIEW
            : COLORS.GROOVE,
          boxShadow: hasWall ? SHADOWS.WALL_RAISED : SHADOWS.GROOVE_SUNKEN,
          minWidth: "10px",
          minHeight: "10px",
          zIndex: hasWall ? Z_INDEX.WALLS : Z_INDEX.GROOVES,
        }}
      />
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-800 to-amber-950 p-4 flex flex-col items-center justify-center gap-6">
      {/* iOS install prompt */}
      <IOSInstallPrompt />


      <header className="text-center">
        <h1 className="text-4xl font-bold text-white mb-2">Quoridor</h1>
        <p className="text-amber-200">Block your opponent, reach the other side!</p>
      </header>

      {/* Turn indicator */}
      <div className="flex items-center justify-center gap-4 py-3 px-6 bg-gray-800 rounded-lg">
        <div
          className={`flex items-center gap-2 px-3 py-1 rounded ${
            store.currentPlayer === 1 ? "bg-blue-600" : "bg-gray-700"
          }`}
        >
          <div
            className="w-4 h-4 rounded-full"
            style={{ backgroundColor: COLORS.PLAYER1 }}
          />
          <span className="font-bold text-white">
            P1: {store.wallsRemaining[1]}
          </span>
        </div>

        <div className="text-white font-bold text-lg">
          {store.status === "playing" ? (
            store.isAIThinking ? (
              "AI Thinking..."
            ) : store.gameMode === "local" ? (
              `Player ${store.currentPlayer}'s Turn`
            ) : store.currentPlayer === 1 ? (
              "Your Turn!"
            ) : (
              "..."
            )
          ) : store.status === "player1-wins" ? (
            store.gameMode === "ai" ? "You Win!" : "Player 1 Wins!"
          ) : (
            store.gameMode === "ai" ? "AI Wins!" : "Player 2 Wins!"
          )}
        </div>

        <div
          className={`flex items-center gap-2 px-3 py-1 rounded ${
            store.currentPlayer === 2 ? "bg-orange-600" : "bg-gray-700"
          }`}
        >
          <div
            className="w-4 h-4 rounded-full"
            style={{ backgroundColor: COLORS.PLAYER2 }}
          />
          <span className="font-bold text-white">
            {store.gameMode === "ai" ? "AI" : "P2"}: {store.wallsRemaining[2]}
          </span>
        </div>
      </div>

      {/* Board */}
      <div
        className="bg-amber-900 p-2 md:p-3 rounded-lg shadow-2xl w-full max-w-[90vw] md:max-w-[min(80vh,700px)]"
        style={{ zIndex: Z_INDEX.BOARD_BG }}
      >
        <div
          className="grid gap-0"
          style={{
            gridTemplateColumns: `repeat(${BOARD_SIZE * 2 - 1}, 1fr)`,
            gridTemplateRows: `repeat(${BOARD_SIZE * 2 - 1}, 1fr)`,
            willChange: "transform",
          }}
        >
          {/* Render board from top (row 8) to bottom (row 0) */}
          {Array.from({ length: BOARD_SIZE * 2 - 1 }).map((_, gridRow) => {
            const boardRow = BOARD_SIZE - 1 - Math.floor(gridRow / 2);
            const isSquareRow = gridRow % 2 === 0;

            return Array.from({ length: BOARD_SIZE * 2 - 1 }).map(
              (_, gridCol) => {
                const boardCol = Math.floor(gridCol / 2);
                const isSquareCol = gridCol % 2 === 0;

                if (isSquareRow && isSquareCol) {
                  // Square
                  return renderSquare(boardRow, boardCol);
                } else if (!isSquareRow && isSquareCol) {
                  // Horizontal groove (between rows)
                  return renderHorizontalGroove(boardRow, boardCol);
                } else if (isSquareRow && !isSquareCol) {
                  // Vertical groove (between columns)
                  return renderVerticalGroove(boardRow, boardCol + 1);
                } else {
                  // Intersection
                  return renderIntersection(boardRow, boardCol + 1);
                }
              }
            );
          })}
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-4 w-full max-w-lg">
        {/* Mode buttons */}
        {store.status === "playing" && !store.isAIThinking && (
          <div className="flex gap-2 justify-center">
            <button
              onClick={() => store.selectPawn()}
              className={`px-6 py-3 font-bold rounded-lg transition-colors ${
                store.selectedPawn
                  ? "bg-blue-600 text-white"
                  : "bg-gray-600 hover:bg-gray-500 text-white"
              }`}
            >
              Move Pawn
            </button>
            <button
              onClick={() =>
                store.wallMode ? store.exitWallMode() : store.enterWallMode()
              }
              disabled={store.wallsRemaining[store.currentPlayer] <= 0}
              className={`px-6 py-3 font-bold rounded-lg transition-colors ${
                store.wallMode
                  ? "bg-amber-600 text-white"
                  : store.wallsRemaining[store.currentPlayer] > 0
                  ? "bg-gray-600 hover:bg-gray-500 text-white"
                  : "bg-gray-700 text-gray-400 cursor-not-allowed"
              }`}
            >
              Place Wall
            </button>
            {store.wallMode && (
              <button
                onClick={() => store.toggleWallOrientation()}
                className="px-4 py-3 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-lg transition-colors"
              >
                {store.wallOrientation === "horizontal" ? "Horiz" : "Vert"}
              </button>
            )}
          </div>
        )}

        {/* Game mode selector */}
        <div className="flex gap-2 justify-center flex-wrap">
          <button
            onClick={() => store.setGameMode("local")}
            className={`px-5 py-3 rounded-lg font-bold transition-colors touch-manipulation ${
              store.gameMode === "local"
                ? "bg-green-500 text-white"
                : "bg-gray-600 hover:bg-gray-500 text-white"
            }`}
          >
            2 Players
          </button>
          <button
            onClick={() => store.setGameMode("ai")}
            className={`px-5 py-3 rounded-lg font-bold transition-colors touch-manipulation ${
              store.gameMode === "ai"
                ? "bg-green-500 text-white"
                : "bg-gray-600 hover:bg-gray-500 text-white"
            }`}
          >
            vs AI
          </button>
        </div>

        {/* Difficulty selector (only for AI mode) */}
        {store.gameMode === "ai" && (
          <div className="flex gap-2 justify-center flex-wrap">
            {(["easy", "medium", "hard"] as Difficulty[]).map((d) => (
              <button
                key={d}
                onClick={() => store.setDifficulty(d)}
                className={`px-5 py-3 rounded-lg font-bold text-white transition-colors touch-manipulation ${
                  store.difficulty === d
                    ? d === "easy"
                      ? "bg-green-500"
                      : d === "medium"
                      ? "bg-yellow-500"
                      : "bg-red-500"
                    : "bg-gray-600 hover:bg-gray-500"
                }`}
              >
                {d.charAt(0).toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 justify-center">
          <button
            onClick={() => store.newGame()}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-colors"
          >
            New Game
          </button>
          <button
            onClick={() => setShowStats(!showStats)}
            className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg transition-colors"
          >
            Stats
          </button>
        </div>

        {/* Stats panel */}
        {showStats && (
          <div className="p-4 bg-gray-800 rounded-lg text-white">
            <h3 className="text-lg font-bold mb-2">Your Stats</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>Games Played: {store.progress.gamesPlayed}</div>
              <div>Games Won: {store.progress.gamesWon}</div>
              <div>Win Streak: {store.progress.currentWinStreak}</div>
              <div>Best Streak: {store.progress.bestWinStreak}</div>
              <div>Total Walls Placed: {store.progress.totalWallsPlaced}</div>
              <div>
                Fastest Win:{" "}
                {store.progress.fastestWin !== null
                  ? `${store.progress.fastestWin} moves`
                  : "N/A"}
              </div>
            </div>
          </div>
        )}

        {/* Win/Loss celebration */}
        {store.status !== "playing" && (
          <div
            className={`p-4 rounded-lg text-center text-white font-bold text-xl ${
              store.status === "player1-wins"
                ? "bg-green-600"
                : "bg-red-600"
            }`}
          >
            {store.status === "player1-wins"
              ? store.gameMode === "ai"
                ? "Congratulations! You won!"
                : "Player 1 wins!"
              : store.gameMode === "ai"
              ? "AI wins! Try again?"
              : "Player 2 wins!"}
            <button
              onClick={() => store.newGame()}
              className="block mx-auto mt-2 px-4 py-2 bg-white text-gray-800 rounded-lg"
            >
              Play Again
            </button>
          </div>
        )}
      </div>

      {/* Sync status indicator */}
      {isAuthenticated && (
        <div className="fixed bottom-2 right-2 text-xs text-amber-300/60">
          {syncStatus === "syncing"
            ? "Saving..."
            : syncStatus === "synced"
            ? "Saved"
            : ""}
        </div>
      )}

      {/* Onboarding modal for first-time players */}
      {showOnboarding && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center p-4"
          style={{ zIndex: Z_INDEX.MODALS }}
        >
          <div className="bg-white rounded-xl p-6 max-w-md text-center shadow-2xl">
            <h2 className="text-2xl font-bold mb-4 text-gray-800">
              How to Play Quoridor
            </h2>

            <div className="space-y-3 text-left text-gray-700">
              <p>
                <span className="text-xl mr-2">🎯</span>
                <strong>Goal:</strong> Get your pawn to the opposite side of the board first!
              </p>
              <p>
                <span className="text-xl mr-2">👆</span>
                <strong>Move:</strong> Tap your pawn, then tap a green dot to move one square
              </p>
              <p>
                <span className="text-xl mr-2">🧱</span>
                <strong>Walls:</strong> Place red walls in the dark grooves to block your opponent
              </p>
              <p>
                <span className="text-xl mr-2">⚠️</span>
                <strong>Rule:</strong> You can&apos;t completely trap anyone - there must always be a path!
              </p>
            </div>

            <div className="mt-4 pt-4 border-t border-gray-200 text-sm text-gray-500">
              <p className="flex items-center justify-center gap-2">
                <span
                  className="w-4 h-4 rounded-full inline-block"
                  style={{ backgroundColor: COLORS.PLAYER1 }}
                />
                Blue reaches the{" "}
                <span className="font-bold" style={{ color: COLORS.PLAYER1 }}>
                  top
                </span>
              </p>
              <p className="flex items-center justify-center gap-2">
                <span
                  className="w-4 h-4 rounded-full inline-block"
                  style={{ backgroundColor: COLORS.PLAYER2 }}
                />
                Orange reaches the{" "}
                <span className="font-bold" style={{ color: COLORS.PLAYER2 }}>
                  bottom
                </span>
              </p>
            </div>

            <button
              onClick={dismissOnboarding}
              className="mt-6 px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-colors text-lg"
            >
              Got it, let&apos;s play!
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default QuoridorGame;
