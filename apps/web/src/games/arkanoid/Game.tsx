"use client";

import { useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useArkanoidStore, type Ball } from "./lib/store";
import { BALL_CONFIG, PHYSICS, PADDLE, WALLS, GAME, GRID, getSpawnedBallType } from "./lib/constants";

export function ArkanoidGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);

  const {
    gameState,
    score,
    multiplier,
    balls,
    soundEnabled,
    progress,
    wasNewHighScore,
    startGame,
    pauseGame,
    resumeGame,
    endGame,
    setPaddleX,
    addBall,
    updateBalls,
    addScore,
    updateMultiplier,
    toggleSound,
  } = useArkanoidStore();

  // Mouse/touch handlers for paddle
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleMove = (clientX: number) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * 2 - 1;
      setPaddleX(x);
    };

    const handleMouseMove = (e: MouseEvent) => handleMove(e.clientX);
    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length > 0) {
        handleMove(e.touches[0].clientX);
      }
    };

    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("touchmove", handleTouchMove, { passive: false });

    return () => {
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("touchmove", handleTouchMove);
    };
  }, [setPaddleX]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Escape") {
        e.preventDefault();
        if (gameState === "playing") {
          pauseGame();
        } else if (gameState === "paused") {
          resumeGame();
        }
      }
      // Use getState() to avoid stale closure - always gets current paddleX
      if (e.key === "ArrowLeft") {
        const current = useArkanoidStore.getState().paddleX;
        setPaddleX(Math.max(-0.85, current - 0.1));
      }
      if (e.key === "ArrowRight") {
        const current = useArkanoidStore.getState().paddleX;
        setPaddleX(Math.min(0.85, current + 0.1));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [gameState, pauseGame, resumeGame, setPaddleX]);

  // Render function
  const render = useCallback((
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    ballsToRender: Ball[]
  ) => {
    const w = canvas.width;
    const h = canvas.height;

    // Clear
    ctx.fillStyle = GAME.canvasColor;
    ctx.fillRect(0, 0, w, h);

    // Helper: normalized to screen coordinates
    const toScreen = (nx: number, ny: number) => ({
      x: ((nx + 1) / 2) * w,
      y: ((1 - ny) / 2) * h,
    });

    // Draw grid background
    ctx.fillStyle = GRID.color;
    const gridSize = GRID.spacing * w;
    for (let gx = 0; gx < w; gx += gridSize) {
      for (let gy = 0; gy < h / 2; gy += gridSize) {
        // Checkerboard pattern
        if ((Math.floor(gx / gridSize) + Math.floor(gy / gridSize)) % 2 === 0) {
          ctx.fillStyle = GRID.color;
        } else {
          ctx.fillStyle = GRID.alternateColor;
        }
        ctx.fillRect(gx, gy, gridSize, gridSize);
      }
    }

    // Draw walls
    ctx.fillStyle = GAME.wallColor;
    for (const wall of WALLS) {
      const topLeft = toScreen(wall.x - wall.width / 2, wall.y + wall.height / 2);
      const screenWidth = wall.width * (w / 2);
      const screenHeight = wall.height * (h / 2);
      ctx.fillRect(topLeft.x, topLeft.y, screenWidth, screenHeight);
    }

    // Draw paddle
    const currentPaddleX = useArkanoidStore.getState().paddleX;
    const paddleLeft = toScreen(currentPaddleX - PADDLE.width / 2, PADDLE.y + PADDLE.height / 2);
    const paddleWidth = PADDLE.width * (w / 2);
    const paddleHeight = PADDLE.height * (h / 2);

    // Gradient paddle
    const gradient = ctx.createLinearGradient(
      paddleLeft.x,
      paddleLeft.y,
      paddleLeft.x + paddleWidth,
      paddleLeft.y
    );
    gradient.addColorStop(0, "#fbbf24");
    gradient.addColorStop(0.5, "#ef4444");
    gradient.addColorStop(1, "#fbbf24");
    ctx.fillStyle = gradient;
    ctx.fillRect(paddleLeft.x, paddleLeft.y, paddleWidth, paddleHeight);

    // Paddle border
    ctx.strokeStyle = PADDLE.borderColor;
    ctx.lineWidth = 3;
    ctx.strokeRect(paddleLeft.x, paddleLeft.y, paddleWidth, paddleHeight);

    // Draw balls
    ballsToRender.forEach((ball) => {
      const pos = toScreen(ball.x, ball.y);
      const radius = BALL_CONFIG[ball.type].radius * (w / 2);

      // Ball gradient
      const ballGradient = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, radius);
      ballGradient.addColorStop(0, BALL_CONFIG[ball.type].color);
      ballGradient.addColorStop(1, "#1e293b");

      ctx.fillStyle = ballGradient;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
      ctx.fill();
    });
  }, []);

  // Main game loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || gameState !== "playing") return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let lastTime = Date.now();

    const gameLoop = () => {
      const now = Date.now();
      const dtMs = Math.min(now - lastTime, 50); // Cap delta time in ms
      const dt = dtMs / 1000; // Convert to seconds for physics
      lastTime = now;

      // Get current state directly from store (avoid stale closures)
      const currentBalls = useArkanoidStore.getState().balls;
      const currentPaddleX = useArkanoidStore.getState().paddleX;

      // Update physics
      const updatedBalls = currentBalls.map((ball) => {
        let { x, y, vx, vy } = ball;

        // Apply gravity
        vy -= PHYSICS.gravity * dt;

        // Update position
        x += vx * dt;
        y += vy * dt;

        // Ball radius
        const radius = BALL_CONFIG[ball.type].radius;

        // Wall collisions
        let hitWall = false;
        for (const wall of WALLS) {
          const halfWidth = wall.width / 2;
          const halfHeight = wall.height / 2;

          // Simple AABB collision
          if (
            x + radius > wall.x - halfWidth &&
            x - radius < wall.x + halfWidth &&
            y + radius > wall.y - halfHeight &&
            y - radius < wall.y + halfHeight
          ) {
            // Determine collision side
            const dx = x - wall.x;
            const dy = y - wall.y;

            if (Math.abs(dx) > Math.abs(dy)) {
              // Side collision
              vx = -vx * PHYSICS.wallRestitution;
              x = dx > 0 ? wall.x + halfWidth + radius : wall.x - halfWidth - radius;
            } else {
              // Top/bottom collision
              vy = -vy * PHYSICS.wallRestitution;
              y = dy > 0 ? wall.y + halfHeight + radius : wall.y - halfHeight - radius;
            }

            hitWall = true;
            break;
          }
        }

        // Paddle collision
        const paddleLeft = currentPaddleX - PADDLE.width / 2;
        const paddleRight = currentPaddleX + PADDLE.width / 2;
        const paddleTop = PADDLE.y + PADDLE.height / 2;
        const paddleBottom = PADDLE.y - PADDLE.height / 2;

        if (
          x + radius > paddleLeft &&
          x - radius < paddleRight &&
          y - radius < paddleTop &&
          y - radius > paddleBottom &&
          vy < 0 // Ball moving downward
        ) {
          vy = -vy * PHYSICS.paddleRestitution;
          y = paddleTop + radius;

          // Add horizontal velocity based on hit position
          const hitOffset = (x - currentPaddleX) / (PADDLE.width / 2);
          vx += hitOffset * 1;
        }

        // Spawn new ball on wall hit
        if (hitWall) {
          const spawnChance = BALL_CONFIG[ball.type].spawnChance;
          if (Math.random() < spawnChance) {
            // Spawn new ball
            const spawnedType = getSpawnedBallType(ball.type);
            const angle = Math.random() * Math.PI * 2;
            const speed = 1.5;
            addBall({
              type: spawnedType,
              x: x + Math.cos(angle) * radius * 3,
              y: y + Math.sin(angle) * radius * 3,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed,
            });
            addScore(BALL_CONFIG[spawnedType].points);
          }
        }

        // Clamp velocity
        const speed = Math.sqrt(vx * vx + vy * vy);
        if (speed > PHYSICS.maxVelocity) {
          vx = (vx / speed) * PHYSICS.maxVelocity;
          vy = (vy / speed) * PHYSICS.maxVelocity;
        } else if (speed < PHYSICS.minVelocity && speed > 0) {
          vx = (vx / speed) * PHYSICS.minVelocity;
          vy = (vy / speed) * PHYSICS.minVelocity;
        }

        return { ...ball, x, y, vx, vy };
      });

      // Remove balls that fell off bottom
      const ballsInBounds = updatedBalls.filter((ball) => {
        if (ball.y < -1.1) {
          return false;
        }
        return true;
      });

      updateBalls(ballsInBounds);
      updateMultiplier(ballsInBounds.length);

      // Check for game over (all balls fell off)
      if (ballsInBounds.length === 0) {
        endGame();
        return;
      }

      // Render
      render(ctx, canvas, ballsInBounds);

      animationFrameRef.current = requestAnimationFrame(gameLoop);
    };

    animationFrameRef.current = requestAnimationFrame(gameLoop);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [gameState, addBall, updateBalls, addScore, updateMultiplier, endGame, render]);

  // Resize canvas to match display size
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
    };

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // Count balls by type
  const blueBalls = balls.filter((b) => b.type === "blue").length;
  const orangeBalls = balls.filter((b) => b.type === "orange").length;
  const yellowBalls = balls.filter((b) => b.type === "yellow-dot").length;

  return (
    <div className="flex h-screen w-full flex-col bg-slate-900">
      {/* HUD */}
      <div className="relative z-10 flex items-center justify-between border-b-2 border-slate-700 bg-slate-800 px-4 py-3">
        {/* Left: Home + Pause buttons */}
        <div className="flex gap-2">
          <Link href="/" className="btn btn-square btn-ghost text-2xl">
            🏠
          </Link>
          <button
            onClick={() => (gameState === "playing" ? pauseGame() : resumeGame())}
            className="btn btn-square btn-primary text-2xl"
            disabled={gameState === "menu" || gameState === "gameOver"}
          >
            {gameState === "paused" ? "▶" : "⏸"}
          </button>
        </div>

        {/* Center: Score */}
        <div className="text-center">
          <div className="text-4xl font-bold text-white">{score.toLocaleString()}</div>
          <div className="text-sm text-slate-400">
            {multiplier}x Multiplier • High: {progress.highScore.toLocaleString()}
          </div>
        </div>

        {/* Right: Sound toggle */}
        <button onClick={toggleSound} className="btn btn-square btn-ghost text-2xl">
          {soundEnabled ? "🔊" : "🔇"}
        </button>
      </div>

      {/* Game canvas */}
      <div className="relative flex-1">
        <canvas
          ref={canvasRef}
          className="h-full w-full cursor-none"
          style={{ touchAction: "none" }}
        />

        {/* Ball counters (left side) */}
        {gameState === "playing" && (
          <div className="absolute left-4 top-4 space-y-4">
            {blueBalls > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-slate-800/80 px-3 py-2 text-white backdrop-blur">
                <div className="h-6 w-6 rounded-full bg-blue-500" />
                <span className="text-xl font-bold">x{blueBalls}</span>
              </div>
            )}
            {orangeBalls > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-slate-800/80 px-3 py-2 text-white backdrop-blur">
                <div className="h-6 w-6 rounded-full bg-orange-500" />
                <span className="text-xl font-bold">x{orangeBalls}</span>
              </div>
            )}
            {yellowBalls > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-slate-800/80 px-3 py-2 text-white backdrop-blur">
                <div className="h-4 w-4 rounded-full bg-yellow-400" />
                <span className="text-xl font-bold">x{yellowBalls}</span>
              </div>
            )}
          </div>
        )}

        {/* Menu overlay */}
        {gameState === "menu" && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/95">
            <div className="text-center">
              <h1 className="mb-2 text-6xl font-bold text-white">Arkanoid</h1>
              <p className="mb-8 text-xl text-slate-300">
                Chain Reaction Mayhem
              </p>
              <button onClick={startGame} className="btn btn-primary btn-lg text-2xl">
                🎮 Start Game
              </button>
              <div className="mt-8 space-y-2 text-sm text-slate-400">
                <p>Move paddle with mouse/touch</p>
                <p>Balls multiply when they hit walls!</p>
                <p>Keep them from falling off the bottom</p>
              </div>
            </div>
          </div>
        )}

        {/* Paused overlay */}
        {gameState === "paused" && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80">
            <div className="text-center">
              <h2 className="mb-4 text-5xl font-bold text-white">PAUSED</h2>
              <button onClick={resumeGame} className="btn btn-primary btn-lg text-2xl">
                ▶ Resume
              </button>
            </div>
          </div>
        )}

        {/* Game Over overlay */}
        {gameState === "gameOver" && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/95">
            <div className="text-center">
              <h2 className="mb-2 text-5xl font-bold text-white">Game Over!</h2>
              <div className="mb-8 space-y-2">
                <p className="text-3xl text-yellow-400">Score: {score.toLocaleString()}</p>
                {wasNewHighScore && (
                  <p className="text-xl text-green-400">🎉 New High Score! 🎉</p>
                )}
                <p className="text-lg text-slate-400">
                  High Score: {progress.highScore.toLocaleString()}
                </p>
              </div>
              <button onClick={startGame} className="btn btn-primary btn-lg text-2xl">
                🎮 Play Again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ArkanoidGame;
