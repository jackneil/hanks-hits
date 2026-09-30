"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type React from "react";
import { useDinoRunnerStore } from "./lib/store";
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  GROUND_Y,
  DINO,
  CLOUD,
  getColors,
  type Obstacle,
  type CloudData,
} from "./lib/constants";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { useShellHold } from "@/shared/hooks/useShellHold";
import { useGameLoop } from "@/shared/hooks/useGameLoop";
import { usePlayBox } from "@/shared/hooks/usePlayBox";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import { GameStartOverlay } from "@/shared/components/GameStartOverlay";
import { ResultChip } from "@/shared/components/ResultChip";
import {
  THUMB_GUTTER_WIDTH,
  THUMB_ROW_HEIGHT,
  ThumbPadLayout,
  fitThumbPads,
  type ThumbFit,
  type ThumbLayout,
} from "@/shared/components/ThumbPadLayout";
import { metadata } from "./metadata";
import { keyBelongsToTarget } from "@/shared/lib/keyboardTarget";
import { useCoarsePointer } from "@/shared/hooks/useCoarsePointer";
import { usePointerHold, useTouchInput } from "@/shared/hooks/useTouchInput";
import { DEFAULT_RESTART_GRACE_MS, useRestartGrace } from "@/shared/lib/input";
import { useDinoClips } from "./lib/useDinoClips";

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
 * Draw the score at the right edge of the VISIBLE world. On a phone held
 * upright the world is cropped on the right (see PORTRAIT_VISIBLE_WORLD),
 * so a score at the canvas edge would be off screen. The font grows when
 * the scale is small, so the digits stay 16 CSS px or taller.
 */
function drawScore(
  ctx: CanvasRenderingContext2D,
  score: number,
  highScore: number,
  color: string,
  view: { visibleWidth: number; scale: number }
) {
  const px = Math.max(24, Math.ceil(16 / Math.max(view.scale, 0.01)));
  ctx.font = `bold ${px}px 'Courier New', monospace`;
  ctx.fillStyle = color;
  ctx.textAlign = "right";
  const right = view.visibleWidth - 20;
  const baseline = 12 + px;

  // Current score
  const scoreStr = Math.floor(score).toString().padStart(5, "0");
  ctx.fillText(scoreStr, right, baseline);

  // High score
  if (highScore > 0) {
    const highScoreStr = "HI " + Math.floor(highScore).toString().padStart(5, "0");
    ctx.fillText(highScoreStr, right - px * 4, baseline);
  }
}

/** The words of the result, in kid words (the result chip reads them out loud). */
export function gameOverText({ score, best, newBest }: { score: number; best: number; newBest: boolean }): string {
  const points = Math.floor(score);
  const line = `Game over! You got ${points} ${points === 1 ? "point" : "points"}.`;
  return newBest ? `${line} That is a new best!` : `${line} Your best is ${Math.floor(best)}.`;
}

/** What a finger on the play surface means, once the game knows. */
type DinoTouchIntent = "pending" | "jump" | "duck" | "other";
/** A pending finger that moves this far (CSS px) has shown its intent. */
export const INTENT_MOVE_PX = 8;
/**
 * A pending finger that stays still this long is a jump. Android sends no
 * touchmove until the finger clears its touch slop (about 8 to 15 px), so
 * the window leaves a brisk swipe room to arrive; a tap shorter than this
 * jumps the moment it lifts.
 */
export const JUMP_INTENT_MS = 80;
/** A jumping finger that drags this far down (CSS px) fast-falls. */
export const SWIPE_DUCK_PX = 30;

// ============================================
// LAYOUT
// ============================================

/**
 * How much of the 800 px world a phone held upright shows. The canvas is
 * scaled to the height of the play box and the world is cropped on the
 * right (the dino runs at x = 50, so the room ahead of it is what a kid
 * needs). 600 px is the width of Chrome's own dino game on a phone. Before
 * this the game was a strip 19 to 21 percent of the screen tall, with a
 * 20 px dino (phone UX audit 2026-09-29).
 */
export const PORTRAIT_VISIBLE_WORLD = 600;
/** A phone held sideways: the JUMP and DUCK buttons sit in gutters beside the picture, under the thumbs. */
export const GUTTER_WIDTH = THUMB_GUTTER_WIDTH;
/** A phone held upright: the two buttons share a row under the picture. */
export const CONTROL_ROW_HEIGHT = THUMB_ROW_HEIGHT;
/** Pixel art past this scale looks chunky on a big monitor (the old cap). */
export const MAX_SCALE = 1.5;

export type DinoLayout = ThumbLayout;
export type DinoFit = ThumbFit;

/**
 * The picture and the controls for a play box (the shared thumb-pad fit):
 * the layout, the scale, and the window onto the world. Pure, so a test
 * can check it.
 */
export function fitDino(box: { width: number; height: number }, coarse: boolean): DinoFit {
  return fitThumbPads(
    box,
    coarse,
    { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
    { minVisibleWorldUpright: PORTRAIT_VISIBLE_WORLD, maxScale: MAX_SCALE },
  );
}

const HOLD_BUTTON =
  "flex items-center justify-center rounded-2xl bg-gray-700 text-white text-xl font-bold shadow-md active:bg-gray-900 touch-none select-none [-webkit-touch-callout:none] [-webkit-user-select:none]";

// ============================================
// MAIN GAME COMPONENT
// ============================================
export function DinoRunnerGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const pterodactylFrameRef = useRef<number>(0);
  const isCoarse = useCoarsePointer();
  // The shell holds the game under an overlay (the restart question, the
  // leaderboard, the install steps, a clip sheet) and in a hidden tab: the
  // loop pauses while it is true, so no game time passes there.
  const held = useShellHold();
  // The play box, fitted: the box does not scroll, and a touch on it is the game's.
  const box = usePlayBox({ fit: true });
  const fit = fitDino(box, isCoarse);
  // The draw callback reads the newest fit (the score sits at the right
  // edge of the VISIBLE world). A layout effect runs before the next frame.
  const fitRef = useRef(fit);
  useLayoutEffect(() => {
    fitRef.current = fit;
  });

  // The DOM needs only these. The canvas reads the store at draw time.
  const gameState = useDinoRunnerStore((s) => s.gameState);
  const score = useDinoRunnerStore((s) => s.score);
  const runId = useDinoRunnerStore((s) => s.runId);
  const lastRunNewBest = useDinoRunnerStore((s) => s.lastRunNewBest);
  const progress = useDinoRunnerStore((s) => s.progress);
  const startGame = useDinoRunnerStore((s) => s.startGame);
  const update = useDinoRunnerStore((s) => s.update);
  const jump = useDinoRunnerStore((s) => s.jump);
  const releaseJump = useDinoRunnerStore((s) => s.releaseJump);
  const duck = useDinoRunnerStore((s) => s.duck);
  const getProgress = useDinoRunnerStore((s) => s.getProgress);
  const setProgress = useDinoRunnerStore((s) => s.setProgress);

  const playing = gameState === "playing";
  const gameOver = gameState === "game-over";

  // Gameplay clips: the canvas, the run phases and the new-best moment.
  useDinoClips(canvasRef, { gameState, score, highScore: progress.highScore, runId });

  // Auth sync
  const { forceSync } = useAuthSync({
    appId: "dino-runner",
    localStorageKey: "dino-runner-progress",
    getState: getProgress,
    setState: setProgress,
    debounceMs: 3000,
  });

  // Force save immediately on game over
  useEffect(() => {
    if (gameOver) {
      forceSync();
    }
  }, [gameOver, forceSync]);

  // Restart waits out a short grace after the result appears, and a held
  // key's repeats never count: a kid still tapping at the crash sees the
  // result first. Every death used to cost two taps (tap, then Play on the
  // start card); now Play again (or Space) starts the next run at once.
  const grace = useRestartGrace(DEFAULT_RESTART_GRACE_MS, gameState);

  // Draw the world. It reads the store at draw time, so the picture is the
  // state of THIS frame, not of the last React commit.
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    const s = useDinoRunnerStore.getState();
    const colors = getColors(s.isNight);

    // Clear and fill background
    ctx.fillStyle = s.milestoneFlash ? "#FFFFFF" : colors.SKY;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    drawClouds(ctx, s.clouds, colors.CLOUD);

    pterodactylFrameRef.current += 0.05;
    for (const obstacle of s.obstacles) {
      if (obstacle.type.startsWith("cactus")) {
        drawCactus(ctx, obstacle, colors.OBSTACLE);
      } else {
        drawPterodactyl(ctx, obstacle, colors.OBSTACLE, pterodactylFrameRef.current);
      }
    }

    drawGround(ctx, s.groundOffset, colors);
    drawDino(ctx, s.dinoY, s.isDucking, s.isJumping, s.legFrame, colors.DINO);

    // In "idle" the canvas draws only the scene: the start card is DOM. At
    // game over the scene dims under the DOM result card and the result
    // chip; no words are drawn into the canvas.
    if (s.gameState === "playing") {
      drawScore(ctx, s.score, s.progress.highScore, colors.SCORE, {
        visibleWidth: fitRef.current.visibleWorld,
        scale: fitRef.current.scale,
      });
    } else if (s.gameState === "game-over") {
      ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
  }, []);

  // The shared loop: a fixed 60 Hz step of game time, the picture drawn
  // every frame (also between runs), and no game time under a hold.
  useGameLoop(
    { update: (stepMs) => update(stepMs), render: draw },
    { running: true, paused: !playing || held }
  );

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // A focused button or link owns its own Space and Enter: never swallow them.
      if (keyBelongsToTarget(e)) return;
      // The start card owns the ready state: keys must not act or block the
      // browser's own Space/Enter handling while it is up.
      if (gameState === "idle") return;
      if (gameState === "game-over") {
        if (e.code === "Space" || e.code === "Enter" || e.code === "ArrowUp") {
          e.preventDefault();
          if (grace.accept(e)) startGame();
        }
        return;
      }
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        jump();
      } else if (e.code === "ArrowDown") {
        e.preventDefault();
        duck(true);
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
  }, [gameState, grace, startGame, jump, duck, releaseJump]);

  // Touch on the WHOLE play surface (not only the canvas): where a thumb
  // rests on a phone held upright is below the picture, and that strip was
  // dead. The shared native touch hook keeps the page still and sends no
  // compatibility click; each finger is tracked by its own identifier.
  //
  // In play a finger does not jump the moment it lands: the old handler
  // did, so "swipe down to duck" hopped the dino into the pterodactyl. A
  // finger is "pending" until it moves INTENT_MOVE_PX (down = duck, any
  // other way = jump), stays still for JUMP_INTENT_MS (jump, and keep
  // holding for height), or lifts (a quick tap: jump, held for the rest of
  // the window). At game over a finger does nothing: the result chip's Play
  // again starts the next run, so a tap meant for the last jump never
  // wipes the result.
  const intentTimersRef = useRef(new Map<number, number>());
  const releaseTimersRef = useRef(new Set<number>());
  const clearIntentTimer = useCallback((id: number) => {
    const timer = intentTimersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      intentTimersRef.current.delete(id);
    }
  }, []);
  useEffect(() => {
    const intentTimers = intentTimersRef.current;
    const releaseTimers = releaseTimersRef.current;
    return () => {
      intentTimers.forEach((timer) => window.clearTimeout(timer));
      intentTimers.clear();
      releaseTimers.forEach((timer) => window.clearTimeout(timer));
      releaseTimers.clear();
    };
  }, []);
  useTouchInput<DinoTouchIntent>(
    surfaceRef,
    {
      onStart: (touch) => {
        if (gameState !== "playing") {
          touch.tag = "other";
          return;
        }
        touch.tag = "pending";
        const timer = window.setTimeout(() => {
          intentTimersRef.current.delete(touch.id);
          if (touch.tag !== "pending") return;
          touch.tag = "jump";
          jump();
        }, JUMP_INTENT_MS);
        intentTimersRef.current.set(touch.id, timer);
      },
      onMove: (touch) => {
        if (gameState !== "playing") return;
        const dx = touch.x - touch.startX;
        const dy = touch.y - touch.startY;
        if (touch.tag === "pending") {
          if (Math.hypot(dx, dy) < INTENT_MOVE_PX) return;
          clearIntentTimer(touch.id);
          if (dy > 0 && dy >= Math.abs(dx)) {
            touch.tag = "duck";
            duck(true);
          } else {
            touch.tag = "jump";
            jump();
          }
        } else if (touch.tag === "jump" && dy > SWIPE_DUCK_PX) {
          // Swipe down in mid-air: fast fall.
          duck(true);
        }
      },
      onEnd: (touch) => {
        clearIntentTimer(touch.id);
        if (touch.tag === "pending") {
          // A quick tap: the same hop a JUMP_INTENT_MS press gives.
          jump();
          const release = window.setTimeout(() => {
            releaseTimersRef.current.delete(release);
            releaseJump();
          }, JUMP_INTENT_MS);
          releaseTimersRef.current.add(release);
        } else if (touch.tag === "jump") {
          releaseJump();
          duck(false);
        } else if (touch.tag === "duck") {
          duck(false);
        }
      },
    },
    // The buttons over the surface keep their own presses.
    { ignore: "button" }
  );

  // A mouse (or a pen) on the surface: press = jump, release = let the
  // jump go. A finger is the touch hook's; its pointer events are skipped
  // here, or one tap would jump twice. A press on a button is the button's.
  const onSurfacePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch" || event.button !== 0) return;
    if ((event.target as Element).closest("button")) return;
    if (gameState === "playing") jump();
  };
  const onSurfacePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    releaseJump();
  };

  // JUMP is a hold: down jumps, and the jump goes higher while the thumb
  // stays down. DUCK is a hold: down ducks, up (or a cancel, or a blur)
  // stands the dino back up.
  const jumpHold = usePointerHold<HTMLButtonElement>(
    () => jump(),
    () => releaseJump()
  );
  const duckHold = usePointerHold<HTMLButtonElement>(
    () => duck(true),
    () => duck(false)
  );

  const sideways = fit.layout === "sideways";
  const controlsShown = playing;

  const jumpButton = (
    <button
      type="button"
      data-testid="dino-jump"
      {...jumpHold}
      aria-hidden={controlsShown ? undefined : true}
      inert={!controlsShown}
      className={`${HOLD_BUTTON} ${sideways ? "h-24 w-[72px]" : "h-20 flex-1"} ${controlsShown ? "" : "invisible"}`}
    >
      JUMP
    </button>
  );
  const duckButton = (
    <button
      type="button"
      data-testid="dino-duck"
      {...duckHold}
      aria-hidden={controlsShown ? undefined : true}
      inert={!controlsShown}
      className={`${HOLD_BUTTON} ${sideways ? "h-24 w-[72px]" : "h-20 flex-1"} ${controlsShown ? "" : "invisible"}`}
    >
      DUCK
    </button>
  );

  const resultCopy = gameOverText({ score, best: progress.highScore, newBest: lastRunNewBest });

  return (
    <div
      ref={surfaceRef}
      data-testid="dino-surface"
      data-layout={fit.layout}
      onPointerDown={onSurfacePointerDown}
      onPointerUp={onSurfacePointerUp}
      onPointerCancel={onSurfacePointerUp}
      className="relative h-full w-full bg-gray-200 touch-none select-none [-webkit-touch-callout:none]"
    >
      {/* iOS install prompt */}
      <IOSInstallPrompt />

      {/* JUMP under the left thumb, DUCK under the right (sideways gutters,
          or one row under the picture upright). */}
      <ThumbPadLayout fit={fit} left={jumpButton} right={duckButton} rowTestId="dino-control-row">
        {/* The window onto the world. On a phone held upright it crops the
            world on the right (fitDino), so the picture is as tall as the
            box allows instead of a strip. */}
        <div
          data-testid="dino-viewport"
          className="relative shrink-0 overflow-hidden rounded-lg border-2 border-gray-300 bg-gray-100 shadow-xl"
          style={{ width: fit.viewWidth, height: fit.viewHeight }}
        >
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            className="block"
            style={{
              width: Math.round(CANVAS_WIDTH * fit.scale),
              height: fit.viewHeight,
              imageRendering: "pixelated",
            }}
          />

          {/* The result, in the DOM, so it is legible at every scale (the
              canvas text was 7.7 px on a phone upright). The chip under it
              has the buttons and reads these words out loud. */}
          {gameOver && (
            <div
              data-testid="dino-result-card"
              className="pointer-events-none absolute inset-0 flex items-center justify-center p-2"
            >
              <div className="flex max-w-full flex-col items-center gap-0.5 rounded-xl bg-white/90 px-4 py-2 text-center text-gray-800 shadow-md short:flex-row short:gap-3 short:py-1.5">
                <p className="text-2xl font-bold short:text-xl">Game over!</p>
                <p className="text-lg font-semibold short:text-base">Score {Math.floor(score)}</p>
                <p className="text-base short:text-sm">
                  {lastRunNewBest ? "🏆 New best!" : `Best ${Math.floor(progress.highScore)}`}
                </p>
              </div>
            </div>
          )}
        </div>

      </ThumbPadLayout>

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
          touchHints={["👆 Tap to jump (hold = higher)", "👇 Hold DUCK or swipe down to duck"]}
          onStart={startGame}
        />
      )}

      {/* The result chip (plan 11.4): read it to me, Play again, the
          leaderboard, and with clips on the clip buttons. Mounted only at
          game over, so its grace starts then. */}
      {gameOver && (
        <ResultChip
          resultText={resultCopy}
          appId="dino-runner"
          onRestart={startGame}
          keyboardHint="Space"
        />
      )}
    </div>
  );
}

export default DinoRunnerGame;
