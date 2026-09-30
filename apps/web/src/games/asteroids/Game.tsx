"use client";

import { useEffect, useRef, useCallback, type ReactNode } from "react";
import { useAsteroidsStore } from "./lib/store";
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  SHIP_SIZE,
  UFO_SIZE,
  COLORS,
} from "./lib/constants";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { useCoarsePointer, usePlayBox, usePointerHold } from "@/shared/hooks";
import type { PointerHoldHandlers } from "@/shared/hooks";
import { useGameLoop } from "@/shared/hooks/useGameLoop";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import { GameStartOverlay } from "@/shared/components/GameStartOverlay";
import { metadata } from "./metadata";
import {
  gameOverText,
  getOverlayCopy,
  NEXT_WAVE_LABEL,
  PAD_LABELS,
  SOUND_LABELS,
  waveCompleteText,
} from "./lib/overlayCopy";
import { keyBelongsToTarget } from "@/shared/lib/keyboardTarget";
import { ResultChip } from "@/shared/components/ResultChip";
import { ResultCard, ResultLine } from "@/shared/components/ResultCard";
import { RESULT_CHIP_BUTTON } from "@/shared/components/buttonStyles";
import { DEFAULT_RESTART_GRACE_MS, useRestartGrace } from "@/shared/lib/input";
import { useAsteroidsClips } from "./lib/useAsteroidsClips";
import { setGameSpeakerEnabled, wantGameAudio } from "@/shared/lib/audio";
import { ASTEROIDS_AUDIO_ID, releaseSounds } from "./lib/sounds";
import {
  ACTION_BUTTON_PX,
  asteroidsLayout,
  EDGE_PX,
  GUTTER_PX,
  PAD_GAP_PX,
  STATS_ROW_PX,
  TURN_BUTTON_PX,
} from "./lib/layout";

// ============================================
// CANVAS RENDERER
// ============================================
function useCanvasRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  isCoarse: boolean
) {
  const store = useAsteroidsStore();

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const copy = getOverlayCopy(isCoarse);

    const { ship, bullets, asteroids, ufo, particles, score, lives, wave, status } = store;

    // Clear canvas
    ctx.fillStyle = COLORS.BACKGROUND;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw particles
    for (const particle of particles) {
      const alpha = particle.life / particle.maxLife;
      ctx.fillStyle = particle.color;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Draw asteroids
    ctx.strokeStyle = COLORS.ASTEROID;
    ctx.lineWidth = 2;

    for (const asteroid of asteroids) {
      ctx.save();
      ctx.translate(asteroid.x, asteroid.y);
      ctx.rotate(asteroid.rotation);

      ctx.beginPath();
      const vertices = asteroid.vertices;
      ctx.moveTo(vertices[0].x, vertices[0].y);
      for (let i = 1; i < vertices.length; i++) {
        ctx.lineTo(vertices[i].x, vertices[i].y);
      }
      ctx.closePath();
      ctx.stroke();

      ctx.restore();
    }

    // Draw UFO
    if (ufo) {
      ctx.save();
      ctx.translate(ufo.x, ufo.y);

      ctx.strokeStyle = COLORS.UFO;
      ctx.lineWidth = 2;

      // UFO shape (classic flying saucer)
      ctx.beginPath();
      // Top dome
      ctx.arc(0, -5, 8, Math.PI, 0);
      // Body
      ctx.moveTo(-UFO_SIZE, 0);
      ctx.lineTo(-10, -5);
      ctx.lineTo(10, -5);
      ctx.lineTo(UFO_SIZE, 0);
      ctx.lineTo(10, 5);
      ctx.lineTo(-10, 5);
      ctx.closePath();
      ctx.stroke();

      ctx.restore();
    }

    // Draw bullets
    for (const bullet of bullets) {
      ctx.fillStyle = bullet.isUfoBullet ? COLORS.UFO_BULLET : COLORS.BULLET;
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, bullet.isUfoBullet ? 3 : 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw ship
    if (status === "playing" || status === "paused" || status === "waveComplete") {
      ctx.save();
      ctx.translate(ship.x, ship.y);
      ctx.rotate(ship.angle);

      // Invincibility effect
      if (ship.invincibleFrames > 0 && Math.floor(ship.invincibleFrames / 5) % 2 === 0) {
        ctx.strokeStyle = COLORS.INVINCIBLE;
        ctx.globalAlpha = 0.5;
      } else {
        ctx.strokeStyle = COLORS.SHIP;
      }

      ctx.lineWidth = 2;

      // Ship triangle
      ctx.beginPath();
      ctx.moveTo(SHIP_SIZE, 0); // Nose
      ctx.lineTo(-SHIP_SIZE * 0.7, -SHIP_SIZE * 0.6); // Left wing
      ctx.lineTo(-SHIP_SIZE * 0.4, 0); // Back indent
      ctx.lineTo(-SHIP_SIZE * 0.7, SHIP_SIZE * 0.6); // Right wing
      ctx.closePath();
      ctx.stroke();

      // Thrust flame. Its flicker is game time (the ship's own frame
      // count), so a paused picture holds still under the shell's hold.
      if (ship.thrusting && status === "playing") {
        ctx.strokeStyle = COLORS.SHIP_THRUST;
        ctx.beginPath();
        ctx.moveTo(-SHIP_SIZE * 0.5, -SHIP_SIZE * 0.3);
        ctx.lineTo(-SHIP_SIZE * 1.2 - Math.random() * 8, 0);
        ctx.lineTo(-SHIP_SIZE * 0.5, SHIP_SIZE * 0.3);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // HUD
    ctx.fillStyle = COLORS.TEXT;
    ctx.font = "bold 20px Arial";
    ctx.textAlign = "left";
    ctx.fillText(`Score: ${score}`, 10, 30);

    ctx.textAlign = "right";
    ctx.fillText(`Wave: ${wave}`, CANVAS_WIDTH - 10, 30);

    // Lives (as ship icons)
    ctx.textAlign = "left";
    for (let i = 0; i < lives; i++) {
      ctx.save();
      ctx.translate(20 + i * 25, 55);
      ctx.rotate(-Math.PI / 2);
      ctx.strokeStyle = COLORS.SHIP;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(-7, -6);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-7, 6);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    // Overlays
    // The "ready" start screen is a DOM overlay (GameStartOverlay), not canvas
    // text — so touch users get a real start button and pointer-aware hints.
    // Keep only the dark backdrop here; all title/instruction text lives in the
    // overlay component now.
    if (status === "ready") {
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }

    if (status === "paused") {
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      ctx.fillStyle = "#eab308";
      ctx.font = "bold 36px Arial";
      ctx.textAlign = "center";
      ctx.fillText("PAUSED", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);

      ctx.fillStyle = COLORS.TEXT;
      ctx.font = "18px Arial";
      ctx.fillText(copy.resume, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 40);
    }

    // Game over and the wave card only dim the field: the words are a
    // ResultCard over the canvas, clear of the result chip (the chip
    // covered the lower quarter of the canvas upright).
    if (status === "gameOver" || status === "waveComplete") {
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
  }, [canvasRef, store, isCoarse]);

  return render;
}

// ============================================
// PAD BUTTON
// ============================================
const PAD_BUTTON_CLASSES =
  "flex flex-col items-center justify-center rounded-2xl font-bold leading-none text-white touch-none select-none [-webkit-touch-callout:none] shadow-md active:scale-95";

/** One hold button of the pad: a glyph, a short word under it, and a fixed size. */
function PadButton({
  hold,
  label,
  glyph,
  word,
  size,
  tone,
}: {
  hold: PointerHoldHandlers<HTMLButtonElement>;
  label: string;
  glyph: ReactNode;
  word?: string;
  size: number;
  tone: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      {...hold}
      className={`${PAD_BUTTON_CLASSES} ${tone}`}
      style={{ width: size, height: size }}
    >
      <span aria-hidden="true" className="text-2xl">
        {glyph}
      </span>
      {word && (
        <span aria-hidden="true" className="mt-0.5 text-[11px] tracking-wide">
          {word}
        </span>
      )}
    </button>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================
export function AsteroidsGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const store = useAsteroidsStore();
  const isCoarse = useCoarsePointer();
  const render = useCanvasRenderer(canvasRef, isCoarse);

  // The canvas fits the play box on both axes (layout.ts): upright the pad
  // sits under it, sideways the pad sits in the gutters beside it. The box
  // is fitted: it never scrolls, and a touch on it goes to the game.
  const box = usePlayBox({ fit: true });
  const layout = asteroidsLayout(box);
  const { canvas: fit, sideways } = layout;

  // Gameplay clips: the canvas, the run phases and the new-best moment.
  useAsteroidsClips(canvasRef, {
    status: store.status,
    score: store.score,
    highScore: store.progress.highScore,
    runId: store.runId,
  });

  // Sound: the first tap starts the shared game-audio bus, the sound switch
  // is this game's speaker (also after the saved setting loads), and the
  // game's channel leaves the bus when the game unmounts.
  useEffect(() => wantGameAudio(), []);
  const soundEnabled = store.progress.soundEnabled;
  useEffect(() => {
    setGameSpeakerEnabled(ASTEROIDS_AUDIO_ID, soundEnabled);
  }, [soundEnabled]);
  useEffect(() => () => releaseSounds(), []);

  // Auth sync
  const { forceSync } = useAuthSync({
    appId: "asteroids",
    localStorageKey: "asteroids-game-state",
    getState: store.getProgress,
    setState: store.setProgress,
    debounceMs: 3000,
  });

  // Force save immediately on game over
  useEffect(() => {
    if (store.status === "gameOver") {
      forceSync();
    }
  }, [store.status, forceSync]);

  // The shared fixed-step loop: 60 steps of game time each second on any
  // screen (the old requestAnimationFrame chain ran the store's per-frame
  // update once per screen frame, so a 120 Hz phone played at double
  // speed). The steps stop between rounds and while the shell holds the
  // game (the store is "paused" then); the picture still draws each frame.
  const update = store.update;
  const playing = store.status === "playing";
  useGameLoop({ update, render }, { running: true, paused: !playing });

  // Between rounds the picture changes only with the state (a card, a
  // pause): draw it in the same commit, so the card is on the canvas
  // before the next frame, also where frames are throttled.
  useEffect(() => {
    if (!playing) render();
  }, [render, playing]);

  // Restart and "next wave" wait out a short grace after the card appears,
  // and a held key's repeats never count: a kid who is still firing when
  // the run ends sees the card first.
  const grace = useRestartGrace(DEFAULT_RESTART_GRACE_MS, store.status);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // A focused button or link owns its own Space and Enter: never swallow them.
      if (keyBelongsToTarget(e)) return;
      // The start card owns the ready state: keys must not act or block the
      // browser's own Space/Enter handling while it is up.
      if (store.status === "ready") return;
      if (store.status === "gameOver") {
        if (e.code === "Space") {
          e.preventDefault();
          if (grace.accept(e)) store.startGame();
        }
        return;
      }

      if (store.status === "waveComplete") {
        if (e.code === "Space") {
          e.preventDefault();
          if (grace.accept(e)) store.nextWave();
        }
        return;
      }

      if (store.status === "paused") {
        // Pause/resume is owned by the GameShell now (ESC + pause button), so
        // we ignore game keys while paused instead of double-handling ESC/P.
        return;
      }

      switch (e.code) {
        case "KeyA":
        case "ArrowLeft":
          e.preventDefault();
          store.setInput({ rotatingLeft: true });
          break;
        case "KeyD":
        case "ArrowRight":
          e.preventDefault();
          store.setInput({ rotatingRight: true });
          break;
        case "KeyW":
        case "ArrowUp":
          e.preventDefault();
          store.setInput({ thrusting: true });
          break;
        case "Space":
          e.preventDefault();
          store.setInput({ shooting: true });
          break;
        case "ShiftLeft":
        case "ShiftRight":
          e.preventDefault();
          store.hyperspace();
          break;
        // Pause (ESC) is owned by the GameShell now — see the wrapper.
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      switch (e.code) {
        case "KeyA":
        case "ArrowLeft":
          store.setInput({ rotatingLeft: false });
          break;
        case "KeyD":
        case "ArrowRight":
          store.setInput({ rotatingRight: false });
          break;
        case "KeyW":
        case "ArrowUp":
          store.setInput({ thrusting: false });
          break;
        case "Space":
          store.setInput({ shooting: false });
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [store.status, store, grace]);

  // The pad buttons are hold controls through the shared pointer hold: one
  // press per button however many fingers, pointer capture so a thumb that
  // slides off still releases, and a release on pointercancel, on window
  // blur and on unmount. The buttons used to carry onTouchStart/onTouchEnd
  // AND onMouseDown/Up/Leave with no touchcancel, so a system-cancelled
  // touch (an edge swipe, the notification pull) left the thrust stuck on.
  const setInput = store.setInput;
  const leftHold = usePointerHold<HTMLButtonElement>(
    () => setInput({ rotatingLeft: true }),
    () => setInput({ rotatingLeft: false })
  );
  const thrustHold = usePointerHold<HTMLButtonElement>(
    () => setInput({ thrusting: true }),
    () => setInput({ thrusting: false })
  );
  const fireHold = usePointerHold<HTMLButtonElement>(
    () => setInput({ shooting: true }),
    () => setInput({ shooting: false })
  );
  const rightHold = usePointerHold<HTMLButtonElement>(
    () => setInput({ rotatingRight: true }),
    () => setInput({ rotatingRight: false })
  );

  // A held input lets go when the round stops (the wave card, game over,
  // a pause): the next round never starts with a thrust or a shot the kid
  // is no longer making.
  useEffect(() => {
    if (playing) return;
    setInput({ rotatingLeft: false, rotatingRight: false, thrusting: false, shooting: false });
  }, [playing, setInput]);

  // Game over restarts only from the result chip's Play again (or Space),
  // and a wave goes on only from the chip's Next wave (or Space): a tap that
  // was meant for a control at the moment the round ended must not skip
  // the card.
  const handleCanvasClick = () => {
    if (store.status === "ready") {
      store.startGame();
    } else if (store.status === "paused") {
      store.resumeGame();
    }
  };

  const toggleSound = () => {
    const current = store.progress.soundEnabled;
    store.setProgress({ ...store.progress, soundEnabled: !current });
  };

  const gameOver = store.status === "gameOver";
  const waveComplete = store.status === "waveComplete";
  const soundLabel = store.progress.soundEnabled ? SOUND_LABELS.on : SOUND_LABELS.off;

  // The pad groups keep their place on every screen, so the canvas does not
  // jump when a run ends; they show and take taps only while a round plays.
  const padState = playing
    ? {}
    : ({ "aria-hidden": true, inert: true } as const);
  const padHidden = playing ? "" : "invisible";

  const turnPad = (
    <div
      data-testid="asteroids-pad-turn"
      className={`flex items-center ${padHidden}`}
      style={{ gap: PAD_GAP_PX }}
      {...padState}
    >
      <PadButton hold={leftHold} label={PAD_LABELS.turnLeft} glyph="↺" size={TURN_BUTTON_PX} tone="bg-gray-700 active:bg-gray-600" />
      <PadButton hold={rightHold} label={PAD_LABELS.turnRight} glyph="↻" size={TURN_BUTTON_PX} tone="bg-gray-700 active:bg-gray-600" />
    </div>
  );
  const actionPad = (
    <div
      data-testid="asteroids-pad-action"
      className={`flex items-center ${padHidden}`}
      style={{ gap: PAD_GAP_PX }}
      {...padState}
    >
      <PadButton hold={thrustHold} label={PAD_LABELS.thrust} glyph="🔥" word="GO" size={ACTION_BUTTON_PX} tone="bg-orange-600 active:bg-orange-500" />
      <PadButton hold={fireHold} label={PAD_LABELS.fire} glyph="●" word="FIRE" size={ACTION_BUTTON_PX} tone="bg-yellow-600 active:bg-yellow-500" />
    </div>
  );

  const soundButton = (
    <button
      type="button"
      data-testid="asteroids-sound"
      aria-label={soundLabel}
      onClick={toggleSound}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gray-700 text-xl text-white hover:bg-gray-600 touch-manipulation"
    >
      <span aria-hidden="true">{store.progress.soundEnabled ? "🔊" : "🔇"}</span>
    </button>
  );

  // The stats: one line upright (it never wraps, so the canvas never moves
  // when a number grows), two short lines in the gutter sideways.
  const stats = (
    <div
      data-testid="asteroids-stats"
      className={
        sideways
          ? "flex max-w-full flex-col items-center gap-0.5 overflow-hidden whitespace-nowrap text-center text-xs text-white"
          : "flex max-w-full items-center gap-3 overflow-hidden whitespace-nowrap text-xs text-white sm:gap-4 sm:text-sm"
      }
    >
      <span>High: {store.progress.highScore}</span>
      <span>Best wave: {store.progress.highestWave}</span>
      <span>Rocks: {store.progress.totalAsteroidsDestroyed}</span>
    </div>
  );

  const canvasBox = (
    <div className="relative shrink-0" style={{ width: fit.width, height: fit.height }}>
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        onClick={handleCanvasClick}
        className="rounded-lg border-2 border-gray-700"
        style={{ width: fit.width, height: fit.height }}
      />

      {store.status === "gameOver" && (
        <ResultCard testId="asteroids-result-card" title="Game over!">
          <ResultLine big>
            Score {store.score} · Wave {store.wave}
          </ResultLine>
          <ResultLine>{store.lastRunNewBest ? "🏆 New best!" : `Best ${store.progress.highScore}`}</ResultLine>
        </ResultCard>
      )}
      {store.status === "waveComplete" && (
        <ResultCard testId="asteroids-result-card" title={`Wave ${store.wave} complete!`}>
          <ResultLine big>Score {store.score}</ResultLine>
        </ResultCard>
      )}

      {store.status === "ready" && (
        <GameStartOverlay
          title="Asteroids"
          emoji={metadata.emoji}
          keyboardHints={[
            "A/D or ← → to rotate",
            "W or ↑ to thrust",
            "SPACE to fire",
            "SHIFT for hyperspace",
          ]}
          touchHints={[
            "Tap ⟲ ⟳ to rotate",
            "Hold 🔥 to thrust",
            "Tap ● to fire",
          ]}
          onStart={store.startGame}
        />
      )}
    </div>
  );

  return (
    <div
      data-testid="asteroids-root"
      data-layout={sideways ? "sideways" : "upright"}
      className="h-full w-full select-none bg-black"
    >
      {sideways ? (
        // Sideways: the pad in the gutters, the canvas full height between them.
        <div className="flex h-full w-full items-center justify-center" style={{ padding: EDGE_PX }}>
          <div
            data-testid="asteroids-gutter-left"
            className="flex shrink-0 flex-col items-center justify-center gap-3"
            style={{ width: GUTTER_PX }}
          >
            {turnPad}
            {stats}
          </div>
          {canvasBox}
          <div
            data-testid="asteroids-gutter-right"
            className="flex shrink-0 flex-col items-center justify-center gap-3"
            style={{ width: GUTTER_PX }}
          >
            {actionPad}
            {soundButton}
          </div>
        </div>
      ) : (
        // Upright: the stats line, the canvas, then the pad in one row.
        <div className="flex h-full w-full flex-col items-center" style={{ padding: EDGE_PX, gap: PAD_GAP_PX }}>
          <div className="flex w-full shrink-0 items-center justify-center gap-3" style={{ height: STATS_ROW_PX }}>
            {stats}
            {soundButton}
          </div>
          {canvasBox}
          <div className="flex w-full shrink-0 items-center justify-between" style={{ height: ACTION_BUTTON_PX, maxWidth: fit.width }}>
            {turnPad}
            {actionPad}
          </div>
        </div>
      )}

      <IOSInstallPrompt />

      {/* The result chip under the game-over card (plan 11.4): read it to
          me, Play again, the leaderboard, and with clips on the clip
          buttons. Mounted only at game over, so its grace starts then. */}
      {gameOver && (
        <ResultChip
          resultText={gameOverText({
            score: store.score,
            wave: store.wave,
            best: store.progress.highScore,
            newBest: store.lastRunNewBest,
          })}
          appId="asteroids"
          onRestart={store.startGame}
          keyboardHint="Space"
        />
      )}

      {/* The wave-complete chip: read it to me, then Next wave. The canvas
          used to say "Tap for Next Wave" in 18 px text; now the button is
          real, 44 px or more, and the voice can say it. */}
      {waveComplete && (
        <ResultChip resultText={waveCompleteText({ wave: store.wave, score: store.score })} spokenExtras={[NEXT_WAVE_LABEL]}>
          <button
            type="button"
            data-testid="asteroids-next-wave"
            onClick={() => store.nextWave()}
            className={`btn btn-primary gap-2 px-4 text-lg ${RESULT_CHIP_BUTTON} active:scale-[0.97] touch-manipulation`}
          >
            <span aria-hidden="true">▶</span>
            {NEXT_WAVE_LABEL}
          </button>
        </ResultChip>
      )}
    </div>
  );
}

export default AsteroidsGame;
