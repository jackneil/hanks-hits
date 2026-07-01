"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useBlitzBomberStore, type BlitzBomberProgress } from "./lib/store";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { FullscreenButton } from "@/shared/components/FullscreenButton";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  PLANE,
  BOMB,
  BUILDING,
  GROUND,
  EXPLOSION,
  COLORS,
  UI,
  type Building as BuildingType,
  type Explosion as ExplosionType,
  type DifficultyLevel,
} from "./lib/constants";

export function BlitzBomberGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const lastTimeRef = useRef<number>(0);
  const [scale, setScale] = useState(1);

  const store = useBlitzBomberStore();
  const {
    gameState,
    score,
    level,
    plane,
    bombs,
    buildings,
    explosions,
    isNewHighScore,
    progress,
    startGame,
    dropBomb,
    update,
    reset,
    nextLevel,
    setDifficulty,
  } = store;

  // Sync with auth system
  const { isAuthenticated, syncStatus, forceSync } = useAuthSync({
    appId: "blitz-bomber",
    localStorageKey: "blitz-bomber-progress",
    getState: () => store.getProgress(),
    setState: (data: BlitzBomberProgress) => store.setProgress(data),
    debounceMs: 3000,
  });

  // Force save immediately on game end
  useEffect(() => {
    if (gameState === "crashed" || gameState === "landed") {
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
      setScale(Math.min(scaleX, scaleY, 1.5)); // Cap at 1.5x
    };

    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  function drawCloud(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number
  ) {
    ctx.beginPath();
    ctx.arc(x, y, size * 0.5, 0, Math.PI * 2);
    ctx.arc(x + size * 0.4, y - size * 0.1, size * 0.4, 0, Math.PI * 2);
    ctx.arc(x + size * 0.8, y, size * 0.5, 0, Math.PI * 2);
    ctx.arc(x + size * 0.4, y + size * 0.2, size * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }

  // Drawing functions
  const drawSky = useCallback((ctx: CanvasRenderingContext2D) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    gradient.addColorStop(0, COLORS.SKY_TOP);
    gradient.addColorStop(1, COLORS.SKY_BOTTOM);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw some clouds
    ctx.fillStyle = COLORS.CLOUD;
    drawCloud(ctx, 100, 80, 60);
    drawCloud(ctx, 350, 50, 45);
    drawCloud(ctx, 600, 100, 55);
    drawCloud(ctx, 200, 150, 40);
    drawCloud(ctx, 700, 60, 50);
  }, []);

  const drawPlane = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      ctx.save();
      ctx.translate(plane.x + PLANE.WIDTH / 2, plane.y + PLANE.HEIGHT / 2);

      // Flip if going left
      if (plane.direction === -1) {
        ctx.scale(-1, 1);
      }

      // Plane body
      ctx.fillStyle = COLORS.PLANE_BODY;
      ctx.beginPath();
      ctx.ellipse(0, 0, PLANE.WIDTH / 2, PLANE.HEIGHT / 3, 0, 0, Math.PI * 2);
      ctx.fill();

      // Cockpit
      ctx.fillStyle = COLORS.PLANE_COCKPIT;
      ctx.beginPath();
      ctx.ellipse(
        PLANE.WIDTH / 4,
        -PLANE.HEIGHT / 6,
        PLANE.WIDTH / 6,
        PLANE.HEIGHT / 4,
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();

      // Wing (top)
      ctx.fillStyle = COLORS.PLANE_WING;
      ctx.fillRect(-PLANE.WIDTH / 4, -PLANE.HEIGHT / 2, PLANE.WIDTH / 2, 8);

      // Tail
      ctx.fillStyle = COLORS.PLANE_WING;
      ctx.beginPath();
      ctx.moveTo(-PLANE.WIDTH / 2, 0);
      ctx.lineTo(-PLANE.WIDTH / 2 - 10, -PLANE.HEIGHT / 2);
      ctx.lineTo(-PLANE.WIDTH / 2 + 5, 0);
      ctx.closePath();
      ctx.fill();

      // Stripe
      ctx.fillStyle = COLORS.PLANE_STRIPE;
      ctx.fillRect(-PLANE.WIDTH / 4, -2, PLANE.WIDTH / 2, 4);

      // Propeller (spinning animation)
      const propAngle = (Date.now() / 20) % 360;
      ctx.save();
      ctx.translate(PLANE.WIDTH / 2, 0);
      ctx.rotate((propAngle * Math.PI) / 180);
      ctx.fillStyle = "#333";
      ctx.fillRect(-2, -15, 4, 30);
      ctx.restore();

      ctx.restore();
    },
    [plane]
  );

  const drawBombs = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      bombs.forEach((bomb) => {
        ctx.save();
        ctx.translate(bomb.x, bomb.y);

        // Bomb body
        ctx.fillStyle = COLORS.BOMB;
        ctx.beginPath();
        ctx.ellipse(0, BOMB.HEIGHT / 2, BOMB.WIDTH / 2, BOMB.HEIGHT / 2, 0, 0, Math.PI * 2);
        ctx.fill();

        // Fins
        ctx.fillStyle = COLORS.BOMB_FIN;
        ctx.beginPath();
        ctx.moveTo(-BOMB.WIDTH / 2, 0);
        ctx.lineTo(-BOMB.WIDTH / 2 - 5, -8);
        ctx.lineTo(-BOMB.WIDTH / 2, 4);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(BOMB.WIDTH / 2, 0);
        ctx.lineTo(BOMB.WIDTH / 2 + 5, -8);
        ctx.lineTo(BOMB.WIDTH / 2, 4);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
      });
    },
    [bombs]
  );

  const drawBuildings = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const groundY = CANVAS_HEIGHT - GROUND.HEIGHT;

      buildings.forEach((building: BuildingType) => {
        if (building.height <= 0) return;

        const x = building.x;
        const height = building.height;
        const y = groundY - height;

        // Building body
        ctx.fillStyle = building.color;
        ctx.fillRect(x, y, building.width, height);

        // Building shadow (right side)
        ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
        ctx.fillRect(x + building.width - 5, y, 5, height);

        // Windows (grid pattern)
        ctx.fillStyle = BUILDING.WINDOW_COLOR;
        const windowSize = BUILDING.WINDOW_SIZE;
        const windowGap = BUILDING.WINDOW_GAP;

        for (let wy = y + 10; wy < groundY - 10; wy += windowGap) {
          for (let wx = x + 5; wx < x + building.width - 10; wx += windowGap) {
            // Random lit/unlit windows
            if (Math.random() > 0.3) {
              ctx.fillRect(wx, wy, windowSize, windowSize);
            }
          }
        }

        // Roof detail
        ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
        ctx.fillRect(x, y, building.width, 4);
      });
    },
    [buildings]
  );

  const drawExplosions = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const now = Date.now();

      explosions.forEach((explosion: ExplosionType) => {
        const elapsed = now - explosion.startTime;
        const progress = elapsed / EXPLOSION.DURATION;

        if (progress >= 1) return;

        const radius = EXPLOSION.MAX_RADIUS * progress;
        const alpha = 1 - progress;

        // Draw multiple explosion circles
        EXPLOSION.COLORS.forEach((color, i) => {
          const r = radius * (1 - i * 0.2);
          if (r > 0) {
            ctx.fillStyle =
              color.startsWith("rgba")
                ? color.replace(/[\d.]+\)$/, `${alpha})`)
                : `${color}${Math.floor(alpha * 255).toString(16).padStart(2, "0")}`;
            ctx.beginPath();
            ctx.arc(explosion.x, explosion.y, r, 0, Math.PI * 2);
            ctx.fill();
          }
        });
      });
    },
    [explosions]
  );

  const drawGround = useCallback((ctx: CanvasRenderingContext2D) => {
    const groundY = CANVAS_HEIGHT - GROUND.HEIGHT;

    // Grass
    ctx.fillStyle = GROUND.GRASS_COLOR;
    ctx.fillRect(0, groundY, CANVAS_WIDTH, GROUND.GRASS_HEIGHT);

    // Ground
    ctx.fillStyle = GROUND.COLOR;
    ctx.fillRect(
      0,
      groundY + GROUND.GRASS_HEIGHT,
      CANVAS_WIDTH,
      GROUND.HEIGHT - GROUND.GRASS_HEIGHT
    );
  }, []);

  const drawHUD = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      // Score
      ctx.font = UI.SCORE_FONT;
      ctx.textAlign = "left";
      ctx.fillStyle = COLORS.SCORE_SHADOW;
      ctx.fillText(`Score: ${score}`, 22, 42);
      ctx.fillStyle = COLORS.SCORE_TEXT;
      ctx.fillText(`Score: ${score}`, 20, 40);

      // Level
      ctx.textAlign = "right";
      ctx.fillStyle = COLORS.SCORE_SHADOW;
      ctx.fillText(`Level ${level}`, CANVAS_WIDTH - 18, 42);
      ctx.fillStyle = COLORS.SCORE_TEXT;
      ctx.fillText(`Level ${level}`, CANVAS_WIDTH - 20, 40);

      // High score
      ctx.font = UI.SMALL_FONT;
      ctx.textAlign = "left";
      ctx.fillStyle = COLORS.SCORE_TEXT;
      ctx.fillText(`Best: ${progress.highScore}`, 20, 70);
    },
    [score, level, progress.highScore]
  );

  const drawReadyScreen = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      // Title
      ctx.font = UI.TITLE_FONT;
      ctx.textAlign = "center";
      ctx.fillStyle = COLORS.SCORE_SHADOW;
      ctx.fillText("Blitz Bomber", CANVAS_WIDTH / 2 + 3, 153);
      ctx.fillStyle = "#FF6B6B";
      ctx.fillText("Blitz Bomber", CANVAS_WIDTH / 2, 150);

      // Instructions
      ctx.font = UI.SMALL_FONT;
      ctx.fillStyle = COLORS.SCORE_TEXT;
      ctx.fillText("Drop bombs to destroy buildings!", CANVAS_WIDTH / 2, 220);
      ctx.fillText("Clear the city to land safely!", CANVAS_WIDTH / 2, 250);

      // Controls
      ctx.font = "18px Arial, sans-serif";
      ctx.fillText("Tap or Press SPACE to drop bombs", CANVAS_WIDTH / 2, 320);
      ctx.fillText("Any key starts the game", CANVAS_WIDTH / 2, 350);

      // Difficulty selector
      const difficulties: DifficultyLevel[] = ["easy", "normal", "hard"];
      const buttonWidth = 100;
      const buttonGap = 20;
      const totalWidth = difficulties.length * buttonWidth + (difficulties.length - 1) * buttonGap;
      const startX = (CANVAS_WIDTH - totalWidth) / 2;

      ctx.font = "16px Arial, sans-serif";
      difficulties.forEach((diff, i) => {
        const x = startX + i * (buttonWidth + buttonGap);
        const y = 400;
        const isSelected = progress.settings.difficulty === diff;

        ctx.fillStyle = isSelected ? "#4ECDC4" : "#ddd";
        ctx.fillRect(x, y, buttonWidth, 40);

        ctx.fillStyle = isSelected ? "#fff" : "#333";
        ctx.textAlign = "center";
        ctx.fillText(diff.toUpperCase(), x + buttonWidth / 2, y + 26);
      });

      // High score
      if (progress.highScore > 0) {
        ctx.font = UI.SMALL_FONT;
        ctx.fillStyle = "#FFD700";
        ctx.fillText(`High Score: ${progress.highScore}`, CANVAS_WIDTH / 2, 500);
      }
    },
    [progress.highScore, progress.settings.difficulty]
  );

  const drawCrashedScreen = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      // Overlay
      ctx.fillStyle = COLORS.CRASH_OVERLAY;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Crashed text
      ctx.font = UI.TITLE_FONT;
      ctx.textAlign = "center";
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#c0392b";
      ctx.lineWidth = 4;
      ctx.strokeText("CRASHED!", CANVAS_WIDTH / 2, 200);
      ctx.fillText("CRASHED!", CANVAS_WIDTH / 2, 200);

      // Score
      ctx.font = UI.SCORE_FONT;
      ctx.fillStyle = "#fff";
      ctx.fillText(`Score: ${score}`, CANVAS_WIDTH / 2, 280);

      if (isNewHighScore) {
        ctx.fillStyle = "#FFD700";
        ctx.font = "bold 28px Arial, sans-serif";
        ctx.fillText("NEW HIGH SCORE!", CANVAS_WIDTH / 2, 330);
      }

      // Restart instruction
      ctx.font = UI.SMALL_FONT;
      ctx.fillStyle = "#fff";
      ctx.fillText("Tap or press any key to restart", CANVAS_WIDTH / 2, 420);
    },
    [score, isNewHighScore]
  );

  const drawLandedScreen = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      // Overlay
      ctx.fillStyle = COLORS.WIN_OVERLAY;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Success text
      ctx.font = UI.TITLE_FONT;
      ctx.textAlign = "center";
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#27ae60";
      ctx.lineWidth = 4;
      ctx.strokeText("LANDED!", CANVAS_WIDTH / 2, 180);
      ctx.fillText("LANDED!", CANVAS_WIDTH / 2, 180);

      // Score
      ctx.font = UI.SCORE_FONT;
      ctx.fillStyle = "#fff";
      ctx.fillText(`Score: ${score}`, CANVAS_WIDTH / 2, 260);

      // Level complete
      ctx.font = "bold 24px Arial, sans-serif";
      ctx.fillStyle = "#FFD700";
      ctx.fillText(`Level ${level} Complete!`, CANVAS_WIDTH / 2, 310);

      if (isNewHighScore) {
        ctx.fillStyle = "#FFD700";
        ctx.font = "bold 28px Arial, sans-serif";
        ctx.fillText("NEW HIGH SCORE!", CANVAS_WIDTH / 2, 360);
      }

      // Next level instruction
      ctx.font = UI.SMALL_FONT;
      ctx.fillStyle = "#fff";
      ctx.fillText("Tap or press SPACE for next level", CANVAS_WIDTH / 2, 430);
      ctx.fillText("Press R to restart from level 1", CANVAS_WIDTH / 2, 460);
    },
    [score, level, isNewHighScore]
  );

  // Main render function
  const render = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      // Draw sky
      drawSky(ctx);

      // Draw buildings
      drawBuildings(ctx);

      // Draw ground
      drawGround(ctx);

      // Draw explosions
      drawExplosions(ctx);

      // Draw bombs
      drawBombs(ctx);

      // Draw plane
      drawPlane(ctx);

      // Draw UI based on state
      if (gameState === "ready") {
        drawReadyScreen(ctx);
      } else if (gameState === "playing") {
        drawHUD(ctx);
      } else if (gameState === "crashed") {
        drawHUD(ctx);
        drawCrashedScreen(ctx);
      } else if (gameState === "landed") {
        drawHUD(ctx);
        drawLandedScreen(ctx);
      }
    },
    [
      gameState,
      drawSky,
      drawBuildings,
      drawGround,
      drawExplosions,
      drawBombs,
      drawPlane,
      drawReadyScreen,
      drawHUD,
      drawCrashedScreen,
      drawLandedScreen,
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
      lastTimeRef.current = 0;
    };
  }, [gameState, update, render]);

  // Input handling
  const handleInput = useCallback(() => {
    if (gameState === "ready") {
      startGame();
    } else if (gameState === "playing") {
      dropBomb();
    } else if (gameState === "crashed") {
      reset();
    } else if (gameState === "landed") {
      nextLevel();
    }
  }, [gameState, startGame, dropBomb, reset, nextLevel]);

  // Handle difficulty click on ready screen
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || gameState !== "ready") {
        handleInput();
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;

      // Check difficulty button clicks
      const difficulties: DifficultyLevel[] = ["easy", "normal", "hard"];
      const buttonWidth = 100;
      const buttonGap = 20;
      const totalWidth = difficulties.length * buttonWidth + (difficulties.length - 1) * buttonGap;
      const startX = (CANVAS_WIDTH - totalWidth) / 2;
      const buttonY = 400;

      for (let i = 0; i < difficulties.length; i++) {
        const bx = startX + i * (buttonWidth + buttonGap);
        if (x >= bx && x <= bx + buttonWidth && y >= buttonY && y <= buttonY + 40) {
          setDifficulty(difficulties[i]);
          return;
        }
      }

      // Otherwise start game
      handleInput();
    },
    [gameState, scale, setDifficulty, handleInput]
  );

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        handleInput();
      } else if (e.code === "KeyR" && (gameState === "landed" || gameState === "crashed")) {
        e.preventDefault();
        reset();
      } else if (gameState === "ready") {
        // Any key starts in ready state
        handleInput();
      } else if (gameState === "playing") {
        // Any key drops bomb while playing
        handleInput();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleInput, gameState, reset]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-400 to-sky-600 flex flex-col items-center justify-center p-4">
      {/* iOS install prompt */}
      <IOSInstallPrompt />

      {/* Fullscreen button */}
      <div className="fixed top-4 right-4 z-50">
        <FullscreenButton />
      </div>

      {/* Header */}
      <header className="mb-4 text-center">
        <h1 className="text-3xl font-bold text-white drop-shadow-lg">
          Blitz Bomber
        </h1>
        <p className="text-sky-100">Bomb the buildings, land safely!</p>
      </header>

      {/* Game container */}
      <div
        ref={containerRef}
        className="relative w-full max-w-4xl aspect-[4/3] flex items-center justify-center"
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          onClick={handleCanvasClick}
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
        <p>
          Games: {progress.gamesPlayed} | Landings: {progress.successfulLandings} | Buildings: {progress.totalBuildingsDestroyed}
        </p>
      </div>

      {/* Controls hint */}
      <div className="mt-2 text-center text-white/60 text-xs">
        <p className="hidden md:block">Press SPACE or any key to drop bombs | R to restart</p>
        <p className="md:hidden">Tap anywhere to drop bombs</p>
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

export default BlitzBomberGame;
