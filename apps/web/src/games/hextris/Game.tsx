"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useHextrisStore, type HextrisProgress } from "./lib/store";
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  HEX_CENTER_X,
  HEX_CENTER_Y,
  HEX_RADIUS,
  BLOCK_WIDTH,
  BLOCK_HEIGHT,
  COLORS,
  getHexCorner,
  getSideAngle,
  getBlockPosition,
} from "./lib/constants";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { FullscreenButton } from "@/shared/components/FullscreenButton";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";

// ============================================
// CANVAS RENDERER
// ============================================
function useCanvasRenderer(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const store = useHextrisStore();

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { stacks, fallingBlock, particles, rotation, score, status } = store;

    // Clear canvas
    ctx.fillStyle = COLORS.BACKGROUND;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw central hexagon
    ctx.save();
    ctx.translate(HEX_CENTER_X, HEX_CENTER_Y);
    ctx.rotate(rotation);

    // Hexagon fill
    ctx.fillStyle = COLORS.HEX_FILL;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const corner = getHexCorner(0, 0, HEX_RADIUS, i);
      if (i === 0) ctx.moveTo(corner.x, corner.y);
      else ctx.lineTo(corner.x, corner.y);
    }
    ctx.closePath();
    ctx.fill();

    // Hexagon border
    ctx.strokeStyle = COLORS.HEX_STROKE;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Draw side indicators
    for (let i = 0; i < 6; i++) {
      const sideAngle = getSideAngle(i);
      const indicatorDist = HEX_RADIUS - 10;
      ctx.fillStyle = "rgba(96, 165, 250, 0.3)";
      ctx.beginPath();
      ctx.arc(
        Math.cos(sideAngle) * indicatorDist,
        Math.sin(sideAngle) * indicatorDist,
        5,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    ctx.restore();

    // Draw stacked blocks
    for (let side = 0; side < 6; side++) {
      const stack = stacks[side];
      for (let i = 0; i < stack.length; i++) {
        const block = stack[i];
        const pos = getBlockPosition(HEX_CENTER_X, HEX_CENTER_Y, HEX_RADIUS, side, i, rotation);

        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.rotate(pos.angle + Math.PI / 2);

        // Block body
        ctx.fillStyle = block.color;
        ctx.fillRect(-BLOCK_WIDTH / 2, -BLOCK_HEIGHT / 2, BLOCK_WIDTH, BLOCK_HEIGHT);

        // Highlight
        ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
        ctx.fillRect(-BLOCK_WIDTH / 2, -BLOCK_HEIGHT / 2, BLOCK_WIDTH, 4);

        // Shadow
        ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
        ctx.fillRect(-BLOCK_WIDTH / 2, BLOCK_HEIGHT / 2 - 4, BLOCK_WIDTH, 4);

        // Border
        ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
        ctx.lineWidth = 1;
        ctx.strokeRect(-BLOCK_WIDTH / 2, -BLOCK_HEIGHT / 2, BLOCK_WIDTH, BLOCK_HEIGHT);

        ctx.restore();
      }
    }

    // Draw falling block
    if (fallingBlock) {
      ctx.save();
      ctx.translate(fallingBlock.x, fallingBlock.y);

      // Calculate angle toward center
      const angleToCenter = Math.atan2(
        HEX_CENTER_Y - fallingBlock.y,
        HEX_CENTER_X - fallingBlock.x
      );
      ctx.rotate(angleToCenter + Math.PI / 2);

      // Block body
      ctx.fillStyle = fallingBlock.color;
      ctx.fillRect(-BLOCK_WIDTH / 2, -BLOCK_HEIGHT / 2, BLOCK_WIDTH, BLOCK_HEIGHT);

      // Highlight
      ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
      ctx.fillRect(-BLOCK_WIDTH / 2, -BLOCK_HEIGHT / 2, BLOCK_WIDTH, 4);

      // Glow effect
      ctx.shadowColor = fallingBlock.color;
      ctx.shadowBlur = 10;
      ctx.strokeStyle = fallingBlock.color;
      ctx.lineWidth = 2;
      ctx.strokeRect(-BLOCK_WIDTH / 2, -BLOCK_HEIGHT / 2, BLOCK_WIDTH, BLOCK_HEIGHT);
      ctx.shadowBlur = 0;

      ctx.restore();
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

    // Draw score
    ctx.fillStyle = COLORS.SCORE_TEXT;
    ctx.font = "bold 24px Arial";
    ctx.textAlign = "center";
    ctx.fillText(`Score: ${score}`, CANVAS_WIDTH / 2, 35);

    // Draw game over overlay
    if (status === "game-over") {
      ctx.fillStyle = COLORS.GAME_OVER_BG;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      ctx.fillStyle = "#ef4444";
      ctx.font = "bold 36px Arial";
      ctx.textAlign = "center";
      ctx.fillText("GAME OVER", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 30);

      ctx.fillStyle = "#f8fafc";
      ctx.font = "24px Arial";
      ctx.fillText(`Final Score: ${score}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 20);

      ctx.font = "18px Arial";
      ctx.fillText("Tap to Play Again", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 60);
    }

    // Draw idle state
    if (status === "idle") {
      ctx.fillStyle = COLORS.GAME_OVER_BG;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      ctx.fillStyle = "#60a5fa";
      ctx.font = "bold 40px Arial";
      ctx.textAlign = "center";
      ctx.fillText("HEXTRIS", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 40);

      ctx.fillStyle = "#f8fafc";
      ctx.font = "18px Arial";
      ctx.fillText("Rotate the hexagon to catch blocks", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 10);
      ctx.fillText("Match 3+ same color to clear", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 35);

      ctx.font = "bold 20px Arial";
      ctx.fillText("Tap to Start", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 80);
    }

    // Draw paused state
    if (status === "paused") {
      ctx.fillStyle = COLORS.GAME_OVER_BG;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      ctx.fillStyle = "#eab308";
      ctx.font = "bold 36px Arial";
      ctx.textAlign = "center";
      ctx.fillText("PAUSED", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);

      ctx.fillStyle = "#f8fafc";
      ctx.font = "18px Arial";
      ctx.fillText("Tap to Resume", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 40);
    }
  }, [canvasRef, store]);

  return render;
}

// ============================================
// MAIN COMPONENT
// ============================================
export function HextrisGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const store = useHextrisStore();
  const render = useCanvasRenderer(canvasRef);

  // Auth sync
  const { forceSync } = useAuthSync({
    appId: "hextris",
    localStorageKey: "hextris-game-state",
    getState: store.getProgress,
    setState: store.setProgress,
    debounceMs: 3000,
  });

  // Force save immediately on game over
  useEffect(() => {
    if (store.status === "game-over") {
      forceSync();
    }
  }, [store.status, forceSync]);

  // Game loop
  useEffect(() => {
    if (store.status !== "playing") return;

    let animationId: number;
    let lastTime = performance.now();

    const gameLoop = (currentTime: number) => {
      const deltaTime = (currentTime - lastTime) / 16.67; // Normalize to ~60fps
      lastTime = currentTime;

      store.update(deltaTime);
      render();

      animationId = requestAnimationFrame(gameLoop);
    };

    animationId = requestAnimationFrame(gameLoop);

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [store.status, store.update, render]);

  // Initial render and idle/paused states
  useEffect(() => {
    render();
  }, [render, store.status]);

  // Responsive scaling
  useEffect(() => {
    const updateScale = () => {
      if (!containerRef.current) return;

      const containerWidth = containerRef.current.clientWidth;
      const containerHeight = containerRef.current.clientHeight - 120; // Account for buttons

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
      if (store.status === "idle" || store.status === "game-over") {
        if (e.code === "Space" || e.code === "Enter") {
          e.preventDefault();
          store.startGame();
        }
        return;
      }

      if (store.status === "paused") {
        if (e.code === "Space" || e.code === "Escape" || e.code === "KeyP") {
          e.preventDefault();
          store.resumeGame();
        }
        return;
      }

      switch (e.code) {
        case "KeyA":
        case "ArrowLeft":
          e.preventDefault();
          store.rotateLeft();
          break;
        case "KeyD":
        case "ArrowRight":
          e.preventDefault();
          store.rotateRight();
          break;
        case "Escape":
        case "KeyP":
          e.preventDefault();
          store.pauseGame();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [store.status, store.startGame, store.pauseGame, store.resumeGame, store.rotateLeft, store.rotateRight]);

  // Touch controls
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();

      if (store.status === "idle" || store.status === "game-over") {
        store.startGame();
        return;
      }

      if (store.status === "paused") {
        store.resumeGame();
        return;
      }

      // Get click position relative to canvas
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      let clientX: number;
      if ("touches" in e) {
        clientX = e.touches[0]?.clientX ?? rect.left + rect.width / 2;
      } else {
        clientX = e.clientX;
      }

      const relativeX = clientX - rect.left;
      const halfWidth = rect.width / 2;

      if (relativeX < halfWidth) {
        store.rotateLeft();
      } else {
        store.rotateRight();
      }
    },
    [store]
  );

  const toggleSound = () => {
    const current = store.progress.soundEnabled;
    store.setProgress({ ...store.progress, soundEnabled: !current });
  };

  return (
    <div
      ref={containerRef}
      className="flex flex-col items-center justify-center min-h-screen bg-slate-900 p-4 select-none"
    >
      {/* Stats Bar */}
      <div className="flex items-center gap-4 mb-2 text-white text-sm">
        <span>High Score: {store.progress.highScore}</span>
        <span>|</span>
        <span>Games: {store.progress.gamesPlayed}</span>
        <span>|</span>
        <span>Blocks: {store.progress.totalBlocksMatched}</span>
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
          onTouchStart={handleCanvasClick}
          className="rounded-lg shadow-xl cursor-pointer"
          style={{
            width: CANVAS_WIDTH * scale,
            height: CANVAS_HEIGHT * scale,
            touchAction: "none",
          }}
        />
      </div>

      {/* Control buttons for mobile */}
      {store.status === "playing" && (
        <div className="flex gap-4 mt-4">
          <button
            onClick={() => store.rotateLeft()}
            className="w-20 h-16 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-2xl font-bold rounded-xl shadow-lg"
          >
            {"<"}
          </button>
          <button
            onClick={() => store.pauseGame()}
            className="w-16 h-16 bg-yellow-600 hover:bg-yellow-700 active:bg-yellow-800 text-white text-lg font-bold rounded-xl shadow-lg"
          >
            II
          </button>
          <button
            onClick={() => store.rotateRight()}
            className="w-20 h-16 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-2xl font-bold rounded-xl shadow-lg"
          >
            {">"}
          </button>
        </div>
      )}

      {/* Control row */}
      <div className="flex items-center gap-4 mt-4">
        <button
          onClick={toggleSound}
          className="w-12 h-12 bg-slate-700 hover:bg-slate-600 text-white rounded-full flex items-center justify-center"
        >
          {store.progress.soundEnabled ? "🔊" : "🔇"}
        </button>
        <FullscreenButton />
        <IOSInstallPrompt />
      </div>

      {/* Instructions */}
      <div className="mt-4 text-slate-400 text-center text-sm">
        <p>A/D or Arrow Keys to rotate | Tap left/right side</p>
        <p>P or Escape to pause</p>
      </div>
    </div>
  );
}

export default HextrisGame;
