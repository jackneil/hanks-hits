"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useAsteroidsStore, type AsteroidsProgress } from "./lib/store";
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  SHIP_SIZE,
  ASTEROID_SIZES,
  UFO_SIZE,
  COLORS,
} from "./lib/constants";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { FullscreenButton } from "@/shared/components/FullscreenButton";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";

// ============================================
// CANVAS RENDERER
// ============================================
function useCanvasRenderer(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const store = useAsteroidsStore();

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

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
    if (status === "ready") {
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      ctx.fillStyle = "#22c55e";
      ctx.font = "bold 36px Arial";
      ctx.textAlign = "center";
      ctx.fillText("ASTEROIDS", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 50);

      ctx.fillStyle = COLORS.TEXT;
      ctx.font = "16px Arial";
      ctx.fillText("Rotate: A/D or ←→", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
      ctx.fillText("Thrust: W or ↑ | Fire: Space", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 25);
      ctx.fillText("Hyperspace: Shift", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 50);

      ctx.font = "bold 20px Arial";
      ctx.fillText("Press Space to Start", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 100);
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
      ctx.fillText("Press P or Escape to Resume", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 40);
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

      ctx.font = "18px Arial";
      ctx.fillText("Press Space to Play Again", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 100);
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
      ctx.fillText("Press Space for Next Wave", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 40);
    }
  }, [canvasRef, store]);

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
  const render = useCanvasRenderer(canvasRef);

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
  useEffect(() => {
    if (store.status !== "playing") return;

    let animationId: number;

    const gameLoop = () => {
      store.update();
      render();
      animationId = requestAnimationFrame(gameLoop);
    };

    animationId = requestAnimationFrame(gameLoop);

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [store.status, store.update, render]);

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

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (store.status === "ready" || store.status === "gameOver") {
        if (e.code === "Space") {
          e.preventDefault();
          store.startGame();
        }
        return;
      }

      if (store.status === "waveComplete") {
        if (e.code === "Space") {
          e.preventDefault();
          store.nextWave();
        }
        return;
      }

      if (store.status === "paused") {
        if (e.code === "Escape" || e.code === "KeyP") {
          e.preventDefault();
          store.resumeGame();
        }
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
        case "Escape":
        case "KeyP":
          e.preventDefault();
          store.pauseGame();
          break;
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
  }, [store.status, store]);

  // Touch handlers for mobile buttons
  const handleTouchStart = (action: string) => (e: React.TouchEvent) => {
    e.preventDefault();
    switch (action) {
      case "left":
        store.setInput({ rotatingLeft: true });
        break;
      case "right":
        store.setInput({ rotatingRight: true });
        break;
      case "thrust":
        store.setInput({ thrusting: true });
        break;
      case "fire":
        store.setInput({ shooting: true });
        break;
    }
  };

  const handleTouchEnd = (action: string) => (e: React.TouchEvent) => {
    e.preventDefault();
    switch (action) {
      case "left":
        store.setInput({ rotatingLeft: false });
        break;
      case "right":
        store.setInput({ rotatingRight: false });
        break;
      case "thrust":
        store.setInput({ thrusting: false });
        break;
      case "fire":
        store.setInput({ shooting: false });
        break;
    }
  };

  const handleCanvasClick = () => {
    if (store.status === "ready" || store.status === "gameOver") {
      store.startGame();
    } else if (store.status === "waveComplete") {
      store.nextWave();
    } else if (store.status === "paused") {
      store.resumeGame();
    }
  };

  const toggleSound = () => {
    const current = store.progress.soundEnabled;
    store.setProgress({ ...store.progress, soundEnabled: !current });
  };

  return (
    <div
      ref={containerRef}
      className="flex flex-col items-center justify-center min-h-screen bg-black p-4 select-none"
    >
      {/* Stats Bar */}
      <div className="flex items-center gap-4 mb-2 text-white text-sm">
        <span>High: {store.progress.highScore}</span>
        <span>|</span>
        <span>Best Wave: {store.progress.highestWave}</span>
        <span>|</span>
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
      </div>

      {/* Mobile controls */}
      {store.status === "playing" && (
        <div className="flex gap-2 mt-4">
          <button
            onTouchStart={handleTouchStart("left")}
            onTouchEnd={handleTouchEnd("left")}
            onMouseDown={() => store.setInput({ rotatingLeft: true })}
            onMouseUp={() => store.setInput({ rotatingLeft: false })}
            onMouseLeave={() => store.setInput({ rotatingLeft: false })}
            className="w-16 h-16 bg-gray-700 active:bg-gray-600 text-white text-2xl font-bold rounded-xl"
          >
            ↺
          </button>
          <button
            onTouchStart={handleTouchStart("thrust")}
            onTouchEnd={handleTouchEnd("thrust")}
            onMouseDown={() => store.setInput({ thrusting: true })}
            onMouseUp={() => store.setInput({ thrusting: false })}
            onMouseLeave={() => store.setInput({ thrusting: false })}
            className="w-16 h-16 bg-orange-600 active:bg-orange-500 text-white text-2xl font-bold rounded-xl"
          >
            🔥
          </button>
          <button
            onTouchStart={handleTouchStart("fire")}
            onTouchEnd={handleTouchEnd("fire")}
            onMouseDown={() => store.setInput({ shooting: true })}
            onMouseUp={() => store.setInput({ shooting: false })}
            onMouseLeave={() => store.setInput({ shooting: false })}
            className="w-16 h-16 bg-yellow-600 active:bg-yellow-500 text-white text-2xl font-bold rounded-xl"
          >
            ●
          </button>
          <button
            onTouchStart={handleTouchStart("right")}
            onTouchEnd={handleTouchEnd("right")}
            onMouseDown={() => store.setInput({ rotatingRight: true })}
            onMouseUp={() => store.setInput({ rotatingRight: false })}
            onMouseLeave={() => store.setInput({ rotatingRight: false })}
            className="w-16 h-16 bg-gray-700 active:bg-gray-600 text-white text-2xl font-bold rounded-xl"
          >
            ↻
          </button>
        </div>
      )}

      {/* Control row */}
      <div className="flex items-center gap-4 mt-4">
        <button
          onClick={toggleSound}
          className="w-12 h-12 bg-gray-700 hover:bg-gray-600 text-white rounded-full flex items-center justify-center"
        >
          {store.progress.soundEnabled ? "🔊" : "🔇"}
        </button>
        {store.status === "playing" && (
          <button
            onClick={() => store.pauseGame()}
            className="w-12 h-12 bg-yellow-600 hover:bg-yellow-500 text-white rounded-full flex items-center justify-center font-bold"
          >
            II
          </button>
        )}
        <FullscreenButton />
        <IOSInstallPrompt />
      </div>

      {/* Instructions */}
      <div className="mt-4 text-gray-400 text-center text-sm">
        <p>A/D = Rotate | W = Thrust | Space = Fire | Shift = Hyperspace</p>
      </div>
    </div>
  );
}

export default AsteroidsGame;
