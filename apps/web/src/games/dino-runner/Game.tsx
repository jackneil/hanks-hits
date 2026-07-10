"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useDinoRunnerStore, type DinoRunnerProgress } from "./lib/store";
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  GROUND_Y,
  DINO,
  CLOUD,
  UI,
  getColors,
  type Obstacle,
  type CloudData,
} from "./lib/constants";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import { GameStartOverlay } from "@/shared/components/GameStartOverlay";
import { metadata } from "./metadata";

// ============================================
// DRAWING FUNCTIONS
// ============================================

/**
 * Draw the running dino with leg animation
 */
function drawDino(
  ctx: CanvasRenderingContext2D,
  y: number,
  isDucking: boolean,
  isJumping: boolean,
  legFrame: number,
  color: string
) {
  ctx.fillStyle = color;

  if (isDucking) {
    // Ducking dino (flat and long)
    // Body
    ctx.fillRect(DINO.X, y, DINO.WIDTH + 10, DINO.DUCK_HEIGHT - 6);

    // Head
    ctx.fillRect(DINO.X + DINO.WIDTH - 5, y - 8, 20, 20);

    // Eye
    ctx.fillStyle = getColors(false).SKY;
    ctx.fillRect(DINO.X + DINO.WIDTH + 8, y - 4, 4, 4);
    ctx.fillStyle = color;

    // Legs (shorter when ducking)
    ctx.fillRect(DINO.X + 5, y + DINO.DUCK_HEIGHT - 6, 6, 8);
    ctx.fillRect(DINO.X + 20, y + DINO.DUCK_HEIGHT - 6, 6, 8);
  } else {
    // Standing/jumping dino

    // Body
    ctx.fillRect(DINO.X + 5, y + 15, 30, 22);

    // Neck
    ctx.fillRect(DINO.X + 25, y + 5, 10, 15);

    // Head
    ctx.fillRect(DINO.X + 20, y, 24, 18);

    // Eye
    ctx.fillStyle = getColors(false).SKY;
    ctx.fillRect(DINO.X + 35, y + 4, 4, 4);
    ctx.fillStyle = color;

    // Tail
    ctx.fillRect(DINO.X, y + 15, 10, 12);
    ctx.fillRect(DINO.X - 5, y + 12, 8, 8);

    // Arms
    ctx.fillRect(DINO.X + 25, y + 25, 4, 10);

    // Legs (animated when running, static when jumping)
    if (isJumping) {
      // Both legs down when jumping
      ctx.fillRect(DINO.X + 10, y + 37, 6, 12);
      ctx.fillRect(DINO.X + 22, y + 37, 6, 12);
    } else {
      // Alternating leg animation
      const frame = Math.floor(legFrame);
      if (frame === 0) {
        ctx.fillRect(DINO.X + 10, y + 37, 6, 12);
        ctx.fillRect(DINO.X + 22, y + 37, 6, 6);
      } else {
        ctx.fillRect(DINO.X + 10, y + 37, 6, 6);
        ctx.fillRect(DINO.X + 22, y + 37, 6, 12);
      }
    }
  }
}

/**
 * Draw a cactus obstacle
 */
function drawCactus(
  ctx: CanvasRenderingContext2D,
  obstacle: Obstacle,
  color: string
) {
  ctx.fillStyle = color;

  switch (obstacle.type) {
    case "cactus-small":
      // Main stem
      ctx.fillRect(obstacle.x + 5, obstacle.y, 7, obstacle.height);
      // Top
      ctx.fillRect(obstacle.x + 3, obstacle.y, 11, 5);
      break;

    case "cactus-large":
      // Main stem
      ctx.fillRect(obstacle.x + 8, obstacle.y, 9, obstacle.height);
      // Left arm
      ctx.fillRect(obstacle.x, obstacle.y + 15, 10, 6);
      ctx.fillRect(obstacle.x, obstacle.y + 10, 6, 12);
      // Right arm
      ctx.fillRect(obstacle.x + 15, obstacle.y + 20, 10, 6);
      ctx.fillRect(obstacle.x + 19, obstacle.y + 15, 6, 15);
      // Top
      ctx.fillRect(obstacle.x + 5, obstacle.y, 15, 5);
      break;

    case "cactus-group":
      // Draw 3 cacti close together
      // Left cactus
      ctx.fillRect(obstacle.x + 5, obstacle.y + 10, 7, 40);
      ctx.fillRect(obstacle.x + 3, obstacle.y + 10, 11, 5);

      // Middle cactus (tallest)
      ctx.fillRect(obstacle.x + 22, obstacle.y, 9, 50);
      ctx.fillRect(obstacle.x + 14, obstacle.y + 15, 10, 6);
      ctx.fillRect(obstacle.x + 14, obstacle.y + 10, 6, 15);
      ctx.fillRect(obstacle.x + 29, obstacle.y + 20, 10, 6);
      ctx.fillRect(obstacle.x + 33, obstacle.y + 15, 6, 15);
      ctx.fillRect(obstacle.x + 19, obstacle.y, 15, 5);

      // Right cactus
      ctx.fillRect(obstacle.x + 52, obstacle.y + 15, 7, 35);
      ctx.fillRect(obstacle.x + 50, obstacle.y + 15, 11, 5);
      ctx.fillRect(obstacle.x + 58, obstacle.y + 25, 8, 6);
      ctx.fillRect(obstacle.x + 60, obstacle.y + 20, 6, 15);
      break;
  }
}

/**
 * Draw a pterodactyl with wing animation
 */
function drawPterodactyl(
  ctx: CanvasRenderingContext2D,
  obstacle: Obstacle,
  color: string,
  frame: number
) {
  ctx.fillStyle = color;

  const wingUp = Math.floor(frame * 5) % 2 === 0;

  // Body
  ctx.fillRect(obstacle.x + 15, obstacle.y + 15, 25, 10);

  // Head/beak
  ctx.fillRect(obstacle.x, obstacle.y + 12, 20, 8);
  ctx.fillRect(obstacle.x - 5, obstacle.y + 14, 8, 4);

  // Eye
  ctx.fillStyle = getColors(false).SKY;
  ctx.fillRect(obstacle.x + 12, obstacle.y + 14, 3, 3);
  ctx.fillStyle = color;

  // Wings
  if (wingUp) {
    ctx.fillRect(obstacle.x + 20, obstacle.y, 15, 15);
    ctx.fillRect(obstacle.x + 25, obstacle.y - 5, 10, 10);
  } else {
    ctx.fillRect(obstacle.x + 20, obstacle.y + 22, 15, 12);
    ctx.fillRect(obstacle.x + 25, obstacle.y + 30, 10, 8);
  }

  // Tail
  ctx.fillRect(obstacle.x + 38, obstacle.y + 18, 8, 5);
}

/**
 * Draw ground with scrolling texture
 */
function drawGround(
  ctx: CanvasRenderingContext2D,
  offset: number,
  colors: ReturnType<typeof getColors>
) {
  // Ground line
  ctx.fillStyle = colors.GROUND;
  ctx.fillRect(0, GROUND_Y, CANVAS_WIDTH, 2);

  // Ground texture (small bumps and dots)
  ctx.fillStyle = colors.GROUND_TEXTURE;

  for (let x = -offset % 30; x < CANVAS_WIDTH; x += 30) {
    // Random looking but deterministic bumps
    const seed = Math.floor((x + offset) / 30);
    const bumpType = seed % 4;

    switch (bumpType) {
      case 0:
        ctx.fillRect(x, GROUND_Y + 5, 3, 2);
        break;
      case 1:
        ctx.fillRect(x, GROUND_Y + 8, 2, 3);
        ctx.fillRect(x + 10, GROUND_Y + 6, 4, 2);
        break;
      case 2:
        ctx.fillRect(x, GROUND_Y + 10, 5, 2);
        break;
      case 3:
        ctx.fillRect(x, GROUND_Y + 4, 2, 2);
        ctx.fillRect(x + 5, GROUND_Y + 7, 3, 2);
        break;
    }
  }
}

/**
 * Draw clouds
 */
function drawClouds(
  ctx: CanvasRenderingContext2D,
  clouds: CloudData[],
  color: string
) {
  ctx.fillStyle = color;

  for (const cloud of clouds) {
    // Simple cloud shape (3 rounded bumps)
    const h = CLOUD.HEIGHT;
    ctx.beginPath();
    ctx.ellipse(cloud.x + cloud.width * 0.25, cloud.y + h * 0.6, cloud.width * 0.25, h * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cloud.x + cloud.width * 0.5, cloud.y + h * 0.4, cloud.width * 0.3, h * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cloud.x + cloud.width * 0.75, cloud.y + h * 0.6, cloud.width * 0.25, h * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Draw score display
 */
function drawScore(
  ctx: CanvasRenderingContext2D,
  score: number,
  highScore: number,
  color: string
) {
  ctx.font = UI.SCORE_FONT;
  ctx.fillStyle = color;
  ctx.textAlign = "right";

  // Current score
  const scoreStr = Math.floor(score).toString().padStart(5, "0");
  ctx.fillText(scoreStr, CANVAS_WIDTH - 20, 30);

  // High score
  if (highScore > 0) {
    const highScoreStr = "HI " + Math.floor(highScore).toString().padStart(5, "0");
    ctx.fillText(highScoreStr, CANVAS_WIDTH - 100, 30);
  }
}

/**
 * Draw game over screen
 */
function drawGameOver(
  ctx: CanvasRenderingContext2D,
  score: number,
  highScore: number,
  isNewHighScore: boolean,
  color: string
) {
  // Semi-transparent overlay
  ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  ctx.textAlign = "center";
  ctx.fillStyle = color;

  // Game over text
  ctx.font = UI.GAME_OVER_FONT;
  ctx.fillText("G A M E   O V E R", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 30);

  // Score
  ctx.font = UI.INSTRUCTION_FONT;
  ctx.fillText(`Score: ${Math.floor(score)}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 10);

  if (isNewHighScore) {
    ctx.fillStyle = "#FFD700";
    ctx.fillText("NEW HIGH SCORE!", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 40);
    ctx.fillStyle = color;
  }

  // Restart instruction
  ctx.fillText("Press Space or Tap to Restart", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 70);
}

// ============================================
// MAIN GAME COMPONENT
// ============================================
export function DinoRunnerGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const lastTimeRef = useRef<number>(0);
  const pterodactylFrameRef = useRef<number>(0);
  const [scale, setScale] = useState(1);

  const store = useDinoRunnerStore();
  const {
    gameState,
    score,
    isNight,
    dinoY,
    isDucking,
    isJumping,
    legFrame,
    obstacles,
    clouds,
    groundOffset,
    milestoneFlash,
    progress,
    startGame,
    reset,
    update,
    jump,
    releaseJump,
    duck,
  } = store;

  // Auth sync
  const { isAuthenticated, syncStatus, forceSync } = useAuthSync({
    appId: "dino-runner",
    localStorageKey: "dino-runner-progress",
    getState: () => store.getProgress(),
    setState: (data: DinoRunnerProgress) => store.setProgress(data),
    debounceMs: 3000,
  });

  // Force save immediately on game over
  useEffect(() => {
    if (gameState === "game-over") {
      forceSync();
    }
  }, [gameState, forceSync]);

  // Check if new high score
  const isNewHighScore = gameState === "game-over" && Math.floor(score) >= progress.highScore && progress.highScore > 0;

  // Responsive scaling
  useEffect(() => {
    const updateScale = () => {
      if (!containerRef.current) return;
      const containerWidth = containerRef.current.clientWidth;
      const maxScale = Math.min(containerWidth / CANVAS_WIDTH, 1.5);
      setScale(Math.max(0.4, maxScale));
    };

    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  // Main render function
  const render = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const colors = getColors(isNight);

      // Clear and fill background
      ctx.fillStyle = milestoneFlash ? "#FFFFFF" : colors.SKY;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Draw clouds
      drawClouds(ctx, clouds, colors.CLOUD);

      // Draw obstacles
      pterodactylFrameRef.current += 0.05;
      for (const obstacle of obstacles) {
        if (obstacle.type.startsWith("cactus")) {
          drawCactus(ctx, obstacle, colors.OBSTACLE);
        } else {
          drawPterodactyl(ctx, obstacle, colors.OBSTACLE, pterodactylFrameRef.current);
        }
      }

      // Draw ground
      drawGround(ctx, groundOffset, colors);

      // Draw dino (always visible)
      drawDino(ctx, dinoY, isDucking, isJumping, legFrame, colors.DINO);

      // Draw UI based on state. In "idle" the canvas draws only the normal
      // ground/dino scene — the start screen is now the DOM GameStartOverlay,
      // so instruction text never overlaps the ground line again.
      if (gameState === "playing") {
        drawScore(ctx, score, progress.highScore, colors.SCORE);
      } else if (gameState === "game-over") {
        drawScore(ctx, score, progress.highScore, colors.SCORE);
        drawGameOver(ctx, score, progress.highScore, isNewHighScore, colors.GAME_OVER);
      }
    },
    [
      gameState,
      score,
      isNight,
      dinoY,
      isDucking,
      isJumping,
      legFrame,
      obstacles,
      clouds,
      groundOffset,
      milestoneFlash,
      progress.highScore,
      isNewHighScore,
    ]
  );

  // Game loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const gameLoop = (time: number) => {
      // Skip first frame
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
      lastTimeRef.current = 0;
    };
  }, [gameState, update, render]);

  // Input handler
  const handleInput = useCallback(() => {
    if (gameState === "idle") {
      startGame();
    } else if (gameState === "playing") {
      jump();
    } else if (gameState === "game-over") {
      reset();
    }
  }, [gameState, startGame, jump, reset]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        handleInput();
      } else if (e.code === "ArrowDown") {
        e.preventDefault();
        if (gameState === "playing") {
          duck(true);
        }
      } else if (e.code === "Enter") {
        e.preventDefault();
        if (gameState === "game-over") {
          reset();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        releaseJump();
      } else if (e.code === "ArrowDown") {
        duck(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [handleInput, gameState, duck, releaseJump, reset]);

  // Touch controls
  const touchStartY = useRef<number | null>(null);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      touchStartY.current = e.touches[0].clientY;
      handleInput();
    },
    [handleInput]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (touchStartY.current === null) return;

      const currentY = e.touches[0].clientY;
      const deltaY = currentY - touchStartY.current;

      // Swipe down to duck
      if (deltaY > 30 && gameState === "playing") {
        duck(true);
      }
    },
    [gameState, duck]
  );

  const handleTouchEnd = useCallback(() => {
    touchStartY.current = null;
    releaseJump();
    duck(false);
  }, [releaseJump, duck]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-100 to-gray-300 flex flex-col items-center justify-center p-4">
      {/* iOS install prompt */}
      <IOSInstallPrompt />

      {/* Game container. min-h keeps the DOM start overlay's card fully visible
          even though the canvas is only 300px tall (and scales far smaller on
          phones) — the card is centered here rather than shrunk. */}
      <div
        ref={containerRef}
        className="relative w-full max-w-4xl min-h-[360px] flex items-center justify-center"
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onClick={handleInput}
          className="rounded-lg shadow-xl cursor-pointer touch-manipulation border-2 border-gray-300"
          style={{
            width: CANVAS_WIDTH * scale,
            height: CANVAS_HEIGHT * scale,
            imageRendering: "pixelated",
          }}
        />

        {gameState === "idle" && (
          <GameStartOverlay
            title="Dino Runner"
            emoji={metadata.emoji ?? "🦖"}
            subtitle={
              progress.highScore > 0
                ? `High Score: ${Math.floor(progress.highScore)}`
                : undefined
            }
            keyboardHints={["SPACE or ↑ to jump (hold = higher)", "↓ to duck"]}
            touchHints={[
              "Tap to jump (hold = higher)",
              "Swipe down or tap DUCK to duck",
            ]}
            onStart={startGame}
          />
        )}
      </div>

      {/* Mobile duck button */}
      <div className="md:hidden mt-4">
        <button
          onTouchStart={(e) => {
            e.preventDefault();
            duck(true);
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            duck(false);
          }}
          className="w-24 h-16 bg-gray-600 hover:bg-gray-500 active:bg-gray-700 text-white rounded-xl shadow-lg flex items-center justify-center text-2xl font-bold touch-manipulation"
        >
          DUCK
        </button>
      </div>

      {/* Stats */}
      <div className="mt-4 text-center text-gray-600 text-sm">
        <p>
          Games: {progress.gamesPlayed} | Best: {progress.highScore} | Distance:{" "}
          {Math.floor(progress.totalDistance)}m
        </p>
      </div>

      {/* Desktop controls hint */}
      <div className="hidden md:block mt-2 text-gray-500 text-xs">
        Space/Up = Jump | Down = Duck | Hold jump for height
      </div>

      {/* Sync status */}
      {isAuthenticated && (
        <div className="fixed bottom-2 right-2 text-xs text-gray-400">
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

export default DinoRunnerGame;
