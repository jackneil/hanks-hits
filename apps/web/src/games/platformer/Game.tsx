"use client";

import { useEffect, useRef, useCallback } from "react";
import { usePlatformerStore, type PlatformerProgress } from "./lib/store";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { useCoarsePointer } from "@/shared/hooks/useCoarsePointer";
import { usePointerHold, useTouchInput } from "@/shared/hooks/useTouchInput";
import { DEFAULT_RESTART_GRACE_MS, usePointerTap, useRestartGrace } from "@/shared/lib/input";
import { usePlayBox } from "@/shared/hooks/usePlayBox";
import { ResultChip } from "@/shared/components/ResultChip";
import { ResultCard, ResultLine } from "@/shared/components/ResultCard";
import { RESULT_CHIP_BUTTON } from "@/shared/components/buttonStyles";
import { ThumbPadLayout, fitThumbPads } from "@/shared/components/ThumbPadLayout";
import { usePlatformerClips } from "./lib/usePlatformerClips";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import {
  GameStartOverlay,
  GameStartOverlayButton,
} from "@/shared/components/GameStartOverlay";
import { metadata } from "./metadata";
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
import { keyBelongsToTarget } from "@/shared/lib/keyboardTarget";

/** A phone held sideways: ◀ and ▶ side by side under the left thumb. */
export const LEFT_GUTTER_WIDTH = 132;

/** The result of a level in kid words, read aloud first. */
export function levelResultText({
  cleared,
  levelName,
  score,
  stars,
  coins,
  newBestTime,
  lastLevel,
}: {
  cleared: boolean;
  levelName: string;
  score: number;
  stars: number;
  coins: number;
  newBestTime: boolean;
  lastLevel: boolean;
}): string {
  const coinWords = coins === 1 ? "1 coin" : `${coins} coins`;
  const starWords = stars === 1 ? "1 star" : `${stars} stars`;
  if (!cleared) return `Oops! You got ${score} points, ${coinWords} and ${starWords}. Try again!`;
  const best = newBestTime ? " That is your best time!" : "";
  const next = lastLevel ? " You beat every level!" : "";
  return `Level complete: ${levelName}! You got ${score} points, ${coinWords} and ${starWords}.${best}${next}`;
}

const PAD_BUTTON =
  "flex items-center justify-center rounded-2xl font-bold text-white shadow-md touch-none select-none [-webkit-touch-callout:none] [-webkit-user-select:none]";

export function PlatformerGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const lastTimeRef = useRef<number>(0);
  // Touch viewports must not see keyboard-only copy (2026-07-10 audit)
  const isCoarse = useCoarsePointer();
  // The picture fits the play box, with ◀ ▶ under the left thumb and JUMP
  // under the right, beside it sideways or under it upright. Sideways the
  // player, the ground and the low platforms used to be below the screen.
  const box = usePlayBox({ fit: true });
  const fit = fitThumbPads(
    box,
    isCoarse,
    { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
    // The whole world, always: the camera is clamped at the start of a
    // level (the player stands at the left), and the HUD sits at the edges,
    // so a crop hid both. Upright it is 40 percent of an SE's box (the audit
    // found a 28 to 32 percent strip).
    { maxScale: 2, gutterLeft: LEFT_GUTTER_WIDTH },
  );

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

  // The end of a level is DOM text over the picture (legible at every
  // scale; the canvas text and buttons were 86x21 px upright). The canvas
  // only tints the world.
  const drawGameOver = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = COLORS.GAME_OVER_BG;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }, []);

  const drawLevelComplete = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = "rgba(0, 100, 0, 0.6)";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }, []);

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

      // Draw UI based on state. The "ready" state draws only the level scene;
      // the start menu is the shared DOM GameStartOverlay, not canvas text.
      if (gameState === "playing") {
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

  const lastLevel = currentLevelIndex >= LEVELS.length - 1;
  // Clips: the canvas, one run per attempt at a level, and the level-clear moment.
  usePlatformerClips(canvasRef, { gameState, score });

  // Try again and Next level wait out a short grace after the result shows,
  // so a thumb still pressing JUMP at the finish does not skip the result.
  const grace = useRestartGrace(DEFAULT_RESTART_GRACE_MS, gameState);
  const tryAgain = useCallback(() => startGame(currentLevelIndex), [startGame, currentLevelIndex]);
  const goNext = useCallback(() => {
    if (lastLevel) reset();
    else nextLevel();
  }, [lastLevel, reset, nextLevel]);

  // Input handling. The start card, the result chip and its buttons own
  // every screen but play, so a tap on the picture only ever plays.
  const handleTap = useCallback(() => {
    if (gameState === "playing") jump();
  }, [gameState, jump]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // A focused button or link owns its own Space and Enter: never swallow them.
      if (keyBelongsToTarget(e)) return;
      // The start card owns the ready state: keys must not act or block the
      // browser's own Space/Enter handling while it is up.
      if (gameState === "ready") return;
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
        e.preventDefault();
        if (gameState === "playing") jump();
        else if (gameState === "gameOver" && grace.accept(e)) tryAgain();
        else if (gameState === "levelComplete" && grace.accept(e)) goNext();
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
  }, [gameState, jump, setMovingLeft, setMovingRight, grace, tryAgain, goNext]);

  // Touch zones on the picture through the shared native touch hook: one
  // zone per finger, read from that finger's own start point (the old
  // handler read the OLDEST finger, so a tap while ▶ was held moved LEFT).
  // Left third moves left, right third moves right, the middle jumps.
  useTouchInput<"left" | "right" | "jump">(canvasRef, {
    onStart: (touch) => {
      if (gameState !== "playing") return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (!(rect.width > 0)) return;
      const x = ((touch.startX - rect.left) / rect.width) * CANVAS_WIDTH;
      if (x < CANVAS_WIDTH / 3) {
        touch.tag = "left";
        setMovingLeft(true);
      } else if (x > (CANVAS_WIDTH * 2) / 3) {
        touch.tag = "right";
        setMovingRight(true);
      } else {
        touch.tag = "jump";
        jump();
      }
    },
    onEnd: (touch) => {
      if (touch.tag === "left") setMovingLeft(false);
      if (touch.tag === "right") setMovingRight(false);
    },
  });

  // The pad: ◀ ▶ are holds (pointer capture, release on cancel, blur and
  // unmount); JUMP is one press, for any finger, while ▶ is held.
  const leftHold = usePointerHold<HTMLButtonElement>(
    () => setMovingLeft(true),
    () => setMovingLeft(false)
  );
  const rightHold = usePointerHold<HTMLButtonElement>(
    () => setMovingRight(true),
    () => setMovingRight(false)
  );
  const jumpTap = usePointerTap<HTMLButtonElement>(() => jump());

  // The pad keeps its place between levels (invisible and inert), so the
  // thumbs never land on nothing and the picture never jumps.
  const playing = gameState === "playing";
  const sideways = fit.layout === "sideways";
  const padState = playing ? "" : "invisible";
  const arrowSize = sideways ? "h-24 w-14 text-3xl" : "h-20 flex-1 text-4xl";
  const arrows = (
    <>
      <button
        type="button"
        aria-label="Move left"
        data-testid="platformer-left"
        {...leftHold}
        aria-hidden={playing ? undefined : true}
        inert={!playing}
        className={`${PAD_BUTTON} bg-slate-800/85 active:bg-slate-900 ${arrowSize} ${padState}`}
      >
        ◀
      </button>
      <button
        type="button"
        aria-label="Move right"
        data-testid="platformer-right"
        {...rightHold}
        aria-hidden={playing ? undefined : true}
        inert={!playing}
        className={`${PAD_BUTTON} bg-slate-800/85 active:bg-slate-900 ${arrowSize} ${padState}`}
      >
        ▶
      </button>
    </>
  );
  const jumpButton = (
    <button
      type="button"
      data-testid="platformer-jump"
      {...jumpTap}
      aria-hidden={playing ? undefined : true}
      inert={!playing}
      className={`${PAD_BUTTON} bg-green-700 active:bg-green-800 text-2xl ${sideways ? "h-24 w-[72px]" : "h-20 flex-1"} ${padState}`}
    >
      JUMP
    </button>
  );

  const finished = gameState === "gameOver" || gameState === "levelComplete";
  const cleared = gameState === "levelComplete";
  const resultWords = levelResultText({
    cleared,
    levelName: currentLevel?.name ?? "",
    score,
    stars: starsThisRun,
    coins: coinsThisRun,
    newBestTime: isNewHighScore,
    lastLevel,
  });

  return (
    <div className="relative h-full w-full bg-sky-500 touch-none select-none [-webkit-touch-callout:none]">
      {/* iOS install prompt */}
      <IOSInstallPrompt />

      <ThumbPadLayout fit={fit} left={arrows} right={jumpButton} rowTestId="platformer-control-row">
        {/* The window onto the whole world. */}
        <div
          data-testid="platformer-viewport"
          className="relative shrink-0 overflow-hidden rounded-lg shadow-xl"
          style={{ width: fit.viewWidth, height: fit.viewHeight }}
        >
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            // Mouse only: a finger's touch events are default-prevented by the
            // hook above, so the browser sends no click for a tap.
            onClick={handleTap}
            className="block cursor-pointer touch-none"
            style={{
              width: Math.round(CANVAS_WIDTH * fit.scale),
              height: fit.viewHeight,
            }}
          />

          {finished && (
            <ResultCard testId="platformer-result-card" title={cleared ? "Level complete!" : "Oops!"}>
              <ResultLine big>
                {score} points · 🪙 {coinsThisRun} · {"⭐".repeat(starsThisRun)}
                {"☆".repeat(Math.max(0, 3 - starsThisRun))}
              </ResultLine>
              {cleared && isNewHighScore && <ResultLine>⏱️ Best time!</ResultLine>}
            </ResultCard>
          )}
        </div>
      </ThumbPadLayout>

      {/* Start screen: shared DOM overlay with a real level picker */}
      {gameState === "ready" && (
        <GameStartOverlay
          title="Hank's Hopper"
          emoji={metadata.emoji}
          subtitle="A Platformer Adventure!"
          touchHints={["Hold ◀ ▶ to move", "Tap JUMP to jump"]}
          keyboardHints={["A/D or Arrows to move", "SPACE to jump"]}
          showStartButton={false}
          spokenChoices={`Tap a level and the game starts: ${LEVELS.map(
            (level, index) => `Level ${index + 1}, ${level.name}`
          ).join(", ")}.`}
          onStart={() => startGame(currentLevelIndex)}
        >
          {LEVELS.map((level, index) => {
            const stars = progress.levels[level.id]?.starsCollected ?? 0;
            const starLabel =
              "⭐".repeat(stars) + "☆".repeat(Math.max(0, 3 - stars));
            return (
              <GameStartOverlayButton
                key={level.id}
                onClick={() => startGame(index)}
              >
                Level {index + 1}: {level.name} · {starLabel}
              </GameStartOverlayButton>
            );
          })}
          <div className="text-sm font-semibold opacity-80">
            ⭐ Total Stars: {progress.totalStars} · 🪙 Coins:{" "}
            {progress.totalCoins} · Jumps: {progress.totalJumps}
          </div>
        </GameStartOverlay>
      )}

      {/* The result chip: read it to me, Try again (Play again), Next level,
          the leaderboard, and with clips on the clip buttons. Mounted only
          at the end of a level, so its grace starts then. */}
      {finished && (
        <ResultChip
          resultText={resultWords}
          appId="platformer"
          onRestart={tryAgain}
          spokenExtras={cleared ? [lastLevel ? "Pick a level" : "Next level"] : []}
          keyboardHint="Space"
        >
          {cleared && (
            <button
              type="button"
              data-testid="platformer-next"
              onClick={() => {
                if (grace.accept()) goNext();
              }}
              className={`btn btn-primary ${RESULT_CHIP_BUTTON}`}
            >
              {lastLevel ? "🗺️ Pick a level" : "▶ Next level"}
            </button>
          )}
        </ResultChip>
      )}
    </div>
  );
}

export default PlatformerGame;
