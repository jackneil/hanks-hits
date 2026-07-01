"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRetroArcadeStore } from "./lib/store";
import {
  SYSTEMS,
  SYSTEM_IDS,
  EMULATOR_CONFIG,
  isValidRomFile,
  type SystemType,
  type SystemInfo,
} from "./lib/constants";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import { FullscreenButton } from "@/shared/components/FullscreenButton";
import { GameBrowser, type CatalogGame } from "./components/GameBrowser";
import {
  SNES_CATALOG,
  getRomUrl as getSnesRomUrl,
} from "./lib/snes-catalog";
import {
  ATARI_2600_CATALOG,
  getRomUrl as getAtariRomUrl,
} from "./lib/atari-2600-catalog";

// Console selection card
function ConsoleCard({
  system,
  onClick,
}: {
  system: SystemInfo;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`bg-gradient-to-br ${system.bgGradient} p-6 rounded-2xl shadow-lg hover:scale-105 active:scale-95 transition-transform cursor-pointer border-4 border-white/20 hover:border-white/40 min-w-[140px] touch-manipulation`}
    >
      <div className="text-5xl mb-2">{system.icon}</div>
      <h3 className="text-xl font-bold text-white">{system.name}</h3>
      <p className="text-white/70 text-sm">{system.fullName}</p>
    </button>
  );
}

// ROM upload component
function RomUploader({
  system,
  onRomLoaded,
}: {
  system: SystemInfo;
  onRomLoaded: (url: string, name: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const store = useRetroArcadeStore();

  const handleFile = useCallback(
    (file: File) => {
      setError(null);

      if (!isValidRomFile(file, system.id)) {
        setError(
          `Invalid file type. Please upload a ${system.extensions.join(", ")} file.`
        );
        return;
      }

      // Create blob URL for the ROM
      const blobUrl = URL.createObjectURL(file);

      // Add to custom ROMs list
      store.addCustomRom({
        id: `${system.id}-${file.name}-${Date.now()}`,
        name: file.name,
        system: system.id,
        addedAt: Date.now(),
        blobUrl,
      });

      onRomLoaded(blobUrl, file.name);
    },
    [system, onRomLoaded, store]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);

      const file = e.dataTransfer.files[0];
      if (file) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`border-4 border-dashed rounded-2xl p-8 text-center transition-colors ${
          dragOver
            ? "border-blue-400 bg-blue-900/30"
            : "border-white/30 hover:border-white/50"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={system.extensions.join(",")}
          onChange={handleChange}
          className="hidden"
        />

        <div className="text-6xl mb-4">{system.icon}</div>
        <h3 className="text-xl font-bold text-white mb-2">
          Upload {system.name} ROM
        </h3>
        <p className="text-white/60 mb-4">
          Drag & drop or click to select a ROM file
        </p>
        <p className="text-white/40 text-sm mb-4">
          Supported: {system.extensions.join(", ")}
        </p>

        <button
          onClick={() => inputRef.current?.click()}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-lg transition-colors"
        >
          Choose File
        </button>
      </div>

      {error && (
        <div className="mt-4 p-3 bg-red-600/50 border border-red-400 rounded-lg text-white text-center">
          {error}
        </div>
      )}

      {/* Recently uploaded ROMs for this system */}
      {store.getCustomRomsForSystem(system.id).length > 0 && (
        <div className="mt-6">
          <h4 className="text-white/80 font-semibold mb-3">Your ROMs:</h4>
          <div className="space-y-2">
            {store.getCustomRomsForSystem(system.id).map((rom) => (
              <button
                key={rom.id}
                onClick={() => {
                  if (rom.blobUrl) {
                    onRomLoaded(rom.blobUrl, rom.name);
                  }
                }}
                disabled={!rom.blobUrl}
                className="w-full p-3 bg-white/10 hover:bg-white/20 rounded-lg text-left text-white flex items-center justify-between disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="truncate">{rom.name}</span>
                <span className="text-white/40 text-sm">
                  {rom.blobUrl ? "Play" : "Expired"}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Emulator view with iframe
function EmulatorView({
  romUrl,
  romName,
  system,
  gameId,
  saveSaveState,
  loadSaveState,
  onExit,
}: {
  romUrl: string;
  romName: string;
  system: SystemType;
  gameId: string;
  saveSaveState: (gameId: string, slot: string, data: string) => void;
  loadSaveState: (gameId: string, slot: string) => string | undefined;
  onExit: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Only accept messages from same origin
      if (event.origin !== window.location.origin) return;

      if (event.data.type === "ready") {
        setIsReady(true);

        // Auto-load save state if one exists
        const savedState = loadSaveState(gameId, "autoSave");
        if (savedState && iframeRef.current?.contentWindow) {
          try {
            // Convert base64 back to Uint8Array
            const binary = Uint8Array.from(atob(savedState), (c) => c.charCodeAt(0));
            iframeRef.current.contentWindow.postMessage(
              { type: "loadState", data: binary },
              window.location.origin
            );
          } catch (e) {
            console.error("Failed to load save state:", e);
          }
        }
      }

      // Handle save state from emulator
      if (event.data.type === "saveState" && event.data.data) {
        try {
          // Convert binary data to base64 for storage
          const uint8Array = new Uint8Array(event.data.data);
          const base64 = btoa(String.fromCharCode(...uint8Array));
          saveSaveState(gameId, "autoSave", base64);
        } catch (e) {
          console.error("Failed to save state:", e);
        }
      }

      // Handle load state request from emulator
      if (event.data.type === "requestLoadState") {
        const savedState = loadSaveState(gameId, "autoSave");
        if (savedState && iframeRef.current?.contentWindow) {
          try {
            const binary = Uint8Array.from(atob(savedState), (c) => c.charCodeAt(0));
            iframeRef.current.contentWindow.postMessage(
              { type: "loadState", data: binary },
              window.location.origin
            );
          } catch (e) {
            console.error("Failed to send load state:", e);
          }
        }
      }

      // Handle exit from EmulatorJS controls
      if (event.data.type === "emulator-exit") {
        onExit();
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [gameId, saveSaveState, loadSaveState, onExit]);

  // Build the emulator URL with params
  const emulatorUrl = `/emulator/index.html?core=${encodeURIComponent(SYSTEMS[system].ejsCore)}&rom=${encodeURIComponent(romUrl)}&name=${encodeURIComponent(romName)}`;

  return (
    <div className="fixed inset-0 bg-black flex flex-col z-50">
      {/* Floating back button - always visible, even in fullscreen */}
      <button
        onClick={onExit}
        className="fixed top-4 left-4 z-[9999] px-4 py-2 bg-black/80 hover:bg-red-600
                   text-white rounded-lg flex items-center gap-2 text-sm font-bold
                   shadow-lg backdrop-blur-sm transition-all active:scale-95 border border-white/20"
      >
        ← Back to Games
      </button>

      {/* Header bar */}
      <div className="bg-gray-900 p-2 flex items-center justify-between shrink-0">
        <button
          onClick={onExit}
          className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg transition-colors"
        >
          Exit
        </button>
        <span className="text-white font-semibold truncate mx-4">{romName}</span>
        <div className="text-white/60 text-sm">{SYSTEMS[system].name}</div>
      </div>

      {/* Emulator iframe */}
      <div className="flex-1 relative">
        {!isReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-black z-10">
            <div className="text-center">
              <div className="text-6xl mb-4 animate-bounce">
                {SYSTEMS[system].icon}
              </div>
              <p className="text-white text-xl">Loading emulator...</p>
            </div>
          </div>
        )}

        <iframe
          ref={iframeRef}
          src={emulatorUrl}
          className="w-full h-full border-0"
          allow="autoplay; fullscreen; gamepad"
          allowFullScreen
        />
      </div>
    </div>
  );
}

// Main game component
export function RetroArcadeGame() {
  const store = useRetroArcadeStore();
  const [showUploader, setShowUploader] = useState(false);

  // Auth sync
  const { isAuthenticated, syncStatus } = useAuthSync({
    appId: "retro-arcade",
    localStorageKey: "retro-arcade-progress",
    getState: () => store.getProgress(),
    setState: (data) => store.setProgress(data),
    debounceMs: 3000,
  });

  const handleConsoleSelect = (system: SystemType) => {
    store.setCurrentSystem(system);
  };

  const handleRomLoaded = (url: string, name: string) => {
    if (store.currentSystem) {
      store.startGame(url, name, store.currentSystem);
    }
  };

  const handleBack = () => {
    store.setCurrentSystem(null);
    setShowUploader(false);
  };

  const handleGameSelect = (game: CatalogGame, romUrl: string) => {
    if (store.currentSystem) {
      store.startGame(romUrl, game.displayName, store.currentSystem);
    }
  };

  const handleToggleFavorite = (gameId: string) => {
    if (store.isFavorite(gameId)) {
      store.removeFavorite(gameId);
    } else {
      store.addFavorite(gameId);
    }
  };

  const handleExit = () => {
    store.stopGame();
  };

  // If playing, show emulator
  if (store.isPlaying && store.currentRomUrl && store.currentSystem) {
    // Generate a consistent gameId for save states
    const gameId = `${store.currentSystem}-${store.currentRomName || "unknown"}`;
    return (
      <EmulatorView
        romUrl={store.currentRomUrl}
        romName={store.currentRomName || "Game"}
        system={store.currentSystem}
        gameId={gameId}
        saveSaveState={store.saveSaveState}
        loadSaveState={store.loadSaveState}
        onExit={handleExit}
      />
    );
  }

  // If a console is selected, show game browser or ROM uploader
  if (store.currentSystem) {
    const system = SYSTEMS[store.currentSystem];

    // Get catalog info for systems that have pre-loaded games
    const getCatalogInfo = (): {
      catalog: CatalogGame[];
      getRomUrl: (game: CatalogGame) => string;
      systemName: string;
    } | null => {
      if (store.currentSystem === "snes") {
        return {
          catalog: SNES_CATALOG as CatalogGame[],
          getRomUrl: getSnesRomUrl as (game: CatalogGame) => string,
          systemName: "SNES",
        };
      }
      if (store.currentSystem === "atari2600") {
        return {
          catalog: ATARI_2600_CATALOG as CatalogGame[],
          getRomUrl: getAtariRomUrl as (game: CatalogGame) => string,
          systemName: "Atari 2600",
        };
      }
      return null;
    };

    const catalogInfo = getCatalogInfo();

    // Systems with catalogs get game browser (SNES, Atari 2600)
    if (catalogInfo && !showUploader) {
      return (
        <div
          className={`min-h-screen bg-gradient-to-b ${system.bgGradient} p-4 sm:p-6 flex flex-col`}
        >
          <header className="mb-4 sm:mb-6">
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={handleBack}
                className="px-3 py-2 bg-white/20 hover:bg-white/30 text-white font-bold rounded-lg transition-colors text-sm sm:text-base"
              >
                Back
              </button>
              <div className="text-white/60 text-sm">
                {catalogInfo.catalog.length} games
              </div>
            </div>
            <h1 className="text-2xl sm:text-4xl font-bold text-white text-center">
              {system.fullName}
            </h1>
            <p className="text-white/70 text-center mt-1 text-sm sm:text-base">
              Pick a game to play!
            </p>
          </header>

          <div className="flex-1 overflow-y-auto">
            <GameBrowser
              catalog={catalogInfo.catalog}
              getRomUrl={catalogInfo.getRomUrl}
              systemName={catalogInfo.systemName}
              onGameSelect={handleGameSelect}
              onUploadClick={() => setShowUploader(true)}
              favoriteIds={store.favorites}
              onToggleFavorite={handleToggleFavorite}
            />
          </div>

          {/* Sync status */}
          {isAuthenticated && (
            <div className="fixed bottom-2 right-2 text-xs text-white/40">
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

    // Check if this system has a catalog (can go back to library)
    const hasCatalog = store.currentSystem === "snes" || store.currentSystem === "atari2600";

    // Other systems (or catalog systems with uploader) show ROM uploader
    return (
      <div
        className={`min-h-screen bg-gradient-to-b ${system.bgGradient} p-6 flex flex-col`}
      >
        <header className="mb-8">
          <button
            onClick={() => {
              if (hasCatalog && showUploader) {
                setShowUploader(false);
              } else {
                handleBack();
              }
            }}
            className="mb-4 px-4 py-2 bg-white/20 hover:bg-white/30 text-white font-bold rounded-lg transition-colors"
          >
            {hasCatalog && showUploader ? "Back to Library" : "Back to Consoles"}
          </button>
          <h1 className="text-4xl font-bold text-white text-center">
            {system.fullName}
          </h1>
          <p className="text-white/70 text-center mt-2">
            Upload your own ROM file to play
          </p>
        </header>

        <div className="flex-1 flex items-center justify-center">
          <RomUploader system={system} onRomLoaded={handleRomLoaded} />
        </div>

        {/* Sync status */}
        {isAuthenticated && (
          <div className="fixed bottom-2 right-2 text-xs text-white/40">
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

  // Show console selection
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 p-6 flex flex-col">
      {/* iOS install prompt */}
      <IOSInstallPrompt />

      {/* Fullscreen button */}
      <div className="fixed top-4 right-4 z-50">
        <FullscreenButton />
      </div>

      <header className="text-center mb-8">
        <h1 className="text-5xl font-bold text-white mb-2">Retro Arcade</h1>
        <p className="text-white/70 text-xl">Pick a console to play!</p>
      </header>

      {/* Console grid */}
      <div className="flex-1 flex items-center justify-center">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-w-4xl">
          {SYSTEM_IDS.map((id) => (
            <ConsoleCard
              key={id}
              system={SYSTEMS[id]}
              onClick={() => handleConsoleSelect(id)}
            />
          ))}
        </div>
      </div>

      {/* Recently played */}
      {store.recentlyPlayed.length > 0 && (
        <div className="mt-8 max-w-4xl mx-auto w-full">
          <h2 className="text-xl font-bold text-white mb-4">Recently Played</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {store.recentlyPlayed.slice(0, 6).map((game) => (
              <div
                key={game.gameId}
                className="p-3 bg-white/10 rounded-lg text-white flex items-center justify-between"
              >
                <span className="truncate">{game.name}</span>
                <span className="text-white/40 text-sm ml-2">
                  {SYSTEMS[game.system]?.name || game.system}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sync status */}
      {isAuthenticated && (
        <div className="fixed bottom-2 right-2 text-xs text-white/40">
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

export default RetroArcadeGame;
