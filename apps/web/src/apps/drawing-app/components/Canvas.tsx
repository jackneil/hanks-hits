"use client";

import { useEffect } from "react";
import { useCanvas } from "../hooks/useCanvas";
import { useDrawingStore } from "../lib/store";

interface CanvasProps {
  onCanvasReady?: (canvas: ReturnType<typeof useCanvas>) => void;
}

/**
 * Canvas Component - The main drawing surface
 * Fills the available space and handles all drawing
 */
export function Canvas({ onCanvasReady }: CanvasProps) {
  const { tool, color, brushSize, setIsDrawing, settings } = useDrawingStore();

  const canvas = useCanvas({
    tool,
    color,
    brushSize,
    onDrawStart: () => setIsDrawing(true),
    onDrawEnd: () => setIsDrawing(false),
  });
  const { containerRef, canvasRef } = canvas;

  // Pass canvas controls to parent
  useEffect(() => {
    onCanvasReady?.(canvas);
  }, [canvas, onCanvasReady]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-white rounded-lg overflow-hidden shadow-inner"
    >
      {/* Optional grid overlay */}
      {settings.showGrid && (
        <div
          className="absolute inset-0 pointer-events-none opacity-20"
          style={{
            backgroundImage: `
              linear-gradient(to right, #ccc 1px, transparent 1px),
              linear-gradient(to bottom, #ccc 1px, transparent 1px)
            `,
            backgroundSize: "20px 20px",
          }}
        />
      )}

      <canvas
        ref={canvasRef}
        className="absolute inset-0 cursor-crosshair touch-none"
        style={{ touchAction: "none" }}
      />
    </div>
  );
}
