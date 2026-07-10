"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useBreakoutStore, type BreakoutProgress } from "./lib/store";
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  COLORS,
  POWERUP_CONFIG,
  type Ball,
  type Brick,
  type PowerUp,
  type Paddle,
  type Particle,
} from "./lib/constants";
import { getLevel, getTotalLevels } from "./lib/levels";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";

// ============================================
// CANVAS RENDERER
// ============================================
function useCanvasRenderer(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const store = useBreakoutStore();

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { paddle, balls, bricks, powerUps, particles, score, lives, level, status, activePowerUps } = store;

    // Clear canvas
    ctx.fillStyle = COLORS.BACKGROUND;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw bricks
    for (const brick of bricks) {
      // Darken tough bricks that have taken damage
      let color = brick.color;
      if (brick.type === "tough" && brick.hitsRemaining === 1) {
        color = "#6b7280"; // Darker silver
      }

      ctx.fillStyle = color;
      ctx.fillRect(brick.x, brick.y, brick.width, brick.height);

      // Add highlight
      ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
      ctx.fillRect(brick.x, brick.y, brick.width, 3);

      // Add shadow
      ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
      ctx.fillRect(brick.x, brick.y + brick.height - 3, brick.width, 3);

      // Border
      ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
      ctx.lineWidth = 1;
      ctx.strokeRect(brick.x, brick.y, brick.width, brick.height);
    }

    // Draw particles
    for (const particle of particles) {
      const alpha = particle.life / particle.maxLife;
      ctx.fillStyle = particle.color;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Draw power-ups
    for (const powerUp of powerUps) {
      const config = POWERUP_CONFIG[powerUp.type];

      // Background
      ctx.fillStyle = config.color;
      ctx.fillRect(powerUp.x, powerUp.y, powerUp.width, powerUp.height);

      // Border
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.strokeRect(powerUp.x, powerUp.y, powerUp.width, powerUp.height);

      // Icon text
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 10px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(config.icon, powerUp.x + powerUp.width / 2, powerUp.y + powerUp.height / 2);
    }

    // Draw paddle
    const paddleGradient = ctx.createLinearGradient(paddle.x, paddle.y, paddle.x, paddle.y + paddle.height);
    paddleGradient.addColorStop(0, "#60a5fa");
    paddleGradient.addColorStop(0.5, COLORS.PADDLE);
    paddleGradient.addColorStop(1, "#2563eb");
    ctx.fillStyle = paddleGradient;
    ctx.beginPath();
    ctx.roundRect(paddle.x, paddle.y, paddle.width, paddle.height, 4);
    ctx.fill();

    // Paddle highlight
    ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
    ctx.fillRect(paddle.x + 2, paddle.y + 2, paddle.width - 4, 3);

    // Draw balls
    for (const ball of balls) {
      // Ball glow
      const glowGradient = ctx.createRadialGradient(
        ball.x, ball.y, 0,
        ball.x, ball.y, ball.radius * 2
      );
      glowGradient.addColorStop(0, "rgba(255, 255, 255, 0.3)");
      glowGradient.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = glowGradient;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius * 2, 0, Math.PI * 2);
      ctx.fill();

      // Ball
      const ballGradient = ctx.createRadialGradient(
        ball.x - ball.radius / 3, ball.y - ball.radius / 3, 0,
        ball.x, ball.y, ball.radius
      );
      ballGradient.addColorStop(0, "#ffffff");
      ballGradient.addColorStop(1, "#d1d5db");
      ctx.fillStyle = ballGradient;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw HUD
    ctx.fillStyle = COLORS.HUD_TEXT;
    ctx.font = "bold 18px Arial";
    ctx.textAlign = "left";
    ctx.fillText(`Score: ${score}`, 10, 25);

    ctx.textAlign = "center";
    ctx.fillText(`Level ${level}`, CANVAS_WIDTH / 2, 25);

    ctx.textAlign = "right";
    // Draw lives as hearts
    const heartText = "❤️".repeat(lives);
    ctx.font = "16px Arial";
    ctx.fillText(heartText, CANVAS_WIDTH - 10, 25);

    // Draw active power-up indicators
    const activePowerUpTypes = [...new Set(activePowerUps.map(p => p.type))];
    if (activePowerUpTypes.length > 0) {
      ctx.font = "bold 12px Arial";
      ctx.textAlign = "left";
      let x = 10;
      const y = 45;

      for (const type of activePowerUpTypes) {
        const config = POWERUP_CONFIG[type];
        const powerUp = activePowerUps.find(p => p.type === type)!;
        const remaining = Math.max(0, powerUp.expiresAt - Date.now());
        const seconds = Math.ceil(remaining / 1000);

        ctx.fillStyle = config.color;
        ctx.fillRect(x, y - 10, 50, 14);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(`${config.icon} ${seconds}s`, x + 4, y);
        x += 55;
      }
    }

    // Draw launch hint
    if (balls.some(b => b.stuck)) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
      ctx.font = "16px Arial";
      ctx.textAlign = "center";
      ctx.fillText("Tap or Press Space to Launch!", CANVAS_WIDTH / 2, CANVAS_HEIGHT - 80);
    }

    // Draw overlays for game states
    if (status === "paused") {
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 36px Arial";
      ctx.textAlign = "center";
      ctx.fillText("PAUSED", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 20);

      ctx.font = "18px Arial";
      ctx.fillText("Tap or Press Space to Resume", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 20);
    }

    if (status === "game-over") {
      ctx.fillStyle = COLORS.GAME_OVER_BG;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      ctx.fillStyle = "#ef4444";
      ctx.font = "bold 42px Arial";
      ctx.textAlign = "center";
      ctx.fillText("GAME OVER", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 60);

      ctx.fillStyle = "#ffffff";
      ctx.font = "24px Arial";
      ctx.fillText(`Final Score: ${score}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);

      ctx.font = "18px Arial";
      ctx.fillText(`Level Reached: ${level}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 35);

      ctx.fillStyle = "#22c55e";
      ctx.font = "bold 20px Arial";
      ctx.fillText("Tap or Press Space to Play Again!", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 90);
    }

    if (status === "level-complete") {
      ctx.fillStyle = COLORS.LEVEL_COMPLETE_BG;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 36px Arial";
      ctx.textAlign = "center";
      ctx.fillText("LEVEL COMPLETE!", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 40);

      ctx.font = "24px Arial";
      ctx.fillText(`Score: ${score}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 10);

      if (level < getTotalLevels()) {
        ctx.fillStyle = "#fbbf24";
        ctx.font = "bold 20px Arial";
        ctx.fillText("Tap or Press Space for Next Level!", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 60);
      } else {
        ctx.fillStyle = "#fbbf24";
        ctx.font = "bold 20px Arial";
        ctx.fillText("You Beat All Levels! Amazing!", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 60);
        ctx.fillText("Tap or Press Space to Play Again!", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 90);
      }
    }
  }, [canvasRef, store]);

  return render;
}

// ============================================
// GAME CANVAS COMPONENT
// ============================================
function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const store = useBreakoutStore();
  const { status, movePaddle, launchBall, pauseGame, resumeGame, startGame, nextLevel } = store;

  const render = useCanvasRenderer(canvasRef);

  // Calculate scale for responsive canvas
  useEffect(() => {
    const updateScale = () => {
      if (!containerRef.current) return;

      const containerWidth = containerRef.current.clientWidth;
      const containerHeight = containerRef.current.clientHeight;

      const scaleX = containerWidth / CANVAS_WIDTH;
      const scaleY = containerHeight / CANVAS_HEIGHT;
      const newScale = Math.min(scaleX, scaleY, 1.5); // Cap at 1.5x

      setScale(newScale);
    };

    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  // Game loop
  useEffect(() => {
    let animationFrameId: number;
    let lastTime = performance.now();

    const gameLoop = (currentTime: number) => {
      const deltaTime = currentTime - lastTime;
      lastTime = currentTime;

      if (status === "playing") {
        store.update(deltaTime);
      }

      render();
      animationFrameId = requestAnimationFrame(gameLoop);
    };

    animationFrameId = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(animationFrameId);
  }, [status, store, render]);

  // Mouse control is RELATIVE: the paddle follows the direction the
  // mouse moves (movementX), not where the cursor happens to sit. This
  // kills the dead zone that absolute tracking had - with the cursor
  // parked far off-board, the paddle used to ignore rightward motion
  // until the cursor traveled all the way back over the board. Now any
  // motion anywhere over the page moves the paddle instantly, and the
  // cursor stays visible and free (pointer lock hid it system-wide,
  // which was scary). movePaddle clamps, so excess motion past a wall
  // is simply discarded instead of accumulating drift.
  useEffect(() => {
    const handleWindowPointerMove = (e: PointerEvent) => {
      // Touch drags are handled absolutely by handleTouchMove; relative
      // deltas from synthesized pointer events would double-move.
      if (e.pointerType === "touch") return;

      const { paddle } = useBreakoutStore.getState();
      const center = paddle.x + paddle.width / 2;
      movePaddle(center + e.movementX / scale);
    };

    window.addEventListener("pointermove", handleWindowPointerMove);
    return () => window.removeEventListener("pointermove", handleWindowPointerMove);
  }, [movePaddle, scale]);

  // Handle touch move for mobile
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!canvasRef.current) return;
    e.preventDefault();

    const rect = canvasRef.current.getBoundingClientRect();
    const touch = e.touches[0];
    const x = (touch.clientX - rect.left) / scale;
    movePaddle(x);
  }, [movePaddle, scale]);

  // Handle clicks/taps
  const handleClick = useCallback(() => {
    if (status === "idle") {
      startGame();
    } else if (status === "playing") {
      // If ball is stuck, launch it
      if (store.balls.some(b => b.stuck)) {
        launchBall();
      }
    } else if (status === "paused") {
      resumeGame();
    } else if (status === "game-over") {
      startGame();
    } else if (status === "level-complete") {
      if (store.level < getTotalLevels()) {
        nextLevel();
      } else {
        startGame();
      }
    }
  }, [status, store.balls, store.level, startGame, launchBall, resumeGame, nextLevel]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (["ArrowLeft", "ArrowRight", " ", "Escape", "p", "P"].includes(e.key)) {
        e.preventDefault();
      }

      switch (e.key) {
        case "ArrowLeft":
        case "a":
        case "A":
          movePaddle(store.paddle.x - 20);
          break;
        case "ArrowRight":
        case "d":
        case "D":
          movePaddle(store.paddle.x + store.paddle.width + 20);
          break;
        case " ":
          handleClick();
          break;
        case "Escape":
        case "p":
        case "P":
          if (status === "playing") {
            pauseGame();
          } else if (status === "paused") {
            resumeGame();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [movePaddle, store.paddle.x, store.paddle.width, status, handleClick, pauseGame, resumeGame]);

  return (
    <div
      ref={containerRef}
      className="w-full max-w-lg mx-auto flex items-center justify-center"
      style={{ aspectRatio: `${CANVAS_WIDTH}/${CANVAS_HEIGHT}` }}
    >
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className="border-4 border-blue-600 rounded-lg shadow-2xl touch-none cursor-default"
        style={{
          width: CANVAS_WIDTH * scale,
          height: CANVAS_HEIGHT * scale,
        }}
        onTouchMove={handleTouchMove}
        onClick={handleClick}
        onTouchStart={handleClick}
      />
    </div>
  );
}

// ============================================
// STATS DISPLAY
// ============================================
function StatsDisplay() {
  const { progress } = useBreakoutStore();

  return (
    <div className="w-full max-w-lg mx-auto bg-gray-800/80 rounded-lg p-4 text-white">
      <h3 className="font-bold text-lg mb-3 text-center">Your Stats</h3>
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div className="bg-gray-700/50 p-2 rounded text-center">
          <div className="text-gray-400 text-xs">High Score</div>
          <div className="text-xl font-bold text-amber-400">{progress.highScore}</div>
        </div>
        <div className="bg-gray-700/50 p-2 rounded text-center">
          <div className="text-gray-400 text-xs">Highest Level</div>
          <div className="text-xl font-bold text-green-400">{progress.highestLevel}</div>
        </div>
        <div className="bg-gray-700/50 p-2 rounded text-center">
          <div className="text-gray-400 text-xs">Bricks Smashed</div>
          <div className="text-xl font-bold text-red-400">{progress.totalBricksDestroyed}</div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// SETTINGS PANEL
// ============================================
function SettingsPanel() {
  const { progress } = useBreakoutStore();
  const [isOpen, setIsOpen] = useState(false);

  const toggleSound = () => {
    useBreakoutStore.setState(state => ({
      progress: {
        ...state.progress,
        soundEnabled: !state.progress.soundEnabled,
        lastModified: Date.now(),
      }
    }));
  };

  return (
    <div className="w-full max-w-lg mx-auto">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full bg-gray-700/80 hover:bg-gray-600 text-white py-2 px-4 rounded-lg flex items-center justify-between"
      >
        <span>Settings</span>
        <span
          className="transform transition-transform"
          style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0)" }}
        >
          ▼
        </span>
      </button>

      {isOpen && (
        <div className="mt-2 bg-gray-800/80 rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-white font-bold">Sound Effects</label>
            <button
              onClick={toggleSound}
              className={`w-14 h-8 rounded-full transition-all ${
                progress.soundEnabled ? "bg-green-600" : "bg-gray-600"
              }`}
            >
              <div
                className={`w-6 h-6 bg-white rounded-full shadow transition-transform ${
                  progress.soundEnabled ? "translate-x-7" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// MAIN GAME COMPONENT
// ============================================
export function BreakoutGame() {
  const store = useBreakoutStore();
  const { status, progress } = store;

  // Sync with auth system
  const { isAuthenticated, syncStatus, forceSync } = useAuthSync({
    appId: "breakout",
    localStorageKey: "breakout-game-state",
    getState: () => store.getProgress(),
    setState: (data: BreakoutProgress) => store.setProgress(data),
    debounceMs: 2000,
  });

  // Force save immediately on game over or level complete
  useEffect(() => {
    if (status === "game-over" || status === "level-complete") {
      forceSync();
    }
  }, [status, forceSync]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-900 via-purple-900 to-indigo-950 p-4 flex flex-col items-center justify-center gap-4">
      {/* iOS install prompt */}
      <IOSInstallPrompt />


      {/* Header */}
      <header className="text-center">
        <h1 className="text-4xl md:text-5xl font-bold text-white mb-2">Breakout</h1>
        <p className="text-purple-200">Break all the bricks!</p>
      </header>

      {/* Game Canvas */}
      <GameCanvas />

      {/* Controls hint */}
      <div className="text-center text-purple-200 text-sm">
        <span className="hidden md:inline">Slide mouse left/right to steer | Arrow keys work too | Space to launch/pause</span>
        <span className="md:hidden">Drag to move paddle | Tap to launch</span>
      </div>

      {/* Settings */}
      <SettingsPanel />

      {/* Stats */}
      <StatsDisplay />

      {/* Sync status indicator */}
      {isAuthenticated && (
        <div className="fixed bottom-2 right-2 text-xs text-purple-300/60">
          {syncStatus === "syncing" ? "Saving..." : syncStatus === "synced" ? "Saved" : ""}
        </div>
      )}
    </div>
  );
}

export default BreakoutGame;
