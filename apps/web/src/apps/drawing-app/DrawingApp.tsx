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
import { ReadAloudButton } from "@/shared/components/ReadAloudButton";
import { AppNotesSlot } from "@/shared/components/AppNotesSlot";
import { useShortViewport } from "@/shared/hooks/useShortViewport";
import { DRAWING_APP_INSTRUCTIONS } from "./lib/readAloud";
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
      useDrawingStore.getState().saveArtwork(dataUrl);
      setShowSaveSuccess(true);
      setTimeout(() => setShowSaveSuccess(false), 2000);
    }
  }, []);

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

  const short = useShortViewport();
  const round = (on = true) =>
    `flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl shadow-lg transition-all touch-manipulation ${
      on ? "bg-white/90 text-gray-700 hover:bg-white" : "cursor-not-allowed bg-white/30 text-white/50"
    }`;

  const undoButton = (
    <button type="button" onClick={handleUndo} disabled={!canUndo} className={round(canUndo)} aria-label="Undo" title="Undo">
      {"\u21A9\uFE0F"}
    </button>
  );
  const redoButton = (
    <button type="button" onClick={handleRedo} disabled={!canRedo} className={round(canRedo)} aria-label="Redo" title="Redo">
      {"\u21AA\uFE0F"}
    </button>
  );
  const galleryButton = (
    <button type="button" onClick={() => setShowGallery(true)} className={round()} aria-label="Gallery" title="My Gallery">
      {"\uD83D\uDDBC\uFE0F"}
    </button>
  );
  const settingsButton = (
    <button
      type="button"
      onClick={() => setShowSettings(!showSettings)}
      aria-pressed={showSettings}
      className={`flex shrink-0 items-center justify-center rounded-xl text-2xl shadow-lg transition-all touch-manipulation ${
        short ? "h-11 w-11" : "h-16 w-16 flex-col text-2xl"
      } ${showSettings ? "bg-blue-500 text-white" : "bg-white/90 text-gray-700"}`}
      aria-label="Colors and brush"
    >
      <span aria-hidden="true">{"\uD83C\uDFA8"}</span>
      {!short && <span className="text-sm font-medium">Colors</span>}
    </button>
  );

  // The four actions. Upright they have words; in the side rail they are
  // round icons with the words as their names.
  type ActionKey = "clear" | "save" | "download" | "print";
  const actions: { key: ActionKey; label: string; icon: string; color: string }[] = [
    { key: "clear", label: "Clear", icon: "\uD83D\uDDD1\uFE0F", color: "bg-red-500 hover:bg-red-600" },
    { key: "save", label: "Save", icon: "\uD83D\uDCBE", color: "bg-green-600 hover:bg-green-700" },
    { key: "download", label: "Download", icon: "\u2B07\uFE0F", color: "bg-blue-600 hover:bg-blue-700" },
    { key: "print", label: "Print", icon: "\uD83D\uDDA8\uFE0F", color: "bg-purple-600 hover:bg-purple-700" },
  ];
  const runAction = (key: ActionKey) => {
    if (key === "clear") setShowClearConfirm(true);
    else if (key === "save") handleSave();
    else if (key === "download") handleDownload();
    else handlePrint();
  };
  const actionButtons = actions.map((a) =>
    short ? (
      <button
        key={a.key}
        type="button"
        onClick={() => runAction(a.key)}
        aria-label={a.label}
        title={a.label}
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl text-white shadow-lg transition-all touch-manipulation ${a.color}`}
      >
        <span aria-hidden="true">{a.icon}</span>
      </button>
    ) : (
      <button
        key={a.key}
        type="button"
        onClick={() => runAction(a.key)}
        className={`flex h-12 min-w-0 items-center justify-center gap-1 rounded-xl px-2 font-bold text-white shadow-lg transition-all touch-manipulation ${a.color}`}
      >
        <span aria-hidden="true" className="text-lg">
          {a.icon}
        </span>
        <span className="truncate text-base">{a.label}</span>
      </button>
    )
  );

  // Colors and brush: a panel over the canvas that closes when a color is
  // picked. It used to push the canvas down to a 15 px sliver upright.
  const settingsPanel = showSettings && (
    <div
      data-testid="drawing-settings"
      className={`absolute z-20 flex flex-col gap-2 overflow-y-auto rounded-2xl bg-white/95 p-2 shadow-2xl ${
        short ? "bottom-2 right-2 top-2 w-[min(22rem,calc(100%-1rem))]" : "inset-x-2 bottom-2 max-h-[calc(100%-1rem)]"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-base font-bold text-gray-800">🎨 Colors and brush</span>
        <button
          type="button"
          onClick={() => setShowSettings(false)}
          className="h-11 min-w-11 rounded-xl bg-blue-500 px-3 font-bold text-white"
        >
          Done
        </button>
      </div>
      <ColorPicker onPicked={() => setShowSettings(false)} />
      <BrushSettings />
    </div>
  );

  const canvasArea = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-2">
      {/* The install pill and a trophy show here, as rows of the page, never
          over the tools (as a child of the sideways row, the pill stretched
          into a column half the screen wide). */}
      <IOSInstallPrompt />
      <AppNotesSlot />
      <div data-testid="drawing-canvas-area" className="relative min-h-0 flex-1">
        <Canvas onCanvasReady={handleCanvasReady} />
        {settingsPanel}
      </div>
    </div>
  );

  return (
    // h-full: the root is the GameShell play box (which already leaves room
    // for an install sheet), and nothing is ever laid over the canvas. The
    // canvas takes what the tools leave; sideways the tools are a rail on
    // the right (they sat on the canvas sideways, so a stroke drew nothing:
    // phone UX audit 2026-09-29).
    <div
      data-testid="drawing-app-root"
      className={`flex h-full overflow-hidden bg-gradient-to-b from-blue-400 via-purple-400 to-pink-400 ${
        short ? "flex-row" : "flex-col"
      }`}
    >
      {short ? (
        <>
          {canvasArea}
          <div
            data-testid="drawing-rail"
            className="grid shrink-0 grid-cols-3 content-center gap-1.5 overflow-y-auto p-2 pl-0"
          >
            <ReadAloudButton text={DRAWING_APP_INSTRUCTIONS} variant="icon" />
            {undoButton}
            {redoButton}
            <Toolbar compact />
            {settingsButton}
            {galleryButton}
            {actionButtons[1]}
            {actionButtons[0]}
            {actionButtons[2]}
            {actionButtons[3]}
          </div>
        </>
      ) : (
        <>
          {/* Read it to me, then undo, redo and the gallery. */}
          <div className="flex shrink-0 items-center gap-2 p-2">
            <ReadAloudButton text={DRAWING_APP_INSTRUCTIONS} variant="icon" />
            <div className="flex-1" />
            {undoButton}
            {redoButton}
            {galleryButton}
          </div>

          {canvasArea}

          {/* The tools, then the actions. */}
          <div data-testid="drawing-tools" className="shrink-0 space-y-2 p-2 pt-0">
            <div className="flex items-start justify-center gap-2">
              <Toolbar />
              {settingsButton}
            </div>
            <div className="mx-auto grid max-w-xl grid-cols-4 gap-2">{actionButtons}</div>
          </div>
        </>
      )}

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
