/**
 * useCanvas - Custom hook for canvas drawing operations
 * Handles drawing, erasing, undo/redo, and touch support
 */

import { useRef, useCallback, useEffect, useState } from "react";
import { MAX_HISTORY_STATES, CANVAS_BG_COLOR } from "../lib/constants";
import type { DrawingTool } from "../lib/constants";

interface Point {
  x: number;
  y: number;
}

interface UseCanvasOptions {
  tool: DrawingTool;
  color: string;
  brushSize: number;
  onDrawStart?: () => void;
  onDrawEnd?: () => void;
}

interface UseCanvasReturn {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  clearCanvas: () => void;
  getDataUrl: () => string;
  loadImage: (dataUrl: string) => void;
  downloadImage: (filename?: string) => void;
  printImage: () => void;
}

export function useCanvas({
  tool,
  color,
  brushSize,
  onDrawStart,
  onDrawEnd,
}: UseCanvasOptions): UseCanvasReturn {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<Point | null>(null);
  const isInitializedRef = useRef(false);

  // History for undo/redo
  const [history, setHistory] = useState<ImageData[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const isUndoRedoRef = useRef(false);

  // Initialize canvas
  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // Set canvas size to match container
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.floor(rect.width * dpr);
    const height = Math.floor(rect.height * dpr);

    // A zero-width or zero-height canvas cannot be initialized: getImageData
    // throws IndexSizeError on a zero dimension (e.g. a short viewport where
    // the container is laid out with 0 height before it gets its real size).
    // Bail out and let the ResizeObserver retry once the container has real
    // dimensions, instead of crashing the whole page.
    if (width <= 0 || height <= 0) return;

    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.fillStyle = CANVAS_BG_COLOR;
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctxRef.current = ctx;

    // Save initial state
    const initialState = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setHistory([initialState]);
    setHistoryIndex(0);
    isInitializedRef.current = true;
  }, []);

  // Initialize on mount, and retry if the container starts at zero size
  // (short viewport / delayed layout) until it has real dimensions.
  useEffect(() => {
    initCanvas();

    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (!isInitializedRef.current) {
        initCanvas();
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [initCanvas]);

  // Save current state to history
  const saveToHistory = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx || isUndoRedoRef.current) return;
    // Skip while the canvas has no drawable area - getImageData throws on a
    // zero dimension. History is captured again once it has a real size.
    if (canvas.width <= 0 || canvas.height <= 0) return;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    setHistory((prev) => {
      // Remove any future states if we're in the middle of history
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push(imageData);

      // Limit history size
      if (newHistory.length > MAX_HISTORY_STATES) {
        newHistory.shift();
        return newHistory;
      }

      return newHistory;
    });

    setHistoryIndex((prev) => Math.min(prev + 1, MAX_HISTORY_STATES - 1));
  }, [historyIndex]);

  // Restore state from history
  const restoreFromHistory = useCallback((imageData: ImageData) => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;
    // A zero-dimension canvas can't accept image data; skip until it resizes.
    if (canvas.width <= 0 || canvas.height <= 0) return;

    isUndoRedoRef.current = true;
    ctx.putImageData(imageData, 0, 0);
    setTimeout(() => {
      isUndoRedoRef.current = false;
    }, 0);
  }, []);

  // Get point from event
  const getPoint = useCallback((e: MouseEvent | Touch): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }, []);

  // Draw line between two points
  const drawLine = useCallback(
    (from: Point, to: Point) => {
      const ctx = ctxRef.current;
      if (!ctx) return;

      ctx.globalCompositeOperation =
        tool === "eraser" ? "destination-out" : "source-over";
      ctx.strokeStyle = tool === "eraser" ? CANVAS_BG_COLOR : color;
      ctx.lineWidth = brushSize;

      ctx.beginPath();
      ctx.moveTo(from.x, from.y);

      // Use quadratic curve for smoother lines
      const midX = (from.x + to.x) / 2;
      const midY = (from.y + to.y) / 2;
      ctx.quadraticCurveTo(from.x, from.y, midX, midY);
      ctx.lineTo(to.x, to.y);

      ctx.stroke();
    },
    [tool, color, brushSize]
  );

  // Draw a single point (for taps/clicks)
  const drawPoint = useCallback(
    (point: Point) => {
      const ctx = ctxRef.current;
      if (!ctx) return;

      ctx.globalCompositeOperation =
        tool === "eraser" ? "destination-out" : "source-over";
      ctx.fillStyle = tool === "eraser" ? CANVAS_BG_COLOR : color;

      ctx.beginPath();
      ctx.arc(point.x, point.y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
    },
    [tool, color, brushSize]
  );

  // Start drawing
  const startDrawing = useCallback(
    (e: MouseEvent | Touch) => {
      isDrawingRef.current = true;
      const point = getPoint(e);
      lastPointRef.current = point;
      drawPoint(point);
      onDrawStart?.();
    },
    [getPoint, drawPoint, onDrawStart]
  );

  // Continue drawing
  const draw = useCallback(
    (e: MouseEvent | Touch) => {
      if (!isDrawingRef.current || !lastPointRef.current) return;

      const point = getPoint(e);
      drawLine(lastPointRef.current, point);
      lastPointRef.current = point;
    },
    [getPoint, drawLine]
  );

  // Stop drawing
  const stopDrawing = useCallback(() => {
    if (isDrawingRef.current) {
      isDrawingRef.current = false;
      lastPointRef.current = null;
      saveToHistory();
      onDrawEnd?.();
    }
  }, [saveToHistory, onDrawEnd]);

  // Mouse event handlers
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      startDrawing(e);
    };

    const handleMouseMove = (e: MouseEvent) => {
      draw(e);
    };

    const handleMouseUp = () => {
      stopDrawing();
    };

    const handleMouseLeave = () => {
      stopDrawing();
    };

    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseup", handleMouseUp);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [startDrawing, draw, stopDrawing]);

  // Touch event handlers
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        startDrawing(e.touches[0]);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        draw(e.touches[0]);
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      stopDrawing();
    };

    canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
    canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
    canvas.addEventListener("touchend", handleTouchEnd, { passive: false });
    canvas.addEventListener("touchcancel", handleTouchEnd, { passive: false });

    return () => {
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchmove", handleTouchMove);
      canvas.removeEventListener("touchend", handleTouchEnd);
      canvas.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [startDrawing, draw, stopDrawing]);

  // Undo
  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      restoreFromHistory(history[newIndex]);
    }
  }, [history, historyIndex, restoreFromHistory]);

  // Redo
  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      restoreFromHistory(history[newIndex]);
    }
  }, [history, historyIndex, restoreFromHistory]);

  // Clear canvas
  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;

    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = CANVAS_BG_COLOR;
    ctx.fillRect(0, 0, rect.width, rect.height);

    saveToHistory();
  }, [saveToHistory]);

  // Get data URL
  const getDataUrl = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return "";
    return canvas.toDataURL("image/png");
  }, []);

  // Load image
  const loadImage = useCallback((dataUrl: string) => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    const container = containerRef.current;
    if (!canvas || !ctx || !container) return;

    const img = new Image();
    img.onload = () => {
      const rect = container.getBoundingClientRect();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = CANVAS_BG_COLOR;
      ctx.fillRect(0, 0, rect.width, rect.height);

      // Center the image
      const scale = Math.min(rect.width / img.width, rect.height / img.height, 1);
      const x = (rect.width - img.width * scale) / 2;
      const y = (rect.height - img.height * scale) / 2;
      ctx.drawImage(img, x, y, img.width * scale, img.height * scale);

      // Save to history (skip if the canvas has no drawable area yet)
      if (canvas.width > 0 && canvas.height > 0) {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        setHistory([imageData]);
        setHistoryIndex(0);
      }
    };
    img.src = dataUrl;
  }, []);

  // Download image
  const downloadImage = useCallback((filename = "my-artwork.png") => {
    const dataUrl = getDataUrl();
    if (!dataUrl) return;

    const link = document.createElement("a");
    link.download = filename;
    link.href = dataUrl;
    link.click();
  }, [getDataUrl]);

  // Print image
  const printImage = useCallback(() => {
    const dataUrl = getDataUrl();
    if (!dataUrl) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>My Artwork</title>
          <style>
            body { margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
            img { max-width: 100%; max-height: 100vh; }
            @media print { body { margin: 0; } img { max-width: 100%; } }
          </style>
        </head>
        <body>
          <img src="${dataUrl}" onload="window.print(); window.close();" />
        </body>
      </html>
    `);
    printWindow.document.close();
  }, [getDataUrl]);

  return {
    canvasRef,
    containerRef,
    canUndo: historyIndex > 0,
    canRedo: historyIndex < history.length - 1,
    undo,
    redo,
    clearCanvas,
    getDataUrl,
    loadImage,
    downloadImage,
    printImage,
  };
}
