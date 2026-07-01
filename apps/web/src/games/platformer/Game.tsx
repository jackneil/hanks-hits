"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { usePlatformerStore, type PlatformerProgress } from "./lib/store";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { FullscreenButton } from "@/shared/components/FullscreenButton";
import { OrientationWarning } from "@/shared/components/OrientationWarning";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  PLAYER,
  PLATFORM,
  GROUND,
  COIN,
  STAR,
  COLORS,
  UI,
  LEVELS,
} from "./lib/constants";

export function PlatformerGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const lastTimeRef = useRef<number>(0);
  const [scale, setScale] = useState(1);

  const store = usePlatformerStore();

  // Cloud sync for authenticated users
  const { forceSync } = useAuthSync<PlatformerProgress>({
    appId: "platformer",
    localStorageKey: "hank-platformer-progress",
    getState: () => store.getProgress(),
    setState: (data) => store.setProgress(data),
    debounceMs: 3000,
  });

  // Force save immediately on game over or level complete
  useEffect(() => {
    if (store.gameState === "gameOver" || store.gameState === "levelComplete") {
      forceSync();
    }
  }, [store.gameState, forceSync]);

  const {
    gameState,
    currentLevelIndex,
    currentLevel,
    player,
    platforms,
    collectibles,
    particles,
    clouds,
    score,
    coinsThisRun,
    starsThisRun,
    timeElapsed,
    cameraX,
    groundOffset,
    isNewHighScore,
    progress,
    startGame,
    jump,
    setMovingLeft,
    setMovingRight,
    update,
    reset,
    nextLevel,
  } = store;

  // Responsive scaling
  useEffect(() => {
    const updateScale = () => {
      if (!containerRef.current) return;
      const containerWidth = containerRef.current.clientWidth;
      const containerHeight = containerRef.current.clientHeight;
      const scaleX = containerWidth / CANVAS_WIDTH;
      const scaleY = containerHeight / CANVAS_HEIGHT;
      setScale(Math.min(scaleX, scaleY, 2.5));
    };

    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  // Drawing functions
  const drawSky = useCallback(
    (ctx: CanvasRenderingContext2D) => {
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
    },
    []
  );

  const drawClouds = useCallback(
    (ctx: CanvasRenderingContext2D, offsetX: number) => {
      ctx.fillStyle = COLORS.CLOUD;
      clouds.forEach((cloud) => {
        const s = cloud.scale;
        const x = cloud.x - offsetX * 0.2; // Parallax effect
        ctx.beginPath();
        ctx.arc(x, cloud.y, 25 * s, 0, Math.PI * 2);
        ctx.arc(x + 20 * s, cloud.y - 10 * s, 20 * s, 0, Math.PI * 2);
        ctx.arc(x + 40 * s, cloud.y, 25 * s, 0, Math.PI * 2);
        ctx.arc(x + 20 * s, cloud.y + 10 * s, 18 * s, 0, Math.PI * 2);
        ctx.fill();
      });
    },
    [clouds]
  );

  const drawGround = useCallback(
    (ctx: CanvasRenderingContext2D, levelWidth: number, offsetX: number) => {
      const groundY = CANVAS_HEIGHT - GROUND.HEIGHT;

      // Draw ground for entire level width
      ctx.save();
      ctx.translate(-offsetX, 0);

      // Grass layer
      ctx.fillStyle = GROUND.GRASS_COLOR;
      ctx.fillRect(0, groundY, levelWidth, GROUND.GRASS_HEIGHT);

      // Ground base
      ctx.fillStyle = GROUND.COLOR;
      ctx.fillRect(
        0,
        groundY + GROUND.GRASS_HEIGHT,
        levelWidth,
        GROUND.HEIGHT - GROUND.GRASS_HEIGHT
      );

      ctx.restore();
    },
    []
  );

  const drawPlatforms = useCallback(
    (ctx: CanvasRenderingContext2D, offsetX: number) => {
      platforms.forEach((platform) => {
        const x = platform.x - offsetX;
        const y = platform.y;

        // Skip if off screen
        if (x + platform.width < 0 || x > CANVAS_WIDTH) return;

        // Platform top (lighter)
        ctx.fillStyle = PLATFORM.COLOR_TOP;
        ctx.fillRect(x, y, platform.width, 5);

        // Platform body
        ctx.fillStyle = PLATFORM.COLOR;
        ctx.fillRect(x, y + 5, platform.width, PLATFORM.HEIGHT - 5);

        // Moving platform indicator
        if (platform.type === "moving") {
          ctx.fillStyle = "#FFD700";
          ctx.fillRect(x + platform.width / 2 - 5, y + 7, 10, 3);
        }
      });
    },
    [platforms]
  );

  // Helper to draw star shape
  function drawStar(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    spikes: number,
    outerRadius: number,
    innerRadius: number
  ) {
    let rot = (Math.PI / 2) * 3;
    const step = Math.PI / spikes;

    ctx.beginPath();
    ctx.moveTo(cx, cy - outerRadius);

    for (let i = 0; i < spikes; i++) {
      let x = cx + Math.cos(rot) * outerRadius;
      let y = cy + Math.sin(rot) * outerRadius;
      ctx.lineTo(x, y);
      rot += step;

      x = cx + Math.cos(rot) * innerRadius;
      y = cy + Math.sin(rot) * innerRadius;
      ctx.lineTo(x, y);
      rot += step;
    }

    ctx.lineTo(cx, cy - outerRadius);
    ctx.closePath();
  }

  const drawCollectibles = useCallback(
    (ctx: CanvasRenderingContext2D, offsetX: number) => {
      collectibles.forEach((item) => {
        if (item.collected) return;

        const x = item.x - offsetX;
        const y = item.y;

        // Skip if off screen
        if (x < -50 || x > CANVAS_WIDTH + 50) return;

        // Sparkle animation
        const sparkle = Math.sin(Date.now() / 150 + item.id) * 0.2 + 0.8;

        ctx.save();
        ctx.translate(x, y);
        ctx.scale(sparkle, sparkle);

        if (item.type === "coin") {
          // Coin
          ctx.fillStyle = COIN.COLOR;
          ctx.beginPath();
          ctx.arc(0, 0, COIN.SIZE / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = COIN.OUTLINE_COLOR;
          ctx.lineWidth = 2;
          ctx.stroke();

          // $ sign
          ctx.fillStyle = COIN.OUTLINE_COLOR;
          ctx.font = "bold 12px Arial";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("$", 0, 1);
        } else {
          // Star
          drawStar(ctx, 0, 0, 5, STAR.SIZE / 2, STAR.SIZE / 4);
          ctx.fillStyle = STAR.COLOR;
          ctx.fill();
          ctx.strokeStyle = STAR.OUTLINE_COLOR;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        ctx.restore();
      });
    },
    [collectibles]
  );

  const drawPlayer = useCallback(
    (ctx: CanvasRenderingContext2D, offsetX: number) => {
      const x = player.x - offsetX;
      const y = player.y;

      // Running animation frame
      const runFrame = Math.floor(Date.now() / 100) % 2;

      ctx.save();
      ctx.translate(x + PLAYER.WIDTH / 2, y + PLAYER.HEIGHT);

      // Flip if facing left
      if (!player.facingRight) {
        ctx.scale(-1, 1);
      }

      // Body
      ctx.fillStyle = PLAYER.COLOR_BODY;
      ctx.fillRect(
        -PLAYER.WIDTH / 2 + 4,
        -PLAYER.HEIGHT + 15,
        PLAYER.WIDTH - 8,
        PLAYER.HEIGHT - 25
      );

      // Legs (animated)
      if (player.isJumping) {
        // Jumping pose
        ctx.fillRect(-10, -12, 6, 16);
        ctx.fillRect(4, -12, 6, 16);
      } else {
        // Running animation
        if (runFrame === 0) {
          ctx.fillRect(-10, -10, 6, 18);
          ctx.fillRect(4, -15, 6, 14);
        } else {
          ctx.fillRect(-10, -15, 6, 14);
          ctx.fillRect(4, -10, 6, 18);
        }
      }

      // Arms
      if (player.isJumping) {
        ctx.fillRect(-PLAYER.WIDTH / 2, -PLAYER.HEIGHT + 18, 6, 12);
        ctx.fillRect(PLAYER.WIDTH / 2 - 6, -PLAYER.HEIGHT + 18, 6, 12);
      } else {
        if (runFrame === 0) {
          ctx.fillRect(-PLAYER.WIDTH / 2, -PLAYER.HEIGHT + 22, 6, 10);
          ctx.fillRect(PLAYER.WIDTH / 2 - 6, -PLAYER.HEIGHT + 16, 6, 10);
        } else {
          ctx.fillRect(-PLAYER.WIDTH / 2, -PLAYER.HEIGHT + 16, 6, 10);
          ctx.fillRect(PLAYER.WIDTH / 2 - 6, -PLAYER.HEIGHT + 22, 6, 10);
        }
      }

      // Head
      ctx.fillStyle = PLAYER.COLOR_HEAD;
      ctx.beginPath();
      ctx.arc(0, -PLAYER.HEIGHT - 2, 12, 0, Math.PI * 2);
      ctx.fill();

      // Eyes
      ctx.fillStyle = PLAYER.COLOR_EYES;
      ctx.beginPath();
      ctx.arc(4, -PLAYER.HEIGHT - 3, 2, 0, Math.PI * 2);
      ctx.fill();

      // Hair
      ctx.fillStyle = "#654321";
      ctx.beginPath();
      ctx.arc(0, -PLAYER.HEIGHT - 7, 10, Math.PI, 0);
      ctx.fill();

      ctx.restore();
    },
    [player]
  );

  const drawGoal = useCallback(
    (ctx: CanvasRenderingContext2D, goalX: number, offsetX: number) => {
      const x = goalX - offsetX;
      const groundY = CANVAS_HEIGHT - GROUND.HEIGHT;

      // Skip if off screen
      if (x < -50 || x > CANVAS_WIDTH + 50) return;

      // Flag pole
      ctx.fillStyle = "#8B4513";
      ctx.fillRect(x, groundY - 120, 8, 120);

      // Flag
      ctx.fillStyle = "#FF4444";
      ctx.beginPath();
      ctx.moveTo(x + 8, groundY - 120);
      ctx.lineTo(x + 60, groundY - 100);
      ctx.lineTo(x + 8, groundY - 80);
      ctx.closePath();
      ctx.fill();

      // Flag star
      ctx.fillStyle = "#FFD700";
      ctx.font = "bold 20px Arial";
      ctx.textAlign = "center";
      ctx.fillText("*", x + 35, groundY - 96);
    },
    []
  );

  const drawParticles = useCallback(
    (ctx: CanvasRenderingContext2D, offsetX: number) => {
      particles.forEach((p) => {
        const alpha = p.life / p.maxLife;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x - offsetX, p.y, p.size * alpha, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    },
    [particles]
  );

  const drawHUD = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      // Score
      ctx.font = UI.SCORE_FONT;
      ctx.textAlign = "left";
      ctx.fillStyle = COLORS.SCORE_SHADOW;
      ctx.fillText(`Score: ${score}`, 22, 42);
      ctx.fillStyle = COLORS.SCORE_TEXT;
      ctx.fillText(`Score: ${score}`, 20, 40);

      // Coins
      ctx.textAlign = "center";
      ctx.fillStyle = COIN.COLOR;
      ctx.beginPath();
      ctx.arc(CANVAS_WIDTH - 100, 32, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.SCORE_TEXT;
      ctx.fillText(`x${coinsThisRun}`, CANVAS_WIDTH - 60, 40);

      // Stars
      ctx.fillStyle = STAR.COLOR;
      ctx.font = "24px Arial";
      ctx.fillText("*", CANVAS_WIDTH - 150, 40);
      ctx.font = UI.SCORE_FONT;
      ctx.fillStyle = COLORS.SCORE_TEXT;
      ctx.fillText(`x${starsThisRun}`, CANVAS_WIDTH - 120, 40);

      // Level name
      ctx.font = "18px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = COLORS.SCORE_TEXT;
      ctx.fillText(
        currentLevel?.name || "",
        CANVAS_WIDTH / 2,
        25
      );

      // Time
      const seconds = Math.floor(timeElapsed / 1000);
      const ms = Math.floor((timeElapsed % 1000) / 10);
      ctx.fillText(
        `${seconds}.${ms.toString().padStart(2, "0")}s`,
        CANVAS_WIDTH / 2,
        45
      );
    },
    [score, coinsThisRun, starsThisRun, currentLevel, timeElapsed]
  );

  const drawReadyScreen = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      ctx.font = UI.TITLE_FONT;
      ctx.textAlign = "center";
      ctx.fillStyle = COLORS.SCORE_SHADOW;
      ctx.fillText("Hank's Hopper", CANVAS_WIDTH / 2 + 2, 102);
      ctx.fillStyle = COLORS.SCORE_TEXT;
      ctx.fillText("Hank's Hopper", CANVAS_WIDTH / 2, 100);

      ctx.font = UI.SMALL_FONT;
      ctx.fillStyle = COLORS.SCORE_TEXT;
      ctx.fillText("A Platformer Adventure!", CANVAS_WIDTH / 2, 140);

      // Level selection
      ctx.font = "20px Arial, sans-serif";
      LEVELS.forEach((level, index) => {
        const y = 200 + index * 50;
        const levelProgress = progress.levels[level.id];
        const completed = levelProgress?.completed || false;
        const stars = levelProgress?.starsCollected || 0;

        // Highlight current level
        if (index === currentLevelIndex) {
          ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
          ctx.fillRect(CANVAS_WIDTH / 2 - 150, y - 20, 300, 40);
        }

        ctx.fillStyle = completed ? "#4CAF50" : COLORS.SCORE_TEXT;
        ctx.fillText(
          `${index + 1}. ${level.name}`,
          CANVAS_WIDTH / 2 - 50,
          y
        );

        // Stars indicator
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = i < stars ? STAR.COLOR : "#666";
          ctx.fillText("*", CANVAS_WIDTH / 2 + 80 + i * 20, y);
        }
      });

      // Tap to start
      ctx.fillStyle = "rgba(34, 197, 94, 0.9)";
      ctx.fillRect(CANVAS_WIDTH / 2 - 100, 370, 200, 50);
      ctx.strokeStyle = "#166534";
      ctx.lineWidth = 3;
      ctx.strokeRect(CANVAS_WIDTH / 2 - 100, 370, 200, 50);
      ctx.font = "bold 24px Arial, sans-serif";
      ctx.fillStyle = "#FFF";
      ctx.fillText("TAP TO PLAY", CANVAS_WIDTH / 2, 402);

      // Stats
      ctx.font = "16px Arial, sans-serif";
      ctx.fillStyle = COLORS.SCORE_TEXT;
      ctx.fillText(
        `Total Stars: ${progress.totalStars} | Coins: ${progress.totalCoins}`,
        CANVAS_WIDTH / 2,
        440
      );
    },
    [progress, currentLevelIndex]
  );

  const drawGameOver = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      // Darken background
      ctx.fillStyle = COLORS.GAME_OVER_BG;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      ctx.textAlign = "center";

      // Game Over text
      ctx.font = "bold 48px Arial, sans-serif";
      ctx.fillStyle = "#FF4444";
      ctx.fillText("Oops!", CANVAS_WIDTH / 2, 120);

      // Score box
      ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
      ctx.fillRect(CANVAS_WIDTH / 2 - 120, 150, 240, 120);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 3;
      ctx.strokeRect(CANVAS_WIDTH / 2 - 120, 150, 240, 120);

      ctx.fillStyle = "#000";
      ctx.font = "22px Arial, sans-serif";
      ctx.fillText("Score", CANVAS_WIDTH / 2, 185);
      ctx.font = "bold 36px Arial, sans-serif";
      ctx.fillText(`${score}`, CANVAS_WIDTH / 2, 225);

      ctx.font = "18px Arial, sans-serif";
      ctx.fillText(
        `Coins: ${coinsThisRun} | Stars: ${starsThisRun}`,
        CANVAS_WIDTH / 2,
        260
      );

      // Try Again button
      ctx.fillStyle = "rgba(34, 197, 94, 0.95)";
      ctx.fillRect(CANVAS_WIDTH / 2 - 100, 300, 200, 50);
      ctx.strokeStyle = "#166534";
      ctx.lineWidth = 3;
      ctx.strokeRect(CANVAS_WIDTH / 2 - 100, 300, 200, 50);
      ctx.font = "bold 24px Arial, sans-serif";
      ctx.fillStyle = "#FFF";
      ctx.fillText("TRY AGAIN", CANVAS_WIDTH / 2, 332);
    },
    [score, coinsThisRun, starsThisRun]
  );

  const drawLevelComplete = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      // Darken background
      ctx.fillStyle = "rgba(0, 100, 0, 0.8)";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      ctx.textAlign = "center";

      // Level Complete text
      ctx.font = "bold 48px Arial, sans-serif";
      ctx.fillStyle = "#FFD700";
      ctx.fillText("LEVEL COMPLETE!", CANVAS_WIDTH / 2, 100);

      // Score box
      ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
      ctx.fillRect(CANVAS_WIDTH / 2 - 140, 130, 280, 160);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 3;
      ctx.strokeRect(CANVAS_WIDTH / 2 - 140, 130, 280, 160);

      ctx.fillStyle = "#000";
      ctx.font = "22px Arial, sans-serif";
      ctx.fillText("Score", CANVAS_WIDTH / 2, 165);
      ctx.font = "bold 36px Arial, sans-serif";
      ctx.fillText(`${score}`, CANVAS_WIDTH / 2, 205);

      // Stars collected
      ctx.font = "24px Arial, sans-serif";
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i < starsThisRun ? STAR.COLOR : "#CCC";
        ctx.font = "bold 36px Arial";
        ctx.fillText("*", CANVAS_WIDTH / 2 - 40 + i * 40, 250);
      }

      ctx.font = "18px Arial, sans-serif";
      ctx.fillStyle = "#000";
      ctx.fillText(`Coins: ${coinsThisRun}`, CANVAS_WIDTH / 2, 280);

      // New record
      if (isNewHighScore) {
        ctx.fillStyle = "#FFD700";
        ctx.font = "bold 24px Arial, sans-serif";
        ctx.fillText("NEW BEST TIME!", CANVAS_WIDTH / 2, 320);
      }

      // Next Level / Menu buttons
      const hasNextLevel = currentLevelIndex < LEVELS.length - 1;

      if (hasNextLevel) {
        ctx.fillStyle = "rgba(34, 197, 94, 0.95)";
        ctx.fillRect(CANVAS_WIDTH / 2 - 100, 350, 200, 50);
        ctx.strokeStyle = "#166534";
        ctx.lineWidth = 3;
        ctx.strokeRect(CANVAS_WIDTH / 2 - 100, 350, 200, 50);
        ctx.font = "bold 24px Arial, sans-serif";
        ctx.fillStyle = "#FFF";
        ctx.fillText("NEXT LEVEL", CANVAS_WIDTH / 2, 382);
      } else {
        ctx.fillStyle = "rgba(59, 130, 246, 0.95)";
        ctx.fillRect(CANVAS_WIDTH / 2 - 100, 350, 200, 50);
        ctx.strokeStyle = "#1e40af";
        ctx.lineWidth = 3;
        ctx.strokeRect(CANVAS_WIDTH / 2 - 100, 350, 200, 50);
        ctx.font = "bold 24px Arial, sans-serif";
        ctx.fillStyle = "#FFF";
        ctx.fillText("ALL COMPLETE!", CANVAS_WIDTH / 2, 382);
      }
    },
    [score, coinsThisRun, starsThisRun, isNewHighScore, currentLevelIndex]
  );

  // Main render function
  const render = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const offsetX = cameraX - CANVAS_WIDTH / 2;
      const levelWidth = currentLevel?.width || CANVAS_WIDTH;
      const goalX = currentLevel?.goalX || 0;

      // Draw background
      drawSky(ctx);
      drawClouds(ctx, offsetX);

      // Draw game world
      drawGround(ctx, levelWidth, offsetX);
      drawPlatforms(ctx, offsetX);
      drawCollectibles(ctx, offsetX);
      drawGoal(ctx, goalX, offsetX);
      drawPlayer(ctx, offsetX);
      drawParticles(ctx, offsetX);

      // Draw UI based on state
      if (gameState === "ready") {
        drawReadyScreen(ctx);
      } else if (gameState === "playing") {
        drawHUD(ctx);
      } else if (gameState === "gameOver") {
        drawGameOver(ctx);
      } else if (gameState === "levelComplete") {
        drawLevelComplete(ctx);
      }
    },
    [
      gameState,
      cameraX,
      currentLevel,
      drawSky,
      drawClouds,
      drawGround,
      drawPlatforms,
      drawCollectibles,
      drawGoal,
      drawPlayer,
      drawParticles,
      drawHUD,
      drawReadyScreen,
      drawGameOver,
      drawLevelComplete,
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

  // Input handling
  const handleTap = useCallback(() => {
    if (gameState === "ready") {
      startGame();
    } else if (gameState === "playing") {
      jump();
    } else if (gameState === "gameOver") {
      reset();
    } else if (gameState === "levelComplete") {
      nextLevel();
    }
  }, [gameState, startGame, jump, reset, nextLevel]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.code === "Space" ||
        e.code === "ArrowUp" ||
        e.code === "KeyW"
      ) {
        e.preventDefault();
        if (gameState === "playing") {
          jump();
        } else {
          handleTap();
        }
      }
      if (e.code === "ArrowLeft" || e.code === "KeyA") {
        e.preventDefault();
        if (gameState === "playing") {
          setMovingLeft(true);
        }
      }
      if (e.code === "ArrowRight" || e.code === "KeyD") {
        e.preventDefault();
        if (gameState === "playing") {
          setMovingRight(true);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "ArrowLeft" || e.code === "KeyA") {
        e.preventDefault();
        setMovingLeft(false);
      }
      if (e.code === "ArrowRight" || e.code === "KeyD") {
        e.preventDefault();
        setMovingRight(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [gameState, jump, handleTap, setMovingLeft, setMovingRight]);

  // Touch controls for mobile
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = (touch.clientX - rect.left) / scale;

      if (gameState === "playing") {
        // Left third = move left, right third = move right, middle = jump
        if (x < CANVAS_WIDTH / 3) {
          setMovingLeft(true);
        } else if (x > (CANVAS_WIDTH * 2) / 3) {
          setMovingRight(true);
        } else {
          jump();
        }
      } else {
        handleTap();
      }
    },
    [gameState, jump, handleTap, setMovingLeft, setMovingRight, scale]
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      setMovingLeft(false);
      setMovingRight(false);
    },
    [setMovingLeft, setMovingRight]
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-400 to-sky-600 flex flex-col items-center justify-center p-4">
      {/* Orientation warning for mobile */}
      <OrientationWarning />

      {/* iOS install prompt */}
      <IOSInstallPrompt />

      {/* Fullscreen button */}
      <div className="fixed top-4 right-4 z-50">
        <FullscreenButton />
      </div>

      {/* Header */}
      <header className="mb-4 text-center">
        <h1 className="text-3xl font-bold text-white drop-shadow-lg">
          Hank&apos;s Hopper
        </h1>
        <p className="text-sky-100">Jump, collect, and reach the goal!</p>
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

      {/* Visible mobile controls */}
      {gameState === "playing" && (
        <div className="md:hidden fixed bottom-4 left-0 right-0 flex justify-between px-4 pointer-events-none">
          <button
            onTouchStart={(e) => {
              e.preventDefault();
              setMovingLeft(true);
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              setMovingLeft(false);
            }}
            className="w-20 h-20 bg-white/30 rounded-full flex items-center justify-center text-4xl font-bold text-white shadow-lg active:bg-white/50 pointer-events-auto touch-manipulation"
          >
            ◀
          </button>
          <button
            onTouchStart={(e) => {
              e.preventDefault();
              jump();
            }}
            className="w-24 h-24 bg-green-500/60 rounded-full flex items-center justify-center text-2xl font-bold text-white shadow-lg active:bg-green-500/80 pointer-events-auto touch-manipulation"
          >
            JUMP
          </button>
          <button
            onTouchStart={(e) => {
              e.preventDefault();
              setMovingRight(true);
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              setMovingRight(false);
            }}
            className="w-20 h-20 bg-white/30 rounded-full flex items-center justify-center text-4xl font-bold text-white shadow-lg active:bg-white/50 pointer-events-auto touch-manipulation"
          >
            ▶
          </button>
        </div>
      )}

      {/* Mobile controls hint */}
      <div className="mt-4 text-center text-white/80 text-sm">
        <p>
          <strong>Desktop:</strong> A/D or Arrows to move, Space to jump
        </p>
        <p className="md:hidden">
          <strong>Mobile:</strong> Use the buttons below to move and jump
        </p>
      </div>

      {/* Stats */}
      <div className="mt-2 text-center text-white/60 text-xs">
        <p>
          Games: {progress.gamesPlayed} | Deaths: {progress.totalDeaths} |
          Jumps: {progress.totalJumps}
        </p>
      </div>
    </div>
  );
}

export default PlatformerGame;
