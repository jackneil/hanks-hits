"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useAsteroidsStore } from "./lib/store";
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  SHIP_SIZE,
  UFO_SIZE,
  COLORS,
} from "./lib/constants";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { useCoarsePointer, usePointerHold } from "@/shared/hooks";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import { GameStartOverlay } from "@/shared/components/GameStartOverlay";
import { metadata } from "./metadata";
import { gameOverText, getOverlayCopy, NEW_BEST_LINE, SOUND_LABELS } from "./lib/overlayCopy";
import { keyBelongsToTarget } from "@/shared/lib/keyboardTarget";
import { ResultChip } from "@/shared/components/ResultChip";
import { RESULT_CHIP_BUTTON, SECONDARY_ACTION } from "@/shared/components/buttonStyles";
import { DEFAULT_RESTART_GRACE_MS, useRestartGrace } from "@/shared/lib/input";
import { useAsteroidsClips } from "./lib/useAsteroidsClips";
import { setGameSpeakerEnabled, wantGameAudio } from "@/shared/lib/audio";
import { ASTEROIDS_AUDIO_ID, releaseSounds } from "./lib/sounds";

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

      // Thrust flame
      if (ship.thrusting) {
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

    if (status === "gameOver") {
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      ctx.fillStyle = "#ef4444";
      ctx.font = "bold 36px Arial";
      ctx.textAlign = "center";
      ctx.fillText("GAME OVER", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 30);

      ctx.fillStyle = COLORS.TEXT;
      ctx.font = "24px Arial";
      ctx.fillText(`Score: ${score}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 20);
      ctx.fillText(`Wave: ${wave}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 50);

      // No "play again" line: the result chip under the card has the
      // button. A new best gets its own line.
      if (store.lastRunNewBest) {
        ctx.fillStyle = "#eab308";
        ctx.font = "bold 24px Arial";
        ctx.fillText(NEW_BEST_LINE, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 95);
      }
    }

    if (status === "waveComplete") {
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      ctx.fillStyle = "#22c55e";
      ctx.font = "bold 36px Arial";
      ctx.textAlign = "center";
      ctx.fillText(`WAVE ${wave} COMPLETE!`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 20);

      ctx.fillStyle = COLORS.TEXT;
      ctx.font = "18px Arial";
      ctx.fillText(copy.nextWave, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 40);
    }
  }, [canvasRef, store, isCoarse]);

  return render;
}

// ============================================
// MAIN COMPONENT
// ============================================
export function AsteroidsGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const store = useAsteroidsStore();
  const isCoarse = useCoarsePointer();
  const render = useCanvasRenderer(canvasRef, isCoarse);

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

  // Game loop
  const update = store.update;
  useEffect(() => {
    if (store.status !== "playing") return;

    let animationId: number;

    const gameLoop = () => {
      update();
      render();
      animationId = requestAnimationFrame(gameLoop);
    };

    animationId = requestAnimationFrame(gameLoop);

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [store.status, update, render]);

  // Render when not playing
  useEffect(() => {
    render();
  }, [render, store.status]);

  // Responsive scaling
  useEffect(() => {
    const updateScale = () => {
      if (!containerRef.current) return;

      const containerWidth = containerRef.current.clientWidth;
      const containerHeight = containerRef.current.clientHeight - 150;

      const scaleX = containerWidth / CANVAS_WIDTH;
      const scaleY = containerHeight / CANVAS_HEIGHT;
      const newScale = Math.min(scaleX, scaleY, 1.5);

      setScale(newScale);
    };

    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

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

  // Game over restarts only from the result chip's Play again (or Space): a
  // tap that was meant for a control at the moment of the last death must
  // not start a new run and wipe the score off the card.
  const handleCanvasClick = () => {
    if (store.status === "ready") {
      store.startGame();
    } else if (store.status === "waveComplete") {
      if (grace.accept()) store.nextWave();
    } else if (store.status === "paused") {
      store.resumeGame();
    }
  };

  const toggleSound = () => {
    const current = store.progress.soundEnabled;
    store.setProgress({ ...store.progress, soundEnabled: !current });
  };

  const playing = store.status === "playing";
  const gameOver = store.status === "gameOver";
  const soundLabel = store.progress.soundEnabled ? SOUND_LABELS.on : SOUND_LABELS.off;

  return (
    <div
      ref={containerRef}
      className="flex flex-col items-center justify-center min-h-screen bg-black p-4 select-none"
    >
      {/* Stats Bar: one line at every width, so the canvas never moves
          when a number grows (a new best at game over). */}
      <div
        data-testid="asteroids-stats"
        className="flex max-w-full items-center gap-3 overflow-hidden whitespace-nowrap mb-2 text-white text-xs sm:gap-4 sm:text-sm"
      >
        <span>High: {store.progress.highScore}</span>
        <span aria-hidden="true" className="hidden sm:inline">|</span>
        <span>Best Wave: {store.progress.highestWave}</span>
        <span aria-hidden="true" className="hidden sm:inline">|</span>
        <span>Asteroids: {store.progress.totalAsteroidsDestroyed}</span>
      </div>

      {/* Canvas */}
      <div
        className="relative"
        style={{
          width: CANVAS_WIDTH * scale,
          height: CANVAS_HEIGHT * scale,
        }}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          onClick={handleCanvasClick}
          className="rounded-lg border-2 border-gray-700"
          style={{
            width: CANVAS_WIDTH * scale,
            height: CANVAS_HEIGHT * scale,
          }}
        />

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

      {/* Mobile controls. The row keeps its place on every screen, so the
          canvas does not jump when a run ends; it shows and takes taps only
          while a round plays. */}
      <div
        data-testid="asteroids-touch-controls"
        className={`flex gap-2 mt-4 ${store.status === "playing" ? "" : "invisible"}`}
        aria-hidden={store.status === "playing" ? undefined : true}
        inert={store.status !== "playing"}
      >
        <button
          type="button"
          {...leftHold}
          className="w-16 h-16 bg-gray-700 active:bg-gray-600 text-white text-2xl font-bold rounded-xl touch-none select-none"
        >
          ↺
        </button>
        <button
          type="button"
          {...thrustHold}
          className="w-16 h-16 bg-orange-600 active:bg-orange-500 text-white text-2xl font-bold rounded-xl touch-none select-none"
        >
          🔥
        </button>
        <button
          type="button"
          {...fireHold}
          className="w-16 h-16 bg-yellow-600 active:bg-yellow-500 text-white text-2xl font-bold rounded-xl touch-none select-none"
        >
          ●
        </button>
        <button
          type="button"
          {...rightHold}
          className="w-16 h-16 bg-gray-700 active:bg-gray-600 text-white text-2xl font-bold rounded-xl touch-none select-none"
        >
          ↻
        </button>
      </div>

      {/* Control row. It keeps its place on every screen: the pause button
          stays mounted (shown and tappable only while a round plays), so
          the sound switch never moves. At game over the result chip covers
          this row, so the row hides and the chip has the sound switch. */}
      <div
        data-testid="asteroids-control-row"
        className={`flex items-center gap-4 mt-4 ${gameOver ? "invisible" : ""}`}
        aria-hidden={gameOver ? true : undefined}
        inert={gameOver}
      >
        <button
          type="button"
          data-testid="asteroids-sound"
          aria-label={soundLabel}
          onClick={toggleSound}
          className="w-12 h-12 bg-gray-700 hover:bg-gray-600 text-white rounded-full flex items-center justify-center"
        >
          {store.progress.soundEnabled ? "🔊" : "🔇"}
        </button>
        <button
          type="button"
          data-testid="asteroids-pause"
          aria-label="Pause"
          onClick={() => store.pauseGame()}
          aria-hidden={playing ? undefined : true}
          inert={!playing}
          className={`w-12 h-12 bg-yellow-600 hover:bg-yellow-500 text-white rounded-full flex items-center justify-center font-bold ${
            playing ? "" : "invisible"
          }`}
        >
          II
        </button>
        <IOSInstallPrompt />
      </div>

      {/* The result chip under the game-over card (plan 11.4): read it to
          me, Play again, the leaderboard, the sound switch, and with clips
          on the clip buttons. Mounted only at game over, so its grace
          starts then. */}
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
          spokenExtras={[soundLabel]}
        >
          <button
            type="button"
            data-testid="result-chip-sound"
            onClick={toggleSound}
            // A pointer press leaves no focus here, so Space still means "play again".
            onMouseDown={(event) => event.preventDefault()}
            className={`btn ${SECONDARY_ACTION} gap-2 px-4 text-lg ${RESULT_CHIP_BUTTON} normal-case active:scale-[0.97] touch-manipulation`}
          >
            <span aria-hidden="true">{store.progress.soundEnabled ? "🔊" : "🔇"}</span>
            {soundLabel}
          </button>
        </ResultChip>
      )}
    </div>
  );
}

export default AsteroidsGame;
