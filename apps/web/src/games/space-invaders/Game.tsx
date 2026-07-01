"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useSpaceInvadersStore, type SpaceInvadersProgress } from "./lib/store";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { FullscreenButton } from "@/shared/components/FullscreenButton";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
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
  UI,
  DIFFICULTY_SETTINGS,
  type Alien,
  type AlienType,
  type Difficulty,
} from "./lib/constants";

// ============================================
// Sound Manager
// ============================================
class SoundManager {
  private audioContext: AudioContext | null = null;
  private enabled: boolean = true;

  constructor() {
    if (typeof window !== "undefined") {
      this.audioContext = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  private createOscillator(
    frequency: number,
    duration: number,
    type: OscillatorType = "square"
  ) {
    if (!this.audioContext || !this.enabled) return;

    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);

    gainNode.gain.setValueAtTime(0.1, this.audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(
      0.01,
      this.audioContext.currentTime + duration
    );

    oscillator.start();
    oscillator.stop(this.audioContext.currentTime + duration);
  }

  playShoot() {
    this.createOscillator(880, 0.1, "square");
  }

  playExplosion() {
    if (!this.audioContext || !this.enabled) return;
    // Noise-like explosion
    const duration = 0.15;
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        this.createOscillator(100 + Math.random() * 200, 0.05, "sawtooth");
      }, i * 30);
    }
  }

  playPlayerDeath() {
    if (!this.audioContext || !this.enabled) return;
    // Descending tone
    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);
    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(400, this.audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      50,
      this.audioContext.currentTime + 0.5
    );
    gainNode.gain.setValueAtTime(0.15, this.audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(
      0.01,
      this.audioContext.currentTime + 0.5
    );
    oscillator.start();
    oscillator.stop(this.audioContext.currentTime + 0.5);
  }

  playMystery() {
    this.createOscillator(330, 0.2, "sine");
    setTimeout(() => this.createOscillator(440, 0.2, "sine"), 100);
  }

  playMarch(step: number) {
    const frequencies = [100, 90, 80, 70];
    this.createOscillator(frequencies[step % 4], 0.08, "square");
  }

  playWaveClear() {
    if (!this.audioContext || !this.enabled) return;
    // Ascending arpeggio
    [440, 554, 659, 880].forEach((freq, i) => {
      setTimeout(() => this.createOscillator(freq, 0.15, "square"), i * 100);
    });
  }
}

const soundManager = new SoundManager();

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
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const lastTimeRef = useRef<number>(0);
  const keysRef = useRef<Set<string>>(new Set());
  const lastMarchRef = useRef<number>(0);
  const marchStepRef = useRef<number>(0);
  const [scale, setScale] = useState(1);

  // Auto-fire support
  const fireHeldRef = useRef(false);
  const lastAutoFireRef = useRef<number>(0);
  const AUTO_FIRE_COOLDOWN = 150; // ms between auto-fire shots

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
    pauseGame,
    resumeGame,
    reset,
    movePlayer,
    shoot,
    update,
    nextWave,
  } = store;

  // Sync with auth system
  const { isAuthenticated, syncStatus, forceSync } = useAuthSync({
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

  // Update sound manager
  useEffect(() => {
    soundManager.setEnabled(progress.settings.soundEnabled);
  }, [progress.settings.soundEnabled]);

  // Responsive scaling
  useEffect(() => {
    const updateScale = () => {
      if (!containerRef.current) return;
      const containerWidth = containerRef.current.clientWidth;
      const containerHeight = containerRef.current.clientHeight - 100; // Account for controls
      const scaleX = containerWidth / CANVAS_WIDTH;
      const scaleY = containerHeight / CANVAS_HEIGHT;
      setScale(Math.min(scaleX, scaleY, 1.5)); // Cap at 1.5x
    };

    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

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

  const drawHUD = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = COLORS.HUD;
      ctx.font = UI.SMALL_FONT;
      ctx.textAlign = "left";

      // Score
      ctx.fillText(`SCORE: ${score}`, 10, 25);

      // High score
      ctx.textAlign = "center";
      ctx.fillText(`HI: ${progress.highScore}`, CANVAS_WIDTH / 2, 25);

      // Lives
      ctx.textAlign = "right";
      ctx.fillText(`LIVES: ${lives}`, CANVAS_WIDTH - 10, 25);

      // Wave
      ctx.textAlign = "center";
      ctx.font = "12px monospace";
      ctx.fillText(`WAVE ${wave}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT - 10);
    },
    [score, lives, wave, progress.highScore]
  );

  const drawReadyScreen = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      // Title
      ctx.fillStyle = COLORS.TEXT;
      ctx.font = "bold 36px monospace";
      ctx.textAlign = "center";
      ctx.fillText("SPACE", CANVAS_WIDTH / 2, 180);
      ctx.fillText("INVADERS", CANVAS_WIDTH / 2, 230);

      // Instructions
      ctx.font = UI.SMALL_FONT;
      ctx.fillText("TAP TO START", CANVAS_WIDTH / 2, 350);

      // Desktop controls
      ctx.font = "12px monospace";
      ctx.fillStyle = "#888";
      ctx.fillText("Desktop: A/D or Arrows to move", CANVAS_WIDTH / 2, 420);
      ctx.fillText("SPACE to shoot, P to pause", CANVAS_WIDTH / 2, 440);

      // High score
      if (progress.highScore > 0) {
        ctx.fillStyle = COLORS.HUD;
        ctx.font = UI.SMALL_FONT;
        ctx.fillText(`HIGH SCORE: ${progress.highScore}`, CANVAS_WIDTH / 2, 500);
      }

      // Draw sample aliens
      const sampleAliens: Alien[] = [
        { id: 1, type: "squid", x: CANVAS_WIDTH / 2 - 80, y: 280, alive: true, animationFrame: 0 },
        { id: 2, type: "crab", x: CANVAS_WIDTH / 2 - 15, y: 280, alive: true, animationFrame: 0 },
        { id: 3, type: "octopus", x: CANVAS_WIDTH / 2 + 50, y: 280, alive: true, animationFrame: 0 },
      ];
      for (const alien of sampleAliens) {
        drawAlien(ctx, alien, Math.floor(Date.now() / 500) % 2);
      }

      // Point values
      ctx.font = "10px monospace";
      ctx.fillStyle = COLORS.TEXT;
      ctx.fillText("=30", CANVAS_WIDTH / 2 - 60, 310);
      ctx.fillText("=20", CANVAS_WIDTH / 2 + 5, 310);
      ctx.fillText("=10", CANVAS_WIDTH / 2 + 70, 310);
    },
    [progress.highScore]
  );

  const drawPausedScreen = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      ctx.fillStyle = COLORS.TEXT;
      ctx.font = "bold 36px monospace";
      ctx.textAlign = "center";
      ctx.fillText("PAUSED", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);

      ctx.font = UI.SMALL_FONT;
      ctx.fillText("Tap to Resume", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 50);
    },
    []
  );

  const drawGameOverScreen = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      ctx.fillStyle = COLORS.GAME_OVER;
      ctx.font = "bold 36px monospace";
      ctx.textAlign = "center";
      ctx.fillText("GAME OVER", CANVAS_WIDTH / 2, 200);

      ctx.fillStyle = COLORS.TEXT;
      ctx.font = UI.SMALL_FONT;
      ctx.fillText(`SCORE: ${score}`, CANVAS_WIDTH / 2, 280);
      ctx.fillText(`WAVE: ${wave}`, CANVAS_WIDTH / 2, 320);

      if (score >= progress.highScore && score > 0) {
        ctx.fillStyle = "#fbbf24";
        ctx.fillText("NEW HIGH SCORE!", CANVAS_WIDTH / 2, 380);
      }

      ctx.fillStyle = COLORS.TEXT;
      ctx.fillText("TAP TO PLAY AGAIN", CANVAS_WIDTH / 2, 450);
    },
    [score, wave, progress.highScore]
  );

  const drawWaveCompleteScreen = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      ctx.fillStyle = "#22c55e";
      ctx.font = "bold 36px monospace";
      ctx.textAlign = "center";
      ctx.fillText("WAVE COMPLETE!", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 30);

      ctx.fillStyle = COLORS.TEXT;
      ctx.font = UI.SMALL_FONT;
      ctx.fillText(`WAVE ${wave} CLEARED`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 20);
      ctx.fillText("TAP FOR NEXT WAVE", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 70);
    },
    [wave]
  );

  // ============================================
  // Main Render Function
  // ============================================
  const render = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      // Clear screen
      ctx.fillStyle = COLORS.BACKGROUND;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      if (gameState === "ready") {
        drawReadyScreen(ctx);
        return;
      }

      // Draw game elements
      drawShields(ctx);
      drawPlayer(ctx);
      drawAliens(ctx);
      drawBullets(ctx);
      drawMysteryShip(ctx);
      drawExplosions(ctx);
      drawHUD(ctx);

      // Draw overlay screens
      if (gameState === "paused") {
        drawPausedScreen(ctx);
      } else if (gameState === "gameOver") {
        drawGameOverScreen(ctx);
      } else if (gameState === "waveComplete") {
        drawWaveCompleteScreen(ctx);
      }
    },
    [
      gameState,
      drawReadyScreen,
      drawShields,
      drawPlayer,
      drawAliens,
      drawBullets,
      drawMysteryShip,
      drawExplosions,
      drawHUD,
      drawPausedScreen,
      drawGameOverScreen,
      drawWaveCompleteScreen,
    ]
  );

  // ============================================
  // Game Loop
  // ============================================
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const gameLoop = (time: number) => {
      if (lastTimeRef.current === 0) {
        lastTimeRef.current = time;
        render(ctx);
        animationFrameRef.current = requestAnimationFrame(gameLoop);
        return;
      }

      const delta = time - lastTimeRef.current;
      lastTimeRef.current = time;

      // Handle keyboard input for continuous movement
      if (gameState === "playing") {
        if (keysRef.current.has("ArrowLeft") || keysRef.current.has("KeyA")) {
          movePlayer(-1);
        }
        if (keysRef.current.has("ArrowRight") || keysRef.current.has("KeyD")) {
          movePlayer(1);
        }

        // Auto-fire when fire key is held
        if (fireHeldRef.current) {
          const now = Date.now();
          if (now - lastAutoFireRef.current >= AUTO_FIRE_COOLDOWN) {
            shoot();
            soundManager.playShoot();
            lastAutoFireRef.current = now;
          }
        }

        // Update game state
        update(delta);

        // Play march sound based on alien movement (scaled by difficulty)
        const aliveAliens = aliens.filter((a) => a.alive).length;
        const totalAliens = aliens.length || 55;
        const percentKilled = (totalAliens - aliveAliens) / totalAliens;
        const baseInterval = 800 - percentKilled * 700; // 800ms at start, 100ms at end
        const diffSettings = DIFFICULTY_SETTINGS[progress.settings.difficulty];
        const marchInterval = Math.max(100, baseInterval / diffSettings.enemySpeedMultiplier);
        if (time - lastMarchRef.current >= marchInterval && aliveAliens > 0) {
          soundManager.playMarch(marchStepRef.current);
          marchStepRef.current = (marchStepRef.current + 1) % 4;
          lastMarchRef.current = time;
        }
      }

      render(ctx);
      animationFrameRef.current = requestAnimationFrame(gameLoop);
    };

    animationFrameRef.current = requestAnimationFrame(gameLoop);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      lastTimeRef.current = 0;
    };
  }, [gameState, update, render, movePlayer, aliens]);

  // ============================================
  // Input Handling
  // ============================================
  const handleInput = useCallback(() => {
    if (gameState === "ready") {
      startGame();
    } else if (gameState === "paused") {
      resumeGame();
    } else if (gameState === "gameOver") {
      reset();
    } else if (gameState === "waveComplete") {
      soundManager.playWaveClear();
      nextWave();
    }
  }, [gameState, startGame, resumeGame, reset, nextWave]);

  const handleShoot = useCallback(() => {
    if (gameState === "playing") {
      shoot();
      soundManager.playShoot();
    }
  }, [gameState, shoot]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keysRef.current.add(e.code);

      if (e.code === "Space" || e.code === "KeyW" || e.code === "ArrowUp") {
        e.preventDefault();
        if (gameState === "playing") {
          // Start auto-fire and fire immediately on first press
          if (!fireHeldRef.current) {
            fireHeldRef.current = true;
            handleShoot();
            lastAutoFireRef.current = Date.now();
          }
        } else if (e.code === "Space") {
          handleInput();
        }
      }

      if (e.code === "KeyP" || e.code === "Escape") {
        e.preventDefault();
        if (gameState === "playing") {
          pauseGame();
        } else if (gameState === "paused") {
          resumeGame();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.code);

      // Stop auto-fire when fire key is released
      if (e.code === "Space" || e.code === "KeyW" || e.code === "ArrowUp") {
        fireHeldRef.current = false;
        lastAutoFireRef.current = 0;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [gameState, handleInput, handleShoot, pauseGame, resumeGame]);

  // ============================================
  // Mobile Controls Component
  // ============================================
  const MobileControls = () => {
    const [leftPressed, setLeftPressed] = useState(false);
    const [rightPressed, setRightPressed] = useState(false);
    const [firePressed, setFirePressed] = useState(false);
    const leftIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const rightIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const fireIntervalRef = useRef<NodeJS.Timeout | null>(null);

    const startMoveLeft = useCallback(() => {
      if (gameState !== "playing") return;
      setLeftPressed(true);
      movePlayer(-1);
      leftIntervalRef.current = setInterval(() => movePlayer(-1), 50);
    }, []);

    const stopMoveLeft = useCallback(() => {
      setLeftPressed(false);
      if (leftIntervalRef.current) {
        clearInterval(leftIntervalRef.current);
        leftIntervalRef.current = null;
      }
    }, []);

    const startMoveRight = useCallback(() => {
      if (gameState !== "playing") return;
      setRightPressed(true);
      movePlayer(1);
      rightIntervalRef.current = setInterval(() => movePlayer(1), 50);
    }, []);

    const stopMoveRight = useCallback(() => {
      setRightPressed(false);
      if (rightIntervalRef.current) {
        clearInterval(rightIntervalRef.current);
        rightIntervalRef.current = null;
      }
    }, []);

    const startFire = useCallback(() => {
      if (gameState !== "playing") return;
      setFirePressed(true);
      handleShoot(); // Fire immediately
      fireIntervalRef.current = setInterval(() => {
        handleShoot();
      }, 150); // Auto-fire every 150ms
    }, []);

    const stopFire = useCallback(() => {
      setFirePressed(false);
      if (fireIntervalRef.current) {
        clearInterval(fireIntervalRef.current);
        fireIntervalRef.current = null;
      }
    }, []);

    useEffect(() => {
      return () => {
        if (leftIntervalRef.current) clearInterval(leftIntervalRef.current);
        if (rightIntervalRef.current) clearInterval(rightIntervalRef.current);
        if (fireIntervalRef.current) clearInterval(fireIntervalRef.current);
      };
    }, []);

    if (gameState !== "playing") return null;

    return (
      <div className="flex justify-between items-center w-full max-w-md mx-auto mt-4 px-4">
        {/* Left button */}
        <button
          className={`w-20 h-20 rounded-full flex items-center justify-center text-white text-3xl touch-manipulation transition-all ${
            leftPressed ? "bg-green-700 scale-95" : "bg-green-600"
          }`}
          onTouchStart={(e) => {
            e.preventDefault();
            startMoveLeft();
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            stopMoveLeft();
          }}
          onMouseDown={startMoveLeft}
          onMouseUp={stopMoveLeft}
          onMouseLeave={stopMoveLeft}
          aria-label="Move left"
        >
          <svg className="w-10 h-10" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="3" fill="none" />
          </svg>
        </button>

        {/* Fire button */}
        <button
          className={`w-24 h-24 rounded-full flex items-center justify-center text-white text-xl font-bold touch-manipulation transition-all shadow-lg ${
            firePressed ? "bg-red-700 scale-95" : "bg-red-600 hover:bg-red-500"
          }`}
          onTouchStart={(e) => {
            e.preventDefault();
            startFire();
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            stopFire();
          }}
          onTouchCancel={(e) => {
            e.preventDefault();
            stopFire();
          }}
          onMouseDown={startFire}
          onMouseUp={stopFire}
          onMouseLeave={stopFire}
          aria-label="Fire"
        >
          FIRE
        </button>

        {/* Right button */}
        <button
          className={`w-20 h-20 rounded-full flex items-center justify-center text-white text-3xl touch-manipulation transition-all ${
            rightPressed ? "bg-green-700 scale-95" : "bg-green-600"
          }`}
          onTouchStart={(e) => {
            e.preventDefault();
            startMoveRight();
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            stopMoveRight();
          }}
          onMouseDown={startMoveRight}
          onMouseUp={stopMoveRight}
          onMouseLeave={stopMoveRight}
          aria-label="Move right"
        >
          <svg className="w-10 h-10" viewBox="0 0 24 24" fill="currentColor">
            <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="3" fill="none" />
          </svg>
        </button>
      </div>
    );
  };

  // ============================================
  // Settings Panel
  // ============================================
  const SettingsPanel = () => {
    const [isOpen, setIsOpen] = useState(false);
    const { progress, setSoundEnabled, setDifficulty } = useSpaceInvadersStore();

    return (
      <div className="w-full max-w-md mx-auto mt-4">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full bg-gray-800 hover:bg-gray-700 text-white py-2 px-4 rounded-lg flex items-center justify-between"
        >
          <span>Settings</span>
          <span
            className="transform transition-transform"
            style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0)" }}
          >
            v
          </span>
        </button>

        {isOpen && (
          <div className="mt-2 bg-gray-800 rounded-lg p-4 space-y-4">
            {/* Sound toggle */}
            <div className="flex items-center justify-between">
              <label className="text-white font-bold">Sound</label>
              <button
                onClick={() => setSoundEnabled(!progress.settings.soundEnabled)}
                className={`w-14 h-8 rounded-full transition-all ${
                  progress.settings.soundEnabled ? "bg-green-600" : "bg-gray-600"
                }`}
              >
                <div
                  className={`w-6 h-6 bg-white rounded-full shadow transition-transform ${
                    progress.settings.soundEnabled ? "translate-x-7" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {/* Difficulty (only shown when not playing) */}
            {gameState === "ready" && (
              <div>
                <label className="text-white font-bold mb-2 block">Age/Difficulty</label>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(DIFFICULTY_SETTINGS) as Difficulty[]).map((diff) => {
                    const settings = DIFFICULTY_SETTINGS[diff];
                    return (
                      <button
                        key={diff}
                        onClick={() => setDifficulty(diff)}
                        className={`px-3 py-2 rounded-lg font-bold transition-all ${
                          progress.settings.difficulty === diff
                            ? `${settings.color} text-white`
                            : "bg-gray-600 text-gray-300 hover:bg-gray-500"
                        }`}
                      >
                        {settings.emoji} {diff}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ============================================
  // Stats Display
  // ============================================
  const StatsDisplay = () => (
    <div className="w-full max-w-md mx-auto mt-4 bg-gray-800 rounded-lg p-4 text-white">
      <h3 className="font-bold text-lg mb-3 text-center">Your Stats</h3>
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div className="bg-gray-700 p-2 rounded text-center">
          <div className="text-gray-400 text-xs">Games</div>
          <div className="text-lg font-bold">{progress.gamesPlayed}</div>
        </div>
        <div className="bg-gray-700 p-2 rounded text-center">
          <div className="text-gray-400 text-xs">High Score</div>
          <div className="text-lg font-bold text-yellow-400">{progress.highScore}</div>
        </div>
        <div className="bg-gray-700 p-2 rounded text-center">
          <div className="text-gray-400 text-xs">Best Wave</div>
          <div className="text-lg font-bold text-green-400">{progress.highestWave}</div>
        </div>
        <div className="bg-gray-700 p-2 rounded text-center">
          <div className="text-gray-400 text-xs">Aliens</div>
          <div className="text-lg font-bold">{progress.totalAliensKilled}</div>
        </div>
        <div className="bg-gray-700 p-2 rounded text-center">
          <div className="text-gray-400 text-xs">UFOs</div>
          <div className="text-lg font-bold text-red-400">{progress.mysteryShipsHit}</div>
        </div>
        <div className="bg-gray-700 p-2 rounded text-center">
          <div className="text-gray-400 text-xs">Waves</div>
          <div className="text-lg font-bold">{progress.wavesCompleted}</div>
        </div>
      </div>
    </div>
  );

  // ============================================
  // Main Render
  // ============================================
  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-start p-4">
      {/* iOS install prompt */}
      <IOSInstallPrompt />

      {/* Fullscreen button */}
      <div className="fixed top-4 right-4 z-50">
        <FullscreenButton />
      </div>

      {/* Header */}
      <header className="text-center mb-4">
        <h1 className="text-3xl font-bold text-green-500">Space Invaders</h1>
        <p className="text-gray-400 text-sm">Defend Earth from alien invasion!</p>
      </header>

      {/* Game container */}
      <div
        ref={containerRef}
        className="relative w-full flex items-center justify-center"
        style={{ height: "60vh" }}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          onClick={handleInput}
          onTouchStart={(e) => {
            e.preventDefault();
            if (gameState !== "playing") {
              handleInput();
            }
          }}
          className="rounded-lg shadow-2xl cursor-pointer touch-manipulation border-2 border-green-800"
          style={{
            width: CANVAS_WIDTH * scale,
            height: CANVAS_HEIGHT * scale,
          }}
        />
      </div>

      {/* Age-based difficulty selector - visible on start screen */}
      {gameState === "ready" && (
        <div className="w-full max-w-lg mx-auto mt-4 px-4">
          <div className="text-center mb-3 text-white font-bold text-lg">How old are you?</div>
          <div className="flex flex-wrap gap-2 justify-center">
            {(Object.keys(DIFFICULTY_SETTINGS) as Difficulty[]).map((diff) => {
              const settings = DIFFICULTY_SETTINGS[diff];
              const isSelected = progress.settings.difficulty === diff;
              return (
                <button
                  key={diff}
                  onClick={() => store.setDifficulty(diff)}
                  className={`px-4 py-3 rounded-xl font-bold text-base transition-all flex flex-col items-center min-w-[70px] ${
                    isSelected
                      ? `${settings.color} text-white scale-110 ring-2 ring-white shadow-lg`
                      : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  }`}
                >
                  <span className="text-2xl">{settings.emoji}</span>
                  <span>{diff}</span>
                </button>
              );
            })}
          </div>
          {progress.settings.difficulty === "99yo" && (
            <div className="text-center mt-2 text-purple-300 text-sm">
              Grandpa mode: Big aliens, slow & easy!
            </div>
          )}
          <div className="text-center mt-3 text-green-400 text-lg font-bold animate-pulse">
            Tap the game to START!
          </div>
        </div>
      )}

      {/* Mobile Controls */}
      <div className="md:hidden w-full">
        <MobileControls />
      </div>

      {/* Desktop keyboard hint */}
      <div className="hidden md:block text-gray-500 text-sm text-center mt-2">
        A/D or Arrows to move | SPACE or W to shoot (hold to auto-fire) | P to pause
      </div>

      {/* Pause button for mobile */}
      {gameState === "playing" && (
        <button
          onClick={pauseGame}
          className="md:hidden mt-4 bg-yellow-600 hover:bg-yellow-500 text-white px-6 py-2 rounded-lg font-bold"
        >
          PAUSE
        </button>
      )}

      {/* Settings */}
      <SettingsPanel />

      {/* Stats */}
      <StatsDisplay />

      {/* Sync status indicator */}
      {isAuthenticated && (
        <div className="fixed bottom-2 right-2 text-xs text-green-400/60">
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

export default SpaceInvadersGame;
