"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useEndlessRunnerStore, type EndlessRunnerProgress } from "./lib/store";
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  PLAYER,
  PHYSICS,
  GROUND,
  OBSTACLE,
  COIN,
  COLORS,
  UI,
  CHARACTERS,
  type CharacterId,
} from "./lib/constants";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { OrientationWarning } from "@/shared/components/OrientationWarning";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";

export function EndlessRunnerGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const lastTimeRef = useRef<number>(0);
  const [scale, setScale] = useState(1);

  const store = useEndlessRunnerStore();

  // Cloud sync for authenticated users
  const { forceSync } = useAuthSync<EndlessRunnerProgress>({
    appId: "endless-runner",
    localStorageKey: "endless-runner-storage",
    getState: () => store.getProgress(),
    setState: (data) => store.setProgress(data),
    debounceMs: 3000,
  });

  const {
    gameState,
    score,
    coinsThisRun,
    player,
    obstacles,
    coins,
    clouds,
    groundOffset,
    isNewHighScore,
    progress,
    startGame,
    jump,
    startDuck,
    stopDuck,
    update,
    reset,
  } = store;

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
      setScale(Math.min(scaleX, scaleY, 2.5)); // Cap at 2.5x
    };

    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  // Get character color
  const getCharacterColor = useCallback(() => {
    const charId = progress.selectedCharacter as CharacterId;
    return CHARACTERS[charId]?.color || PLAYER.COLOR_BODY;
  }, [progress.selectedCharacter]);

  // Drawing functions
  const drawSky = useCallback((ctx: CanvasRenderingContext2D) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    gradient.addColorStop(0, COLORS.SKY_TOP);
    gradient.addColorStop(1, COLORS.SKY_BOTTOM);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Sun
    ctx.fillStyle = COLORS.SUN_GLOW;
    ctx.beginPath();
    ctx.arc(CANVAS_WIDTH - 80, 60, 50, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.SUN;
    ctx.beginPath();
    ctx.arc(CANVAS_WIDTH - 80, 60, 35, 0, Math.PI * 2);
    ctx.fill();
  }, []);

  const drawClouds = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = COLORS.CLOUD;
    clouds.forEach((cloud) => {
      const s = cloud.scale;
      ctx.beginPath();
      ctx.arc(cloud.x, cloud.y, 25 * s, 0, Math.PI * 2);
      ctx.arc(cloud.x + 20 * s, cloud.y - 10 * s, 20 * s, 0, Math.PI * 2);
      ctx.arc(cloud.x + 40 * s, cloud.y, 25 * s, 0, Math.PI * 2);
      ctx.arc(cloud.x + 20 * s, cloud.y + 10 * s, 18 * s, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [clouds]);

  const drawMountains = useCallback((ctx: CanvasRenderingContext2D) => {
    const groundY = CANVAS_HEIGHT - GROUND.HEIGHT;

    // Far mountains
    ctx.fillStyle = COLORS.MOUNTAIN_FAR;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(100, groundY - 80);
    ctx.lineTo(200, groundY);
    ctx.lineTo(300, groundY - 100);
    ctx.lineTo(400, groundY);
    ctx.lineTo(500, groundY - 70);
    ctx.lineTo(600, groundY);
    ctx.lineTo(700, groundY - 90);
    ctx.lineTo(800, groundY);
    ctx.closePath();
    ctx.fill();

    // Near mountains
    ctx.fillStyle = COLORS.MOUNTAIN_NEAR;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(150, groundY - 60);
    ctx.lineTo(250, groundY);
    ctx.lineTo(350, groundY - 50);
    ctx.lineTo(450, groundY);
    ctx.lineTo(550, groundY - 70);
    ctx.lineTo(650, groundY);
    ctx.lineTo(750, groundY - 45);
    ctx.lineTo(800, groundY);
    ctx.closePath();
    ctx.fill();
  }, []);

  const drawGround = useCallback((ctx: CanvasRenderingContext2D) => {
    const groundY = CANVAS_HEIGHT - GROUND.HEIGHT;

    // Grass layer
    ctx.fillStyle = GROUND.GRASS_COLOR;
    ctx.fillRect(0, groundY, CANVAS_WIDTH, GROUND.GRASS_HEIGHT);

    // Ground base
    ctx.fillStyle = GROUND.COLOR;
    ctx.fillRect(0, groundY + GROUND.GRASS_HEIGHT, CANVAS_WIDTH, GROUND.HEIGHT - GROUND.GRASS_HEIGHT);

    // Scrolling texture lines
    ctx.strokeStyle = "rgba(0,0,0,0.1)";
    ctx.lineWidth = 2;
    for (let x = -groundOffset; x < CANVAS_WIDTH + 40; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, groundY + GROUND.GRASS_HEIGHT + 10);
      ctx.lineTo(x + 20, groundY + GROUND.HEIGHT - 10);
      ctx.stroke();
    }
  }, [groundOffset]);

  const drawPlayer = useCallback((ctx: CanvasRenderingContext2D) => {
    const characterColor = getCharacterColor();
    const groundY = CANVAS_HEIGHT - GROUND.HEIGHT;
    const playerHeight = player.isDucking ? PHYSICS.DUCK_HEIGHT : PLAYER.HEIGHT;
    const playerY = player.y;

    // Running animation frame
    const runFrame = Math.floor(Date.now() / 100) % 2;

    ctx.save();
    ctx.translate(PLAYER.X, playerY);

    if (player.isDucking) {
      // Ducking pose - compact body
      ctx.fillStyle = characterColor;
      ctx.fillRect(-PLAYER.WIDTH / 2, -playerHeight, PLAYER.WIDTH, playerHeight);

      // Head (lower when ducking)
      ctx.fillStyle = PLAYER.COLOR_HEAD;
      ctx.beginPath();
      ctx.arc(0, -playerHeight - 8, 12, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Normal running pose
      // Body
      ctx.fillStyle = characterColor;
      ctx.fillRect(-PLAYER.WIDTH / 2 + 5, -playerHeight + 15, PLAYER.WIDTH - 10, playerHeight - 25);

      // Legs (animated)
      ctx.fillStyle = characterColor;
      if (player.isJumping) {
        // Jumping pose - legs together
        ctx.fillRect(-8, -10, 6, 20);
        ctx.fillRect(2, -10, 6, 20);
      } else {
        // Running animation
        if (runFrame === 0) {
          ctx.fillRect(-10, -10, 6, 22);
          ctx.fillRect(4, -15, 6, 18);
        } else {
          ctx.fillRect(-10, -15, 6, 18);
          ctx.fillRect(4, -10, 6, 22);
        }
      }

      // Arms (animated)
      if (player.isJumping) {
        // Arms up when jumping
        ctx.fillRect(-PLAYER.WIDTH / 2 - 5, -playerHeight + 20, 8, 15);
        ctx.fillRect(PLAYER.WIDTH / 2 - 3, -playerHeight + 20, 8, 15);
      } else {
        // Swinging arms
        if (runFrame === 0) {
          ctx.fillRect(-PLAYER.WIDTH / 2 - 5, -playerHeight + 25, 8, 12);
          ctx.fillRect(PLAYER.WIDTH / 2 - 3, -playerHeight + 18, 8, 12);
        } else {
          ctx.fillRect(-PLAYER.WIDTH / 2 - 5, -playerHeight + 18, 8, 12);
          ctx.fillRect(PLAYER.WIDTH / 2 - 3, -playerHeight + 25, 8, 12);
        }
      }

      // Head
      ctx.fillStyle = PLAYER.COLOR_HEAD;
      ctx.beginPath();
      ctx.arc(0, -playerHeight - 5, 14, 0, Math.PI * 2);
      ctx.fill();

      // Hair
      ctx.fillStyle = PLAYER.COLOR_HAIR;
      ctx.beginPath();
      ctx.arc(0, -playerHeight - 10, 12, Math.PI, 0);
      ctx.fill();

      // Eyes
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.arc(4, -playerHeight - 5, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }, [player, getCharacterColor]);

  const drawObstacles = useCallback((ctx: CanvasRenderingContext2D) => {
    const groundY = CANVAS_HEIGHT - GROUND.HEIGHT;

    obstacles.forEach((obs) => {
      if (obs.type === "ground") {
        // Ground obstacle - red crate/box
        ctx.fillStyle = OBSTACLE.GROUND_COLOR;
        const obsY = groundY - GROUND.HEIGHT - obs.height;
        ctx.fillRect(obs.x, obsY, obs.width, obs.height);

        // Highlight
        ctx.fillStyle = "rgba(255,255,255,0.3)";
        ctx.fillRect(obs.x + 3, obsY + 3, obs.width - 6, 8);

        // Shadow
        ctx.fillStyle = "rgba(0,0,0,0.2)";
        ctx.fillRect(obs.x, obsY + obs.height - 5, obs.width, 5);

        // X marks
        ctx.strokeStyle = "#FFF";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(obs.x + 8, obsY + 12);
        ctx.lineTo(obs.x + obs.width - 8, obsY + obs.height - 12);
        ctx.moveTo(obs.x + obs.width - 8, obsY + 12);
        ctx.lineTo(obs.x + 8, obsY + obs.height - 12);
        ctx.stroke();
      } else {
        // Air obstacle - purple bar (duck under)
        ctx.fillStyle = OBSTACLE.AIR_COLOR;
        ctx.fillRect(obs.x, OBSTACLE.AIR_Y, obs.width, obs.height);

        // Highlight
        ctx.fillStyle = "rgba(255,255,255,0.3)";
        ctx.fillRect(obs.x, OBSTACLE.AIR_Y, obs.width, 5);

        // Warning stripes
        ctx.fillStyle = "#FFF";
        for (let i = 0; i < obs.width; i += 15) {
          ctx.fillRect(obs.x + i, OBSTACLE.AIR_Y + 10, 8, obs.height - 15);
        }
      }
    });
  }, [obstacles]);

  const drawCoins = useCallback((ctx: CanvasRenderingContext2D) => {
    coins.forEach((coin) => {
      if (coin.collected) return;

      // Sparkle animation
      const sparkle = Math.sin(Date.now() / 150 + coin.id) * 0.2 + 0.8;

      ctx.save();
      ctx.translate(coin.x, coin.y);
      ctx.scale(sparkle, 1);

      // Coin body
      ctx.fillStyle = COIN.COLOR;
      ctx.beginPath();
      ctx.arc(0, 0, COIN.SIZE / 2, 0, Math.PI * 2);
      ctx.fill();

      // Outline
      ctx.strokeStyle = COIN.OUTLINE_COLOR;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Inner shine
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.beginPath();
      ctx.arc(-3, -3, COIN.SIZE / 4, 0, Math.PI * 2);
      ctx.fill();

      // Dollar sign
      ctx.fillStyle = COIN.OUTLINE_COLOR;
      ctx.font = "bold 12px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("$", 0, 1);

      ctx.restore();
    });
  }, [coins]);

  const drawHUD = useCallback((ctx: CanvasRenderingContext2D) => {
    // Distance counter
    ctx.font = UI.SCORE_FONT;
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.SCORE_SHADOW;
    ctx.fillText(`${score}m`, 22, 42);
    ctx.fillStyle = COLORS.SCORE_TEXT;
    ctx.fillText(`${score}m`, 20, 40);

    // Coins counter
    ctx.textAlign = "right";
    ctx.fillStyle = COLORS.SCORE_SHADOW;
    ctx.fillText(`${coinsThisRun}`, CANVAS_WIDTH - 18, 42);
    ctx.fillStyle = COIN.COLOR;
    ctx.fillText(`${coinsThisRun}`, CANVAS_WIDTH - 20, 40);

    // Coin icon
    ctx.fillStyle = COIN.COLOR;
    ctx.beginPath();
    ctx.arc(CANVAS_WIDTH - 60, 32, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COIN.OUTLINE_COLOR;
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [score, coinsThisRun]);

  const drawReadyScreen = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.font = UI.TITLE_FONT;
    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.SCORE_SHADOW;
    ctx.fillText("Endless Runner", CANVAS_WIDTH / 2 + 2, 102);
    ctx.fillStyle = COLORS.SCORE_TEXT;
    ctx.fillText("Endless Runner", CANVAS_WIDTH / 2, 100);

    ctx.font = UI.SMALL_FONT;
    ctx.fillStyle = COLORS.SCORE_SHADOW;
    ctx.fillText("Tap or Press Space to Jump!", CANVAS_WIDTH / 2 + 1, 161);
    ctx.fillStyle = COLORS.SCORE_TEXT;
    ctx.fillText("Tap or Press Space to Jump!", CANVAS_WIDTH / 2, 160);

    ctx.fillStyle = COLORS.SCORE_SHADOW;
    ctx.fillText("Hold Down Arrow to Duck", CANVAS_WIDTH / 2 + 1, 191);
    ctx.fillStyle = COLORS.SCORE_TEXT;
    ctx.fillText("Hold Down Arrow to Duck", CANVAS_WIDTH / 2, 190);

    // High score
    if (progress.highScore > 0) {
      ctx.font = "20px Arial, sans-serif";
      ctx.fillStyle = COLORS.SCORE_SHADOW;
      ctx.fillText(`Best: ${progress.highScore}m`, CANVAS_WIDTH / 2 + 1, 231);
      ctx.fillStyle = COIN.COLOR;
      ctx.fillText(`Best: ${progress.highScore}m`, CANVAS_WIDTH / 2, 230);
    }

    // Total coins
    ctx.font = "18px Arial, sans-serif";
    ctx.fillStyle = COLORS.SCORE_TEXT;
    ctx.fillText(`Total Coins: ${progress.totalCoins}`, CANVAS_WIDTH / 2, 270);

    // Tap to start button area
    ctx.fillStyle = "rgba(34, 197, 94, 0.9)";
    ctx.fillRect(CANVAS_WIDTH / 2 - 100, 300, 200, 50);
    ctx.strokeStyle = "#166534";
    ctx.lineWidth = 3;
    ctx.strokeRect(CANVAS_WIDTH / 2 - 100, 300, 200, 50);
    ctx.font = "bold 24px Arial, sans-serif";
    ctx.fillStyle = "#FFF";
    ctx.fillText("TAP TO PLAY", CANVAS_WIDTH / 2, 332);
  }, [progress.highScore, progress.totalCoins]);

  const drawGameOver = useCallback((ctx: CanvasRenderingContext2D) => {
    // Darken background
    ctx.fillStyle = COLORS.GAME_OVER_BG;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.textAlign = "center";

    // Game Over text
    ctx.font = "bold 48px Arial, sans-serif";
    ctx.fillStyle = COLORS.SCORE_SHADOW;
    ctx.fillText("Game Over!", CANVAS_WIDTH / 2 + 2, 82);
    ctx.fillStyle = COLORS.SCORE_TEXT;
    ctx.fillText("Game Over!", CANVAS_WIDTH / 2, 80);

    // Score box
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.fillRect(CANVAS_WIDTH / 2 - 120, 100, 240, 160);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 3;
    ctx.strokeRect(CANVAS_WIDTH / 2 - 120, 100, 240, 160);

    ctx.fillStyle = "#000";
    ctx.font = "22px Arial, sans-serif";
    ctx.fillText("Distance", CANVAS_WIDTH / 2, 135);
    ctx.font = "bold 40px Arial, sans-serif";
    ctx.fillText(`${score}m`, CANVAS_WIDTH / 2, 175);

    ctx.font = "18px Arial, sans-serif";
    ctx.fillText(`Coins: +${coinsThisRun}`, CANVAS_WIDTH / 2, 210);

    ctx.font = "20px Arial, sans-serif";
    ctx.fillText(`Best: ${progress.highScore}m`, CANVAS_WIDTH / 2, 245);

    // New high score celebration
    if (isNewHighScore) {
      ctx.fillStyle = "#FFD700";
      ctx.font = "bold 28px Arial, sans-serif";
      ctx.fillText("NEW HIGH SCORE!", CANVAS_WIDTH / 2, 290);
    }

    // Play Again button
    ctx.fillStyle = "rgba(34, 197, 94, 0.95)";
    ctx.fillRect(CANVAS_WIDTH / 2 - 100, 320, 200, 50);
    ctx.strokeStyle = "#166534";
    ctx.lineWidth = 3;
    ctx.strokeRect(CANVAS_WIDTH / 2 - 100, 320, 200, 50);
    ctx.font = "bold 24px Arial, sans-serif";
    ctx.fillStyle = "#FFF";
    ctx.fillText("PLAY AGAIN", CANVAS_WIDTH / 2, 352);
  }, [score, coinsThisRun, progress.highScore, isNewHighScore]);

  // Main render function
  const render = useCallback((ctx: CanvasRenderingContext2D) => {
    // Clear and draw background
    drawSky(ctx);
    drawClouds(ctx);
    drawMountains(ctx);
    drawGround(ctx);

    // Draw game objects
    drawCoins(ctx);
    drawObstacles(ctx);
    drawPlayer(ctx);

    // Draw UI based on state
    if (gameState === "ready") {
      drawReadyScreen(ctx);
    } else if (gameState === "playing") {
      drawHUD(ctx);
    } else if (gameState === "gameOver") {
      drawGameOver(ctx);
    }
  }, [
    gameState,
    drawSky,
    drawClouds,
    drawMountains,
    drawGround,
    drawCoins,
    drawObstacles,
    drawPlayer,
    drawHUD,
    drawReadyScreen,
    drawGameOver,
  ]);

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
  const handleTap = useCallback(() => {
    if (gameState === "ready") {
      startGame();
    } else if (gameState === "playing") {
      jump();
    } else if (gameState === "gameOver") {
      reset();
    }
  }, [gameState, startGame, jump, reset]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
        e.preventDefault();
        handleTap();
      }
      if (e.code === "ArrowDown" || e.code === "KeyS") {
        e.preventDefault();
        if (gameState === "playing") {
          startDuck();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "ArrowDown" || e.code === "KeyS") {
        e.preventDefault();
        stopDuck();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [handleTap, gameState, startDuck, stopDuck]);

  // Touch controls for mobile
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const touch = e.touches[0];
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const y = touch.clientY - rect.top;
    const canvasY = y / scale;

    // Bottom third of screen = duck, rest = jump
    if (canvasY > CANVAS_HEIGHT * 0.7 && gameState === "playing") {
      startDuck();
    } else {
      handleTap();
    }
  }, [handleTap, gameState, startDuck, scale]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    stopDuck();
  }, [stopDuck]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-400 to-sky-600 flex flex-col items-center justify-center p-4">
      {/* Orientation warning for landscape */}
      <OrientationWarning />

      {/* iOS install prompt */}
      <IOSInstallPrompt />


      {/* Header */}
      <header className="mb-4 text-center">
        <h1 className="text-3xl font-bold text-white drop-shadow-lg">
          Endless Runner
        </h1>
        <p className="text-sky-100">Jump over obstacles, collect coins!</p>
      </header>

      {/* Game container */}
      <div
        ref={containerRef}
        className="relative w-full max-w-4xl flex items-center justify-center"
        style={{ aspectRatio: `${CANVAS_WIDTH}/${CANVAS_HEIGHT}` }}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          onClick={handleTap}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className="rounded-lg shadow-2xl cursor-pointer touch-none"
          style={{
            width: CANVAS_WIDTH * scale,
            height: CANVAS_HEIGHT * scale,
          }}
        />
      </div>

      {/* Stats */}
      <div className="mt-4 text-center text-white/80 text-sm">
        <p>Games: {progress.gamesPlayed} | Total Distance: {Math.floor(progress.totalDistance)}m</p>
      </div>

      {/* Mobile controls hint */}
      <div className="mt-2 text-center text-white/60 text-xs md:hidden">
        <p>Tap top to jump, tap bottom to duck</p>
      </div>
    </div>
  );
}

export default EndlessRunnerGame;
