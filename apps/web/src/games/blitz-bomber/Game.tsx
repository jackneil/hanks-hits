"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import { GameStartOverlay, GameStartOverlayButton } from "@/shared/components/GameStartOverlay";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import { ResultCard, ResultLine } from "@/shared/components/ResultCard";
import { ResultChip } from "@/shared/components/ResultChip";
import { RESULT_CHIP_BUTTON, SECONDARY_ACTION } from "@/shared/components/buttonStyles";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { useGameLoop } from "@/shared/hooks/useGameLoop";
import { usePlayBox } from "@/shared/hooks/usePlayBox";
import { useShellHold } from "@/shared/hooks/useShellHold";
import { setGameSpeakerEnabled, wantGameAudio } from "@/shared/lib/audio";
import { usePointerTap, useRestartGrace } from "@/shared/lib/input";
import { keyBelongsToTarget } from "@/shared/lib/keyboardTarget";

import {
  BOMB,
  BUILDING,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  COLORS,
  EXPLOSION,
  GROUND,
  PLANE,
  type Building as BuildingType,
  type DifficultyLevel,
} from "./lib/constants";
import { blitzLayout, spriteBoost } from "./lib/layout";
import { BLITZ_BOMBER_AUDIO_ID, releaseSounds } from "./lib/sounds";
import { useBlitzBomberStore } from "./lib/store";
import { useBlitzBomberClips } from "./lib/useBlitzBomberClips";
import { metadata } from "./metadata";

// Difficulty choices shown in the start overlay. Each starts the game
// immediately at the chosen difficulty.
const DIFFICULTY_CHOICES: { level: DifficultyLevel; label: string; emoji: string }[] = [
  { level: "easy", label: "Easy", emoji: "🟢" },
  { level: "normal", label: "Normal", emoji: "🟡" },
  { level: "hard", label: "Hard", emoji: "🔴" },
];

/** The sound switch: the words say what the kid hears now. */
export const SOUND_LABELS = { on: "Sound on", off: "Sound off" } as const;
/** The one button of the landing chip. */
export const NEXT_LEVEL_LABEL = "Next level";

/** The result chip's words, read out loud first. */
export function resultText({
  landed,
  score,
  level,
  newBest,
}: {
  landed: boolean;
  score: number;
  level: number;
  newBest: boolean;
}): string {
  const points = score === 1 ? "1 point" : `${score} points`;
  const head = landed ? `You landed! Level ${level} done. You have ${points}.` : `Crashed! You got ${points} on level ${level}.`;
  return newBest ? `${head} That is a new best!` : head;
}

/** A window light that stays on or off (the draw used Math.random, so every window flickered 60 times a second). */
function windowLit(buildingX: number, wx: number, wy: number): boolean {
  return (Math.floor(buildingX) * 3 + Math.floor(wx) * 7 + Math.floor(wy) * 13) % 10 > 2;
}

function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.beginPath();
  ctx.arc(x, y, size * 0.5, 0, Math.PI * 2);
  ctx.arc(x + size * 0.4, y - size * 0.1, size * 0.4, 0, Math.PI * 2);
  ctx.arc(x + size * 0.8, y, size * 0.5, 0, Math.PI * 2);
  ctx.arc(x + size * 0.4, y + size * 0.2, size * 0.35, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Draws the field from the store's newest state. The words (the score, the
 * level, the result) are DOM over the canvas: the canvas text drawn for an
 * 800 px field was 7 to 14 px on a phone, and the result sat under the chip.
 */
function drawField(ctx: CanvasRenderingContext2D, boost: number) {
  const { gameState, plane, bombs, buildings, explosions } = useBlitzBomberStore.getState();
  const groundY = CANVAS_HEIGHT - GROUND.HEIGHT;

  // Sky and clouds
  const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
  gradient.addColorStop(0, COLORS.SKY_TOP);
  gradient.addColorStop(1, COLORS.SKY_BOTTOM);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.fillStyle = COLORS.CLOUD;
  drawCloud(ctx, 100, 80, 60);
  drawCloud(ctx, 350, 50, 45);
  drawCloud(ctx, 600, 100, 55);
  drawCloud(ctx, 200, 150, 40);
  drawCloud(ctx, 700, 60, 50);

  // Buildings
  buildings.forEach((building: BuildingType) => {
    if (building.height <= 0) return;
    const x = building.x;
    const y = groundY - building.height;
    ctx.fillStyle = building.color;
    ctx.fillRect(x, y, building.width, building.height);
    ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
    ctx.fillRect(x + building.width - 5, y, 5, building.height);
    ctx.fillStyle = BUILDING.WINDOW_COLOR;
    for (let wy = y + 10; wy < groundY - 10; wy += BUILDING.WINDOW_GAP) {
      for (let wx = x + 5; wx < x + building.width - 10; wx += BUILDING.WINDOW_GAP) {
        if (windowLit(x, wx - x, wy - y)) ctx.fillRect(wx, wy, BUILDING.WINDOW_SIZE, BUILDING.WINDOW_SIZE);
      }
    }
    ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
    ctx.fillRect(x, y, building.width, 4);
  });

  // Ground
  ctx.fillStyle = GROUND.GRASS_COLOR;
  ctx.fillRect(0, groundY, CANVAS_WIDTH, GROUND.GRASS_HEIGHT);
  ctx.fillStyle = GROUND.COLOR;
  ctx.fillRect(0, groundY + GROUND.GRASS_HEIGHT, CANVAS_WIDTH, GROUND.HEIGHT - GROUND.GRASS_HEIGHT);

  // Explosions
  const now = Date.now();
  for (const explosion of explosions) {
    const progress = (now - explosion.startTime) / EXPLOSION.DURATION;
    if (progress >= 1) continue;
    const radius = EXPLOSION.MAX_RADIUS * progress;
    const alpha = 1 - progress;
    EXPLOSION.COLORS.forEach((color, i) => {
      const r = radius * (1 - i * 0.2);
      if (r <= 0) return;
      ctx.fillStyle = `${color}${Math.floor(alpha * 255).toString(16).padStart(2, "0")}`;
      ctx.beginPath();
      ctx.arc(explosion.x, explosion.y, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // Bombs (drawn bigger on a small field)
  for (const bomb of bombs) {
    ctx.save();
    ctx.translate(bomb.x, bomb.y);
    ctx.scale(boost, boost);
    ctx.fillStyle = COLORS.BOMB;
    ctx.beginPath();
    ctx.ellipse(0, BOMB.HEIGHT / 2, BOMB.WIDTH / 2, BOMB.HEIGHT / 2, 0, 0, Math.PI * 2);
    ctx.fill();
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
  }

  // The plane (drawn bigger on a small field)
  ctx.save();
  ctx.translate(plane.x + PLANE.WIDTH / 2, plane.y + PLANE.HEIGHT / 2);
  ctx.scale(boost * (plane.direction === -1 ? -1 : 1), boost);
  ctx.fillStyle = COLORS.PLANE_BODY;
  ctx.beginPath();
  ctx.ellipse(0, 0, PLANE.WIDTH / 2, PLANE.HEIGHT / 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLORS.PLANE_COCKPIT;
  ctx.beginPath();
  ctx.ellipse(PLANE.WIDTH / 4, -PLANE.HEIGHT / 6, PLANE.WIDTH / 6, PLANE.HEIGHT / 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLORS.PLANE_WING;
  ctx.fillRect(-PLANE.WIDTH / 4, -PLANE.HEIGHT / 2, PLANE.WIDTH / 2, 8);
  ctx.beginPath();
  ctx.moveTo(-PLANE.WIDTH / 2, 0);
  ctx.lineTo(-PLANE.WIDTH / 2 - 10, -PLANE.HEIGHT / 2);
  ctx.lineTo(-PLANE.WIDTH / 2 + 5, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = COLORS.PLANE_STRIPE;
  ctx.fillRect(-PLANE.WIDTH / 4, -2, PLANE.WIDTH / 2, 4);
  ctx.save();
  ctx.translate(PLANE.WIDTH / 2, 0);
  ctx.rotate((((now / 20) % 360) * Math.PI) / 180);
  ctx.fillStyle = "#333";
  ctx.fillRect(-2, -15, 4, 30);
  ctx.restore();
  ctx.restore();

  // The result tints the field; the words are the ResultCard's.
  if (gameState === "crashed") {
    ctx.fillStyle = COLORS.CRASH_OVERLAY;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  } else if (gameState === "landed") {
    ctx.fillStyle = COLORS.WIN_OVERLAY;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }
}

export function BlitzBomberGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The shell holds the game under an overlay (the restart question, the
  // leaderboard, the install steps, a clip sheet) and in a hidden tab: no
  // game time passes while it is true.
  const held = useShellHold();
  // The play box, fitted: it does not scroll, and a touch on it is the game's.
  const box = usePlayBox({ fit: true });
  const layout = blitzLayout(box);
  const boost = spriteBoost(layout.scale);
  const boostRef = useRef(boost);
  useLayoutEffect(() => {
    boostRef.current = boost;
  });

  const gameState = useBlitzBomberStore((s) => s.gameState);
  const score = useBlitzBomberStore((s) => s.score);
  const level = useBlitzBomberStore((s) => s.level);
  const runId = useBlitzBomberStore((s) => s.runId);
  const isNewHighScore = useBlitzBomberStore((s) => s.isNewHighScore);
  const progress = useBlitzBomberStore((s) => s.progress);
  const startGame = useBlitzBomberStore((s) => s.startGame);
  const dropBomb = useBlitzBomberStore((s) => s.dropBomb);
  const nextLevel = useBlitzBomberStore((s) => s.nextLevel);
  const setDifficulty = useBlitzBomberStore((s) => s.setDifficulty);
  const setSoundEnabled = useBlitzBomberStore((s) => s.setSoundEnabled);
  const getProgress = useBlitzBomberStore((s) => s.getProgress);
  const setProgress = useBlitzBomberStore((s) => s.setProgress);

  const playing = gameState === "playing";
  const crashed = gameState === "crashed";
  const landed = gameState === "landed";

  // Sync with auth system
  const { forceSync } = useAuthSync({
    appId: "blitz-bomber",
    localStorageKey: "blitz-bomber-progress",
    getState: getProgress,
    setState: setProgress,
    debounceMs: 3000,
  });

  // Force save immediately on game end
  useEffect(() => {
    if (crashed || landed) forceSync();
  }, [crashed, landed, forceSync]);

  // Gameplay clips: the canvas, the run phases and the new-best moment.
  useBlitzBomberClips(canvasRef, { gameState, score, highScore: progress.highScore, runId });

  // Sound: the first tap starts the shared game-audio bus, the sound switch
  // is this game's speaker (also after the saved setting loads), and the
  // game's channel leaves the bus when the game unmounts.
  useEffect(() => wantGameAudio(), []);
  const soundEnabled = progress.settings.soundEnabled;
  useEffect(() => {
    setGameSpeakerEnabled(BLITZ_BOMBER_AUDIO_ID, soundEnabled);
  }, [soundEnabled]);
  useEffect(() => () => releaseSounds(), []);

  const draw = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) drawField(ctx, boostRef.current);
  }, []);

  // The shared loop: a fixed 60 Hz step of game time, the field drawn every
  // frame (the propeller and the explosions move between rounds too), and
  // no game time between rounds or under a hold. The old loop was an effect
  // that restarted on every store change.
  useGameLoop(
    { update: (stepMs) => useBlitzBomberStore.getState().update(stepMs), render: draw },
    { running: true, paused: !playing || held }
  );

  // Play again and Next level wait out a short grace after the result
  // appears (the chip holds its buttons), and a held key's repeats never count.
  const grace = useRestartGrace(undefined, gameState);

  // A tap anywhere on the page (the field or the sky around it) drops a
  // bomb, on pointerdown, so a second finger drops one too. A tap after a
  // crash or a landing does nothing: the result chip's buttons go on, so a
  // tap meant for a bomb at the moment the round ended cannot skip the result.
  const pageTap = usePointerTap<HTMLDivElement>((event) => {
    if ((event.target as Element | null)?.closest?.("button, a")) return;
    if (useBlitzBomberStore.getState().gameState === "playing") dropBomb();
  });

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // A focused button or link owns its own Space and Enter: never swallow them.
      if (keyBelongsToTarget(e)) return;
      // The start card owns the ready state.
      if (gameState === "ready") return;
      // Pause is the GameShell's (ESC and its pause button).
      if (e.code === "Escape" || gameState === "paused") return;
      if (gameState === "playing") {
        // Any key drops a bomb.
        dropBomb();
        if (e.code === "Space" || e.code === "Enter") e.preventDefault();
        return;
      }
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        if (!grace.accept(e)) return;
        if (landed) nextLevel();
        else startGame();
      } else if (e.code === "KeyR") {
        e.preventDefault();
        if (grace.accept(e)) startGame();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [gameState, landed, grace, dropBomb, nextLevel, startGame]);

  const best = progress.highScore;
  const soundButton = (
    <button
      type="button"
      data-testid="result-chip-sound"
      onClick={() => setSoundEnabled(!soundEnabled)}
      // A pointer press leaves no focus here, so Space still means "go on".
      onMouseDown={(event) => event.preventDefault()}
      className={`btn ${SECONDARY_ACTION} gap-2 px-4 text-lg ${RESULT_CHIP_BUTTON} normal-case active:scale-[0.97] touch-manipulation`}
    >
      <span aria-hidden="true">{soundEnabled ? "🔊" : "🔇"}</span>
      {soundEnabled ? SOUND_LABELS.on : SOUND_LABELS.off}
    </button>
  );

  return (
    <div
      data-testid="blitz-bomber-root"
      {...pageTap}
      className="relative flex h-full w-full items-center justify-center bg-gradient-to-b from-sky-400 to-sky-600 touch-none select-none [-webkit-touch-callout:none]"
    >
      <IOSInstallPrompt />

      <div
        data-testid="blitz-bomber-field"
        className="relative shrink-0 overflow-hidden rounded-lg shadow-2xl"
        style={{ width: layout.width, height: layout.height }}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="block cursor-pointer"
          style={{ width: layout.width, height: layout.height, touchAction: "none" }}
        />

        {/* The score and the level, in the DOM, legible at every scale. */}
        {(playing || gameState === "paused") && (
          <div
            data-testid="blitz-bomber-hud"
            className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between px-3 pt-1 text-lg font-bold text-slate-800 [text-shadow:0_1px_0_#fff]"
          >
            <span>
              Score {score}
              <span className="block text-sm font-semibold">Best {best}</span>
            </span>
            <span>Level {level}</span>
          </div>
        )}

        {crashed && (
          <ResultCard testId="blitz-bomber-result-card" title="Crashed!">
            <ResultLine big>Score {score}</ResultLine>
            <ResultLine>{isNewHighScore ? "🏆 New best!" : `Level ${level} · Best ${best}`}</ResultLine>
          </ResultCard>
        )}
        {landed && (
          <ResultCard testId="blitz-bomber-result-card" title="Landed!">
            <ResultLine big>Level {level} done · Score {score}</ResultLine>
            <ResultLine>{isNewHighScore ? "🏆 New best!" : `Best ${best}`}</ResultLine>
          </ResultCard>
        )}
      </div>

      {gameState === "ready" && (
        <GameStartOverlay
          title="Blitz Bomber"
          emoji={metadata.emoji}
          subtitle="Drop bombs to destroy buildings and land safely!"
          touchHints={["Tap anywhere to drop bombs"]}
          keyboardHints={["SPACE or any key drops bombs", "R restarts from level 1"]}
          showStartButton={false}
          spokenChoices={`Tap how hard you want it and the game starts: ${DIFFICULTY_CHOICES.map((choice) => choice.label).join(", ")}.`}
          onStart={startGame}
        >
          {best > 0 && <div className="text-sm font-semibold text-amber-700">🏆 High Score: {best}</div>}
          {DIFFICULTY_CHOICES.map((choice) => (
            <GameStartOverlayButton
              key={choice.level}
              onClick={() => {
                setDifficulty(choice.level);
                startGame();
              }}
            >
              {choice.emoji} {choice.label}
            </GameStartOverlayButton>
          ))}
        </GameStartOverlay>
      )}

      {/* The result chip: read it to me, Play again (a crash) or Next level
          (a landing), the leaderboard, the sound switch, and with clips on
          the clip buttons. Mounted only at a result, so its grace starts then. */}
      {crashed && (
        <ResultChip
          resultText={resultText({ landed: false, score, level, newBest: isNewHighScore })}
          appId="blitz-bomber"
          onRestart={startGame}
          keyboardHint="Space"
        >
          {soundButton}
        </ResultChip>
      )}
      {landed && (
        <ResultChip resultText={resultText({ landed: true, score, level, newBest: isNewHighScore })} appId="blitz-bomber">
          <button
            type="button"
            data-testid="blitz-bomber-next-level"
            onClick={nextLevel}
            className={`btn btn-primary gap-2 px-4 text-lg ${RESULT_CHIP_BUTTON} active:scale-[0.97] touch-manipulation`}
          >
            <span aria-hidden="true">▶</span>
            {NEXT_LEVEL_LABEL}
          </button>
          {soundButton}
        </ResultChip>
      )}
    </div>
  );
}

export default BlitzBomberGame;
