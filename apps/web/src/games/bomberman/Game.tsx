"use client";

import { useEffect, useRef, useCallback } from "react";
import { useBombermanStore } from "./lib/store";
import {
  GRID_WIDTH,
  GRID_HEIGHT,
  TILE_SIZE,
  COLORS,
  ENEMY_CONFIGS,
  POWER_UPS,
  type Direction,
} from "./lib/constants";
import { CANVAS_HEIGHT, CANVAS_WIDTH, layoutBomberman, padSize } from "./lib/layout";
import { BOMBERMAN_AUDIO_ID, releaseSounds } from "./lib/sounds";
import { useBombermanClips } from "./lib/useBombermanClips";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import { GameStartOverlay } from "@/shared/components/GameStartOverlay";
import { ResultCard, ResultLine } from "@/shared/components/ResultCard";
import { ResultChip } from "@/shared/components/ResultChip";
import { RESULT_CHIP_BUTTON, SECONDARY_ACTION } from "@/shared/components/buttonStyles";
import { useCoarsePointer } from "@/shared/hooks/useCoarsePointer";
import { useGameLoop } from "@/shared/hooks/useGameLoop";
import { usePlayBox } from "@/shared/hooks/usePlayBox";
import { useTouchInput } from "@/shared/hooks/useTouchInput";
import { keyBelongsToTarget } from "@/shared/lib/keyboardTarget";
import { usePointerTap, useRestartGrace } from "@/shared/lib/input";
import { setGameSpeakerEnabled, wantGameAudio } from "@/shared/lib/audio";

/** ms between moves while a key or a d-pad key is held (at speed 1). */
export const MOVE_RATE = 120;

export const SOUND_LABELS = { on: "Sound on", off: "Sound off" } as const;

/** The result in kid words, read aloud by the result chip. */
export function gameOverText(input: { score: number; level: number; best: number; newBest: boolean }): string {
  const points = input.score === 1 ? "1 point" : `${input.score} points`;
  const record = input.newBest ? "That is a new best!" : `Your best is ${input.best}.`;
  return `Game over! You got ${points} and reached level ${input.level}. ${record}`;
}

export function levelDoneText(input: { score: number; level: number; newBest: boolean }): string {
  const points = input.score === 1 ? "1 point" : `${input.score} points`;
  return `Level ${input.level} done! You have ${points}.${input.newBest ? " That is a new best!" : ""}`;
}

/** The d-pad keys, in a plus: up on top, left and right in the middle row, down at the bottom. */
const PAD_KEYS: { dir: Direction; label: string; glyph: string; area: string }[] = [
  { dir: "UP", label: "Move up", glyph: "▲", area: "up" },
  { dir: "LEFT", label: "Move left", glyph: "◀", area: "left" },
  { dir: "RIGHT", label: "Move right", glyph: "▶", area: "right" },
  { dir: "DOWN", label: "Move down", glyph: "▼", area: "down" },
];

/** The key under a touch: from the element the finger is on, or the point (a slide). */
function directionAt(target: EventTarget | null, x: number, y: number): Direction | null {
  const fromTarget = (target as Element | null)?.closest?.("[data-dir]") ?? null;
  const element =
    fromTarget ??
    (typeof document.elementFromPoint === "function"
      ? document.elementFromPoint(x, y)?.closest("[data-dir]") ?? null
      : null);
  const dir = element?.getAttribute("data-dir") as Direction | null | undefined;
  return dir ?? null;
}

export function BombermanGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<HTMLDivElement>(null);
  const keysRef = useRef<Set<string>>(new Set());
  // The d-pad key a thumb holds right now. The game loop reads it like
  // keysRef, so a held key keeps moving at the key repeat rate.
  const heldDirectionRef = useRef<Direction | null>(null);
  // Set to Infinity by a d-pad press so the next step moves at once.
  const moveTimerRef = useRef(0);

  const store = useBombermanStore();
  const isCoarse = useCoarsePointer();

  // The arena fits the play box on both axes, with room for the controls.
  const box = usePlayBox({ fit: true });
  const layout = layoutBomberman(box, isCoarse);

  // Gameplay clips: the canvas, the run phases, the new-best and level moments.
  useBombermanClips(canvasRef, {
    gameState: store.gameState,
    score: store.score,
    level: store.level,
    highScore: store.progress.highScore,
    runId: store.runId,
  });

  // Sound: the first tap starts the shared game-audio bus, the sound switch
  // is this game's speaker (also after the saved setting loads), and the
  // game's channel leaves the bus when the game unmounts.
  useEffect(() => wantGameAudio(), []);
  const soundEnabled = store.progress.settings.soundEnabled;
  useEffect(() => {
    setGameSpeakerEnabled(BOMBERMAN_AUDIO_ID, soundEnabled);
  }, [soundEnabled]);
  useEffect(() => () => releaseSounds(), []);

  // Auth sync
  const { forceSync } = useAuthSync({
    appId: "bomberman",
    localStorageKey: "bomberman-state",
    getState: store.getProgress,
    setState: store.setProgress,
    debounceMs: 3000,
  });

  // Force save immediately on game end
  useEffect(() => {
    if (store.gameState === "won" || store.gameState === "lost") {
      forceSync();
    }
  }, [store.gameState, forceSync]);

  // Space or Enter on the result screens waits out the result grace, so a
  // kid still mashing the bomb key at the last life sees the card first.
  const grace = useRestartGrace(undefined, store.gameState);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // A focused button or link owns its own Space and Enter: never swallow them.
      if (keyBelongsToTarget(e)) return;
      const state = useBombermanStore.getState();
      // The start card owns the ready state: keys must not act or block the
      // browser's own Space/Enter handling while it is up.
      if (state.gameState === "menu") return;
      keysRef.current.add(e.key.toLowerCase());

      if (state.gameState === "playing") {
        // Pause (ESC) is owned by the GameShell now (it binds ESC and shows the
        // pause button). Double-handling ESC/P here is what desynced the shell's
        // pause menu from the game's own paused state.
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          state.placeBomb();
        }
      } else if (state.gameState === "won") {
        if ((e.key === " " || e.key === "Enter") && grace.accept(e)) {
          state.nextLevel();
        }
      } else if (state.gameState === "lost") {
        if ((e.key === " " || e.key === "Enter") && grace.accept(e)) {
          state.startGame();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key.toLowerCase());
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [grace]);

  // Movement from keys
  const moveFromKeys = useCallback(() => {
    const state = useBombermanStore.getState();
    if (state.gameState !== "playing" || !state.player.alive) return;

    const keys = keysRef.current;
    let direction: Direction | null = null;

    if (keys.has("w") || keys.has("arrowup")) direction = "UP";
    else if (keys.has("s") || keys.has("arrowdown")) direction = "DOWN";
    else if (keys.has("a") || keys.has("arrowleft")) direction = "LEFT";
    else if (keys.has("d") || keys.has("arrowright")) direction = "RIGHT";
    else direction = heldDirectionRef.current;

    if (direction) {
      state.movePlayer(direction);
    }
  }, []);

  // Draw game
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear
    ctx.fillStyle = COLORS.FLOOR;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw grid
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const tile = store.grid[y][x];
        const px = x * TILE_SIZE;
        const py = y * TILE_SIZE;

        // Checkerboard floor
        if ((x + y) % 2 === 0) {
          ctx.fillStyle = COLORS.FLOOR_ALT;
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        }

        // Tile content
        switch (tile.type) {
          case "wall":
            ctx.fillStyle = COLORS.WALL;
            ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
            ctx.fillStyle = COLORS.WALL_BORDER;
            ctx.fillRect(px, py, TILE_SIZE, 4);
            ctx.fillRect(px, py + TILE_SIZE - 4, TILE_SIZE, 4);
            break;

          case "block":
            ctx.fillStyle = COLORS.BLOCK;
            ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
            ctx.fillStyle = COLORS.BLOCK_BORDER;
            ctx.fillRect(px + 2, py + TILE_SIZE - 8, TILE_SIZE - 4, 6);
            break;

          case "exit":
            if (tile.revealed) {
              ctx.fillStyle = "#4CAF50";
              ctx.beginPath();
              ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, TILE_SIZE / 3, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = "#fff";
              ctx.font = "20px sans-serif";
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText("🚪", px + TILE_SIZE / 2, py + TILE_SIZE / 2);
            } else {
              // Hidden as block
              ctx.fillStyle = COLORS.BLOCK;
              ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
            }
            break;

          case "empty":
            // Draw power-up if revealed
            if (tile.powerUp) {
              const powerUp = POWER_UPS.find(p => p.type === tile.powerUp);
              if (powerUp) {
                ctx.font = "28px sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(powerUp.emoji, px + TILE_SIZE / 2, py + TILE_SIZE / 2);
              }
            }
            break;
        }
      }
    }

    // Draw bombs
    const now = Date.now();
    for (const bomb of store.bombs) {
      const px = bomb.x * TILE_SIZE;
      const py = bomb.y * TILE_SIZE;

      // Pulsing effect
      const pulse = Math.sin(now / 100) * 0.1 + 0.9;
      const size = TILE_SIZE * 0.7 * pulse;
      const offset = (TILE_SIZE - size) / 2;

      ctx.fillStyle = "#333";
      ctx.beginPath();
      ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, size / 2, 0, Math.PI * 2);
      ctx.fill();

      // Fuse
      ctx.strokeStyle = "#FF5722";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px + TILE_SIZE / 2, py + offset);
      ctx.lineTo(px + TILE_SIZE / 2 + 8, py + offset - 8);
      ctx.stroke();

      // Spark
      if (Math.floor(now / 200) % 2 === 0) {
        ctx.fillStyle = "#FFEB3B";
        ctx.beginPath();
        ctx.arc(px + TILE_SIZE / 2 + 8, py + offset - 8, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw explosions
    for (const exp of store.explosions) {
      const px = exp.x * TILE_SIZE;
      const py = exp.y * TILE_SIZE;

      const progress = exp.timer / 400;
      const size = TILE_SIZE * (0.6 + progress * 0.4);
      const offset = (TILE_SIZE - size) / 2;

      // Outer
      ctx.fillStyle = COLORS.EXPLOSION;
      ctx.globalAlpha = progress;
      ctx.fillRect(px + offset, py + offset, size, size);

      // Inner
      ctx.fillStyle = COLORS.EXPLOSION_CENTER;
      ctx.fillRect(px + offset + 8, py + offset + 8, size - 16, size - 16);

      ctx.globalAlpha = 1;
    }

    // Draw enemies
    for (const enemy of store.enemies) {
      if (!enemy.alive) continue;

      const px = enemy.x * TILE_SIZE;
      const py = enemy.y * TILE_SIZE;
      const config = ENEMY_CONFIGS[enemy.type];

      ctx.font = "32px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(config.emoji, px + TILE_SIZE / 2, py + TILE_SIZE / 2);
    }

    // Draw player
    if (store.player.alive) {
      const px = store.player.x * TILE_SIZE;
      const py = store.player.y * TILE_SIZE;

      // Invincibility flash
      if (store.player.invincible <= 0 || Math.floor(now / 100) % 2 === 0) {
        // Player body
        ctx.fillStyle = "#2196F3";
        ctx.beginPath();
        ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, TILE_SIZE / 3, 0, Math.PI * 2);
        ctx.fill();

        // Face
        ctx.font = "24px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("😎", px + TILE_SIZE / 2, py + TILE_SIZE / 2);

        // Shield indicator
        if (store.player.hasShield) {
          ctx.strokeStyle = "#4CAF50";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, TILE_SIZE / 2.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // The result only dims the arena: the words are a ResultCard over it
    // (canvas text drawn for a 600 px arena was 12 px on a phone, and it sat
    // under the result chip).
    if (store.gameState === "won" || store.gameState === "lost") {
      ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
  }, [store.grid, store.bombs, store.explosions, store.enemies, store.player, store.gameState]);

  // The game loop: the shared fixed-step loop (pause-aware, clamped, no
  // effect restarts). Each step moves the world by one step of game time
  // and consumes a held key or d-pad key at the move rate. The old loop
  // effect restarted on every store change, so its move timer never
  // reached the rate and a held key barely moved.
  const update = useCallback(
    (stepMs: number) => {
      const state = useBombermanStore.getState();
      if (state.gameState !== "playing") return;
      state.update(stepMs);
      moveTimerRef.current += stepMs;
      if (moveTimerRef.current >= MOVE_RATE / state.player.speed) {
        moveFromKeys();
        moveTimerRef.current = 0;
      }
    },
    [moveFromKeys]
  );
  useGameLoop({ update, render: draw }, { running: true, paused: store.gameState !== "playing" });

  // Touch d-pad: ONE surface for the four keys. A held key moves the player
  // at the key repeat rate (the loop consumes heldDirectionRef like keysRef),
  // and a thumb that slides from one key onto another changes direction
  // without lifting, like a real pad. The last finger to press or slide
  // wins; a lift, a cancel, a blur or a hidden page lets go.
  const pressDirection = useCallback((direction: Direction) => {
    if (heldDirectionRef.current === direction) return;
    heldDirectionRef.current = direction;
    moveTimerRef.current = Number.POSITIVE_INFINITY;
  }, []);
  const releaseDirection = useCallback((direction: Direction | undefined) => {
    if (direction && heldDirectionRef.current === direction) heldDirectionRef.current = null;
  }, []);
  useTouchInput<Direction>(padRef, {
    onStart: (touch) => {
      const dir = directionAt(touch.target, touch.x, touch.y);
      if (!dir) return;
      touch.tag = dir;
      pressDirection(dir);
    },
    onMove: (touch) => {
      const dir = directionAt(null, touch.x, touch.y);
      if (!dir || dir === touch.tag) return;
      releaseDirection(touch.tag);
      touch.tag = dir;
      pressDirection(dir);
    },
    onEnd: (touch) => releaseDirection(touch.tag),
  });

  // Touch bomb button: one tap = one bomb. The button used to carry
  // onTouchStart AND onClick, so a finger tap called placeBomb twice.
  const bombTap = usePointerTap<HTMLButtonElement>(() => {
    const state = useBombermanStore.getState();
    if (state.gameState === "playing") {
      state.placeBomb();
    }
  });

  const toggleSound = () => {
    store.setProgress({
      ...store.progress,
      settings: {
        ...store.progress.settings,
        soundEnabled: !store.progress.settings.soundEnabled,
      },
    });
  };
  const soundLabel = soundEnabled ? SOUND_LABELS.on : SOUND_LABELS.off;

  const pad = isCoarse ? (
    <div
      ref={padRef}
      data-testid="bomberman-dpad"
      className="grid shrink-0 gap-1 touch-none select-none [-webkit-touch-callout:none]"
      style={{
        gridTemplateAreas: '". up ." "left . right" ". down ."',
        gridTemplateColumns: `repeat(3, ${layout.padKey}px)`,
        gridTemplateRows: `repeat(3, ${layout.padKey}px)`,
        width: padSize(layout.padKey),
        height: padSize(layout.padKey),
      }}
    >
      {PAD_KEYS.map((key) => (
        <button
          key={key.dir}
          type="button"
          data-dir={key.dir}
          aria-label={key.label}
          className="bg-gray-700 active:bg-gray-500 rounded-lg text-white text-2xl touch-none select-none [-webkit-touch-callout:none]"
          style={{ gridArea: key.area, width: layout.padKey, height: layout.padKey }}
        >
          {key.glyph}
        </button>
      ))}
    </div>
  ) : null;

  const bomb = isCoarse ? (
    <button
      type="button"
      {...bombTap}
      aria-label="Drop a bomb"
      data-testid="bomberman-bomb"
      className="shrink-0 bg-red-600 active:bg-red-400 rounded-full text-5xl shadow-lg touch-manipulation select-none [-webkit-touch-callout:none]"
      style={{ width: layout.bombButton, height: layout.bombButton }}
    >
      💣
    </button>
  ) : null;

  // Sideways on a touch screen the HUD wraps into the right gutter under
  // the bomb button; otherwise it is one row over the arena.
  const hudInGutter = layout.sideways && isCoarse;
  const hud = (
    <div
      data-testid="bomberman-hud"
      className={
        hudInGutter
          ? "flex w-full shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 text-base font-bold text-white"
          : "flex h-8 shrink-0 items-center justify-center gap-3 whitespace-nowrap text-base font-bold text-white"
      }
      style={hudInGutter ? undefined : { width: layout.fit.width || undefined }}
    >
      <span>Lv {store.level}</span>
      <span>{store.score} pts</span>
      <span aria-label={`${store.lives} lives`}>{"❤️".repeat(store.lives)}</span>
      <span>💣 {Math.max(0, store.player.maxBombs - store.player.bombCount)}</span>
      <span>🔥 {store.player.blastRange}</span>
      {store.player.hasKick && <span>🦶</span>}
      {store.player.hasShield && <span>🛡️</span>}
    </div>
  );

  const isOver = store.gameState === "lost";
  const isWon = store.gameState === "won";

  const arena = (
    <div data-testid="bomberman-arena" className="relative shrink-0">
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className="block rounded-lg shadow-2xl"
        style={{
          width: layout.fit.width || undefined,
          height: layout.fit.height || undefined,
          touchAction: "none",
        }}
      />
      {isOver && (
        <ResultCard testId="bomberman-result-card" title="Game over!">
          <ResultLine big>Score {store.score}</ResultLine>
          <ResultLine>{store.isNewHighScore ? "🏆 New best!" : `Level ${store.level} · Best ${store.progress.highScore}`}</ResultLine>
        </ResultCard>
      )}
      {isWon && (
        <ResultCard testId="bomberman-result-card" title={`Level ${store.level} done!`}>
          <ResultLine big>Score {store.score}</ResultLine>
          {store.isNewHighScore && <ResultLine>🏆 New best!</ResultLine>}
        </ResultCard>
      )}
    </div>
  );

  return (
    <div
      data-testid="bomberman-game"
      className={`relative h-full w-full bg-gray-900 p-2 select-none [-webkit-touch-callout:none] flex items-center justify-center gap-2 ${
        layout.sideways ? "flex-row" : "flex-col"
      }`}
    >
      {/* Sideways: the d-pad in the left gutter, the HUD and the arena in
          the middle, the bomb button in the right gutter. Upright: the HUD
          row, the arena, then the d-pad (left) and the bomb (right). */}
      {layout.sideways ? (
        <>
          <div className="flex shrink-0 items-center justify-center" data-testid="bomberman-left-gutter">
            {pad}
          </div>
          <div className="flex min-w-0 flex-col items-center gap-2">
            {!hudInGutter && hud}
            {arena}
          </div>
          <div
            className="flex shrink-0 flex-col items-center justify-center gap-3"
            data-testid="bomberman-right-gutter"
            style={hudInGutter ? { width: Math.max(padSize(layout.padKey), layout.bombButton) } : undefined}
          >
            {bomb}
            {hudInGutter && hud}
          </div>
        </>
      ) : (
        <>
          {hud}
          {arena}
          {isCoarse && (
            <div className="flex w-full shrink-0 items-center justify-between px-2" data-testid="bomberman-control-row">
              {pad}
              {bomb}
            </div>
          )}
        </>
      )}

      {/* Menu overlay: shared DOM start screen (it portals to document.body). */}
      {store.gameState === "menu" && (
        <GameStartOverlay
          title="Bomberman"
          emoji="💣"
          subtitle="Destroy blocks. Defeat enemies. Find the exit!"
          keyboardHints={["WASD or Arrows to move", "SPACE to drop bombs"]}
          touchHints={["👉 Hold an arrow to move", "💣 Tap the bomb to drop one"]}
          onStart={() => store.startGame()}
        >
          <div className="text-base font-medium opacity-90">
            🏆 High Score: {store.progress.highScore}
          </div>
        </GameStartOverlay>
      )}

      <IOSInstallPrompt />

      {/* The result chip under the game-over or level-done picture: read it
          to me, Play again or Next level, the leaderboard, the sound switch,
          and with clips on the clip buttons. */}
      {isOver && (
        <ResultChip
          resultText={gameOverText({
            score: store.score,
            level: store.level,
            best: store.progress.highScore,
            newBest: store.isNewHighScore,
          })}
          appId="bomberman"
          onRestart={store.startGame}
          spokenExtras={[soundLabel]}
          keyboardHint="Space"
        >
          <SoundButton label={soundLabel} enabled={soundEnabled} onToggle={toggleSound} />
        </ResultChip>
      )}
      {isWon && (
        <ResultChip
          resultText={levelDoneText({ score: store.score, level: store.level, newBest: store.isNewHighScore })}
          appId="bomberman"
          spokenExtras={["Next level", soundLabel]}
          keyboardHint="Space"
        >
          <button
            type="button"
            onClick={store.nextLevel}
            className={`btn btn-primary gap-2 px-4 text-lg ${RESULT_CHIP_BUTTON} active:scale-[0.97] touch-manipulation`}
          >
            <span aria-hidden="true">▶</span>
            Next level
          </button>
          <SoundButton label={soundLabel} enabled={soundEnabled} onToggle={toggleSound} />
        </ResultChip>
      )}
    </div>
  );
}

function SoundButton({ label, enabled, onToggle }: { label: string; enabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      data-testid="result-chip-sound"
      onClick={onToggle}
      // A pointer press leaves no focus here, so Space still means "play again".
      onMouseDown={(event) => event.preventDefault()}
      className={`btn ${SECONDARY_ACTION} gap-2 px-4 text-lg ${RESULT_CHIP_BUTTON} normal-case active:scale-[0.97] touch-manipulation`}
    >
      <span aria-hidden="true">{enabled ? "🔊" : "🔇"}</span>
      {label}
    </button>
  );
}

export default BombermanGame;
