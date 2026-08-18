"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import { use2048Store } from "./lib/store";
import { getTileColors, GRID_SIZE, TIMINGS, type Direction } from "./lib/constants";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { useCoarsePointer } from "@/shared/hooks/useCoarsePointer";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import { RestartConfirmationDialog } from "@/shared/components/RestartConfirmationDialog";

// Tile component with animations
function Tile({
  value,
  isNew,
  isMerged,
}: {
  value: number;
  isNew: boolean;
  isMerged: boolean;
}) {
  const colors = getTileColors(value);
  const fontSize = value >= 1000 ? "text-2xl" : value >= 100 ? "text-3xl" : "text-4xl";

  return (
    <div
      className={`
        absolute inset-1 rounded-lg flex items-center justify-center font-bold
        transition-all duration-150 ease-out
        ${isNew ? "animate-spawn" : ""}
        ${isMerged ? "animate-pop" : ""}
      `}
      style={{
        backgroundColor: colors.bg,
        color: colors.text,
      }}
    >
      {value > 0 && <span className={fontSize}>{value}</span>}
    </div>
  );
}

// Grid component
function Grid() {
  const grid = use2048Store((s) => s.grid);
  const newTilePosition = use2048Store((s) => s.newTilePosition);
  const mergedPositions = use2048Store((s) => s.mergedPositions);
  const clearAnimationState = use2048Store((s) => s.clearAnimationState);

  // Clear animation state after animations complete
  useEffect(() => {
    if (newTilePosition || mergedPositions.length > 0) {
      const timer = setTimeout(() => {
        clearAnimationState();
      }, TIMINGS.MERGE_POP);
      return () => clearTimeout(timer);
    }
  }, [newTilePosition, mergedPositions, clearAnimationState]);

  const isMerged = (row: number, col: number) =>
    mergedPositions.some((p) => p.row === row && p.col === col);

  const isNew = (row: number, col: number) =>
    newTilePosition?.row === row && newTilePosition?.col === col;

  return (
    <div className="relative bg-[#bbada0] rounded-lg p-2 w-full max-w-[400px] aspect-square">
      {/* Background grid cells */}
      <div className="grid grid-cols-4 gap-2 w-full h-full">
        {Array.from({ length: GRID_SIZE * GRID_SIZE }).map((_, i) => (
          <div
            key={i}
            className="bg-[rgba(238,228,218,0.35)] rounded-lg"
          />
        ))}
      </div>

      {/* Tiles layer */}
      <div className="absolute inset-2 grid grid-cols-4 gap-2">
        {grid.map((row, rowIndex) =>
          row.map((value, colIndex) => (
            <div key={`${rowIndex}-${colIndex}`} className="relative">
              <Tile
                value={value}
                isNew={isNew(rowIndex, colIndex)}
                isMerged={isMerged(rowIndex, colIndex)}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Score display
function ScoreBoard() {
  const score = use2048Store((s) => s.score);
  const highScore = use2048Store((s) => s.highScore);

  return (
    <div className="flex gap-4 justify-center mb-4">
      <div className="bg-[#655c52] rounded-lg px-6 py-3 text-center min-w-[100px]">
        <div className="text-[#eee4da] text-xs uppercase font-bold">Score</div>
        <div className="text-white text-2xl font-bold">{score}</div>
      </div>
      <div className="bg-[#655c52] rounded-lg px-6 py-3 text-center min-w-[100px]">
        <div className="text-[#eee4da] text-xs uppercase font-bold">Best</div>
        <div className="text-white text-2xl font-bold">{highScore}</div>
      </div>
    </div>
  );
}

// Controls
function Controls({ onNewGame, restartTriggerRef }: { onNewGame: () => void; restartTriggerRef: React.RefObject<HTMLButtonElement | null> }) {
  const newGame = onNewGame;
  const undo = use2048Store((s) => s.undo);
  const canUndo = use2048Store((s) => s.canUndo);

  return (
    <div className="flex gap-4 justify-center mt-4">
      <button
        onClick={undo}
        disabled={!canUndo}
        className={`
          px-6 py-3 rounded-lg font-bold text-white text-lg
          min-w-[100px] min-h-[50px]
          transition-all duration-150
          ${canUndo
            ? "bg-[#8f7a66] hover:bg-[#7a6658] active:scale-95 shadow-md"
            : "bg-[#8f7a66] opacity-40 cursor-not-allowed"
          }
        `}
      >
        Undo
      </button>
      <button
        ref={restartTriggerRef}
        onClick={newGame}
        className="px-6 py-3 rounded-lg font-bold text-white text-lg bg-[#8f7a66] hover:bg-[#7a6658] active:scale-95 transition-all duration-150 min-w-[120px] min-h-[50px]"
      >
        New Game
      </button>
    </div>
  );
}

// Game Over overlay
function GameOverOverlay({ onNewGame }: { onNewGame: () => void }) {
  const status = use2048Store((s) => s.status);
  const newGame = onNewGame;

  if (status !== "game-over") return null;

  return (
    <div className="absolute inset-0 bg-[rgba(238,228,218,0.73)] rounded-lg flex flex-col items-center justify-center z-10">
      <div className="text-5xl font-bold text-[#776e65] mb-4">Game Over!</div>
      <button
        onClick={newGame}
        className="px-8 py-4 rounded-lg font-bold text-white text-xl bg-[#8f7a66] hover:bg-[#7a6658] active:scale-95 transition-all duration-150"
      >
        Try Again
      </button>
    </div>
  );
}

// Win overlay
function WinOverlay({ onNewGame }: { onNewGame: () => void }) {
  const status = use2048Store((s) => s.status);
  const keepPlaying = use2048Store((s) => s.keepPlaying);
  const continueAfterWin = use2048Store((s) => s.continueAfterWin);
  const newGame = onNewGame;

  if (status !== "won" || keepPlaying) return null;

  return (
    <div className="absolute inset-0 bg-[rgba(237,194,46,0.5)] rounded-lg flex flex-col items-center justify-center z-10">
      <div className="text-5xl font-bold text-white mb-2 drop-shadow-lg">You Win!</div>
      <div className="text-xl text-white mb-6 drop-shadow">You reached 2048!</div>
      <div className="flex gap-4">
        <button
          onClick={continueAfterWin}
          className="px-6 py-3 rounded-lg font-bold text-white text-lg bg-[#8f7a66] hover:bg-[#7a6658] active:scale-95 transition-all duration-150"
        >
          Keep Going
        </button>
        <button
          onClick={newGame}
          className="px-6 py-3 rounded-lg font-bold text-[#776e65] text-lg bg-white hover:bg-gray-100 active:scale-95 transition-all duration-150"
        >
          New Game
        </button>
      </div>
    </div>
  );
}

// Hook for keyboard controls
function useKeyboardControls(onNewGame: () => void) {
  const move = use2048Store((s) => s.move);
  const undo = use2048Store((s) => s.undo);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ignore if modifier keys are pressed (except for undo)
      if (e.metaKey || e.altKey) return;

      // Undo with Z or Ctrl+Z
      if (e.key === "z" || e.key === "Z") {
        e.preventDefault();
        undo();
        return;
      }

      // New game with N
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        onNewGame();
        return;
      }

      // Arrow keys and WASD for movement
      let direction: Direction | null = null;

      switch (e.key) {
        case "ArrowUp":
        case "w":
        case "W":
          direction = "up";
          break;
        case "ArrowDown":
        case "s":
        case "S":
          direction = "down";
          break;
        case "ArrowLeft":
        case "a":
        case "A":
          direction = "left";
          break;
        case "ArrowRight":
        case "d":
        case "D":
          direction = "right";
          break;
      }

      if (direction) {
        e.preventDefault();
        move(direction);
      }
    },
    [move, undo, onNewGame]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}

// Hook for swipe controls
function useSwipeControls(containerRef: React.RefObject<HTMLDivElement | null>) {
  const move = use2048Store((s) => s.move);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }, []);

  const handleTouchEnd = useCallback(
    (e: TouchEvent) => {
      if (!touchStartRef.current) return;

      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - touchStartRef.current.x;
      const deltaY = touch.clientY - touchStartRef.current.y;

      const minSwipeDistance = 30;
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);

      // Need minimum swipe distance
      if (Math.max(absDeltaX, absDeltaY) < minSwipeDistance) {
        touchStartRef.current = null;
        return;
      }

      let direction: Direction;

      if (absDeltaX > absDeltaY) {
        // Horizontal swipe
        direction = deltaX > 0 ? "right" : "left";
      } else {
        // Vertical swipe
        direction = deltaY > 0 ? "down" : "up";
      }

      move(direction);
      touchStartRef.current = null;
    },
    [move]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchend", handleTouchEnd);
    };
  }, [containerRef, handleTouchStart, handleTouchEnd]);
}

// Main Game component
export function Game2048() {
  const containerRef = useRef<HTMLDivElement>(null);
  const store = use2048Store();
  const { status } = store;
  const [isRestartConfirmationOpen, setIsRestartConfirmationOpen] = useState(false);
  const restartTriggerRef = useRef<HTMLButtonElement>(null);
  const requestNewGame = useCallback(() => setIsRestartConfirmationOpen(true), []);
  const confirmNewGame = useCallback(() => {
    setIsRestartConfirmationOpen(false);
    store.newGame();
  }, [store]);
  // Touch viewports must not see keyboard-only copy (2026-07-10 audit)
  const isCoarse = useCoarsePointer();

  // Set up controls
  useKeyboardControls(requestNewGame);
  useSwipeControls(containerRef);

  // Sync with auth system
  const { isAuthenticated, syncStatus, forceSync } = useAuthSync({
    appId: "2048",
    localStorageKey: "2048-game-state",
    getState: () => store.getProgress(),
    setState: (data) => store.setProgress(data),
    debounceMs: 2000,
  });

  // Force save immediately on game end (won or game-over)
  useEffect(() => {
    if (status === "won" || status === "game-over") {
      forceSync();
    }
  }, [status, forceSync]);

  return (
    <div className="min-h-screen bg-[#faf8ef] p-4 flex flex-col items-center justify-center">
      {/* iOS install prompt */}
      <IOSInstallPrompt />


      {/* Inline styles for animations */}
      <style>{`
        @keyframes spawn {
          0% {
            transform: scale(0);
            opacity: 0;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }

        @keyframes pop {
          0% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.15);
          }
          100% {
            transform: scale(1);
          }
        }

        .animate-spawn {
          animation: spawn ${TIMINGS.SPAWN}ms ease-out forwards;
        }

        .animate-pop {
          animation: pop ${TIMINGS.MERGE_POP}ms ease-out forwards;
        }
      `}</style>

      <ScoreBoard />

      <div
        ref={containerRef}
        data-testid="game-2048-board-wrapper"
        className="relative w-full max-w-[400px] touch-none select-none"
      >
        <Grid />
        <GameOverOverlay onNewGame={store.newGame} />
        <WinOverlay onNewGame={store.newGame} />
      </div>

      <Controls onNewGame={requestNewGame} restartTriggerRef={restartTriggerRef} />

      <RestartConfirmationDialog
        isOpen={isRestartConfirmationOpen}
        gameName="2048"
        message="Start a new 2048 game? Your current board will be lost."
        triggerRef={restartTriggerRef}
        onCancel={() => setIsRestartConfirmationOpen(false)}
        onConfirm={confirmNewGame}
      />

      <div className="mt-6 text-center text-[#776e65] text-sm max-w-[400px]">
        {!isCoarse && (
          <p className="mb-2">
            <strong>Desktop:</strong> Arrow keys or WASD to move
          </p>
        )}
        <p>
          <strong>Mobile:</strong> Swipe to move tiles
        </p>
      </div>

      {/* Sync status indicator */}
      {isAuthenticated && (
        <div className="fixed bottom-2 right-2 text-xs text-[#bbada0]">
          {syncStatus === "syncing" ? "Saving..." : syncStatus === "synced" ? "Saved" : ""}
        </div>
      )}
    </div>
  );
}

export default Game2048;
