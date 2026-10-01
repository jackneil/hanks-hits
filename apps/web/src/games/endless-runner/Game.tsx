"use client";

import { useEffect, useRef, useCallback } from "react";
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
import { useShellHold } from "@/shared/hooks/useShellHold";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import { getInstructionLines } from "./lib/instructions";
import { GameStartOverlay } from "@/shared/components/GameStartOverlay";
import { keyBelongsToTarget } from "@/shared/lib/keyboardTarget";
import { useCoarsePointer } from "@/shared/hooks/useCoarsePointer";
import { usePointerHold, useTouchInput } from "@/shared/hooks/useTouchInput";
import { usePlayBox } from "@/shared/hooks/usePlayBox";
import { DEFAULT_RESTART_GRACE_MS, usePointerTap, useRestartGrace } from "@/shared/lib/input";
import { ResultChip } from "@/shared/components/ResultChip";
import { ResultCard, ResultLine } from "@/shared/components/ResultCard";
import { ThumbPadLayout, fitThumbPads } from "@/shared/components/ThumbPadLayout";
import { useEndlessClips } from "./lib/useEndlessClips";

/**
 * On a phone the window shows at least this much of the world's width,
 * so the picture is taller (the runner stands at x = 100; 500 px of road
 * ahead is what a kid needs). Before this it was a strip 25 to 29 percent
 * of the screen tall (phone UX audit 2026-09-29).
 */
export const PHONE_VISIBLE_WORLD = 600;

/** The result in kid words, read aloud first. */
export function runnerResultText({ distance, coins, best, newBest }: { distance: number; coins: number; best: number; newBest: boolean }): string {
  const coinWords = coins === 1 ? "1 coin" : `${coins} coins`;
  const bestWords = newBest ? " That is a new best!" : ` Your best is ${best} meters.`;
  return `Game over! You ran ${distance} meters and got ${coinWords}.${bestWords}`;
}

const HOLD_BUTTON =
  "flex items-center justify-center rounded-2xl bg-slate-800/90 text-white text-xl font-bold shadow-md active:bg-slate-900 touch-none select-none [-webkit-touch-callout:none] [-webkit-user-select:none]";

export function EndlessRunnerGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const lastTimeRef = useRef<number>(0);
  const isCoarse = useCoarsePointer();
  // The picture fits the play box on both axes, with the thumb buttons
  // beside it (sideways) or under it (upright). Sideways the runner, the
  // crates and the ground used to be below the screen.
  const box = usePlayBox({ fit: true });
  const fit = fitThumbPads(
    box,
    isCoarse,
    { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
    { minVisibleWorld: PHONE_VISIBLE_WORLD, maxScale: 2 },
  );
  // The shell holds the game under an overlay (the orientation tip, the
  // restart question, the leaderboard, the install steps) and in a hidden
  // tab: the loop skips its update while it is true, so the runner stands
  // still under "Turn your phone sideways" (phone UX audit 2026-09-29, S7).
  const held = useShellHold();

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

  // The right edge of the part of the world on screen: on a phone the
  // window may crop the world on the right (PHONE_VISIBLE_WORLD), so the
  // coin counter is drawn at the visible edge, never off screen.
  const visibleRight = Math.round(fit.scale > 0 ? fit.visibleWorld : CANVAS_WIDTH);
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
    ctx.fillText(`${coinsThisRun}`, visibleRight - 18, 42);
    ctx.fillStyle = COIN.COLOR;
    ctx.fillText(`${coinsThisRun}`, visibleRight - 20, 40);

    // Coin icon
    ctx.fillStyle = COIN.COLOR;
    ctx.beginPath();
    ctx.arc(visibleRight - 60, 32, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COIN.OUTLINE_COLOR;
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [score, coinsThisRun, visibleRight]);

  // The result is DOM text over the picture (legible at every scale; the
  // canvas text was 7.7 px upright). The canvas only dims the world.
  const drawGameOver = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = COLORS.GAME_OVER_BG;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }, []);

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

    // Draw UI based on state. The "ready" screen is the shared DOM
    // GameStartOverlay now, so nothing is painted into the canvas for it.
    if (gameState === "playing") {
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

      // Held: draw, but let no game time pass. `held` is a dependency, so
      // the loop starts again with a seed frame when the hold ends.
      if (gameState === "playing" && !held) {
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
  }, [gameState, held, update, render]);

  // Clips: the canvas, runs and the new-best moment.
  useEndlessClips(canvasRef, { gameState, distance: score, highScore: progress.highScore });

  // Play again: straight into a new run, no start card in between.
  const restart = useCallback(() => {
    reset();
    startGame();
  }, [reset, startGame]);
  // A thumb still mashing at the crash must not restart at once.
  const grace = useRestartGrace(DEFAULT_RESTART_GRACE_MS, gameState);

  // Input handling. Taps and keys never start the run: the shared start
  // overlay owns that, and the result chip owns Play again, so a tap on
  // the picture only ever jumps.
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
        if (gameState === "playing") handleTap();
        else if (gameState === "gameOver" && grace.accept(e)) restart();
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
  }, [handleTap, gameState, startDuck, stopDuck, grace, restart]);

  // Touch on the picture through the shared native touch hook: one zone
  // per finger. The ground (the bottom 30 percent) ducks while held, the
  // rest jumps. A thumb holding the ground stays ducked while the other
  // thumb taps to jump; only the duck finger lifting stands the runner up.
  useTouchInput<"duck" | "jump">(canvasRef, {
    onStart: (touch) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (!(rect.height > 0)) return;
      const canvasY = ((touch.startY - rect.top) / rect.height) * CANVAS_HEIGHT;
      if (canvasY > CANVAS_HEIGHT * 0.7 && gameState === "playing") {
        touch.tag = "duck";
        startDuck();
      } else {
        touch.tag = "jump";
        handleTap();
      }
    },
    onEnd: (touch) => {
      if (touch.tag === "duck") stopDuck();
    },
  });

  // The thumb buttons: JUMP on the press, DUCK while held (up, a cancel or
  // a blur stands the runner back up).
  const jumpTap = usePointerTap<HTMLButtonElement>(() => handleTap());
  const duckHold = usePointerHold<HTMLButtonElement>(
    () => {
      if (useEndlessRunnerStore.getState().gameState === "playing") startDuck();
    },
    () => stopDuck(),
  );
  const playing = gameState === "playing";
  const sideways = fit.layout === "sideways";
  const buttonSize = sideways ? "h-24 w-[72px]" : "h-20 flex-1";
  const jumpButton = (
    <button
      type="button"
      data-testid="runner-jump"
      {...jumpTap}
      aria-hidden={playing ? undefined : true}
      inert={!playing}
      className={`${HOLD_BUTTON} ${buttonSize} ${playing ? "" : "invisible"}`}
    >
      JUMP
    </button>
  );
  const duckButton = (
    <button
      type="button"
      data-testid="runner-duck"
      {...duckHold}
      aria-hidden={playing ? undefined : true}
      inert={!playing}
      className={`${HOLD_BUTTON} ${buttonSize} ${playing ? "" : "invisible"}`}
    >
      DUCK
    </button>
  );

  return (
    <div className="relative h-full w-full bg-sky-500 touch-none select-none [-webkit-touch-callout:none]">
      {/* iOS install prompt */}
      <IOSInstallPrompt />

      <ThumbPadLayout fit={fit} left={jumpButton} right={duckButton} rowTestId="runner-control-row">
        {/* The window onto the world. Upright it crops the world on the
            right, so the picture is as tall as the box allows. */}
        <div
          data-testid="runner-viewport"
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
            style={{ width: Math.round(CANVAS_WIDTH * fit.scale), height: fit.viewHeight }}
          />

          {gameState === "gameOver" && (
            <ResultCard testId="runner-result-card" title="Game over!">
              <ResultLine big>
                {score} m · 🪙 +{coinsThisRun}
              </ResultLine>
              <ResultLine>{isNewHighScore ? "🏆 New best!" : `Best ${progress.highScore} m`}</ResultLine>
            </ResultCard>
          )}
        </div>
      </ThumbPadLayout>

      {/* Shared DOM start screen (renders the title once). */}
      {gameState === "ready" && (
        <GameStartOverlay
          title="Endless Runner"
          emoji="🏃"
          subtitle="Run as far as you can!"
          touchHints={getInstructionLines(true)}
          keyboardHints={getInstructionLines(false)}
          onStart={() => startGame()}
        >
          <div className="text-base font-medium opacity-90">
            🏆 Best: {progress.highScore}m · 🪙 Coins: {progress.totalCoins}
          </div>
          <div className="text-sm opacity-80">
            Games: {progress.gamesPlayed} · Total: {Math.floor(progress.totalDistance)}m
          </div>
        </GameStartOverlay>
      )}

      {/* The result chip: read it to me, Play again, the leaderboard, and
          with clips on the clip buttons. Mounted only at game over, so its
          grace starts then. */}
      {gameState === "gameOver" && (
        <ResultChip
          resultText={runnerResultText({
            distance: score,
            coins: coinsThisRun,
            best: progress.highScore,
            newBest: isNewHighScore,
          })}
          appId="endless-runner"
          onRestart={restart}
          keyboardHint="Space"
        />
      )}
    </div>
  );
}

export default EndlessRunnerGame;
