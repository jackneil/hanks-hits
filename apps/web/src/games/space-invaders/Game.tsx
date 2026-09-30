"use client";

import { useEffect, useRef, useCallback, useState, type ReactNode } from "react";
import { useSpaceInvadersStore, type SpaceInvadersProgress } from "./lib/store";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import {
  GameStartOverlay,
  GameStartOverlayButton,
} from "@/shared/components/GameStartOverlay";
import { ResultChip } from "@/shared/components/ResultChip";
import { ResultCard, ResultLine } from "@/shared/components/ResultCard";
import { RESULT_CHIP_BUTTON } from "@/shared/components/buttonStyles";
import { metadata } from "./metadata";
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  PLAYER,
  BULLET,
  ALIEN,
  ALIEN_TYPES,
  MYSTERY_SHIP,
  SHIELD,
  COLORS,
  DIFFICULTY_SETTINGS,
  type Alien,
  type AlienType,
  type Difficulty,
} from "./lib/constants";
import { keyBelongsToTarget } from "@/shared/lib/keyboardTarget";
import { useCoarsePointer } from "@/shared/hooks/useCoarsePointer";
import { usePlayBox } from "@/shared/hooks/usePlayBox";
import { useGameLoop } from "@/shared/hooks/useGameLoop";
import { usePointerHold, type PointerHoldHandlers } from "@/shared/hooks/useTouchInput";
import { DEFAULT_RESTART_GRACE_MS, usePointerTap, useRestartGrace } from "@/shared/lib/input";
import { setGameSpeakerEnabled, wantGameAudio } from "@/shared/lib/audio";
import { playSound, releaseSounds, SPACE_INVADERS_AUDIO_ID } from "./lib/sounds";
import { useSpaceInvadersClips } from "./lib/useSpaceInvadersClips";
import {
  EDGE_PX,
  FIRE_BUTTON_PX,
  GUTTER_PX,
  HUD_ROW_PX,
  MOVE_BUTTON_PX,
  PAD_GAP_PX,
  spaceInvadersLayout,
} from "./lib/layout";

/** The pad buttons' accessible names (the voice and the tests use them). */
export const PAD_LABELS = { left: "Move left", right: "Move right", fire: "Fire" } as const;
/** The sound switch: the words say what the kid hears now. */
export const SOUND_LABELS = { on: "Sound on", off: "Sound off" } as const;
/** The one button of the wave-complete chip. */
export const NEXT_WAVE_LABEL = "Next wave";

/** The result chip's words at game over, read out loud first. */
export function gameOverText({ score, wave, best, newBest }: { score: number; wave: number; best: number; newBest: boolean }): string {
  const words = [`Game over! Your score is ${score}.`, `You got to wave ${wave}.`];
  if (newBest) words.push("That is a new best!");
  else if (best > 0) words.push(`Your best is ${best}.`);
  return words.join(" ");
}

/** The wave-complete chip's words, read out loud first. */
export function waveCompleteText({ wave, score }: { wave: number; score: number }): string {
  return `Wave ${wave} done! Your score is ${score}.`;
}

/** Auto-fire: the game time between two shots while FIRE is held, in ms. */
export const AUTO_FIRE_COOLDOWN_MS = 150;

// ============================================
// Touch pad (module scope)
// ============================================
// The pad lives at module scope on purpose. It used to be declared inside
// SpaceInvadersGame, so every parent render (the parent re-renders each
// frame) gave React a new component type and the buttons unmounted and
// remounted about 30 times a second: a held ◀ moved the cannon one step and
// a 1.5 s FIRE hold fired one bullet. The parent reads the held state from
// refs in its game loop, exactly like the keyboard.
const PAD_BUTTON_CLASSES =
  "flex flex-col items-center justify-center rounded-full font-bold leading-none text-white touch-none select-none [-webkit-touch-callout:none] shadow-md transition-transform";

function PadButton({
  hold,
  label,
  size,
  pressed,
  tone,
  children,
}: {
  hold: PointerHoldHandlers<HTMLButtonElement>;
  label: string;
  size: number;
  pressed: boolean;
  tone: { up: string; down: string };
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      {...hold}
      className={`${PAD_BUTTON_CLASSES} ${pressed ? `${tone.down} scale-95` : tone.up}`}
      style={{ width: size, height: size }}
    >
      {children}
    </button>
  );
}

type PadProps = {
  onLeft: (down: boolean) => void;
  onRight: (down: boolean) => void;
  onFire: (down: boolean) => void;
  /** The pad shows and takes taps only while a round plays. */
  active: boolean;
  /**
   * Which part to render. "row": both groups in one row under the canvas
   * (upright). "move" or "fire": that group alone in a gutter column
   * beside the canvas (sideways), with `under` below it.
   */
  part: "row" | "move" | "fire";
  /** What sits under the group in a gutter (the HUD, the sound switch). */
  under?: ReactNode;
  /** The width of the pad row when upright (the canvas width). */
  rowWidth?: number;
};

const GREEN = { up: "bg-green-600", down: "bg-green-700" };
const RED = { up: "bg-red-600", down: "bg-red-700" };

function SpaceInvadersPad({ onLeft, onRight, onFire, active, part, under, rowWidth }: PadProps) {
  const [leftPressed, setLeftPressed] = useState(false);
  const [rightPressed, setRightPressed] = useState(false);
  const [firePressed, setFirePressed] = useState(false);

  // Hold controls through the shared pointer hold: pointer capture, a
  // release on pointercancel, on window blur and on unmount. The old
  // buttons carried onTouchStart/onTouchEnd (with a no-op preventDefault
  // that logged an error on every tap) AND onMouseDown/Up/Leave.
  const leftHold = usePointerHold<HTMLButtonElement>(
    () => {
      setLeftPressed(true);
      onLeft(true);
    },
    () => {
      setLeftPressed(false);
      onLeft(false);
    }
  );
  const rightHold = usePointerHold<HTMLButtonElement>(
    () => {
      setRightPressed(true);
      onRight(true);
    },
    () => {
      setRightPressed(false);
      onRight(false);
    }
  );
  const fireHold = usePointerHold<HTMLButtonElement>(
    () => {
      setFirePressed(true);
      onFire(true);
    },
    () => {
      setFirePressed(false);
      onFire(false);
    }
  );

  // The groups keep their place on every screen, so the canvas never jumps
  // when a run ends; hidden and inert between rounds.
  const hidden = active ? "" : "invisible";
  const inertProps = active ? {} : ({ "aria-hidden": true, inert: true } as const);

  const moveGroup = (
    <div data-testid="space-invaders-pad-move" className={`flex items-center ${hidden}`} style={{ gap: PAD_GAP_PX }} {...inertProps}>
      <PadButton hold={leftHold} label={PAD_LABELS.left} size={MOVE_BUTTON_PX} pressed={leftPressed} tone={GREEN}>
        <svg className="h-10 w-10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="3" fill="none" />
        </svg>
      </PadButton>
      <PadButton hold={rightHold} label={PAD_LABELS.right} size={MOVE_BUTTON_PX} pressed={rightPressed} tone={GREEN}>
        <svg className="h-10 w-10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="3" fill="none" />
        </svg>
      </PadButton>
    </div>
  );
  const fireGroup = (
    <div data-testid="space-invaders-pad-fire" className={`flex items-center ${hidden}`} {...inertProps}>
      <PadButton hold={fireHold} label={PAD_LABELS.fire} size={FIRE_BUTTON_PX} pressed={firePressed} tone={RED}>
        <span className="text-xl">FIRE</span>
      </PadButton>
    </div>
  );

  if (part !== "row") {
    return (
      <div
        data-testid={`space-invaders-gutter-${part === "move" ? "left" : "right"}`}
        className="flex shrink-0 flex-col items-center justify-center gap-3"
        style={{ width: GUTTER_PX }}
      >
        {part === "move" ? moveGroup : fireGroup}
        {under}
      </div>
    );
  }
  return (
    <div
      data-testid="space-invaders-pad"
      className="flex w-full shrink-0 items-center justify-between select-none"
      style={{ height: FIRE_BUTTON_PX, maxWidth: rowWidth }}
    >
      {moveGroup}
      {fireGroup}
    </div>
  );
}

// ============================================
// Alien Sprites (Simple pixel art using canvas)
// ============================================
function drawAlien(
  ctx: CanvasRenderingContext2D,
  alien: Alien,
  frame: number
) {
  const { type, x, y } = alien;
  const color = frame === 0 ? ALIEN_TYPES[type].color : ALIEN_TYPES[type].colorAlt;
  const sizeMultiplier = alien.sizeMultiplier ?? 1;
  const alienWidth = alien.width ?? ALIEN.WIDTH * sizeMultiplier;
  const alienHeight = alien.height ?? ALIEN.HEIGHT * sizeMultiplier;

  ctx.fillStyle = color;

  // Simple pixel art aliens
  const size = 3 * sizeMultiplier;
  const patterns: Record<AlienType, number[][]> = {
    squid: frame === 0
      ? [
          [0, 0, 0, 1, 1, 0, 0, 0],
          [0, 0, 1, 1, 1, 1, 0, 0],
          [0, 1, 1, 1, 1, 1, 1, 0],
          [1, 1, 0, 1, 1, 0, 1, 1],
          [1, 1, 1, 1, 1, 1, 1, 1],
          [0, 0, 1, 0, 0, 1, 0, 0],
          [0, 1, 0, 1, 1, 0, 1, 0],
          [1, 0, 1, 0, 0, 1, 0, 1],
        ]
      : [
          [0, 0, 0, 1, 1, 0, 0, 0],
          [0, 0, 1, 1, 1, 1, 0, 0],
          [0, 1, 1, 1, 1, 1, 1, 0],
          [1, 1, 0, 1, 1, 0, 1, 1],
          [1, 1, 1, 1, 1, 1, 1, 1],
          [0, 1, 0, 1, 1, 0, 1, 0],
          [1, 0, 0, 0, 0, 0, 0, 1],
          [0, 1, 0, 0, 0, 0, 1, 0],
        ],
    crab: frame === 0
      ? [
          [0, 0, 1, 0, 0, 0, 1, 0, 0],
          [0, 0, 0, 1, 0, 1, 0, 0, 0],
          [0, 0, 1, 1, 1, 1, 1, 0, 0],
          [0, 1, 1, 0, 1, 0, 1, 1, 0],
          [1, 1, 1, 1, 1, 1, 1, 1, 1],
          [1, 0, 1, 1, 1, 1, 1, 0, 1],
          [1, 0, 1, 0, 0, 0, 1, 0, 1],
          [0, 0, 0, 1, 1, 1, 0, 0, 0],
        ]
      : [
          [0, 0, 1, 0, 0, 0, 1, 0, 0],
          [1, 0, 0, 1, 0, 1, 0, 0, 1],
          [1, 0, 1, 1, 1, 1, 1, 0, 1],
          [1, 1, 1, 0, 1, 0, 1, 1, 1],
          [1, 1, 1, 1, 1, 1, 1, 1, 1],
          [0, 1, 1, 1, 1, 1, 1, 1, 0],
          [0, 0, 1, 0, 0, 0, 1, 0, 0],
          [0, 1, 0, 0, 0, 0, 0, 1, 0],
        ],
    octopus: frame === 0
      ? [
          [0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0],
          [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
          [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          [1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 1],
          [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          [0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0],
          [0, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 0],
          [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
        ]
      : [
          [0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0],
          [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
          [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          [1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 1],
          [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          [0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0],
          [0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0],
          [0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0],
        ],
  };

  const pattern = patterns[type];
  const offsetX = x + (alienWidth - pattern[0].length * size) / 2;
  const offsetY = y + (alienHeight - pattern.length * size) / 2;

  for (let row = 0; row < pattern.length; row++) {
    for (let col = 0; col < pattern[row].length; col++) {
      if (pattern[row][col] === 1) {
        ctx.fillRect(offsetX + col * size, offsetY + row * size, size, size);
      }
    }
  }
}

// ============================================
// Main Game Component
// ============================================
export function SpaceInvadersGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const keysRef = useRef<Set<string>>(new Set());
  /** Game time since the last march sound, and the march step (0 to 3). */
  const marchRef = useRef({ sinceMs: 0, step: 0 });
  const isCoarse = useCoarsePointer();

  // Auto-fire: game time since the last shot while FIRE (or the key) is held.
  const fireHeldRef = useRef(false);
  const sinceShotRef = useRef(AUTO_FIRE_COOLDOWN_MS);
  // The pad's ◀ ▶ held state, read by the game loop like keysRef.
  const touchHeldRef = useRef({ left: false, right: false });

  const store = useSpaceInvadersStore();
  const {
    gameState,
    score,
    lives,
    wave,
    playerX,
    aliens,
    alienAnimationFrame,
    playerBullets,
    alienBullets,
    mysteryShip,
    shields,
    explosions,
    playerInvincible,
    progress,
    startGame,
    resumeGame,
    shoot,
    nextWave,
  } = store;

  // The canvas fits the play box on both axes (layout.ts): upright the pad
  // sits under it, sideways the pad sits in the gutters beside it. The box
  // is fitted: it never scrolls, and a touch on it goes to the game.
  const box = usePlayBox({ fit: true });
  const { canvas: fit, sideways } = spaceInvadersLayout(box);

  // Gameplay clips: the canvas, the run phases and the new-best moment.
  useSpaceInvadersClips(canvasRef, {
    gameState,
    score,
    highScore: store.runStartBest,
    runId: store.runId,
  });

  // Sound: the first tap starts the shared game-audio bus, the sound switch
  // is this game's speaker (also after the saved setting loads), and the
  // game's channel leaves the bus when the game unmounts.
  useEffect(() => wantGameAudio(), []);
  const soundEnabled = progress.settings.soundEnabled;
  useEffect(() => {
    setGameSpeakerEnabled(SPACE_INVADERS_AUDIO_ID, soundEnabled);
  }, [soundEnabled]);
  useEffect(() => () => releaseSounds(), []);

  // Sync with auth system
  const { forceSync } = useAuthSync({
    appId: "space-invaders",
    localStorageKey: "space-invaders-progress",
    getState: () => store.getProgress(),
    setState: (data: SpaceInvadersProgress) => store.setProgress(data),
    debounceMs: 3000,
  });

  // Force save immediately on game over
  useEffect(() => {
    if (gameState === "gameOver") {
      forceSync();
    }
  }, [gameState, forceSync]);

  // The wave-clear fanfare plays when the wave is done (not when the kid taps Next wave).
  useEffect(() => {
    if (gameState === "waveComplete") playSound("waveClear");
  }, [gameState]);

  // ============================================
  // Drawing Functions
  // ============================================
  const drawPlayer = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      // Flash when invincible
      if (playerInvincible && Math.floor(Date.now() / 100) % 2 === 0) {
        return; // Skip drawing for flash effect
      }

      ctx.fillStyle = PLAYER.COLOR;

      // Cannon body
      ctx.fillRect(playerX, PLAYER.Y + 10, PLAYER.WIDTH, PLAYER.HEIGHT - 10);

      // Cannon barrel
      ctx.fillRect(
        playerX + PLAYER.WIDTH / 2 - 3,
        PLAYER.Y,
        6,
        15
      );

      // Cannon tip
      ctx.fillRect(
        playerX + PLAYER.WIDTH / 2 - 2,
        PLAYER.Y - 3,
        4,
        5
      );
    },
    [playerX, playerInvincible]
  );

  const drawAliens = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      for (const alien of aliens) {
        if (!alien.alive) continue;
        drawAlien(ctx, alien, alienAnimationFrame);
      }
    },
    [aliens, alienAnimationFrame]
  );

  const drawBullets = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      // Player bullets
      ctx.fillStyle = BULLET.PLAYER_COLOR;
      for (const bullet of playerBullets) {
        ctx.fillRect(bullet.x, bullet.y, BULLET.WIDTH, BULLET.HEIGHT);
      }

      // Alien bullets (zigzag shape)
      ctx.fillStyle = BULLET.ALIEN_COLOR;
      for (const bullet of alienBullets) {
        const zigzag = Math.floor(bullet.y / 10) % 2 === 0;
        ctx.fillRect(
          bullet.x + (zigzag ? 0 : 2),
          bullet.y,
          BULLET.WIDTH,
          BULLET.HEIGHT / 3
        );
        ctx.fillRect(
          bullet.x + (zigzag ? 2 : 0),
          bullet.y + BULLET.HEIGHT / 3,
          BULLET.WIDTH,
          BULLET.HEIGHT / 3
        );
        ctx.fillRect(
          bullet.x + (zigzag ? 0 : 2),
          bullet.y + (2 * BULLET.HEIGHT) / 3,
          BULLET.WIDTH,
          BULLET.HEIGHT / 3
        );
      }
    },
    [playerBullets, alienBullets]
  );

  const drawMysteryShip = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      if (!mysteryShip?.active) return;

      ctx.fillStyle = MYSTERY_SHIP.COLOR;

      // UFO shape
      const x = mysteryShip.x;
      const y = MYSTERY_SHIP.Y;

      // Dome
      ctx.beginPath();
      ctx.arc(
        x + MYSTERY_SHIP.WIDTH / 2,
        y + 8,
        12,
        Math.PI,
        0
      );
      ctx.fill();

      // Body
      ctx.fillRect(x + 5, y + 8, MYSTERY_SHIP.WIDTH - 10, 8);

      // Bottom
      ctx.fillRect(x + 10, y + 16, MYSTERY_SHIP.WIDTH - 20, 4);

      // Lights
      ctx.fillStyle = "#fbbf24";
      ctx.fillRect(x + 12, y + 10, 3, 3);
      ctx.fillRect(x + 20, y + 10, 3, 3);
      ctx.fillRect(x + 28, y + 10, 3, 3);
      ctx.fillRect(x + 36, y + 10, 3, 3);
    },
    [mysteryShip]
  );

  const drawShields = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = SHIELD.COLOR;
      for (const shield of shields) {
        for (const block of shield) {
          if (block.active) {
            ctx.fillRect(block.x, block.y, SHIELD.BLOCK_SIZE, SHIELD.BLOCK_SIZE);
          }
        }
      }
    },
    [shields]
  );

  const drawExplosions = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      for (const explosion of explosions) {
        const progress = explosion.frame / explosion.maxFrames;
        const radius = 10 + progress * 20;
        const alpha = 1 - progress;

        ctx.fillStyle = `rgba(251, 191, 36, ${alpha})`; // Yellow/orange
        ctx.beginPath();
        ctx.arc(explosion.x, explosion.y, radius * 0.6, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(239, 68, 68, ${alpha * 0.7})`; // Red
        ctx.beginPath();
        ctx.arc(explosion.x, explosion.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    [explosions]
  );

  const drawReadyScreen = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      // Ready state: the DOM start overlay owns all start UI (title, hints,
      // age picker, start button). The canvas draws only the decorative
      // sample aliens as a friendly backdrop — no text.
      const sampleAliens: Alien[] = [
        { id: 1, type: "squid", x: CANVAS_WIDTH / 2 - 80, y: 280, alive: true, animationFrame: 0 },
        { id: 2, type: "crab", x: CANVAS_WIDTH / 2 - 15, y: 280, alive: true, animationFrame: 0 },
        { id: 3, type: "octopus", x: CANVAS_WIDTH / 2 + 50, y: 280, alive: true, animationFrame: 0 },
      ];
      for (const alien of sampleAliens) {
        drawAlien(ctx, alien, Math.floor(Date.now() / 500) % 2);
      }
    },
    []
  );

  const drawPausedScreen = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      ctx.fillStyle = COLORS.TEXT;
      ctx.font = "bold 36px monospace";
      ctx.textAlign = "center";
      ctx.fillText("PAUSED", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
    },
    []
  );

  // Game over and the wave card only dim the field: the words are a
  // ResultCard over the canvas (canvas text sat under the result chip, and
  // was 6 px on a phone before the layout fit the box).
  const drawGameOverScreen = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }, []);

  const drawWaveCompleteScreen = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }, []);

  // ============================================
  // Main Render Function
  // ============================================
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;

    // Clear screen
    ctx.fillStyle = COLORS.BACKGROUND;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    if (gameState === "ready") {
      drawReadyScreen(ctx);
      return;
    }

    // Draw game elements. The score, the best, the lives and the wave are
    // DOM text above the canvas (or beside it), readable at any scale.
    drawShields(ctx);
    drawPlayer(ctx);
    drawAliens(ctx);
    drawBullets(ctx);
    drawMysteryShip(ctx);
    drawExplosions(ctx);

    // Draw overlay screens
    if (gameState === "paused") {
      drawPausedScreen(ctx);
    } else if (gameState === "gameOver") {
      drawGameOverScreen(ctx);
    } else if (gameState === "waveComplete") {
      drawWaveCompleteScreen(ctx);
    }
  }, [
    gameState,
    drawReadyScreen,
    drawShields,
    drawPlayer,
    drawAliens,
    drawBullets,
    drawMysteryShip,
    drawExplosions,
    drawPausedScreen,
    drawGameOverScreen,
    drawWaveCompleteScreen,
  ]);

  // ============================================
  // Game Loop
  // ============================================
  // One fixed step of game time: the held input (keys or the pad) moves the
  // cannon, FIRE auto-fires on a game-time cooldown, the store moves the
  // world, and the march sound keeps its beat in game time. The shared
  // loop runs 60 steps a second on any screen; before, the store's
  // per-frame update ran once per screen frame (double speed at 120 Hz)
  // and the loop effect restarted on every store change.
  const playing = gameState === "playing";
  const step = useCallback(
    (stepMs: number) => {
      const state = useSpaceInvadersStore.getState();
      if (state.gameState !== "playing") return;

      if (keysRef.current.has("ArrowLeft") || keysRef.current.has("KeyA") || touchHeldRef.current.left) {
        state.movePlayer(-1);
      }
      if (keysRef.current.has("ArrowRight") || keysRef.current.has("KeyD") || touchHeldRef.current.right) {
        state.movePlayer(1);
      }

      // Auto-fire while FIRE is held: one shot each AUTO_FIRE_COOLDOWN_MS of game time.
      sinceShotRef.current += stepMs;
      if (fireHeldRef.current && sinceShotRef.current >= AUTO_FIRE_COOLDOWN_MS) {
        state.shoot();
        playSound("shoot");
        sinceShotRef.current = 0;
      }

      state.update();

      // The march sound: faster as the aliens fall (scaled by difficulty).
      const after = useSpaceInvadersStore.getState();
      const aliveAliens = after.aliens.filter((a) => a.alive).length;
      const totalAliens = after.aliens.length || 55;
      const percentKilled = (totalAliens - aliveAliens) / totalAliens;
      const baseInterval = 800 - percentKilled * 700; // 800 ms at the start, 100 ms at the end
      const diffSettings = DIFFICULTY_SETTINGS[after.progress.settings.difficulty];
      const marchInterval = Math.max(100, baseInterval / diffSettings.enemySpeedMultiplier);
      marchRef.current.sinceMs += stepMs;
      if (marchRef.current.sinceMs >= marchInterval && aliveAliens > 0) {
        playSound("march", marchRef.current.step);
        marchRef.current.step = (marchRef.current.step + 1) % 4;
        marchRef.current.sinceMs = 0;
      }
    },
    []
  );
  useGameLoop({ update: step, render }, { running: true, paused: !playing });

  // Between rounds the picture changes only with the state (a card, a
  // pause): draw it in the same commit, so the card is on the canvas
  // before the next frame, also where frames are throttled.
  useEffect(() => {
    if (!playing) render();
  }, [render, playing]);

  // A held input lets go when the round stops: the next round never starts
  // with the cannon moving or firing on its own.
  useEffect(() => {
    if (playing) return;
    fireHeldRef.current = false;
    touchHeldRef.current.left = false;
    touchHeldRef.current.right = false;
    keysRef.current.clear();
  }, [playing]);

  // ============================================
  // Input Handling
  // ============================================
  // Play again and Next wave wait out a short grace after the card appears,
  // and a held key's repeats never count: a kid who is still firing when
  // the round ends sees the card first.
  const grace = useRestartGrace(DEFAULT_RESTART_GRACE_MS, gameState);

  const handleShoot = useCallback(() => {
    if (useSpaceInvadersStore.getState().gameState !== "playing") return;
    shoot();
    playSound("shoot");
    sinceShotRef.current = 0;
  }, [shoot]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // A focused button or link owns its own Space and Enter: never swallow them.
      if (keyBelongsToTarget(e)) return;
      // The start card owns the ready state: keys must not act or block the
      // browser's own Space/Enter handling while it is up.
      if (gameState === "ready") return;

      if (gameState === "gameOver") {
        if (e.code === "Space") {
          e.preventDefault();
          if (grace.accept(e)) startGame();
        }
        return;
      }
      if (gameState === "waveComplete") {
        if (e.code === "Space") {
          e.preventDefault();
          if (grace.accept(e)) nextWave();
        }
        return;
      }
      // Pause is owned by the GameShell (it binds ESC and shows the pause
      // button). Handling P/ESC here too is exactly what desynced the shell's
      // pause menu from the game's own paused state.
      if (gameState === "paused") return;

      keysRef.current.add(e.code);

      if (e.code === "Space" || e.code === "KeyW" || e.code === "ArrowUp") {
        e.preventDefault();
        // Fire at once, then the loop auto-fires while the key is held.
        if (!fireHeldRef.current) {
          fireHeldRef.current = true;
          handleShoot();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.code);
      if (e.code === "Space" || e.code === "KeyW" || e.code === "ArrowUp") {
        fireHeldRef.current = false;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [gameState, grace, handleShoot, nextWave, startGame]);

  // The touch pad writes the same refs the keyboard writes; the game loop
  // moves and auto-fires from them every step.
  const pressLeft = useCallback((down: boolean) => {
    touchHeldRef.current.left = down;
  }, []);
  const pressRight = useCallback((down: boolean) => {
    touchHeldRef.current.right = down;
  }, []);
  const pressFire = useCallback(
    (down: boolean) => {
      if (down) {
        if (fireHeldRef.current) return;
        // Fire at once, then the loop auto-fires while held.
        fireHeldRef.current = true;
        handleShoot();
      } else {
        fireHeldRef.current = false;
      }
    },
    [handleShoot]
  );

  // One tap on the canvas = one action: a mouse click shoots in play, and a
  // tap resumes the game's own pause. Game over and wave complete go on
  // only from the result chip (or Space): a tap meant for FIRE at the
  // moment the round ended must not skip the card.
  const canvasTap = usePointerTap<HTMLCanvasElement>((e) => {
    const state = useSpaceInvadersStore.getState().gameState;
    if (state === "paused") {
      resumeGame();
      return;
    }
    if (state === "playing" && !("pointerType" in e && e.pointerType === "touch")) handleShoot();
  });

  const toggleSound = () => store.setSoundEnabled(!soundEnabled);
  const soundLabel = soundEnabled ? SOUND_LABELS.on : SOUND_LABELS.off;

  const soundButton = (
    <button
      type="button"
      data-testid="space-invaders-sound"
      aria-label={soundLabel}
      onClick={toggleSound}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gray-800 text-xl text-white hover:bg-gray-700 touch-manipulation"
    >
      <span aria-hidden="true">{soundEnabled ? "🔊" : "🔇"}</span>
    </button>
  );

  // The HUD is DOM text: the canvas HUD was 5.7 px on a phone. One line
  // upright (it never wraps, so the canvas never moves when a number
  // grows); short lines in the gutter sideways.
  const hud = (
    <div
      data-testid="space-invaders-hud"
      className={
        sideways
          ? "flex max-w-full flex-col items-center gap-0.5 overflow-hidden whitespace-nowrap text-center font-mono text-xs font-bold text-green-400"
          : "flex max-w-full items-center gap-3 overflow-hidden whitespace-nowrap font-mono text-sm font-bold text-green-400 sm:gap-4"
      }
    >
      <span>SCORE {score}</span>
      <span>BEST {progress.highScore}</span>
      <span aria-label={`${lives} lives`}>{lives > 0 ? "♥".repeat(Math.min(lives, 5)) : "♡"}</span>
      <span>WAVE {wave}</span>
    </div>
  );

  const canvasBox = (
    <div className="relative shrink-0" style={{ width: fit.width, height: fit.height }}>
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        {...canvasTap}
        className="rounded-lg border-2 border-green-800 shadow-2xl touch-manipulation"
        style={{ width: fit.width, height: fit.height }}
      />

      {gameState === "gameOver" && (
        <ResultCard testId="space-invaders-result-card" title="Game over!">
          <ResultLine big>Score {score}</ResultLine>
          <ResultLine>
            Wave {wave} ·{" "}
            {score > store.runStartBest && score > 0 ? "🏆 New best!" : `Best ${progress.highScore}`}
          </ResultLine>
        </ResultCard>
      )}
      {gameState === "waveComplete" && (
        <ResultCard testId="space-invaders-result-card" title={`Wave ${wave} done!`}>
          <ResultLine big>Score {score}</ResultLine>
        </ResultCard>
      )}

      {/* DOM start overlay: title, hints, age picker, and start button.
          Replaces the in-canvas ready text and the old below-canvas picker. */}
      {gameState === "ready" && (
        <GameStartOverlay
          title="Space Invaders"
          emoji={metadata.emoji}
          touchHints={["Hold ◀ ▶ to move", "Hold FIRE to shoot"]}
          keyboardHints={[
            "A/D or Arrows to move",
            "SPACE or W to shoot (hold to auto-fire)",
            "ESC to pause",
          ]}
          showStartButton={false}
          spokenChoices={`Tap how old you are and the game starts: ${(
            Object.keys(DIFFICULTY_SETTINGS) as Difficulty[]
          )
            .map((diff) => DIFFICULTY_SETTINGS[diff].label)
            .join(", ")}.`}
          onStart={startGame}
        >
          {progress.highScore > 0 && (
            <div className="text-sm font-semibold text-amber-700">
              🏆 High Score: {progress.highScore}
            </div>
          )}
          {/* Tap an age = start at that difficulty (same one-tap model as
              blitz-bomber/platformer). A separate Start button pushed the
              CTA below the overlay's scroll clip at common viewports while
              these look-alike buttons only selected — a kid tapped an age
              and nothing happened. Two columns keep all five on-screen. */}
          <p className="text-sm font-semibold opacity-80">
            How old are you? Tap to play!
          </p>
          <div className="grid grid-cols-2 gap-3">
            {(Object.keys(DIFFICULTY_SETTINGS) as Difficulty[]).map(
              (diff, index, all) => {
                const settings = DIFFICULTY_SETTINGS[diff];
                const isSelected = progress.settings.difficulty === diff;
                return (
                  <GameStartOverlayButton
                    key={diff}
                    onClick={() => {
                      store.setDifficulty(diff);
                      startGame();
                    }}
                    className={`${isSelected ? "btn-primary" : ""} ${
                      index === all.length - 1 ? "col-span-2" : ""
                    }`}
                  >
                    {settings.emoji} {settings.label}
                  </GameStartOverlayButton>
                );
              }
            )}
          </div>
        </GameStartOverlay>
      )}
    </div>
  );

  // The pad shows on a touch screen (never behind a width breakpoint: a
  // phone held sideways is 844 px wide and has no keyboard). A mouse has
  // the keys, and the click on the canvas.
  const padProps = { onLeft: pressLeft, onRight: pressRight, onFire: pressFire, active: playing };

  // A mouse: the in-play key reminder, keyed on the pointer, never on a
  // width breakpoint. Short lines, so it also fits the gutter column.
  const keyReminder =
    !isCoarse && gameState !== "ready" ? (
      <div data-testid="space-invaders-key-reminder" className="text-center text-xs leading-snug text-gray-500">
        <p>A/D or Arrows to move</p>
        <p>SPACE or W to shoot (hold to auto-fire)</p>
        <p>ESC to pause</p>
      </div>
    ) : null;

  return (
    <div
      data-testid="space-invaders-root"
      data-layout={sideways ? "sideways" : "upright"}
      className="h-full w-full select-none bg-black"
    >
      {sideways ? (
        // Sideways: the pad in the gutters, the canvas full height between them.
        <div className="flex h-full w-full items-center justify-center" style={{ padding: EDGE_PX, gap: PAD_GAP_PX }}>
          {isCoarse ? (
            <SpaceInvadersPad {...padProps} part="move" under={hud} />
          ) : (
            <div className="flex shrink-0 flex-col items-center justify-center gap-3" style={{ width: GUTTER_PX }}>
              {hud}
              {soundButton}
              {keyReminder}
            </div>
          )}
          {canvasBox}
          {isCoarse ? (
            <SpaceInvadersPad {...padProps} part="fire" under={soundButton} />
          ) : (
            // A mouse: the left gutter holds the HUD; this one keeps the canvas centred.
            <div className="shrink-0" style={{ width: GUTTER_PX }} aria-hidden="true" />
          )}
        </div>
      ) : (
        // Upright: the HUD line, the canvas, then the pad in one row.
        <div className="flex h-full w-full flex-col items-center" style={{ padding: EDGE_PX, gap: PAD_GAP_PX }}>
          <div className="flex w-full shrink-0 items-center justify-center gap-3" style={{ height: HUD_ROW_PX }}>
            {hud}
            {soundButton}
          </div>
          {canvasBox}
          {isCoarse && <SpaceInvadersPad {...padProps} part="row" rowWidth={fit.width} />}
          {keyReminder}
        </div>
      )}

      <IOSInstallPrompt />

      {/* The result chip under the game-over card: read it to me, Play
          again, the leaderboard, and with clips on the clip buttons.
          Mounted only at game over, so its grace starts then. */}
      {gameState === "gameOver" && (
        <ResultChip
          resultText={gameOverText({
            score,
            wave,
            best: progress.highScore,
            newBest: score > store.runStartBest && score > 0,
          })}
          appId="space-invaders"
          onRestart={startGame}
          keyboardHint="Space"
        />
      )}

      {/* The wave-complete chip: read it to me, then Next wave. */}
      {gameState === "waveComplete" && (
        <ResultChip resultText={waveCompleteText({ wave, score })} spokenExtras={[NEXT_WAVE_LABEL]}>
          <button
            type="button"
            data-testid="space-invaders-next-wave"
            // The chip holds every button in its bar through the grace.
            onClick={() => nextWave()}
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

export default SpaceInvadersGame;
