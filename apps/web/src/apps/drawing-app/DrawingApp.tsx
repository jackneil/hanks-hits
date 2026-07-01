"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useDrawingStore, type SavedArtwork } from "./lib/store";
import { Canvas } from "./components/Canvas";
import { Toolbar } from "./components/Toolbar";
import { ColorPicker } from "./components/ColorPicker";
import { BrushSettings } from "./components/BrushSettings";
import { Gallery } from "./components/Gallery";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import { FullscreenButton } from "@/shared/components/FullscreenButton";
import type { useCanvas } from "./hooks/useCanvas";

/**
 * Drawing App - Kid-friendly digital canvas
 *
 * Features:
 * - Drawing with pencil/brush/eraser
 * - Color palette + custom picker
 * - Brush size slider
 * - Undo/Redo
 * - Clear canvas (with confirmation)
 * - Save to gallery
 * - Download as PNG
 * - Print artwork
 * - Cloud sync for logged-in users
 */
export function DrawingApp() {
  const store = useDrawingStore();
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Track undo/redo state for UI updates
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Canvas controls ref
  const canvasControlsRef = useRef<ReturnType<typeof useCanvas> | null>(null);

  // Auth sync for logged-in users
  const { isAuthenticated, syncStatus } = useAuthSync({
    appId: "drawing-app",
    localStorageKey: "drawing-app-progress",
    getState: () => store.getProgress(),
    setState: (data) => store.setProgress(data),
    debounceMs: 5000, // Less frequent, artworks are big
  });

  // Poll for undo/redo state changes
  useEffect(() => {
    const interval = setInterval(() => {
      if (canvasControlsRef.current) {
        setCanUndo(canvasControlsRef.current.canUndo);
        setCanRedo(canvasControlsRef.current.canRedo);
      }
    }, 100);
    return () => clearInterval(interval);
  }, []);

  // Handle canvas ready
  const handleCanvasReady = useCallback((controls: ReturnType<typeof useCanvas>) => {
    canvasControlsRef.current = controls;
    setCanUndo(controls.canUndo);
    setCanRedo(controls.canRedo);
  }, []);

  // Undo
  const handleUndo = useCallback(() => {
    canvasControlsRef.current?.undo();
  }, []);

  // Redo
  const handleRedo = useCallback(() => {
    canvasControlsRef.current?.redo();
  }, []);

  // Clear canvas
  const handleClear = useCallback(() => {
    canvasControlsRef.current?.clearCanvas();
    setShowClearConfirm(false);
  }, []);

  // Save artwork
  const handleSave = useCallback(() => {
    const dataUrl = canvasControlsRef.current?.getDataUrl();
    if (dataUrl) {
      store.saveArtwork(dataUrl);
      setShowSaveSuccess(true);
      setTimeout(() => setShowSaveSuccess(false), 2000);
    }
  }, [store]);

  // Download artwork
  const handleDownload = useCallback(() => {
    const timestamp = new Date().toISOString().slice(0, 10);
    canvasControlsRef.current?.downloadImage(`my-artwork-${timestamp}.png`);
  }, []);

  // Print artwork
  const handlePrint = useCallback(() => {
    canvasControlsRef.current?.printImage();
  }, []);

  // Load from gallery
  const handleLoadArtwork = useCallback((artwork: SavedArtwork) => {
    canvasControlsRef.current?.loadImage(artwork.dataUrl);
  }, []);

  return (
    <div
      data-testid="drawing-app-root"
      className="h-[calc(100vh-3rem)] md:h-[calc(100vh-3.5rem)] bg-gradient-to-b from-blue-400 via-purple-400 to-pink-400 flex flex-col overflow-hidden"
    >
      {/* iOS install prompt */}
      <IOSInstallPrompt />

      {/* Header */}
      <header className="flex-shrink-0 flex justify-between items-center gap-2 p-2 md:p-4 bg-white/10 backdrop-blur-sm">
        <h1 className="min-w-0 truncate text-lg md:text-2xl font-bold text-white drop-shadow-lg">
          {"\uD83C\uDFA8"} Drawing App
        </h1>

        <div className="flex shrink-0 items-center gap-1 md:gap-2">
          {/* Undo */}
          <button
            onClick={handleUndo}
            disabled={!canUndo}
            className={`
              w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center
              text-xl md:text-2xl transition-all touch-manipulation
              ${
                canUndo
                  ? "bg-white/90 hover:bg-white text-gray-700 shadow-lg"
                  : "bg-white/30 text-white/50 cursor-not-allowed"
              }
            `}
            aria-label="Undo"
            title="Undo"
          >
            {"\u21A9\uFE0F"}
          </button>

          {/* Redo */}
          <button
            onClick={handleRedo}
            disabled={!canRedo}
            className={`
              w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center
              text-xl md:text-2xl transition-all touch-manipulation
              ${
                canRedo
                  ? "bg-white/90 hover:bg-white text-gray-700 shadow-lg"
                  : "bg-white/30 text-white/50 cursor-not-allowed"
              }
            `}
            aria-label="Redo"
            title="Redo"
          >
            {"\u21AA\uFE0F"}
          </button>

          {/* Gallery */}
          <button
            onClick={() => setShowGallery(true)}
            className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-white/90 hover:bg-white flex items-center justify-center text-xl md:text-2xl shadow-lg transition-all touch-manipulation"
            aria-label="Gallery"
            title="My Gallery"
          >
            {"\uD83D\uDDBC\uFE0F"}
          </button>

          {/* Fullscreen */}
          <FullscreenButton />
        </div>
      </header>

      {/* Main canvas area */}
      <div className="flex-1 p-2 md:p-4 min-h-0">
        <Canvas onCanvasReady={handleCanvasReady} />
      </div>

      {/* Bottom toolbar */}
      <div className="flex-shrink-0 p-2 md:p-4 bg-white/10 backdrop-blur-sm space-y-2 md:space-y-3">
        {/* Tools row */}
        <div className="flex gap-2 md:gap-4 items-start flex-wrap justify-center">
          <Toolbar />

          {/* Settings toggle (mobile) */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`
              md:hidden w-14 h-14 rounded-xl flex items-center justify-center text-2xl
              transition-all touch-manipulation
              ${
                showSettings
                  ? "bg-blue-500 text-white shadow-lg"
                  : "bg-white/90 text-gray-700 shadow-lg"
              }
            `}
            aria-label="Settings"
          >
            {"\u2699\uFE0F"}
          </button>
        </div>

        {/* Color picker - always visible on desktop, toggleable on mobile */}
        <div className={`${showSettings ? "block" : "hidden"} md:block`}>
          <ColorPicker />
        </div>

        {/* Brush settings - always visible on desktop, toggleable on mobile */}
        <div className={`${showSettings ? "block" : "hidden"} md:block`}>
          <BrushSettings />
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 md:gap-3 justify-center flex-wrap">
          {/* Clear */}
          <button
            onClick={() => setShowClearConfirm(true)}
            className="py-2 px-4 md:py-3 md:px-6 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold shadow-lg transition-all touch-manipulation flex items-center gap-1 md:gap-2"
          >
            <span className="text-lg md:text-xl">{"\uD83D\uDDD1\uFE0F"}</span>
            <span className="text-sm md:text-base">Clear</span>
          </button>

          {/* Save */}
          <button
            onClick={handleSave}
            className="py-2 px-4 md:py-3 md:px-6 rounded-xl bg-green-500 hover:bg-green-600 text-white font-bold shadow-lg transition-all touch-manipulation flex items-center gap-1 md:gap-2"
          >
            <span className="text-lg md:text-xl">{"\uD83D\uDCBE"}</span>
            <span className="text-sm md:text-base">Save</span>
          </button>

          {/* Download */}
          <button
            onClick={handleDownload}
            className="py-2 px-4 md:py-3 md:px-6 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-bold shadow-lg transition-all touch-manipulation flex items-center gap-1 md:gap-2"
          >
            <span className="text-lg md:text-xl">{"\u2B07\uFE0F"}</span>
            <span className="text-sm md:text-base">Download</span>
          </button>

          {/* Print */}
          <button
            onClick={handlePrint}
            className="py-2 px-4 md:py-3 md:px-6 rounded-xl bg-purple-500 hover:bg-purple-600 text-white font-bold shadow-lg transition-all touch-manipulation flex items-center gap-1 md:gap-2"
          >
            <span className="text-lg md:text-xl">{"\uD83D\uDDA8\uFE0F"}</span>
            <span className="text-sm md:text-base">Print</span>
          </button>
        </div>
      </div>

      {/* Clear confirmation modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl">
            <div className="text-center mb-4">
              <div className="text-6xl mb-3">{"\u26A0\uFE0F"}</div>
              <h2 className="text-2xl font-bold text-gray-800">Clear Canvas?</h2>
              <p className="text-gray-600 mt-2">
                Are you sure? Your drawing will be erased!
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 py-3 rounded-xl bg-gray-200 hover:bg-gray-300 font-bold text-gray-700 transition-all"
              >
                Keep Drawing
              </button>
              <button
                onClick={handleClear}
                className="flex-1 py-3 rounded-xl bg-red-500 hover:bg-red-600 font-bold text-white transition-all"
              >
                Clear It!
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save success toast */}
      {showSaveSuccess && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 animate-bounce">
          <div className="bg-green-500 text-white px-6 py-3 rounded-full font-bold shadow-lg flex items-center gap-2">
            <span className="text-2xl">{"\u2705"}</span>
            Saved to Gallery!
          </div>
        </div>
      )}

      {/* Gallery modal */}
      {showGallery && (
        <Gallery
          onLoadArtwork={handleLoadArtwork}
          onClose={() => setShowGallery(false)}
        />
      )}

      {/* Sync status */}
      {isAuthenticated && (
        <div className="fixed bottom-2 right-2 text-xs text-white/60">
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

export default DrawingApp;
