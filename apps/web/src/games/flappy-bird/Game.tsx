"use client";

import { useEffect, useRef, useCallback } from "react";
import { useFlappyStore } from "./lib/store";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { useShellHold } from "@/shared/hooks/useShellHold";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import { GameStartOverlay } from "@/shared/components/GameStartOverlay";
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
import { keyBelongsToTarget } from "@/shared/lib/keyboardTarget";
import { DEFAULT_RESTART_GRACE_MS, usePointerTap, useRestartGrace } from "@/shared/lib/input";
import { fitCanvas, usePlayBox } from "@/shared/hooks/usePlayBox";
import { ResultChip } from "@/shared/components/ResultChip";
import { useFlappyClips } from "./lib/useFlappyClips";

/** The result in kid words, read aloud first. */
export function flappyResultText({ score, best, newBest }: { score: number; best: number; newBest: boolean }): string {
  const pipes = score === 1 ? "1 pipe" : `${score} pipes`;
  const medal = getMedal(score);
  const medalWords = medal === "none" ? "" : ` You earned a ${medal} medal!`;
  const bestWords = newBest ? " That is a new best!" : ` Your best is ${best}.`;
  return `Game over! You flew through ${pipes}.${medalWords}${bestWords}`;
}

export function FlappyBirdGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const lastTimeRef = useRef<number>(0);
  // The board fits the play box on both axes, so a phone held sideways
  // shows the whole board (it was 672 px tall in a 263 px window) and a
  // phone held upright never scrolls (phone UX audit 2026-09-29).
  const box = usePlayBox({ fit: true });
  const fit = fitCanvas(box, CANVAS_WIDTH, CANVAS_HEIGHT);
  // The shell holds the game under an overlay (the orientation tip, the
  // restart question, the leaderboard, the install steps) and in a hidden
  // tab: the loop skips its update while it is true, so the bird hangs in
  // the air instead of falling to the floor under "Turn your phone
  // upright" (phone UX audit 2026-09-29, S7).
  const held = useShellHold();

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

      // Play again is the result chip's button, under the board.
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

      // Draw UI based on state. The "ready" screen is the shared DOM
      // GameStartOverlay now, so nothing is painted into the canvas for it.
      if (gameState === "playing") {
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
  useFlappyClips(canvasRef, { gameState, score, highScore: progress.highScore });

  // Play again: straight into a new flight, no start card in between.
  const restart = useCallback(() => {
    reset();
    startGame();
  }, [reset, startGame]);
  // A thumb still mashing when the bird crashes must not restart at once.
  const grace = useRestartGrace(DEFAULT_RESTART_GRACE_MS, gameState);

  // Input handling. Taps and keys never start the game: the shared start
  // overlay owns that, and the result chip owns Play again, so a tap on
  // the board only ever flaps.
  const handleInput = useCallback(() => {
    if (gameState === "playing") flap();
  }, [gameState, flap]);

  // One tap = one flap, for a finger, a mouse, or Enter on the focused
  // canvas: the shared pointer tap acts on pointerdown and ignores the
  // browser's compatibility click.
  const canvasTap = usePointerTap<HTMLCanvasElement>(() => handleInput());

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // A focused button or link owns its own Space and Enter: never swallow them.
      if (keyBelongsToTarget(e)) return;
      // The start card owns the ready state: keys must not act or block the
      // browser's own Space/Enter handling while it is up.
      if (gameState === "ready") return;
      if (e.code !== "Space" && e.code !== "Enter" && e.code !== "ArrowUp") return;
      e.preventDefault();
      if (gameState === "playing") handleInput();
      else if (gameState === "gameOver" && grace.accept(e)) restart();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [gameState, handleInput, restart, grace]);

  return (
    <div className="relative flex h-full w-full items-center justify-center bg-sky-500">
      {/* iOS install prompt */}
      <IOSInstallPrompt />

      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        data-testid="flappy-canvas"
        // One handler for finger and mouse. A React onTouchStart cannot
        // preventDefault (React attaches it passive), so a tap used to fire
        // touchstart AND the compatibility click: two flaps per tap.
        {...canvasTap}
        className="rounded-lg shadow-2xl cursor-pointer touch-none"
        style={{ width: fit.width, height: fit.height }}
      />

      {/* Shared DOM start screen (renders the title once) */}
      {gameState === "ready" && (
        <GameStartOverlay
          title="Flappy Bird"
          emoji="🐦"
          subtitle="Fly through the pipes!"
          touchHints={["👆 Tap to flap", "🟩 Fly through the gaps"]}
          keyboardHints={["⌨️ Space to flap", "🟩 Fly through the gaps"]}
          onStart={() => startGame()}
        >
          <div className="text-base font-medium opacity-90">
            🏆 Best: {progress.highScore} · Games: {progress.gamesPlayed} · Pipes: {progress.totalPipes}
          </div>
        </GameStartOverlay>
      )}

      {gameState === "gameOver" && (
        <ResultChip
          resultText={flappyResultText({ score, best: progress.highScore, newBest: isNewHighScore })}
          appId="flappy-bird"
          onRestart={restart}
          keyboardHint="Space"
        />
      )}

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
