"use client";

import { useCallback, useEffect, useRef } from "react";
import { GameStartOverlay } from "@/shared/components/GameStartOverlay";
import { ResultCard, ResultLine } from "@/shared/components/ResultCard";
import { ResultChip } from "@/shared/components/ResultChip";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { useCoarsePointer } from "@/shared/hooks/useCoarsePointer";
import { usePlayBox } from "@/shared/hooks/usePlayBox";
import { useTouchInput } from "@/shared/hooks/useTouchInput";
import { setGameSpeakerEnabled, wantGameAudio } from "@/shared/lib/audio";
import { useSecondFingerClick } from "@/shared/lib/input";
import { keyBelongsToTarget } from "@/shared/lib/keyboardTarget";
import { useArkanoidStore, type Ball } from "./lib/store";
import { BALL_CONFIG, PADDLE, WALLS, GAME, GRID, LIVES } from "./lib/constants";
import { EDGE_PX, GAP_PX, HUD_COLUMN_PX, HUD_ROW_PX, arkanoidLayout } from "./lib/layout";
import { stepWorld } from "./lib/physics";
import { ARKANOID_AUDIO_ID, playSound, releaseSounds } from "./lib/sounds";
import { useArkanoidClips } from "./lib/useArkanoidClips";

/** A finger that moves less than this between down and up is a tap (a launch), not a drag. */
export const TAP_SLOP_PX = 10;
/** The sound switch: the words say what the kid hears now. */
export const SOUND_LABELS = { on: "Sound on", off: "Sound off" } as const;

/** The result in kid words, read aloud first. */
export function arkanoidResultText({ score, best, newBest }: { score: number; best: number; newBest: boolean }): string {
  const bestWords = newBest ? " That is a new best!" : ` Your best is ${best}.`;
  return `Game over! You got ${score} points.${bestWords}`;
}

export function ArkanoidGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);

  const {
    gameState,
    score,
    multiplier,
    balls,
    lives,
    runId,
    soundEnabled,
    progress,
    wasNewHighScore,
    startGame,
    launchBall,
    loseLife,
    setPaddleX,
    addBall,
    updateBalls,
    addScore,
    updateMultiplier,
    toggleSound,
  } = useArkanoidStore();

  // Cloud-save progress like every other game (arkanoid predated the sync
  // wiring: it had getProgress/setProgress and a leaderboard extractor but
  // never mounted the hook, so scores silently stayed local-only).
  const { forceSync } = useAuthSync({
    appId: "arkanoid",
    localStorageKey: "arkanoid-state",
    getState: useArkanoidStore.getState().getProgress,
    setState: useArkanoidStore.getState().setProgress,
    debounceMs: 3000,
  });

  // Flush immediately on game over (same pattern as the other synced games)
  // so a new high score survives tapping Home before the debounce fires.
  useEffect(() => {
    if (gameState === "gameOver") {
      forceSync();
    }
  }, [gameState, forceSync]);

  const isCoarse = useCoarsePointer();

  // The field is square and fits the play box on both axes (layout.ts).
  const box = usePlayBox({ fit: true });
  const { sideways, field } = arkanoidLayout(box);

  // The canvas draws at the device's pixels (at most 2 per CSS pixel: the
  // old full-DPR canvas dropped frames on a big phone held sideways).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || field.width === 0) return;
    const dpr = Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
    canvas.width = Math.round(field.width * dpr);
    canvas.height = Math.round(field.height * dpr);
  }, [field.width, field.height]);

  // Clips: the canvas, runs and the new-best moment.
  useArkanoidClips(canvasRef, { gameState, score, highScore: progress.highScore, runId });

  // Sound: the first tap starts the shared game-audio bus, the sound switch
  // is this game's speaker, and the channel leaves when the game unmounts.
  useEffect(() => wantGameAudio(), []);
  useEffect(() => {
    setGameSpeakerEnabled(ARKANOID_AUDIO_ID, soundEnabled);
  }, [soundEnabled]);
  useEffect(() => () => releaseSounds(), []);

  const launch = useCallback(() => {
    const state = useArkanoidStore.getState();
    if (state.gameState !== "playing" || !state.balls.some((b) => b.stuck)) return;
    launchBall();
    playSound("launch");
  }, [launchBall]);

  // Mouse: the paddle follows the pointer's x across the field.
  const movePaddleTo = useCallback(
    (clientX: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (!(rect.width > 0)) return;
      setPaddleX(((clientX - rect.left) / rect.width) * 2 - 1);
    },
    [setPaddleX]
  );
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleMouseMove = (e: MouseEvent) => movePaddleTo(e.clientX);
    canvas.addEventListener("mousemove", handleMouseMove);
    return () => canvas.removeEventListener("mousemove", handleMouseMove);
  }, [movePaddleTo]);

  // Finger: a RELATIVE drag anywhere on the screen moves the paddle by the
  // finger's motion, so the thumb can rest beside or under the field and
  // never covers the paddle or the balls. Only a finger that lifts where it
  // landed is a tap (a launch): a drag that places the paddle never launches.
  const lastXRef = useRef(new Map<number, number>());
  useTouchInput(
    rootRef,
    {
      onStart: (touch) => {
        lastXRef.current.set(touch.id, touch.x);
      },
      onMove: (touch) => {
        const last = lastXRef.current.get(touch.id) ?? touch.x;
        lastXRef.current.set(touch.id, touch.x);
        if (useArkanoidStore.getState().gameState !== "playing") return;
        const width = canvasRef.current?.getBoundingClientRect().width ?? 0;
        if (!(width > 0)) return;
        const current = useArkanoidStore.getState().paddleX;
        setPaddleX(current + ((touch.x - last) / width) * 2);
      },
      onEnd: (touch, event) => {
        lastXRef.current.delete(touch.id);
        // A cancel (event null) is never a tap.
        if (!event) return;
        if (Math.hypot(touch.x - touch.startX, touch.y - touch.startY) <= TAP_SLOP_PX) launch();
      },
    },
    // The sound switch and the result buttons keep their taps.
    { ignore: "button" }
  );

  // Keyboard controls: Space launches the resting balls, arrows nudge the
  // paddle. Pause / ESC is owned by the GameShell, so we don't handle it here
  // (handling it too would double-toggle pause). State is read via getState()
  // to avoid stale closures.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // A focused button or link owns its own Space and Enter: never swallow them.
      if (keyBelongsToTarget(e)) return;
      // The start card owns the ready state: keys must not act or block the
      // browser's own Space/Enter handling while it is up.
      if (gameState === "menu") return;
      if (e.key === " ") {
        const state = useArkanoidStore.getState();
        if (state.gameState === "playing" && state.balls.some((b) => b.stuck)) {
          e.preventDefault();
          launch();
        }
        return;
      }
      if (e.key === "ArrowLeft") {
        setPaddleX(useArkanoidStore.getState().paddleX - 0.1);
      }
      if (e.key === "ArrowRight") {
        setPaddleX(useArkanoidStore.getState().paddleX + 0.1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [gameState, launch, setPaddleX]);

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
      const dt = Math.min(now - lastTime, 50) / 1000; // seconds, at most 50 ms a step
      lastTime = now;

      // Get current state directly from store (avoid stale closures)
      const currentBalls = useArkanoidStore.getState().balls;
      const currentPaddleX = useArkanoidStore.getState().paddleX;

      // Waiting to launch: keep the resting balls glued to the paddle (so the
      // player can aim), render, and run no physics until they launch.
      if (currentBalls.some((b) => b.stuck)) {
        const pinned = currentBalls.map((ball) => {
          if (!ball.stuck) return ball;
          const radius = BALL_CONFIG[ball.type].radius;
          return {
            ...ball,
            x: currentPaddleX + (ball.offsetX ?? 0),
            y: PADDLE.y + PADDLE.height / 2 + radius,
          };
        });
        updateBalls(pinned);
        render(ctx, canvas, pinned);
        animationFrameRef.current = requestAnimationFrame(gameLoop);
        return;
      }

      // Every ball moves; a wall hit is a chance to split (when the ball has
      // a spark left), up to the performance cap (it was never enforced: the
      // count could grow without end and the frame time with it).
      const world = stepWorld(currentBalls, currentPaddleX, dt, Math.random, GAME.maxBalls);
      for (const child of world.born) {
        addBall(child);
        addScore(BALL_CONFIG[child.type].points);
      }
      const paddleHit = world.hitPaddle;
      const split = world.born.length > 0;
      const inPlay = world.balls;
      // One sound of each kind per frame, however many balls did it.
      if (paddleHit) playSound("paddle");
      if (split) playSound("split");

      // The new balls addBall made this frame are in the store; keep them.
      const spawned = useArkanoidStore.getState().balls.filter((b) => !currentBalls.some((c) => c.id === b.id));
      const next = [...inPlay, ...spawned];
      updateBalls(next);
      updateMultiplier(next.length);

      // Every ball fell: lose a life (new balls on the paddle), or game over.
      if (next.length === 0) {
        const livesBefore = useArkanoidStore.getState().lives;
        loseLife();
        playSound(livesBefore <= 1 ? "game-over" : "lose-life");
        if (useArkanoidStore.getState().gameState !== "playing") return;
      }

      render(ctx, canvas, useArkanoidStore.getState().balls);
      animationFrameRef.current = requestAnimationFrame(gameLoop);
    };

    animationFrameRef.current = requestAnimationFrame(gameLoop);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [gameState, addBall, updateBalls, addScore, updateMultiplier, loseLife, render]);

  // Draw the resting field on the start card and at game over too.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || gameState === "playing") return;
    render(ctx, canvas, balls);
  }, [gameState, balls, render, field.width]);

  const soundLabel = soundEnabled ? SOUND_LABELS.on : SOUND_LABELS.off;
  // In-play buttons answer the other thumb while one drags the paddle.
  const soundTap = useSecondFingerClick<HTMLButtonElement>(toggleSound);
  const soundButton = (
    <button
      type="button"
      data-testid="arkanoid-sound"
      aria-label={soundLabel}
      {...soundTap}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xl text-white touch-manipulation"
    >
      <span aria-hidden="true">{soundEnabled ? "🔊" : "🔇"}</span>
    </button>
  );

  // Count balls by type
  const counts = [
    { type: "blue" as const, n: balls.filter((b) => b.type === "blue").length, dot: "bg-blue-500" },
    { type: "orange" as const, n: balls.filter((b) => b.type === "orange").length, dot: "bg-orange-500" },
    { type: "yellow-dot" as const, n: balls.filter((b) => b.type === "yellow-dot").length, dot: "bg-yellow-400" },
  ].filter((c) => c.n > 0);

  // The HUD is DOM text: the score, the multiplier and the best, the lives,
  // and the balls in play by color.
  const hud = (
    <div
      data-testid="arkanoid-hud"
      className={
        sideways
          ? "flex max-w-full flex-col items-center gap-1 text-center text-white"
          : "flex max-w-full items-center gap-3 whitespace-nowrap text-white"
      }
    >
      <span className="text-2xl font-bold tabular-nums">{score.toLocaleString()}</span>
      <span className="text-xs text-slate-300">
        {multiplier}x · Best {progress.highScore.toLocaleString()}
      </span>
      <span aria-label={`${lives} lives`} className="text-red-400">
        {lives > 0 ? "♥".repeat(Math.min(lives, LIVES)) : "♡"}
      </span>
      {gameState === "playing" && counts.length > 0 && (
        <span data-testid="arkanoid-ball-counts" className="flex items-center gap-2 text-sm font-bold">
          {counts.map((c) => (
            <span key={c.type} className="flex items-center gap-1">
              <span className={`inline-block h-3 w-3 rounded-full ${c.dot}`} aria-hidden="true" />
              {c.n}
            </span>
          ))}
        </span>
      )}
    </div>
  );

  // Balls are resting on the paddle, waiting for the player to launch them.
  const waitingToLaunch = gameState === "playing" && balls.some((b) => b.stuck);

  const fieldBox = (
    <div className="relative shrink-0" style={{ width: field.width, height: field.height }}>
      <canvas
        ref={canvasRef}
        data-testid="arkanoid-canvas"
        className={`block rounded-lg ${isCoarse ? "" : "cursor-none"}`}
        style={{ width: field.width, height: field.height, touchAction: "none" }}
        // Mouse only: a finger's touch events are default-prevented by the
        // touch hook, so the browser sends no click for a tap.
        onClick={launch}
      />

      {/* Launch hint - shown while the balls rest on the paddle */}
      {waitingToLaunch && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[16%] flex justify-center px-2">
          <div
            data-testid="arkanoid-launch-hint"
            className="animate-pulse rounded-full bg-slate-800/90 px-4 py-2 text-center text-sm font-bold text-white shadow-lg"
          >
            {isCoarse ? "👆 Tap to launch!" : "👆 Click or press Space to launch!"}
          </div>
        </div>
      )}

      {gameState === "gameOver" && (
        <ResultCard testId="arkanoid-result-card" title="Game over!">
          <ResultLine big>{score.toLocaleString()} points</ResultLine>
          <ResultLine>
            {wasNewHighScore ? "🏆 New best!" : `Best ${progress.highScore.toLocaleString()}`}
          </ResultLine>
        </ResultCard>
      )}

      {/* Menu overlay: shared DOM start screen (renders the title once) */}
      {gameState === "menu" && (
        <GameStartOverlay
          title="Arkanoid"
          emoji="🎱"
          subtitle="Chain Reaction Mayhem"
          keyboardHints={[
            "Move the paddle with your mouse",
            "Click to launch the balls",
          ]}
          touchHints={[
            "Slide your finger anywhere to move the paddle",
            "Tap to launch the balls",
          ]}
          onStart={() => startGame()}
        >
          <div className="text-base font-medium opacity-90">
            🏆 High Score: {progress.highScore.toLocaleString()} · ♥ {LIVES} tries
          </div>
        </GameStartOverlay>
      )}
    </div>
  );

  return (
    <div
      ref={rootRef}
      data-testid="arkanoid-root"
      data-layout={sideways ? "sideways" : "upright"}
      className="h-full w-full select-none bg-slate-900"
    >
      {/* One element tree for both layouts, with the field always the
          second child: turning the phone never remounts the canvas. */}
      <div
        className={`flex h-full w-full items-center ${sideways ? "flex-row justify-center" : "flex-col"}`}
        style={{ padding: EDGE_PX, gap: GAP_PX }}
      >
        <div
          data-testid="arkanoid-hud-slot"
          className={`flex shrink-0 items-center justify-center gap-3 ${sideways ? "flex-col" : "w-full"}`}
          style={sideways ? { width: HUD_COLUMN_PX } : { height: HUD_ROW_PX }}
        >
          {hud}
          {soundButton}
        </div>
        {fieldBox}
        {/* Sideways: the same room on the other side keeps the field centred. */}
        <div className="shrink-0" style={sideways ? { width: HUD_COLUMN_PX } : { height: 0 }} aria-hidden="true" />
      </div>

      {gameState === "gameOver" && (
        <ResultChip
          resultText={arkanoidResultText({ score, best: progress.highScore, newBest: wasNewHighScore })}
          appId="arkanoid"
          onRestart={startGame}
          keyboardHint="Space"
        />
      )}
    </div>
  );
}

export default ArkanoidGame;
