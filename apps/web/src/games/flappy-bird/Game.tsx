"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useFlappyStore } from "./lib/store";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  BIRD,
  PIPE,
  GROUND,
  COLORS,
  UI,
  getMedal,
} from "./lib/constants";

export function FlappyBirdGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const lastTimeRef = useRef<number>(0);
  const [scale, setScale] = useState(1);

  const store = useFlappyStore();
  const {
    gameState,
    score,
    bird,
    pipes,
    groundOffset,
    isNewHighScore,
    progress,
    startGame,
    flap,
    update,
    reset,
  } = store;

  // Sync with auth system
  const { isAuthenticated, syncStatus, forceSync } = useAuthSync({
    appId: "flappy-bird",
    localStorageKey: "flappy-bird-progress",
    getState: () => store.getProgress(),
    setState: (data) => store.setProgress(data),
    debounceMs: 3000,
  });

  // Force save immediately on game over
  useEffect(() => {
    if (gameState === "gameOver") {
      forceSync();
    }
  }, [gameState, forceSync]);

  // Responsive scaling
  useEffect(() => {
    const updateScale = () => {
      if (!containerRef.current) return;
      const containerWidth = containerRef.current.clientWidth;
      const containerHeight = containerRef.current.clientHeight;
      const scaleX = containerWidth / CANVAS_WIDTH;
      const scaleY = containerHeight / CANVAS_HEIGHT;
      setScale(Math.min(scaleX, scaleY, 2)); // Cap at 2x
    };

    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  // Drawing functions
  const drawBird = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      ctx.save();
      ctx.translate(BIRD.X, bird.y);
      ctx.rotate((bird.rotation * Math.PI) / 180);

      // Bird body (yellow)
      ctx.fillStyle = COLORS.BIRD_BODY;
      ctx.beginPath();
      ctx.ellipse(0, 0, BIRD.WIDTH / 2, BIRD.HEIGHT / 2, 0, 0, Math.PI * 2);
      ctx.fill();

      // Wing (orange)
      ctx.fillStyle = COLORS.BIRD_WING;
      const wingY = Math.sin(Date.now() / 80) * 3; // Flapping animation
      ctx.beginPath();
      ctx.ellipse(-5, wingY, 10, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      // Eye white
      ctx.fillStyle = COLORS.BIRD_EYE;
      ctx.beginPath();
      ctx.arc(8, -4, 6, 0, Math.PI * 2);
      ctx.fill();

      // Pupil
      ctx.fillStyle = COLORS.BIRD_PUPIL;
      ctx.beginPath();
      ctx.arc(10, -4, 3, 0, Math.PI * 2);
      ctx.fill();

      // Beak
      ctx.fillStyle = COLORS.BIRD_BEAK;
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(22, 3);
      ctx.lineTo(12, 6);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    },
    [bird.y, bird.rotation]
  );

  const drawPipe = useCallback(
    (ctx: CanvasRenderingContext2D, pipe: (typeof pipes)[0]) => {
      const gapTop = pipe.gapY - PIPE.GAP / 2;
      const gapBottom = pipe.gapY + PIPE.GAP / 2;
      const groundY = CANVAS_HEIGHT - GROUND.HEIGHT;

      // Top pipe
      ctx.fillStyle = PIPE.COLOR_BODY;
      ctx.fillRect(pipe.x, 0, PIPE.WIDTH, gapTop);

      // Top pipe cap
      ctx.fillStyle = PIPE.COLOR_TOP;
      ctx.fillRect(pipe.x - 3, gapTop - 26, PIPE.WIDTH + 6, 26);

      // Top pipe shadow
      ctx.fillStyle = PIPE.COLOR_SHADOW;
      ctx.fillRect(pipe.x + PIPE.WIDTH - 8, 0, 8, gapTop - 26);

      // Bottom pipe
      ctx.fillStyle = PIPE.COLOR_BODY;
      ctx.fillRect(pipe.x, gapBottom, PIPE.WIDTH, groundY - gapBottom);

      // Bottom pipe cap
      ctx.fillStyle = PIPE.COLOR_TOP;
      ctx.fillRect(pipe.x - 3, gapBottom, PIPE.WIDTH + 6, 26);

      // Bottom pipe shadow
      ctx.fillStyle = PIPE.COLOR_SHADOW;
      ctx.fillRect(pipe.x + PIPE.WIDTH - 8, gapBottom + 26, 8, groundY - gapBottom - 26);
    },
    []
  );

  const drawGround = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const groundY = CANVAS_HEIGHT - GROUND.HEIGHT;

      // Ground base
      ctx.fillStyle = GROUND.COLOR;
      ctx.fillRect(0, groundY, CANVAS_WIDTH, GROUND.HEIGHT);

      // Ground stripe pattern
      ctx.fillStyle = GROUND.STRIPE_COLOR;
      for (let x = -groundOffset; x < CANVAS_WIDTH; x += 24) {
        ctx.fillRect(x, groundY, 12, 20);
      }
    },
    [groundOffset]
  );

  const drawScore = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      if (gameState !== "playing") return;

      ctx.font = UI.SCORE_FONT;
      ctx.textAlign = "center";

      // Shadow
      ctx.fillStyle = COLORS.SCORE_SHADOW;
      ctx.fillText(score.toString(), CANVAS_WIDTH / 2 + 2, 60 + 2);

      // Score
      ctx.fillStyle = COLORS.SCORE_TEXT;
      ctx.fillText(score.toString(), CANVAS_WIDTH / 2, 60);
    },
    [gameState, score]
  );

  const drawReadyScreen = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      ctx.font = "bold 36px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = COLORS.SCORE_TEXT;
      ctx.strokeStyle = COLORS.SCORE_SHADOW;
      ctx.lineWidth = 3;

      ctx.strokeText("Flappy Bird", CANVAS_WIDTH / 2, 100);
      ctx.fillText("Flappy Bird", CANVAS_WIDTH / 2, 100);

      ctx.font = UI.SMALL_FONT;
      ctx.strokeText("Tap or Press Space", CANVAS_WIDTH / 2, 320);
      ctx.fillText("Tap or Press Space", CANVAS_WIDTH / 2, 320);
      ctx.strokeText("to Start!", CANVAS_WIDTH / 2, 350);
      ctx.fillText("to Start!", CANVAS_WIDTH / 2, 350);

      // High score
      if (progress.highScore > 0) {
        ctx.font = "18px Arial, sans-serif";
        ctx.strokeText(`Best: ${progress.highScore}`, CANVAS_WIDTH / 2, 400);
        ctx.fillText(`Best: ${progress.highScore}`, CANVAS_WIDTH / 2, 400);
      }
    },
    [progress.highScore]
  );

  const drawGameOver = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      // Darken background
      ctx.fillStyle = COLORS.GAME_OVER_BG;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      ctx.textAlign = "center";
      ctx.fillStyle = COLORS.SCORE_TEXT;
      ctx.strokeStyle = COLORS.SCORE_SHADOW;
      ctx.lineWidth = 2;

      // Game Over text
      ctx.font = "bold 40px Arial, sans-serif";
      ctx.strokeText("Game Over!", CANVAS_WIDTH / 2, 120);
      ctx.fillText("Game Over!", CANVAS_WIDTH / 2, 120);

      // Score box
      ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
      ctx.fillRect(CANVAS_WIDTH / 2 - 100, 150, 200, 140);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 3;
      ctx.strokeRect(CANVAS_WIDTH / 2 - 100, 150, 200, 140);

      ctx.fillStyle = "#000";
      ctx.font = "20px Arial, sans-serif";
      ctx.fillText("Score", CANVAS_WIDTH / 2, 180);
      ctx.font = "bold 36px Arial, sans-serif";
      ctx.fillText(score.toString(), CANVAS_WIDTH / 2, 220);

      ctx.font = "20px Arial, sans-serif";
      ctx.fillText("Best", CANVAS_WIDTH / 2, 260);
      ctx.font = "bold 28px Arial, sans-serif";
      ctx.fillText(progress.highScore.toString(), CANVAS_WIDTH / 2, 290);

      // New high score celebration
      if (isNewHighScore) {
        ctx.fillStyle = "#FFD700";
        ctx.font = "bold 24px Arial, sans-serif";
        ctx.fillText("NEW HIGH SCORE!", CANVAS_WIDTH / 2, 330);
      }

      // Medal
      const medal = getMedal(score);
      if (medal !== "none") {
        const medalColors = {
          bronze: "#CD7F32",
          silver: "#C0C0C0",
          gold: "#FFD700",
          platinum: "#E5E4E2",
        };
        ctx.fillStyle = medalColors[medal];
        ctx.beginPath();
        ctx.arc(CANVAS_WIDTH / 2 - 60, 235, 25, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = "#000";
        ctx.font = "12px Arial, sans-serif";
        ctx.fillText(medal.toUpperCase(), CANVAS_WIDTH / 2 - 60, 270);
      }

      // Restart instruction
      ctx.fillStyle = COLORS.SCORE_TEXT;
      ctx.font = UI.SMALL_FONT;
      ctx.fillText("Tap to Restart", CANVAS_WIDTH / 2, 400);
    },
    [score, progress.highScore, isNewHighScore]
  );

  // Main render function
  const render = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      // Clear and draw sky gradient
      const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
      gradient.addColorStop(0, COLORS.SKY_TOP);
      gradient.addColorStop(1, COLORS.SKY_BOTTOM);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Draw pipes
      pipes.forEach((pipe) => drawPipe(ctx, pipe));

      // Draw ground
      drawGround(ctx);

      // Draw bird
      drawBird(ctx);

      // Draw UI based on state
      if (gameState === "ready") {
        drawReadyScreen(ctx);
      } else if (gameState === "playing") {
        drawScore(ctx);
      } else if (gameState === "gameOver") {
        drawGameOver(ctx);
      }
    },
    [
      gameState,
      pipes,
      drawPipe,
      drawGround,
      drawBird,
      drawScore,
      drawReadyScreen,
      drawGameOver,
    ]
  );

  // Game loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const gameLoop = (time: number) => {
      // Skip first frame to avoid massive delta from 0
      if (lastTimeRef.current === 0) {
        lastTimeRef.current = time;
        render(ctx);
        animationFrameRef.current = requestAnimationFrame(gameLoop);
        return;
      }

      const delta = time - lastTimeRef.current;
      lastTimeRef.current = time;

      if (gameState === "playing") {
        update(delta);
      }

      render(ctx);
      animationFrameRef.current = requestAnimationFrame(gameLoop);
    };

    animationFrameRef.current = requestAnimationFrame(gameLoop);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      // Reset so first frame of next game loop is skipped
      lastTimeRef.current = 0;
    };
  }, [gameState, update, render]);

  // Input handling
  const handleInput = useCallback(() => {
    if (gameState === "ready") {
      startGame();
    } else if (gameState === "playing") {
      flap();
    } else if (gameState === "gameOver") {
      reset();
    }
  }, [gameState, startGame, flap, reset]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "Enter" || e.code === "ArrowUp") {
        e.preventDefault();
        handleInput();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleInput]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-400 to-sky-600 flex flex-col items-center justify-center p-4">
      {/* iOS install prompt */}
      <IOSInstallPrompt />


      {/* Header */}
      <header className="mb-4 text-center">
        <h1 className="text-3xl font-bold text-white drop-shadow-lg">
          Flappy Bird
        </h1>
        <p className="text-sky-100">Tap or press Space to fly!</p>
      </header>

      {/* Game container */}
      <div
        ref={containerRef}
        className="relative w-full max-w-md aspect-[2/3] flex items-center justify-center"
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          onClick={handleInput}
          onTouchStart={(e) => {
            e.preventDefault();
            handleInput();
          }}
          className="rounded-lg shadow-2xl cursor-pointer touch-manipulation"
          style={{
            width: CANVAS_WIDTH * scale,
            height: CANVAS_HEIGHT * scale,
          }}
        />
      </div>

      {/* Stats */}
      <div className="mt-4 text-center text-white/80 text-sm">
        <p>Games: {progress.gamesPlayed} | Total Pipes: {progress.totalPipes}</p>
      </div>

      {/* Sync status indicator */}
      {isAuthenticated && (
        <div className="fixed bottom-2 right-2 text-xs text-white/60">
          {syncStatus === "syncing"
            ? "Saving..."
            : syncStatus === "synced"
            ? "Saved"
            : ""}
        </div>
      )}
    </div>
  );
}

export default FlappyBirdGame;
