"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import { useSnakeStore, type SnakeProgress } from "./lib/store";
import {
  type Direction,
  GRID_SIZE,
  CELL_SIZE,
  COLORS,
  FOOD_EMOJI,
  getTickInterval,
} from "./lib/constants";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";

// ============================================
// GAME BOARD COMPONENT
// ============================================
function GameBoard() {
  const { snake, food, foodType, gridSize, status } = useSnakeStore();

  const boardSize = gridSize * CELL_SIZE;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Scale the fixed-pixel board down on narrow screens: at 375px the 400px
  // board overflowed the viewport and the page scrolled sideways under a
  // swipe-steered game (2026-07-10 audit, High).
  useEffect(() => {
    const update = () => {
      const available =
        wrapperRef.current?.parentElement?.clientWidth ?? window.innerWidth;
      setScale(Math.min(1, available / boardSize));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [boardSize]);

  return (
    <div
      ref={wrapperRef}
      style={{ width: boardSize * scale, height: boardSize * scale }}
    >
    <div
      className="relative border-4 border-green-700 rounded-lg shadow-xl overflow-hidden"
      style={{
        width: boardSize,
        height: boardSize,
        backgroundColor: COLORS.GRID_BG,
        transform: `scale(${scale})`,
        transformOrigin: "top left",
      }}
    >
      {/* Grid lines */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(to right, ${COLORS.GRID_LINE} 1px, transparent 1px),
            linear-gradient(to bottom, ${COLORS.GRID_LINE} 1px, transparent 1px)
          `,
          backgroundSize: `${CELL_SIZE}px ${CELL_SIZE}px`,
        }}
      />

      {/* Food */}
      <div
        className="absolute flex items-center justify-center transition-all duration-100"
        style={{
          left: food.x * CELL_SIZE,
          top: food.y * CELL_SIZE,
          width: CELL_SIZE,
          height: CELL_SIZE,
          fontSize: CELL_SIZE * 0.8,
        }}
      >
        <span className="animate-bounce">{FOOD_EMOJI[foodType]}</span>
      </div>

      {/* Snake */}
      {snake.map((segment, index) => {
        const isHead = index === 0;
        const isTail = index === snake.length - 1;

        return (
          <div
            key={`${segment.x}-${segment.y}-${index}`}
            className="absolute rounded-md transition-all duration-75"
            style={{
              left: segment.x * CELL_SIZE + 1,
              top: segment.y * CELL_SIZE + 1,
              width: CELL_SIZE - 2,
              height: CELL_SIZE - 2,
              backgroundColor: isHead
                ? COLORS.SNAKE_HEAD
                : index % 2 === 0
                ? COLORS.SNAKE_BODY
                : COLORS.SNAKE_BODY_ALT,
              borderRadius: isHead ? "6px" : isTail ? "4px" : "3px",
              boxShadow: isHead ? "0 2px 4px rgba(0,0,0,0.3)" : "none",
            }}
          >
            {/* Snake face on head */}
            {isHead && (
              <div className="w-full h-full flex items-center justify-center text-xs">
                <span role="img" aria-label="snake face">
                  {status === "game-over" ? "😵" : "😊"}
                </span>
              </div>
            )}
          </div>
        );
      })}

      {/* Game Over Overlay */}
      {status === "game-over" && (
        <div className="absolute inset-0 bg-red-500/30 flex items-center justify-center">
          <div className="text-4xl font-bold text-white drop-shadow-lg animate-pulse">
            GAME OVER!
          </div>
        </div>
      )}

      {/* Paused Overlay */}
      {status === "paused" && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
          <div className="text-4xl font-bold text-white drop-shadow-lg">
            PAUSED
          </div>
        </div>
      )}
    </div>
    </div>
  );
}

// ============================================
// MOBILE CONTROLS COMPONENT
// ============================================
function MobileControls() {
  const { setDirection, status, progress } = useSnakeStore();
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleDirection = useCallback(
    (dir: Direction) => {
      if (status === "playing") {
        setDirection(dir);
      }
    },
    [setDirection, status]
  );

  // Swipe detection
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!touchStartRef.current || progress.controlMode !== "swipe") return;

      const touch = e.changedTouches[0];
      const dx = touch.clientX - touchStartRef.current.x;
      const dy = touch.clientY - touchStartRef.current.y;
      const minSwipe = 30;

      if (Math.abs(dx) > Math.abs(dy)) {
        if (Math.abs(dx) > minSwipe) {
          handleDirection(dx > 0 ? "right" : "left");
        }
      } else {
        if (Math.abs(dy) > minSwipe) {
          handleDirection(dy > 0 ? "down" : "up");
        }
      }

      touchStartRef.current = null;
    },
    [handleDirection, progress.controlMode]
  );

  if (progress.controlMode === "swipe") {
    return (
      <>
        {/* Invisible touch layer for swipe detection */}
        <div
          className="fixed inset-0 z-10 pointer-events-auto"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          style={{ touchAction: "none" }}
        />
        {/* Visible swipe instruction */}
        <div className="mt-4 text-center text-green-200 animate-pulse">
          <div className="text-4xl mb-2">👆</div>
          <div className="text-lg font-bold">Swipe anywhere to move</div>
        </div>
      </>
    );
  }

  // Button controls
  const buttonClass =
    "w-20 h-20 text-4xl bg-green-600 hover:bg-green-500 active:bg-green-700 text-white rounded-xl shadow-lg transition-all active:scale-95 flex items-center justify-center touch-manipulation";

  return (
    <div className="flex flex-col items-center gap-2 mt-4">
      {/* Up button */}
      <button
        className={buttonClass}
        onClick={() => handleDirection("up")}
        aria-label="Move up"
      >
        <svg className="w-10 h-10" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 4l-8 8h5v8h6v-8h5z" />
        </svg>
      </button>

      {/* Left, Right row */}
      <div className="flex gap-16">
        <button
          className={buttonClass}
          onClick={() => handleDirection("left")}
          aria-label="Move left"
        >
          <svg className="w-10 h-10" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 12l8-8v5h8v6h-8v5z" />
          </svg>
        </button>
        <button
          className={buttonClass}
          onClick={() => handleDirection("right")}
          aria-label="Move right"
        >
          <svg className="w-10 h-10" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 12l-8-8v5H4v6h8v5z" />
          </svg>
        </button>
      </div>

      {/* Down button */}
      <button
        className={buttonClass}
        onClick={() => handleDirection("down")}
        aria-label="Move down"
      >
        <svg className="w-10 h-10" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 20l8-8h-5V4H9v8H4z" />
        </svg>
      </button>
    </div>
  );
}

// ============================================
// GAME UI COMPONENT
// ============================================
function GameUI() {
  const { score, snake, progress, status, startGame, pauseGame, resumeGame } =
    useSnakeStore();

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-md">
      {/* Score display */}
      <div className="flex justify-between w-full text-lg font-bold">
        <div className="bg-green-800 text-white px-4 py-2 rounded-lg">
          Score: {score}
        </div>
        <div className="bg-green-800 text-white px-4 py-2 rounded-lg">
          Length: {snake.length}
        </div>
        <div className="bg-amber-600 text-white px-4 py-2 rounded-lg">
          Best: {progress.highScore}
        </div>
      </div>

      {/* Game controls */}
      <div className="flex gap-4">
        {status === "idle" && (
          <button
            onClick={startGame}
            className="bg-green-600 hover:bg-green-500 text-white text-2xl font-bold px-8 py-4 rounded-xl shadow-lg transition-all active:scale-95"
          >
            START GAME
          </button>
        )}

        {status === "playing" && (
          <button
            onClick={pauseGame}
            className="bg-yellow-500 hover:bg-yellow-400 text-white text-xl font-bold px-6 py-3 rounded-xl shadow-lg transition-all active:scale-95"
          >
            PAUSE
          </button>
        )}

        {status === "paused" && (
          <button
            onClick={resumeGame}
            className="bg-green-600 hover:bg-green-500 text-white text-xl font-bold px-6 py-3 rounded-xl shadow-lg transition-all active:scale-95"
          >
            RESUME
          </button>
        )}

        {status === "game-over" && (
          <button
            onClick={startGame}
            className="bg-green-600 hover:bg-green-500 text-white text-2xl font-bold px-8 py-4 rounded-xl shadow-lg transition-all active:scale-95 animate-pulse"
          >
            PLAY AGAIN!
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================
// SETTINGS PANEL COMPONENT
// ============================================
function SettingsPanel() {
  const { progress, setSpeed, setWraparound, setControlMode, status } =
    useSnakeStore();
  const [isOpen, setIsOpen] = useState(false);

  // Don't allow settings changes during gameplay
  const disabled = status === "playing";

  return (
    <div className="w-full max-w-md">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full bg-gray-700 hover:bg-gray-600 text-white py-2 px-4 rounded-lg flex items-center justify-between"
      >
        <span>Settings</span>
        <span className="transform transition-transform" style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0)" }}>
          ▼
        </span>
      </button>

      {isOpen && (
        <div className="mt-2 bg-gray-800 rounded-lg p-4 space-y-4">
          {/* Speed setting */}
          <div>
            <label className="text-white font-bold mb-2 block">Speed</label>
            <div className="flex gap-2">
              {(["slow", "medium", "fast"] as const).map((speed) => (
                <button
                  key={speed}
                  onClick={() => !disabled && setSpeed(speed)}
                  disabled={disabled}
                  className={`flex-1 py-2 px-4 rounded-lg font-bold capitalize transition-all ${
                    progress.speed === speed
                      ? "bg-green-600 text-white"
                      : "bg-gray-600 text-gray-300 hover:bg-gray-500"
                  } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {speed}
                </button>
              ))}
            </div>
          </div>

          {/* Wraparound toggle */}
          <div className="flex items-center justify-between">
            <label className="text-white font-bold">Wall Wraparound (Kid Mode)</label>
            <button
              onClick={() => !disabled && setWraparound(!progress.wraparoundWalls)}
              disabled={disabled}
              className={`w-14 h-8 rounded-full transition-all ${
                progress.wraparoundWalls ? "bg-green-600" : "bg-gray-600"
              } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <div
                className={`w-6 h-6 bg-white rounded-full shadow transition-transform ${
                  progress.wraparoundWalls ? "translate-x-7" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          {/* Control mode toggle */}
          <div>
            <label className="text-white font-bold mb-2 block">Mobile Controls</label>
            <div className="flex gap-2">
              {(["buttons", "swipe"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => !disabled && setControlMode(mode)}
                  disabled={disabled}
                  className={`flex-1 py-2 px-4 rounded-lg font-bold capitalize transition-all ${
                    progress.controlMode === mode
                      ? "bg-green-600 text-white"
                      : "bg-gray-600 text-gray-300 hover:bg-gray-500"
                  } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {disabled && (
            <p className="text-yellow-400 text-sm text-center">
              Pause or end game to change settings
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// STATS DISPLAY COMPONENT
// ============================================
function StatsDisplay() {
  const { progress } = useSnakeStore();

  return (
    <div className="w-full max-w-md bg-gray-800 rounded-lg p-4 text-white">
      <h3 className="font-bold text-lg mb-3 text-center">Your Stats</h3>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="bg-gray-700 p-2 rounded">
          <div className="text-gray-400">Games Played</div>
          <div className="text-xl font-bold">{progress.gamesPlayed}</div>
        </div>
        <div className="bg-gray-700 p-2 rounded">
          <div className="text-gray-400">Total Food</div>
          <div className="text-xl font-bold">{progress.totalFoodEaten}</div>
        </div>
        <div className="bg-gray-700 p-2 rounded">
          <div className="text-gray-400">High Score</div>
          <div className="text-xl font-bold text-amber-400">{progress.highScore}</div>
        </div>
        <div className="bg-gray-700 p-2 rounded">
          <div className="text-gray-400">Longest Snake</div>
          <div className="text-xl font-bold text-green-400">{progress.longestSnake}</div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// MAIN GAME COMPONENT
// ============================================
export function SnakeGame() {
  const store = useSnakeStore();
  const { status, progress, tick, setDirection } = store;
  const gameLoopRef = useRef<NodeJS.Timeout | null>(null);

  // Sync with auth system
  const { isAuthenticated, syncStatus, forceSync } = useAuthSync({
    appId: "snake",
    localStorageKey: "snake-game-state",
    getState: () => store.getProgress(),
    setState: (data: SnakeProgress) => store.setProgress(data),
    debounceMs: 2000,
  });

  // Force save immediately on game over
  useEffect(() => {
    if (status === "game-over") {
      forceSync();
    }
  }, [status, forceSync]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent default for arrow keys to avoid scrolling
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) {
        e.preventDefault();
      }

      switch (e.key) {
        case "ArrowUp":
        case "w":
        case "W":
          setDirection("up");
          break;
        case "ArrowDown":
        case "s":
        case "S":
          setDirection("down");
          break;
        case "ArrowLeft":
        case "a":
        case "A":
          setDirection("left");
          break;
        case "ArrowRight":
        case "d":
        case "D":
          setDirection("right");
          break;
        case " ":
          if (status === "playing") {
            store.pauseGame();
          } else if (status === "paused") {
            store.resumeGame();
          } else if (status === "idle" || status === "game-over") {
            store.startGame();
          }
          break;
        case "r":
        case "R":
          if (status === "game-over") {
            store.startGame();
          }
          break;
        case "Escape":
          if (status === "playing") {
            store.pauseGame();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setDirection, status, store]);

  // Game loop
  useEffect(() => {
    if (status === "playing") {
      const interval = getTickInterval(progress.speed, store.snake.length);

      gameLoopRef.current = setInterval(() => {
        tick();
      }, interval);

      return () => {
        if (gameLoopRef.current) {
          clearInterval(gameLoopRef.current);
        }
      };
    } else {
      if (gameLoopRef.current) {
        clearInterval(gameLoopRef.current);
        gameLoopRef.current = null;
      }
    }
  }, [status, tick, progress.speed, store.snake.length]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-800 to-green-950 p-4 flex flex-col items-center justify-center gap-6">
      {/* iOS install prompt */}
      <IOSInstallPrompt />


      {/* Header */}
      <header className="text-center">
        <h1 className="text-4xl md:text-5xl font-bold text-white mb-2">Snake</h1>
        <p className="text-green-200">Eat food and grow longer!</p>
      </header>

      {/* Game Board */}
      <div className="flex flex-col items-center">
        <GameBoard />
      </div>

      {/* Game UI (score, buttons) */}
      <GameUI />

      {/* Mobile Controls */}
      <div className="md:hidden">
        <MobileControls />
      </div>

      {/* Desktop keyboard hint */}
      <div className="hidden md:block text-green-300 text-sm text-center">
        Use WASD or Arrow Keys to move | Space to pause | R to restart
      </div>

      {/* Settings */}
      <SettingsPanel />

      {/* Stats */}
      <StatsDisplay />

      {/* Sync status indicator */}
      {isAuthenticated && (
        <div className="fixed bottom-2 right-2 text-xs text-green-300/60">
          {syncStatus === "syncing" ? "Saving..." : syncStatus === "synced" ? "Saved" : ""}
        </div>
      )}
    </div>
  );
}

export default SnakeGame;
