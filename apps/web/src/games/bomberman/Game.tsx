"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useBombermanStore, type BombermanProgress } from "./lib/store";
import {
  GRID_WIDTH,
  GRID_HEIGHT,
  TILE_SIZE,
  COLORS,
  ENEMY_CONFIGS,
  POWER_UPS,
  type Direction,
} from "./lib/constants";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import { GameStartOverlay } from "@/shared/components/GameStartOverlay";
import { useCoarsePointer } from "@/shared/hooks/useCoarsePointer";

const CANVAS_WIDTH = GRID_WIDTH * TILE_SIZE;
const CANVAS_HEIGHT = GRID_HEIGHT * TILE_SIZE;

export function BombermanGame() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const keysRef = useRef<Set<string>>(new Set());

  const store = useBombermanStore();
  const isCoarse = useCoarsePointer();
  // Touch controls default ON: a coarse-pointer kid needs the D-pad to move.
  // The isCoarse gate (below) is what keeps the D-pad off fine-pointer desktops,
  // so this default no longer leaks controls onto every viewport; the 🎮 toggle
  // then lets touch users hide them.
  const [showControls, setShowControls] = useState(true);

  // Auth sync
  const { forceSync } = useAuthSync({
    appId: "bomberman",
    localStorageKey: "bomberman-state",
    getState: store.getProgress,
    setState: store.setProgress,
    debounceMs: 3000,
  });

  // Force save immediately on game end
  useEffect(() => {
    if (store.gameState === "won" || store.gameState === "lost") {
      forceSync();
    }
  }, [store.gameState, forceSync]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keysRef.current.add(e.key.toLowerCase());

      if (store.gameState === "playing") {
        if (e.key === "Escape" || e.key.toLowerCase() === "p") {
          store.pauseGame();
        }
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          store.placeBomb();
        }
      } else if (store.gameState === "paused") {
        if (e.key === "Escape" || e.key.toLowerCase() === "p") {
          store.resumeGame();
        }
      } else if (store.gameState === "menu") {
        if (e.key === " " || e.key === "Enter") {
          store.startGame();
        }
      } else if (store.gameState === "won") {
        if (e.key === " " || e.key === "Enter") {
          store.nextLevel();
        }
      } else if (store.gameState === "lost") {
        if (e.key === " " || e.key === "Enter") {
          store.resetGame();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key.toLowerCase());
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [store]);

  // Movement from keys
  const moveFromKeys = useCallback(() => {
    if (store.gameState !== "playing" || !store.player.alive) return;

    const keys = keysRef.current;
    let direction: Direction | null = null;

    if (keys.has("w") || keys.has("arrowup")) direction = "UP";
    else if (keys.has("s") || keys.has("arrowdown")) direction = "DOWN";
    else if (keys.has("a") || keys.has("arrowleft")) direction = "LEFT";
    else if (keys.has("d") || keys.has("arrowright")) direction = "RIGHT";

    if (direction) {
      store.movePlayer(direction);
    }
  }, [store]);

  // Draw game
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear
    ctx.fillStyle = COLORS.FLOOR;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw grid
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const tile = store.grid[y][x];
        const px = x * TILE_SIZE;
        const py = y * TILE_SIZE;

        // Checkerboard floor
        if ((x + y) % 2 === 0) {
          ctx.fillStyle = COLORS.FLOOR_ALT;
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        }

        // Tile content
        switch (tile.type) {
          case "wall":
            ctx.fillStyle = COLORS.WALL;
            ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
            ctx.fillStyle = COLORS.WALL_BORDER;
            ctx.fillRect(px, py, TILE_SIZE, 4);
            ctx.fillRect(px, py + TILE_SIZE - 4, TILE_SIZE, 4);
            break;

          case "block":
            ctx.fillStyle = COLORS.BLOCK;
            ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
            ctx.fillStyle = COLORS.BLOCK_BORDER;
            ctx.fillRect(px + 2, py + TILE_SIZE - 8, TILE_SIZE - 4, 6);
            break;

          case "exit":
            if (tile.revealed) {
              ctx.fillStyle = "#4CAF50";
              ctx.beginPath();
              ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, TILE_SIZE / 3, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = "#fff";
              ctx.font = "20px sans-serif";
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText("🚪", px + TILE_SIZE / 2, py + TILE_SIZE / 2);
            } else {
              // Hidden as block
              ctx.fillStyle = COLORS.BLOCK;
              ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
            }
            break;

          case "empty":
            // Draw power-up if revealed
            if (tile.powerUp) {
              const powerUp = POWER_UPS.find(p => p.type === tile.powerUp);
              if (powerUp) {
                ctx.font = "28px sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(powerUp.emoji, px + TILE_SIZE / 2, py + TILE_SIZE / 2);
              }
            }
            break;
        }
      }
    }

    // Draw bombs
    const now = Date.now();
    for (const bomb of store.bombs) {
      const px = bomb.x * TILE_SIZE;
      const py = bomb.y * TILE_SIZE;

      // Pulsing effect
      const pulse = Math.sin(now / 100) * 0.1 + 0.9;
      const size = TILE_SIZE * 0.7 * pulse;
      const offset = (TILE_SIZE - size) / 2;

      ctx.fillStyle = "#333";
      ctx.beginPath();
      ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, size / 2, 0, Math.PI * 2);
      ctx.fill();

      // Fuse
      ctx.strokeStyle = "#FF5722";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px + TILE_SIZE / 2, py + offset);
      ctx.lineTo(px + TILE_SIZE / 2 + 8, py + offset - 8);
      ctx.stroke();

      // Spark
      if (Math.floor(now / 200) % 2 === 0) {
        ctx.fillStyle = "#FFEB3B";
        ctx.beginPath();
        ctx.arc(px + TILE_SIZE / 2 + 8, py + offset - 8, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw explosions
    for (const exp of store.explosions) {
      const px = exp.x * TILE_SIZE;
      const py = exp.y * TILE_SIZE;

      const progress = exp.timer / 400;
      const size = TILE_SIZE * (0.6 + progress * 0.4);
      const offset = (TILE_SIZE - size) / 2;

      // Outer
      ctx.fillStyle = COLORS.EXPLOSION;
      ctx.globalAlpha = progress;
      ctx.fillRect(px + offset, py + offset, size, size);

      // Inner
      ctx.fillStyle = COLORS.EXPLOSION_CENTER;
      ctx.fillRect(px + offset + 8, py + offset + 8, size - 16, size - 16);

      ctx.globalAlpha = 1;
    }

    // Draw enemies
    for (const enemy of store.enemies) {
      if (!enemy.alive) continue;

      const px = enemy.x * TILE_SIZE;
      const py = enemy.y * TILE_SIZE;
      const config = ENEMY_CONFIGS[enemy.type];

      ctx.font = "32px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(config.emoji, px + TILE_SIZE / 2, py + TILE_SIZE / 2);
    }

    // Draw player
    if (store.player.alive) {
      const px = store.player.x * TILE_SIZE;
      const py = store.player.y * TILE_SIZE;

      // Invincibility flash
      if (store.player.invincible <= 0 || Math.floor(now / 100) % 2 === 0) {
        // Player body
        ctx.fillStyle = "#2196F3";
        ctx.beginPath();
        ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, TILE_SIZE / 3, 0, Math.PI * 2);
        ctx.fill();

        // Face
        ctx.font = "24px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("😎", px + TILE_SIZE / 2, py + TILE_SIZE / 2);

        // Shield indicator
        if (store.player.hasShield) {
          ctx.strokeStyle = "#4CAF50";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, TILE_SIZE / 2.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
  }, [store.grid, store.bombs, store.explosions, store.enemies, store.player]);

  // Game loop
  useEffect(() => {
    let moveTimer = 0;
    const MOVE_RATE = 120; // ms between moves

    const gameLoop = (timestamp: number) => {
      const deltaTime = timestamp - lastTimeRef.current;
      lastTimeRef.current = timestamp;

      if (store.gameState === "playing") {
        // Update game state
        store.update(deltaTime);

        // Handle keyboard movement with rate limiting
        moveTimer += deltaTime;
        if (moveTimer >= MOVE_RATE / store.player.speed) {
          moveFromKeys();
          moveTimer = 0;
        }
      }

      draw();
      animationRef.current = requestAnimationFrame(gameLoop);
    };

    lastTimeRef.current = performance.now();
    animationRef.current = requestAnimationFrame(gameLoop);

    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [store, draw, moveFromKeys]);

  // Touch D-pad
  const handleDpadPress = (direction: Direction) => {
    if (store.gameState === "playing") {
      store.movePlayer(direction);
    }
  };

  // Touch bomb button
  const handleBombPress = () => {
    if (store.gameState === "playing") {
      store.placeBomb();
    }
  };

  const toggleSound = () => {
    store.setProgress({
      ...store.progress,
      settings: {
        ...store.progress.settings,
        soundEnabled: !store.progress.settings.soundEnabled,
      },
    });
  };

  return (
    <div
      ref={containerRef}
      className="flex flex-col items-center min-h-screen bg-gray-900 p-4 select-none"
    >
      {/* HUD */}
      <div className="w-full max-w-[624px] flex justify-between items-center mb-2 text-white">
        <div className="flex gap-4">
          <span>Level: {store.level}</span>
          <span>Score: {store.score}</span>
        </div>
        <div className="flex gap-4">
          <span>Lives: {"❤️".repeat(store.lives)}</span>
          <span>💣 x{store.player.maxBombs - store.player.bombCount}</span>
        </div>
      </div>

      {/* Power-up indicators */}
      <div className="w-full max-w-[624px] flex gap-2 mb-2">
        <div className="bg-gray-800 px-2 py-1 rounded text-white text-sm">
          🔥 {store.player.blastRange}
        </div>
        {store.player.hasKick && (
          <div className="bg-gray-800 px-2 py-1 rounded text-white text-sm">🦶</div>
        )}
        {store.player.hasShield && (
          <div className="bg-gray-800 px-2 py-1 rounded text-white text-sm">🛡️</div>
        )}
      </div>

      {/* Canvas */}
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="rounded-lg shadow-2xl"
          style={{
            maxWidth: "100%",
            height: "auto",
            touchAction: "none",
          }}
        />

        {/* Menu overlay: shared DOM start screen */}
        {store.gameState === "menu" && (
          <GameStartOverlay
            title="Bomberman"
            emoji="💣"
            subtitle="Destroy blocks. Defeat enemies. Find the exit!"
            keyboardHints={["WASD or Arrows to move", "SPACE to drop bombs"]}
            touchHints={["Tap the arrows to move", "Tap 💣 to drop bombs"]}
            onStart={() => store.startGame()}
          >
            <div className="text-base font-medium opacity-90">
              🏆 High Score: {store.progress.highScore}
            </div>
          </GameStartOverlay>
        )}

        {/* Paused overlay */}
        {store.gameState === "paused" && (
          <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center rounded-lg">
            <h2 className="text-4xl font-bold text-white mb-8">⏸️ PAUSED</h2>
            <button
              onClick={() => store.resumeGame()}
              className="bg-blue-500 hover:bg-blue-400 text-white px-8 py-4 rounded-xl text-xl font-bold mb-4"
            >
              RESUME
            </button>
            <button
              onClick={() => store.resetGame()}
              className="bg-gray-600 hover:bg-gray-500 text-white px-6 py-2 rounded-lg"
            >
              Quit to Menu
            </button>
          </div>
        )}

        {/* Won overlay */}
        {store.gameState === "won" && (
          <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center rounded-lg">
            <h2 className="text-4xl font-bold text-green-400 mb-4">🎉 LEVEL COMPLETE!</h2>
            <p className="text-white text-xl mb-8">Score: {store.score}</p>
            <button
              onClick={() => store.nextLevel()}
              className="bg-green-500 hover:bg-green-400 text-white px-8 py-4 rounded-xl text-xl font-bold mb-4"
            >
              NEXT LEVEL
            </button>
          </div>
        )}

        {/* Lost overlay */}
        {store.gameState === "lost" && (
          <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center rounded-lg">
            <h2 className="text-4xl font-bold text-red-400 mb-4">💀 GAME OVER</h2>
            <p className="text-white text-xl mb-2">Score: {store.score}</p>
            <p className="text-gray-400 mb-8">Level reached: {store.level}</p>
            {store.score > 0 && store.score === store.progress.highScore && (
              <p className="text-yellow-400 text-xl mb-4">🏆 NEW HIGH SCORE!</p>
            )}
            <button
              onClick={() => store.resetGame()}
              className="bg-red-500 hover:bg-red-400 text-white px-8 py-4 rounded-xl text-xl font-bold"
            >
              TRY AGAIN
            </button>
          </div>
        )}
      </div>

      {/* Mobile controls — touch (coarse-pointer) viewports only */}
      {isCoarse && showControls && (
        <div className="mt-4 flex justify-between items-center w-full max-w-[624px]">
          {/* D-Pad */}
          <div className="relative w-36 h-36">
            {/* Up */}
            <button
              onTouchStart={() => handleDpadPress("UP")}
              className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-12 bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded-lg text-white text-2xl"
            >
              ▲
            </button>
            {/* Down */}
            <button
              onTouchStart={() => handleDpadPress("DOWN")}
              className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-12 bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded-lg text-white text-2xl"
            >
              ▼
            </button>
            {/* Left */}
            <button
              onTouchStart={() => handleDpadPress("LEFT")}
              className="absolute left-0 top-1/2 -translate-y-1/2 w-12 h-12 bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded-lg text-white text-2xl"
            >
              ◀
            </button>
            {/* Right */}
            <button
              onTouchStart={() => handleDpadPress("RIGHT")}
              className="absolute right-0 top-1/2 -translate-y-1/2 w-12 h-12 bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded-lg text-white text-2xl"
            >
              ▶
            </button>
          </div>

          {/* Bomb button */}
          <button
            onTouchStart={handleBombPress}
            onClick={handleBombPress}
            className="w-24 h-24 bg-red-600 hover:bg-red-500 active:bg-red-400 rounded-full text-5xl shadow-lg"
          >
            💣
          </button>
        </div>
      )}

      {/* Control row */}
      <div className="mt-4 flex items-center gap-4">
        <button
          onClick={toggleSound}
          className="w-12 h-12 bg-gray-700 hover:bg-gray-600 rounded-full flex items-center justify-center text-white"
        >
          {store.progress.settings.soundEnabled ? "🔊" : "🔇"}
        </button>
        {isCoarse && (
          <button
            onClick={() => setShowControls(!showControls)}
            className="w-12 h-12 bg-gray-700 hover:bg-gray-600 rounded-full flex items-center justify-center text-white"
          >
            🎮
          </button>
        )}
        {store.gameState === "playing" && (
          <button
            onClick={() => store.pauseGame()}
            className="w-12 h-12 bg-gray-700 hover:bg-gray-600 rounded-full flex items-center justify-center text-white"
          >
            ⏸️
          </button>
        )}
        <IOSInstallPrompt />
      </div>

      {/* Stats */}
      <div className="mt-4 text-gray-400 text-sm">
        <span>High Score: {store.progress.highScore}</span>
        <span className="mx-4">|</span>
        <span>Best Level: {store.progress.highestLevel}</span>
        <span className="mx-4">|</span>
        <span>Enemies Defeated: {store.progress.totalEnemiesDefeated}</span>
      </div>
    </div>
  );
}

export default BombermanGame;
