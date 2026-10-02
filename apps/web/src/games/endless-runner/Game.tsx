"use client";

import { useEffect, useRef, useCallback } from "react";
import { useEndlessRunnerStore, type EndlessRunnerProgress, type EndlessRunnerState } from "./lib/store";
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  FLOOR_Y,
  PLAYER,
  GROUND,
  OBSTACLE,
  COIN,
  COLORS,
  UI,
  CHARACTERS,
  RUNNER_ART,
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
import { obstacleRect, runnerHeight } from "./lib/geometry";

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

/** What the picture is drawn from: a snapshot of the store. */
type Scene = Pick<
  EndlessRunnerState,
  "gameState" | "score" | "coinsThisRun" | "player" | "obstacles" | "coins" | "clouds" | "groundOffset" | "progress"
>;

/**
 * The sun, below the HUD row: at y 60 its glow was behind the yellow coin
 * counter on a wide screen, and the coin icon was hard to see (review
 * wave 2, 2026-10-02). On a phone the sun is off the right of the window.
 */
export const SUN = { X: CANVAS_WIDTH - 80, Y: 110, R: 35, GLOW_R: 50 } as const;

function drawSky(ctx: CanvasRenderingContext2D) {
  const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
  gradient.addColorStop(0, COLORS.SKY_TOP);
  gradient.addColorStop(1, COLORS.SKY_BOTTOM);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Sun
  ctx.fillStyle = COLORS.SUN_GLOW;
  ctx.beginPath();
  ctx.arc(SUN.X, SUN.Y, SUN.GLOW_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLORS.SUN;
  ctx.beginPath();
  ctx.arc(SUN.X, SUN.Y, SUN.R, 0, Math.PI * 2);
  ctx.fill();
}

function drawClouds(ctx: CanvasRenderingContext2D, clouds: Scene["clouds"]) {
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
}

function drawMountains(ctx: CanvasRenderingContext2D) {
  const groundY = FLOOR_Y;

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
}

function drawGround(ctx: CanvasRenderingContext2D, groundOffset: number) {
  // The grass starts on the floor line the runner and the crates stand on.
  const groundY = FLOOR_Y;

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
}

/**
 * The runner, drawn with the feet on y = 0 of its own frame (player.y: on
 * the ground that is FLOOR_Y, the top of the grass) from the RUNNER_ART
 * numbers. The drawing stays inside runnerSilhouette(), the coin box. The
 * ducking pose stays under an air bar, so the picture shows what the rules
 * do: duck under the purple bars.
 */
function drawPlayer(ctx: CanvasRenderingContext2D, player: Scene["player"], characterColor: string) {
  const a = RUNNER_ART;
  const playerHeight = runnerHeight(player);
  const arm = a.ARM_WIDTH;

  // Running animation frame
  const runFrame = Math.floor(Date.now() / 100) % 2;

  ctx.save();
  ctx.translate(PLAYER.X, player.y);

  if (player.isDucking) {
    // Ducking pose - a low slide, the head tucked in front
    ctx.fillStyle = characterColor;
    ctx.fillRect(-PLAYER.WIDTH / 2, -a.DUCK_BODY_HEIGHT, PLAYER.WIDTH, a.DUCK_BODY_HEIGHT);

    ctx.fillStyle = PLAYER.COLOR_HEAD;
    ctx.beginPath();
    ctx.arc(a.DUCK_HEAD_X, a.DUCK_HEAD_Y, a.DUCK_HEAD_R, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(a.DUCK_HEAD_X + 4, a.DUCK_HEAD_Y - 1, 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Normal running pose: the planted leg ends on the floor (y = 0)
    const leg = a.LEG_LENGTH;
    // Body
    ctx.fillStyle = characterColor;
    ctx.fillRect(-PLAYER.WIDTH / 2 + 5, -playerHeight + 3, PLAYER.WIDTH - 10, playerHeight - 3 - leg);

    // Legs (animated)
    ctx.fillStyle = characterColor;
    if (player.isJumping) {
      // Jumping pose - legs together
      ctx.fillRect(-8, -leg, 6, leg);
      ctx.fillRect(2, -leg, 6, leg);
    } else {
      // Running animation: one leg planted, one lifted
      if (runFrame === 0) {
        ctx.fillRect(-10, -leg, 6, leg);
        ctx.fillRect(4, -leg - 5, 6, 18);
      } else {
        ctx.fillRect(-10, -leg - 5, 6, 18);
        ctx.fillRect(4, -leg, 6, leg);
      }
    }

    // Arms (animated), out to ARM_REACH on each side
    const leftArm = -a.ARM_REACH;
    const rightArm = a.ARM_REACH - arm;
    if (player.isJumping) {
      // Arms up when jumping
      ctx.fillRect(leftArm, -playerHeight + 8, arm, 15);
      ctx.fillRect(rightArm, -playerHeight + 8, arm, 15);
    } else {
      // Swinging arms
      if (runFrame === 0) {
        ctx.fillRect(leftArm, -playerHeight + 13, arm, 12);
        ctx.fillRect(rightArm, -playerHeight + 6, arm, 12);
      } else {
        ctx.fillRect(leftArm, -playerHeight + 6, arm, 12);
        ctx.fillRect(rightArm, -playerHeight + 13, arm, 12);
      }
    }

    // Head
    ctx.fillStyle = PLAYER.COLOR_HEAD;
    ctx.beginPath();
    ctx.arc(0, a.HEAD_Y, a.HEAD_R, 0, Math.PI * 2);
    ctx.fill();

    // Hair
    ctx.fillStyle = PLAYER.COLOR_HAIR;
    ctx.beginPath();
    ctx.arc(0, a.HAIR_Y, a.HAIR_R, Math.PI, 0);
    ctx.fill();

    // Eyes
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(4, a.HEAD_Y, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/** The width of one white warning stripe on a purple bar, and the step between stripes. */
const STRIPE_WIDTH = 8;
const STRIPE_STEP = 15;

// Obstacles are drawn from obstacleRect(), the same boxes the store
// collides with: what a kid sees is what hits.
function drawObstacles(ctx: CanvasRenderingContext2D, obstacles: Scene["obstacles"]) {
  obstacles.forEach((obs) => {
    const { left: x, top: y, width, height } = obstacleRect(obs);
    if (obs.type === "ground") {
      // Ground obstacle - red crate/box, standing on the grass
      ctx.fillStyle = OBSTACLE.GROUND_COLOR;
      ctx.fillRect(x, y, width, height);

      // Highlight
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.fillRect(x + 3, y + 3, width - 6, 8);

      // Shadow
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.fillRect(x, y + height - 5, width, 5);

      // X marks
      ctx.strokeStyle = "#FFF";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + 8, y + 12);
      ctx.lineTo(x + width - 8, y + height - 12);
      ctx.moveTo(x + width - 8, y + 12);
      ctx.lineTo(x + 8, y + height - 12);
      ctx.stroke();
    } else {
      // Air obstacle - purple bar (duck under)
      ctx.fillStyle = OBSTACLE.AIR_COLOR;
      ctx.fillRect(x, y, width, height);

      // Highlight
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.fillRect(x, y, width, 5);

      // Warning stripes, every one whole and inside the bar
      ctx.fillStyle = "#FFF";
      for (let i = 0; i + STRIPE_WIDTH <= width; i += STRIPE_STEP) {
        ctx.fillRect(x + i, y + 10, STRIPE_WIDTH, height - 15);
      }
    }
  });
}

function drawCoins(ctx: CanvasRenderingContext2D, coins: Scene["coins"]) {
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
}

/** The coin icon's radius in the HUD, and the space between it and the count. */
export const HUD_COIN_RADIUS = 12;
const HUD_GAP = 6;
/**
 * The width of the dark ring round the HUD coin icon. A yellow coin on the
 * yellow sun (and on a white cloud) was hard to see on a wide screen; the
 * ring is the HUD's dark text shadow colour, so it reads on any sky.
 */
export const HUD_COIN_RING = 3;
/** The y of the HUD row's coin icon centre. */
export const HUD_COIN_Y = 32;

/**
 * The distance on the left; the coin count on the right, at the right edge
 * of the part of the world on screen (`visibleRight`: on a phone the window
 * may crop the world, so the counter is never off screen), with the coin
 * icon just left of the number however many digits it has.
 */
function drawHUD(ctx: CanvasRenderingContext2D, score: number, coinsThisRun: number, visibleRight: number) {
  // Distance counter
  ctx.font = UI.SCORE_FONT;
  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.SCORE_SHADOW;
  ctx.fillText(`${score}m`, 22, 42);
  ctx.fillStyle = COLORS.SCORE_TEXT;
  ctx.fillText(`${score}m`, 20, 40);

  // Coins counter
  const count = `${coinsThisRun}`;
  const countRight = visibleRight - 20;
  ctx.textAlign = "right";
  ctx.fillStyle = COLORS.SCORE_SHADOW;
  ctx.fillText(count, countRight + 2, 42);
  ctx.fillStyle = COIN.COLOR;
  ctx.fillText(count, countRight, 40);

  // Coin icon, left of the number, in a dark ring
  const iconX = countRight - ctx.measureText(count).width - HUD_GAP - HUD_COIN_RADIUS;
  ctx.fillStyle = COIN.COLOR;
  ctx.beginPath();
  ctx.arc(iconX, HUD_COIN_Y, HUD_COIN_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = COLORS.SCORE_SHADOW;
  ctx.lineWidth = HUD_COIN_RING;
  ctx.stroke();
}

/** One picture of the world. */
function drawScene(ctx: CanvasRenderingContext2D, scene: Scene, visibleRight: number) {
  const charId = scene.progress.selectedCharacter as CharacterId;
  const characterColor = CHARACTERS[charId]?.color || PLAYER.COLOR_BODY;

  // Clear and draw background
  drawSky(ctx);
  drawClouds(ctx, scene.clouds);
  drawMountains(ctx);
  drawGround(ctx, scene.groundOffset);

  // Draw game objects
  drawCoins(ctx, scene.coins);
  drawObstacles(ctx, scene.obstacles);
  drawPlayer(ctx, scene.player, characterColor);

  // Draw UI based on state. The "ready" screen is the shared DOM
  // GameStartOverlay, and the result is DOM text over the picture
  // (legible at every scale; the canvas text was 7.7 px upright), so the
  // canvas only dims the world at game over.
  if (scene.gameState === "playing") {
    drawHUD(ctx, scene.score, scene.coinsThisRun, visibleRight);
  } else if (scene.gameState === "gameOver") {
    ctx.fillStyle = COLORS.GAME_OVER_BG;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }
}

export function EndlessRunnerGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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

  // Only what the page shows in DOM: the loop reads the world itself, so
  // the page does not draw again on every step.
  const gameState = useEndlessRunnerStore((s) => s.gameState);
  const score = useEndlessRunnerStore((s) => s.score);
  const coinsThisRun = useEndlessRunnerStore((s) => s.coinsThisRun);
  const isNewHighScore = useEndlessRunnerStore((s) => s.isNewHighScore);
  const progress = useEndlessRunnerStore((s) => s.progress);
  const startGame = useEndlessRunnerStore((s) => s.startGame);
  const jump = useEndlessRunnerStore((s) => s.jump);
  const startDuck = useEndlessRunnerStore((s) => s.startDuck);
  const stopDuck = useEndlessRunnerStore((s) => s.stopDuck);
  const reset = useEndlessRunnerStore((s) => s.reset);

  // Cloud sync for authenticated users
  const { forceSync } = useAuthSync<EndlessRunnerProgress>({
    appId: "endless-runner",
    localStorageKey: "endless-runner-storage",
    getState: () => useEndlessRunnerStore.getState().getProgress(),
    setState: (data) => useEndlessRunnerStore.getState().setProgress(data),
    debounceMs: 3000,
  });

  // Force save immediately on game over
  useEffect(() => {
    if (gameState === "gameOver") {
      forceSync();
    }
  }, [gameState, forceSync]);

  // The right edge of the part of the world on screen: on a phone the
  // window may crop the world on the right (PHONE_VISIBLE_WORLD), so the
  // coin counter is drawn at the visible edge, never off screen.
  const visibleRight = Math.round(fit.scale > 0 ? fit.visibleWorld : CANVAS_WIDTH);

  // What the loop reads each frame from the page, without starting again.
  const live = useRef({ held, visibleRight });
  useEffect(() => {
    live.current = { held, visibleRight };
  }, [held, visibleRight]);

  // The time of the last frame that moved the world; 0 means the next frame
  // only starts the clock, so a wait is never run all at once. A frame that
  // is not playing or is held sets it to 0. A change of the hold sets it to
  // 0 too: a browser runs no frames in a hidden tab, so no frame sees that
  // hold, and without this the first frame after the tab comes back would
  // move the world by the whole wait (review wave 2, 2026-10-02).
  const clock = useRef(0);
  useEffect(() => {
    clock.current = 0;
  }, [held]);

  // Game loop: one loop for the life of the page. Each frame it moves the
  // world by the time since the last frame and draws the store as it is
  // now. (It used to start again on every update, because the drawing
  // changed with every step: every other frame then only drew, the run
  // moved in 30 Hz jerks, and a store write on every frame froze it.)
  useEffect(() => {
    let frameId = 0;

    const frame = (time: number) => {
      const before = useEndlessRunnerStore.getState();
      if (before.gameState === "playing" && !live.current.held) {
        if (clock.current !== 0) before.update(time - clock.current);
        clock.current = time;
      } else {
        clock.current = 0;
      }

      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) drawScene(ctx, useEndlessRunnerStore.getState(), live.current.visibleRight);
      frameId = requestAnimationFrame(frame);
    };

    frameId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameId);
  }, []);

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
  // rest jumps. A thumb can hold the ground while the other thumb taps to
  // jump: the runner jumps up out of the duck and lands ducked again. Only
  // the duck finger lifting stands the runner up.
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
