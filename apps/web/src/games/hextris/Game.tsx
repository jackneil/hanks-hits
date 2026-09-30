"use client";

import { useCallback, useEffect, useRef } from "react";

import { GameStartOverlay } from "@/shared/components/GameStartOverlay";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import { ResultCard, ResultLine } from "@/shared/components/ResultCard";
import { ResultChip } from "@/shared/components/ResultChip";
import { ThumbPadLayout } from "@/shared/components/ThumbPadLayout";
import { RESULT_CHIP_BUTTON, SECONDARY_ACTION } from "@/shared/components/buttonStyles";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { useCoarsePointer } from "@/shared/hooks/useCoarsePointer";
import { useGameLoop } from "@/shared/hooks/useGameLoop";
import { usePlayBox } from "@/shared/hooks/usePlayBox";
import { useShellHold } from "@/shared/hooks/useShellHold";
import { setGameSpeakerEnabled, wantGameAudio } from "@/shared/lib/audio";
import { usePointerTap, useRestartGrace, type TapEvent } from "@/shared/lib/input";
import { keyBelongsToTarget } from "@/shared/lib/keyboardTarget";

import {
  BLOCK_HEIGHT,
  BLOCK_WIDTH,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  COLORS,
  HEX_CENTER_X,
  HEX_CENTER_Y,
  HEX_RADIUS,
  getBlockPosition,
  getHexCorner,
  getSideAngle,
} from "./lib/constants";
import { fitHextris } from "./lib/layout";
import { HEXTRIS_AUDIO_ID, releaseSounds } from "./lib/sounds";
import { useHextrisStore } from "./lib/store";
import { useHextrisClips } from "./lib/useHextrisClips";

/** The sound switch: the words say what the kid hears now. */
export const SOUND_LABELS = { on: "Sound on", off: "Sound off" } as const;
/** The spin buttons. */
export const SPIN_LABELS = { left: "Spin left", right: "Spin right" } as const;

/** The result chip's words at game over, read out loud first. */
export function gameOverText({ score, best, newBest }: { score: number; best: number; newBest: boolean }): string {
  const points = score === 1 ? "1 point" : `${score} points`;
  return newBest ? `Game over! You got ${points}. That is a new best!` : `Game over! You got ${points}. Your best is ${best}.`;
}

// ============================================
// CANVAS RENDERER
// ============================================

/**
 * Draws the field from the store's newest state. The words (the score, the
 * result) are DOM over the canvas: canvas text drawn for a 400 px field was
 * 14 px or less on a phone, and the result sat under the result chip.
 */
function drawField(ctx: CanvasRenderingContext2D) {
  const { stacks, fallingBlock, particles, rotation, status } = useHextrisStore.getState();

  ctx.fillStyle = COLORS.BACKGROUND;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Central hexagon
  ctx.save();
  ctx.translate(HEX_CENTER_X, HEX_CENTER_Y);
  ctx.rotate(rotation);
  ctx.fillStyle = COLORS.HEX_FILL;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const corner = getHexCorner(0, 0, HEX_RADIUS, i);
    if (i === 0) ctx.moveTo(corner.x, corner.y);
    else ctx.lineTo(corner.x, corner.y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = COLORS.HEX_STROKE;
  ctx.lineWidth = 3;
  ctx.stroke();
  for (let i = 0; i < 6; i++) {
    const sideAngle = getSideAngle(i);
    const indicatorDist = HEX_RADIUS - 10;
    ctx.fillStyle = "rgba(96, 165, 250, 0.3)";
    ctx.beginPath();
    ctx.arc(Math.cos(sideAngle) * indicatorDist, Math.sin(sideAngle) * indicatorDist, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Stacked blocks
  for (let side = 0; side < 6; side++) {
    const stack = stacks[side];
    for (let i = 0; i < stack.length; i++) {
      const block = stack[i];
      const pos = getBlockPosition(HEX_CENTER_X, HEX_CENTER_Y, HEX_RADIUS, side, i, rotation);
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(pos.angle + Math.PI / 2);
      ctx.fillStyle = block.color;
      ctx.fillRect(-BLOCK_WIDTH / 2, -BLOCK_HEIGHT / 2, BLOCK_WIDTH, BLOCK_HEIGHT);
      ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
      ctx.fillRect(-BLOCK_WIDTH / 2, -BLOCK_HEIGHT / 2, BLOCK_WIDTH, 4);
      ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
      ctx.fillRect(-BLOCK_WIDTH / 2, BLOCK_HEIGHT / 2 - 4, BLOCK_WIDTH, 4);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
      ctx.lineWidth = 1;
      ctx.strokeRect(-BLOCK_WIDTH / 2, -BLOCK_HEIGHT / 2, BLOCK_WIDTH, BLOCK_HEIGHT);
      ctx.restore();
    }
  }

  // The falling block
  if (fallingBlock) {
    ctx.save();
    ctx.translate(fallingBlock.x, fallingBlock.y);
    const angleToCenter = Math.atan2(HEX_CENTER_Y - fallingBlock.y, HEX_CENTER_X - fallingBlock.x);
    ctx.rotate(angleToCenter + Math.PI / 2);
    ctx.fillStyle = fallingBlock.color;
    ctx.fillRect(-BLOCK_WIDTH / 2, -BLOCK_HEIGHT / 2, BLOCK_WIDTH, BLOCK_HEIGHT);
    ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
    ctx.fillRect(-BLOCK_WIDTH / 2, -BLOCK_HEIGHT / 2, BLOCK_WIDTH, 4);
    ctx.shadowColor = fallingBlock.color;
    ctx.shadowBlur = 10;
    ctx.strokeStyle = fallingBlock.color;
    ctx.lineWidth = 2;
    ctx.strokeRect(-BLOCK_WIDTH / 2, -BLOCK_HEIGHT / 2, BLOCK_WIDTH, BLOCK_HEIGHT);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // Particles
  for (const particle of particles) {
    ctx.fillStyle = particle.color;
    ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Between rounds the field only dims (the start card, the shell's pause
  // menu and the result card carry the words).
  if (status !== "playing") {
    ctx.fillStyle = COLORS.GAME_OVER_BG;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }
}

// ============================================
// MAIN COMPONENT
// ============================================
export function HextrisGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isCoarse = useCoarsePointer();
  // The shell holds the game under an overlay (the restart question, the
  // leaderboard, the install steps, a clip sheet, the orientation tip) and
  // in a hidden tab: no game time passes while it is true.
  const held = useShellHold();
  // The play box, fitted: it does not scroll, and a touch on it is the game's.
  const box = usePlayBox({ fit: true });
  const fit = fitHextris(box, isCoarse);

  const status = useHextrisStore((s) => s.status);
  const score = useHextrisStore((s) => s.score);
  const runId = useHextrisStore((s) => s.runId);
  const lastRunNewBest = useHextrisStore((s) => s.lastRunNewBest);
  const progress = useHextrisStore((s) => s.progress);
  const startGame = useHextrisStore((s) => s.startGame);
  const resumeGame = useHextrisStore((s) => s.resumeGame);
  const rotateLeft = useHextrisStore((s) => s.rotateLeft);
  const rotateRight = useHextrisStore((s) => s.rotateRight);
  const getProgress = useHextrisStore((s) => s.getProgress);
  const setProgress = useHextrisStore((s) => s.setProgress);

  const playing = status === "playing";
  const gameOver = status === "game-over";

  // Auth sync
  const { forceSync } = useAuthSync({
    appId: "hextris",
    localStorageKey: "hextris-game-state",
    getState: getProgress,
    setState: setProgress,
    debounceMs: 3000,
  });

  // Force save immediately on game over
  useEffect(() => {
    if (gameOver) forceSync();
  }, [gameOver, forceSync]);

  // Gameplay clips: the canvas, the run phases and the new-best moment.
  useHextrisClips(canvasRef, { status, score, best: progress.highScore, runId });

  // Sound: the first tap starts the shared game-audio bus, the sound switch
  // is this game's speaker (also after the saved setting loads), and the
  // game's channel leaves the bus when the game unmounts.
  useEffect(() => wantGameAudio(), []);
  const soundEnabled = progress.soundEnabled;
  useEffect(() => {
    setGameSpeakerEnabled(HEXTRIS_AUDIO_ID, soundEnabled);
  }, [soundEnabled]);
  useEffect(() => () => releaseSounds(), []);
  const toggleSound = () => setProgress({ ...progress, soundEnabled: !soundEnabled, lastModified: Date.now() });

  const draw = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) drawField(ctx);
  }, []);

  // The shared loop: a fixed 60 Hz step of game time, the field drawn every
  // frame, and no game time between rounds or under a hold. The old loop
  // was an effect that restarted on every store change (its render callback
  // depended on the whole store), and moved a block a whole step per
  // screen frame.
  useGameLoop(
    { update: (stepMs) => useHextrisStore.getState().update(stepMs), render: draw },
    { running: true, paused: !playing || held }
  );

  // Between rounds the picture changes only with the state: draw it in the
  // same commit.
  useEffect(() => {
    if (!playing) draw();
  }, [draw, playing, status]);

  // Play again waits out a short grace after the result appears, and a held
  // key's repeats never count.
  const grace = useRestartGrace(undefined, status);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // A focused button or link owns its own Space and Enter: never swallow them.
      if (keyBelongsToTarget(e)) return;
      // Idle is owned by the start overlay: its Play button begins a game.
      if (status === "idle") return;
      if (status === "game-over") {
        if (e.code === "Space" || e.code === "Enter") {
          e.preventDefault();
          if (grace.accept(e)) startGame();
        }
        return;
      }
      // Pause and resume are the GameShell's (ESC and its pause button).
      if (status === "paused") return;
      switch (e.code) {
        case "KeyA":
        case "ArrowLeft":
          e.preventDefault();
          rotateLeft();
          break;
        case "KeyD":
        case "ArrowRight":
          e.preventDefault();
          rotateRight();
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [status, grace, startGame, rotateLeft, rotateRight]);

  // One tap on the field = one step, on pointerdown (a second finger works).
  // The field used to carry onClick AND onTouchStart, so a finger tap spun
  // 120 degrees. A tap at game over does nothing: the result chip's Play
  // again starts the next round, so a tap meant for the field at the moment
  // the round ended cannot skip the result.
  const handleFieldTap = useCallback(
    (e: TapEvent<HTMLCanvasElement>) => {
      const state = useHextrisStore.getState();
      if (state.status === "paused") {
        resumeGame();
        return;
      }
      if (state.status !== "playing") return;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (e.clientX - rect.left < rect.width / 2) rotateLeft();
      else rotateRight();
    },
    [resumeGame, rotateLeft, rotateRight]
  );
  const fieldTap = usePointerTap<HTMLCanvasElement>(handleFieldTap);
  const spinLeftTap = usePointerTap<HTMLButtonElement>(() => rotateLeft());
  const spinRightTap = usePointerTap<HTMLButtonElement>(() => rotateRight());

  // The spin buttons keep their place on every screen (the field never
  // jumps when a round ends); they show and take taps only in a round.
  const sideways = fit.layout === "sideways";
  const controlsProps = playing ? {} : ({ "aria-hidden": true, inert: true } as const);
  const spinButton = (label: string, glyph: string, tap: ReturnType<typeof usePointerTap<HTMLButtonElement>>, testId: string) => (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      {...tap}
      {...controlsProps}
      className={`flex items-center justify-center rounded-2xl bg-blue-600 text-4xl font-bold text-white shadow-lg active:bg-blue-800 touch-none select-none [-webkit-touch-callout:none] ${
        sideways ? "h-24 w-[72px]" : "h-20 flex-1"
      } ${playing ? "" : "invisible"}`}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );

  const best = progress.highScore;
  const resultCopy = gameOverText({ score, best, newBest: lastRunNewBest });

  return (
    <div data-testid="hextris-root" data-layout={fit.layout} className="relative h-full w-full bg-slate-900 select-none [-webkit-touch-callout:none]">
      <IOSInstallPrompt />

      <ThumbPadLayout
        fit={fit}
        left={isCoarse ? spinButton(SPIN_LABELS.left, "↺", spinLeftTap, "hextris-spin-left") : undefined}
        right={isCoarse ? spinButton(SPIN_LABELS.right, "↻", spinRightTap, "hextris-spin-right") : undefined}
        rowTestId="hextris-control-row"
      >
        <div
          data-testid="hextris-viewport"
          className="relative shrink-0 overflow-hidden rounded-lg shadow-xl"
          style={{ width: fit.viewWidth, height: fit.viewHeight }}
        >
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            {...fieldTap}
            className="block cursor-pointer"
            style={{ width: fit.viewWidth, height: fit.viewHeight, touchAction: "none" }}
          />

          {/* The score, in the DOM, legible at every scale. */}
          {!gameOver && status !== "idle" && (
            <div data-testid="hextris-hud" className="pointer-events-none absolute inset-x-0 top-0 flex justify-between px-3 pt-1 text-lg font-bold text-white drop-shadow">
              <span>Score {score}</span>
              <span className="text-slate-300">Best {best}</span>
            </div>
          )}

          {gameOver && (
            <ResultCard testId="hextris-result-card" title="Game over!">
              <ResultLine big>Score {score}</ResultLine>
              <ResultLine>{lastRunNewBest ? "🏆 New best!" : `Best ${best}`}</ResultLine>
            </ResultCard>
          )}
        </div>
      </ThumbPadLayout>

      {status === "idle" && (
        <GameStartOverlay
          title="Hextris"
          emoji="⬡"
          subtitle="Spin the hexagon and stack the colors!"
          touchHints={[
            "↺ ↻ Tap a spin button, or a side of the hexagon",
            "🎨 Match 3 blocks of one color",
          ]}
          keyboardHints={[
            "⌨️ Press A or the left arrow to spin left",
            "⌨️ Press D or the right arrow to spin right",
            "🎨 Match 3 blocks of one color",
          ]}
          onStart={startGame}
        >
          <div className="text-base font-medium opacity-90">🏆 High Score: {best.toLocaleString()}</div>
        </GameStartOverlay>
      )}

      {/* The result chip: read it to me, Play again, the leaderboard, the
          sound switch, and with clips on the clip buttons. Mounted only at
          game over, so its grace starts then. */}
      {gameOver && (
        <ResultChip resultText={resultCopy} appId="hextris" onRestart={startGame} keyboardHint="Space">
          <button
            type="button"
            data-testid="result-chip-sound"
            onClick={toggleSound}
            // A pointer press leaves no focus here, so Space still means "play again".
            onMouseDown={(event) => event.preventDefault()}
            className={`btn ${SECONDARY_ACTION} gap-2 px-4 text-lg ${RESULT_CHIP_BUTTON} normal-case active:scale-[0.97] touch-manipulation`}
          >
            <span aria-hidden="true">{soundEnabled ? "🔊" : "🔇"}</span>
            {soundEnabled ? SOUND_LABELS.on : SOUND_LABELS.off}
          </button>
        </ResultChip>
      )}
    </div>
  );
}

export default HextrisGame;
