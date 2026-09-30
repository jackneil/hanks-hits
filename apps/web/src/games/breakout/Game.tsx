"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useBreakoutStore, type BreakoutProgress } from "./lib/store";
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  COLORS,
  POWERUP_CONFIG,
} from "./lib/constants";
import { getTotalLevels } from "./lib/levels";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { useCoarsePointer } from "@/shared/hooks/useCoarsePointer";
import { useGameLoop } from "@/shared/hooks/useGameLoop";
import { usePlayBox } from "@/shared/hooks/usePlayBox";
import { useShellHold } from "@/shared/hooks/useShellHold";
import { useTouchInput } from "@/shared/hooks/useTouchInput";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import { GameStartOverlay } from "@/shared/components/GameStartOverlay";
import { ResultChip } from "@/shared/components/ResultChip";
import { ResultCard, ResultLine } from "@/shared/components/ResultCard";
import { RESULT_CHIP_BUTTON } from "@/shared/components/buttonStyles";
import { keyBelongsToTarget } from "@/shared/lib/keyboardTarget";
import { DEFAULT_RESTART_GRACE_MS, useRestartGrace } from "@/shared/lib/input";
import { setGameSpeakerEnabled, wantGameAudio } from "@/shared/lib/audio";
import { BREAKOUT_AUDIO_ID, releaseSounds } from "./lib/sounds";
import { useBreakoutClips } from "./lib/useBreakoutClips";
import { breakoutLayout, EDGE_PX, GAP_PX, HUD_COLUMN_PX, HUD_ROW_PX } from "./lib/layout";

/**
 * A finger that moves less than this (CSS px) before it lifts is a tap; more
 * is a drag that steers the paddle and must not launch the ball.
 */
export const TAP_SLOP_PX = 12;

/** The launch hint over the canvas, branched by pointer type: a phone has no Space. */
export function getLaunchHint(isCoarse: boolean): string {
  return isCoarse ? "👆 Tap to launch!" : "👆 Click or press Space to launch!";
}

/** The sound switch: the words say what the kid hears now. */
export const SOUND_LABELS = { on: "Sound on", off: "Sound off" } as const;
/** The one button of the level-complete chip. */
export const NEXT_LEVEL_LABEL = "Next level";

/** The result chip's words at game over, read out loud first. */
export function gameOverText({ score, level, best, newBest }: { score: number; level: number; best: number; newBest: boolean }): string {
  const words = [`Game over! Your score is ${score}.`, `You got to level ${level}.`];
  if (newBest) words.push("That is a new best!");
  else if (best > 0) words.push(`Your best is ${best}.`);
  return words.join(" ");
}

/** The level-complete chip's words, read out loud first. */
export function levelCompleteText({ level, score, last }: { level: number; score: number; last: boolean }): string {
  if (last) return `You beat every level! Your score is ${score}. Amazing!`;
  return `Level ${level} done! Your score is ${score}.`;
}

// ============================================
// CANVAS RENDERER
// ============================================
function useCanvasRenderer(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const store = useBreakoutStore();

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { paddle, balls, bricks, powerUps, particles, status } = store;

    // Clear canvas
    ctx.fillStyle = COLORS.BACKGROUND;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw bricks
    for (const brick of bricks) {
      // Darken tough bricks that have taken damage
      let color = brick.color;
      if (brick.type === "tough" && brick.hitsRemaining === 1) {
        color = "#6b7280"; // Darker silver
      }

      ctx.fillStyle = color;
      ctx.fillRect(brick.x, brick.y, brick.width, brick.height);

      // Add highlight
      ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
      ctx.fillRect(brick.x, brick.y, brick.width, 3);

      // Add shadow
      ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
      ctx.fillRect(brick.x, brick.y + brick.height - 3, brick.width, 3);

      // Border
      ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
      ctx.lineWidth = 1;
      ctx.strokeRect(brick.x, brick.y, brick.width, brick.height);
    }

    // Draw particles
    for (const particle of particles) {
      const alpha = particle.life / particle.maxLife;
      ctx.fillStyle = particle.color;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Draw power-ups
    for (const powerUp of powerUps) {
      const config = POWERUP_CONFIG[powerUp.type];

      // Background
      ctx.fillStyle = config.color;
      ctx.fillRect(powerUp.x, powerUp.y, powerUp.width, powerUp.height);

      // Border
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.strokeRect(powerUp.x, powerUp.y, powerUp.width, powerUp.height);

      // Icon text
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 12px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(config.icon, powerUp.x + powerUp.width / 2, powerUp.y + powerUp.height / 2);
      ctx.textBaseline = "alphabetic";
    }

    // Draw paddle: a flat blue bar with a light top edge (the old gradient
    // and the ball's glow were decoration that cost a gradient per frame).
    ctx.fillStyle = COLORS.PADDLE;
    ctx.beginPath();
    ctx.roundRect(paddle.x, paddle.y, paddle.width, paddle.height, 4);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
    ctx.fillRect(paddle.x + 2, paddle.y + 2, paddle.width - 4, 3);

    // Draw balls
    for (const ball of balls) {
      ctx.fillStyle = COLORS.BALL;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
      ctx.beginPath();
      ctx.arc(ball.x + ball.radius / 4, ball.y + ball.radius / 4, ball.radius * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }

    // The shell's pause menu covers the field; the canvas only says PAUSED.
    if (status === "paused") {
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 36px Arial";
      ctx.textAlign = "center";
      ctx.fillText("PAUSED", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
    }

    // Game over and the level card only tint the field: the words are a
    // ResultCard over the canvas (canvas text was 10 px sideways and sat
    // under the result chip).
    if (status === "game-over") {
      ctx.fillStyle = COLORS.GAME_OVER_BG;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }

    if (status === "level-complete") {
      ctx.fillStyle = COLORS.LEVEL_COMPLETE_BG;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
  }, [canvasRef, store]);

  return render;
}

// Convert a raw touch/pointer X (page pixels) into a canvas-space X the store
// understands. The canvas is drawn at `scale`, so we undo that scaling and the
// element's left offset. Exported so the paddle-position math is unit-tested.
export function touchXToCanvasX(clientX: number, rectLeft: number, scale: number): number {
  return (clientX - rectLeft) / scale;
}

// ============================================
// MAIN GAME COMPONENT
// ============================================
export function BreakoutGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const store = useBreakoutStore();
  const { status, progress, movePaddle, launchBall, resumeGame, startGame, nextLevel } = store;
  const isCoarse = useCoarsePointer();

  const render = useCanvasRenderer(canvasRef);

  // The canvas fits the play box on both axes (layout.ts): upright the HUD
  // line sits above it, sideways the HUD sits beside it. The box is fitted:
  // it never scrolls, and a touch on it goes to the game.
  const box = usePlayBox({ fit: true });
  const { canvas: fit, sideways } = breakoutLayout(box);
  const scale = fit.scale || 1;

  // The shell holds the game under an overlay (the orientation tip, the
  // restart question, the leaderboard, the install steps) and in a hidden
  // tab. The shell also pauses the store (onPause) while a round plays;
  // the hold covers the rest, so no game time passes under the tip.
  const held = useShellHold();

  // Gameplay clips: the canvas, the run phases and the new-best moment.
  useBreakoutClips(canvasRef, {
    status,
    score: store.score,
    highScore: store.runStartBest,
    runId: store.runId,
  });

  // Sound: the first tap starts the shared game-audio bus, the sound switch
  // is this game's speaker (also after the saved setting loads), and the
  // game's channel leaves the bus when the game unmounts.
  useEffect(() => wantGameAudio(), []);
  const soundEnabled = progress.soundEnabled;
  useEffect(() => {
    setGameSpeakerEnabled(BREAKOUT_AUDIO_ID, soundEnabled);
  }, [soundEnabled]);
  useEffect(() => () => releaseSounds(), []);

  // Sync with auth system
  const { forceSync } = useAuthSync({
    appId: "breakout",
    localStorageKey: "breakout-game-state",
    getState: () => store.getProgress(),
    setState: (data: BreakoutProgress) => store.setProgress(data),
    debounceMs: 2000,
  });

  // Force save immediately on game over or level complete
  useEffect(() => {
    if (status === "game-over" || status === "level-complete") {
      forceSync();
    }
  }, [status, forceSync]);

  // The shared fixed-step loop: 60 steps of game time each second on any
  // screen (the store moves the ball a fixed distance per step). No steps
  // between rounds, under the shell's pause, or under its hold.
  const playing = status === "playing";
  const update = useCallback(() => {
    const state = useBreakoutStore.getState();
    if (state.status === "playing") state.update();
  }, []);
  useGameLoop({ update, render }, { running: true, paused: !playing || held });

  // Between rounds the picture changes only with the state (a card, a
  // pause): draw it in the same commit.
  useEffect(() => {
    if (!playing) render();
  }, [render, playing]);

  // Play again and Next level wait out a short grace after the card
  // appears, and a held key's repeats never count.
  const grace = useRestartGrace(DEFAULT_RESTART_GRACE_MS, status);

  // Mouse control is RELATIVE: the paddle follows the direction the
  // mouse moves (movementX), not where the cursor happens to sit. Any
  // motion anywhere over the page moves the paddle instantly, and the
  // cursor stays visible and free. movePaddle clamps, so excess motion
  // past a wall is simply discarded instead of accumulating drift.
  useEffect(() => {
    const handleWindowPointerMove = (e: PointerEvent) => {
      // Touch drags are handled by the touch surface below.
      if (e.pointerType === "touch") return;
      if (useBreakoutStore.getState().status !== "playing") return;
      const { paddle } = useBreakoutStore.getState();
      const center = paddle.x + paddle.width / 2;
      movePaddle(center + e.movementX / scale);
    };

    window.addEventListener("pointermove", handleWindowPointerMove);
    return () => window.removeEventListener("pointermove", handleWindowPointerMove);
  }, [movePaddle, scale]);

  // A tap (or a click, or Space) launches a resting ball, or resumes the
  // game's own pause. Game over and level complete go on only from the
  // result chip (or Space after its grace): a tap meant for the paddle at
  // the moment the round ended must not skip the card.
  const handleTap = useCallback(() => {
    const state = useBreakoutStore.getState();
    if (state.status === "playing") {
      if (state.balls.some((b) => b.stuck)) launchBall();
    } else if (state.status === "paused") {
      resumeGame();
    }
  }, [launchBall, resumeGame]);

  // Finger input through the shared native touch hook on the WHOLE play
  // area (non-passive, so the page never scrolls under a drag, and the
  // browser sends no compatibility click). A drag is RELATIVE, like the
  // mouse: the paddle moves by the finger's motion, so the thumb can rest
  // under the canvas (upright) or beside it (sideways) and never covers
  // the paddle or the ball. Only a finger that lifts where it landed is a
  // tap. The canvas used to carry onClick AND onTouchStart, so the first
  // touch launched the ball at once (before the kid could place the
  // paddle) and again on the click.
  const lastXRef = useRef(new Map<number, number>());
  useTouchInput(rootRef, {
    onStart: (touch) => {
      lastXRef.current.set(touch.id, touch.x);
    },
    onMove: (touch) => {
      const last = lastXRef.current.get(touch.id) ?? touch.x;
      lastXRef.current.set(touch.id, touch.x);
      if (useBreakoutStore.getState().status !== "playing") return;
      const { paddle } = useBreakoutStore.getState();
      const center = paddle.x + paddle.width / 2;
      movePaddle(center + (touch.x - last) / scale);
    },
    onEnd: (touch, event) => {
      lastXRef.current.delete(touch.id);
      // A cancel (event null) is never a tap.
      if (!event) return;
      const moved = Math.hypot(touch.x - touch.startX, touch.y - touch.startY);
      if (moved <= TAP_SLOP_PX) handleTap();
    },
  }, {
    // The sound switch keeps its tap.
    ignore: "button",
  });

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // A focused button or link owns its own Space and Enter: never swallow them.
      if (keyBelongsToTarget(e)) return;
      // The start overlay owns the idle state; keys must not move or start
      // the game underneath it.
      if (status === "idle") return;
      if (["ArrowLeft", "ArrowRight", " "].includes(e.key)) {
        e.preventDefault();
      }

      if (status === "game-over") {
        if (e.key === " " && grace.accept(e)) startGame();
        return;
      }
      if (status === "level-complete") {
        if (e.key === " " && grace.accept(e)) {
          if (store.level < getTotalLevels()) nextLevel();
          else startGame();
        }
        return;
      }
      // Pause/resume is owned by the GameShell (ESC + pause button): game
      // keys wait while paused, so Space cannot resume the sim behind the
      // still-open menu.
      if (status === "paused") return;

      switch (e.key) {
        case "ArrowLeft":
        case "a":
        case "A":
          movePaddle(store.paddle.x - 20);
          break;
        case "ArrowRight":
        case "d":
        case "D":
          movePaddle(store.paddle.x + store.paddle.width + 20);
          break;
        case " ":
          handleTap();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [movePaddle, store.paddle.x, store.paddle.width, store.level, status, handleTap, grace, startGame, nextLevel]);

  const toggleSound = () => {
    useBreakoutStore.setState((state) => ({
      progress: {
        ...state.progress,
        soundEnabled: !state.progress.soundEnabled,
        lastModified: Date.now(),
      },
    }));
  };

  const soundLabel = soundEnabled ? SOUND_LABELS.on : SOUND_LABELS.off;
  const soundButton = (
    <button
      type="button"
      data-testid="breakout-sound"
      aria-label={soundLabel}
      onClick={toggleSound}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xl text-white hover:bg-slate-600 touch-manipulation"
    >
      <span aria-hidden="true">{soundEnabled ? "🔊" : "🔇"}</span>
    </button>
  );

  // The HUD is DOM text (the canvas HUD was 12.9 px on a phone): the score,
  // the level, the lives, and the active power-ups with their seconds.
  const activeTypes = [...new Set(store.activePowerUps.map((p) => p.type))];
  // The clock for the power-up seconds: it ticks only while one is active,
  // so render stays pure (no Date.now() in the body).
  const [now, setNow] = useState(() => Date.now());
  const hasPowerUps = activeTypes.length > 0;
  useEffect(() => {
    if (!hasPowerUps) return;
    const first = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [hasPowerUps]);
  const hud = (
    <div
      data-testid="breakout-hud"
      className={
        sideways
          ? "flex max-w-full flex-col items-center gap-1 overflow-hidden whitespace-nowrap text-center text-sm font-bold text-white"
          : "flex max-w-full items-center gap-3 overflow-hidden whitespace-nowrap text-sm font-bold text-white sm:gap-4"
      }
    >
      <span>Score {store.score}</span>
      <span>Level {store.level}</span>
      <span aria-label={`${store.lives} lives`} className="text-red-400">
        {store.lives > 0 ? "♥".repeat(Math.min(store.lives, 6)) : "♡"}
      </span>
      {activeTypes.map((type) => {
        const config = POWERUP_CONFIG[type];
        const powerUp = store.activePowerUps.find((p) => p.type === type)!;
        const seconds = Math.ceil(Math.max(0, powerUp.expiresAt - now) / 1000);
        return (
          <span key={type} className="rounded px-1.5 text-xs text-white" style={{ backgroundColor: config.color }}>
            {config.icon} {seconds}s
          </span>
        );
      })}
    </div>
  );

  const waitingToLaunch = playing && store.balls.some((b) => b.stuck);

  const canvasBox = (
    <div className="relative shrink-0" style={{ width: fit.width, height: fit.height }}>
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className={`rounded-lg border-4 border-blue-600 shadow-2xl touch-none ${isCoarse ? "" : "cursor-default"}`}
        style={{ width: fit.width, height: fit.height }}
        // Mouse only: a finger's touchend is default-prevented above, so the
        // browser sends no click for it.
        onClick={handleTap}
      />

      {/* The launch hint over the canvas while the ball rests on the paddle:
          DOM text, readable at any canvas size. */}
      {waitingToLaunch && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[18%] flex justify-center px-2">
          <div data-testid="breakout-launch-hint" className="animate-pulse rounded-full bg-slate-900/90 px-4 py-2 text-center text-sm font-bold text-white shadow-lg">
            {getLaunchHint(isCoarse)}
          </div>
        </div>
      )}

      {status === "game-over" && (
        <ResultCard testId="breakout-result-card" title="Game over!">
          <ResultLine big>Score {store.score}</ResultLine>
          <ResultLine>
            Level {store.level} ·{" "}
            {store.score > store.runStartBest && store.score > 0 ? "🏆 New best!" : `Best ${progress.highScore}`}
          </ResultLine>
        </ResultCard>
      )}
      {status === "level-complete" && (
        <ResultCard
          testId="breakout-result-card"
          title={store.level < getTotalLevels() ? `Level ${store.level} done!` : "You beat every level!"}
        >
          <ResultLine big>Score {store.score}</ResultLine>
        </ResultCard>
      )}

      {/* Shared DOM start screen (renders the title once) */}
      {status === "idle" && (
        <GameStartOverlay
          title="Breakout"
          emoji="🧱"
          subtitle="Smash every brick!"
          touchHints={["👈👉 Slide your finger to move the paddle", "👆 Tap to launch the ball"]}
          keyboardHints={["👈👉 Arrow keys move the paddle", "⌨️ Space to launch the ball"]}
          onStart={() => startGame()}
        >
          <div className="text-base font-medium opacity-90">
            🏆 High Score: {progress.highScore}
          </div>
        </GameStartOverlay>
      )}
    </div>
  );

  const gameOver = status === "game-over";
  const levelComplete = status === "level-complete";
  const lastLevel = store.level >= getTotalLevels();

  return (
    <div
      ref={rootRef}
      data-testid="breakout-root"
      data-layout={sideways ? "sideways" : "upright"}
      className="h-full w-full select-none bg-slate-950"
    >
      {sideways ? (
        // Sideways: the HUD beside the canvas, the canvas full height. The
        // room on both sides is play room: a finger drags the paddle from anywhere.
        <div className="flex h-full w-full items-center justify-center" style={{ padding: EDGE_PX, gap: GAP_PX }}>
          <div data-testid="breakout-hud-column" className="flex shrink-0 flex-col items-center justify-center gap-3" style={{ width: HUD_COLUMN_PX }}>
            {hud}
            {soundButton}
          </div>
          {canvasBox}
          <div className="shrink-0" style={{ width: HUD_COLUMN_PX }} aria-hidden="true" />
        </div>
      ) : (
        // Upright: the HUD line, then the canvas. The room under the canvas is play room too.
        <div className="flex h-full w-full flex-col items-center" style={{ padding: EDGE_PX, gap: GAP_PX }}>
          <div className="flex w-full shrink-0 items-center justify-center gap-3" style={{ height: HUD_ROW_PX }}>
            {hud}
            {soundButton}
          </div>
          {canvasBox}
        </div>
      )}

      <IOSInstallPrompt />

      {/* The result chip under the game-over card: read it to me, Play
          again, the leaderboard, and with clips on the clip buttons. */}
      {gameOver && (
        <ResultChip
          resultText={gameOverText({
            score: store.score,
            level: store.level,
            best: progress.highScore,
            newBest: store.score > store.runStartBest && store.score > 0,
          })}
          appId="breakout"
          onRestart={startGame}
          keyboardHint="Space"
        />
      )}

      {/* The level-complete chip: Next level, or Play again after the last level. */}
      {levelComplete && (
        <ResultChip
          resultText={levelCompleteText({ level: store.level, score: store.score, last: lastLevel })}
          onRestart={lastLevel ? startGame : undefined}
          spokenExtras={lastLevel ? [] : [NEXT_LEVEL_LABEL]}
          keyboardHint="Space"
        >
          {!lastLevel && (
            <button
              type="button"
              data-testid="breakout-next-level"
              // The chip holds every button in its bar through the grace.
              onClick={() => nextLevel()}
              className={`btn btn-primary gap-2 px-4 text-lg ${RESULT_CHIP_BUTTON} active:scale-[0.97] touch-manipulation`}
            >
              <span aria-hidden="true">▶</span>
              {NEXT_LEVEL_LABEL}
            </button>
          )}
        </ResultChip>
      )}
    </div>
  );
}

export default BreakoutGame;
