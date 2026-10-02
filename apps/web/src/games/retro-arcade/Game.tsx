"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useRetroArcadeStore, type RomSource } from "./lib/store";
import {
  SYSTEMS,
  SYSTEM_IDS,
  isValidRomFile,
  type SystemType,
  type SystemInfo,
} from "./lib/constants";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { useCoarsePointer } from "@/shared/hooks/useCoarsePointer";
import { useScrollToTopOn } from "@/shared/hooks/useScrollToTopOn";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import { ReadAloudButton } from "@/shared/components/ReadAloudButton";
import { RestartConfirmationDialog } from "@/shared/components/RestartConfirmationDialog";
import { RestartGameButton } from "@/shared/components/RestartGameButton";
import { RETRO_ARCADE_INSTRUCTIONS } from "./lib/readAloud";
import { GameBrowser, type CatalogGame } from "./components/GameBrowser";
import {
  SNES_CATALOG,
  getRomUrl as getSnesRomUrl,
} from "./lib/snes-catalog";
import {
  ATARI_2600_CATALOG,
  getRomUrl as getAtariRomUrl,
} from "./lib/atari-2600-catalog";
import { recentGamesToShow, type CatalogNamesBySystem } from "./lib/recentGames";
import { saveStateStore, type SaveSlot, type SaveStateStore } from "./lib/saveStates";
import {
  parseEmulatorMessage,
  SAVE_MESSAGES,
  type LoadReason,
  type ParentMessage,
} from "./lib/emulatorMessages";
import { useSaveOwner } from "./hooks/useSaveOwner";
import { SaveNotice, type Notice, type NoticeTone } from "./components/SaveNotice";
import { SavedGames } from "./components/SavedGames";
import { ContentNoticeCard } from "./components/ContentNoticeCard";
import { findOpenNoticeRule } from "./lib/contentNotice";
import type { TitleCandidate } from "./lib/content-match";

// Recently Played shows only games that a catalog still lists (or that the
// player uploaded), so a removed title's name does not stay on screen.
const CATALOG_NAMES: CatalogNamesBySystem = {
  snes: new Set(SNES_CATALOG.map((game) => game.displayName)),
  atari2600: new Set(ATARI_2600_CATALOG.map((game) => game.displayName)),
};

/** How many games each console's catalog has (none: a kid brings a file). */
export const CATALOG_COUNTS: Partial<Record<SystemType, number>> = {
  snes: SNES_CATALOG.length,
  atari2600: ATARI_2600_CATALOG.length,
};

/**
 * The consoles in picker order: the ones with games first, then the ones
 * that need a file. The picker used to follow SYSTEM_IDS (NES first), so
 * five of the first seven cards opened "Upload your own ROM", a dead end on
 * a phone, and Atari 2600, with 741 games, was last and under the fold.
 */
export const PICKER_ORDER: SystemType[] = [
  ...SYSTEM_IDS.filter((id) => CATALOG_COUNTS[id]),
  ...SYSTEM_IDS.filter((id) => !CATALOG_COUNTS[id]),
];

/**
 * A game's name for the bar over the emulator: "bucket.smc" is "Bucket",
 * "super_mario_world.sfc" is "Super Mario World". A catalog name
 * ("Super Boss Gaiden") stays as it is.
 */
export function prettyRomName(name: string): string {
  const bare = name.replace(/\.[A-Za-z0-9]{1,4}$/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!bare) return name;
  if (bare !== bare.toLowerCase()) return bare;
  return bare.replace(/(^|[\s-])([a-z])/g, (_m, sep: string, c: string) => sep + c.toUpperCase());
}

// Console selection card: one flat, solid color per console (SystemInfo.cardColor),
// white text, no gradient and no colored border. A press scales the card down a
// little; a mouse hover makes it a little brighter.
function ConsoleCard({
  system,
  games,
  onClick,
}: {
  system: SystemInfo;
  /** The number of games in its catalog, if it has one. */
  games?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`console-${system.id}`}
      className={`${system.cardColor} relative min-w-0 cursor-pointer touch-manipulation rounded-2xl p-4 text-white shadow-lg transition-[transform,filter] duration-150 ease-out hover:brightness-110 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white active:scale-[0.97] motion-reduce:transition-none short:p-2`}
    >
      <div className="mb-1 text-5xl short:text-3xl" aria-hidden="true">{system.icon}</div>
      <h3 className="text-xl font-bold short:text-lg">{system.name}</h3>
      <p className="text-sm font-medium short:hidden">{system.fullName}</p>
      {games ? (
        <p className="mt-1 inline-block rounded-full bg-black/30 px-2 py-0.5 text-sm font-bold">🎮 {games} games</p>
      ) : (
        <p className="mt-1 text-sm font-medium">📁 Your own file</p>
      )}
    </button>
  );
}

// ROM upload component
function RomUploader({
  system,
  onRomLoaded,
}: {
  system: SystemInfo;
  onRomLoaded: (rom: Blob, name: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const store = useRetroArcadeStore();
  const isCoarse = useCoarsePointer();

  const handleFile = useCallback(
    (file: File) => {
      setError(null);

      if (!isValidRomFile(file, system.id)) {
        setError(
          `Invalid file type. Please upload a ${system.extensions.join(", ")} file.`
        );
        return;
      }

      // Keep the file itself. EmulatorView makes a new object URL for each
      // start (see RomSource in lib/store.ts). Read the store when the
      // handler runs (issue #56): the whole store in the deps made this a
      // new function after every set().
      useRetroArcadeStore.getState().addCustomRom({
        id: `${system.id}-${file.name}-${Date.now()}`,
        name: file.name,
        system: system.id,
        addedAt: Date.now(),
        file,
      });

      onRomLoaded(file, file.name);
    },
    [system, onRomLoaded]
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
        className={`border-4 border-dashed rounded-2xl p-5 text-center transition-colors short:p-3 ${
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

        {/* The button first: on a phone it is the one thing to do here (it
            was under a big icon and two paragraphs, below the fold). */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="min-h-12 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-lg transition-colors"
        >
          📁 Choose File
        </button>
        <p className="mt-3 text-base text-white/80">
          {isCoarse
            ? `Tap Choose File to pick a ${system.name} game file`
            : "Or drag a game file here"}
        </p>
        <p className="mt-1 text-sm text-white/70">
          Files: {system.extensions.join(", ")}
        </p>
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
                  if (rom.file) {
                    onRomLoaded(rom.file, rom.name);
                  }
                }}
                disabled={!rom.file}
                className="w-full min-h-11 p-3 bg-white/10 hover:bg-white/20 rounded-lg text-left text-white flex items-center justify-between disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="truncate">{rom.name}</span>
                <span className="text-white/40 text-sm">
                  {rom.file ? "Play" : "Expired"}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Stacking contract of the site (z-index, low to high; the full list is in
 * design/ARCHITECTURE.md): GameShell header 1000, toasts 1050 (the clip
 * toast slot too), emulator view 1100, celebrations 1150
 * (AchievementCelebrations), result chip 1200, modals 1500, pause menu
 * 2000, sheets 2500 (the clip sheets too), dialogs 3000.
 *
 * The emulator view is full screen above the header and the toasts, so its
 * Back button is never under the header and a toast never covers the game.
 * A celebration shows above the game on purpose. A sheet or a dialog (the
 * restart question) opens above all of them.
 */
export const EMULATOR_VIEW_Z = 1100;

/** How long the parent waits for the emulator to send its state. */
const CAPTURE_TIMEOUT_MS = 4000;
/** How long a save waits for the session to name the owner. */
const OWNER_TIMEOUT_MS = 5000;

// Emulator view with iframe
function EmulatorView({
  rom,
  romName,
  system,
  gameId,
  owner,
  autoSaveOnExit,
  onExit,
  onRestart,
  skipAutoLoad = false,
  store = saveStateStore,
}: {
  rom: RomSource;
  romName: string;
  system: SystemType;
  gameId: string;
  /** The owner of the saves (see lib/ownerKey.ts). Null while the session loads. */
  owner: string | null;
  autoSaveOnExit: boolean;
  /** Leaves the game. `problem` is a message for the next screen. */
  onExit: (problem?: string) => void;
  onRestart: () => void;
  skipAutoLoad?: boolean;
  store?: SaveStateStore;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isReady, setIsReady] = useState(false);
  const readyRef = useRef(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [exiting, setExiting] = useState(false);
  const exitingRef = useRef(false);
  const [restartOpen, setRestartOpen] = useState(false);
  const restartTriggerRef = useRef<HTMLButtonElement>(null);
  const capturesRef = useRef(new Map<number, (state: ArrayBuffer | null) => void>());
  const nextRequestRef = useRef(1);

  // The owner can arrive after the game starts (the session loads). A save
  // waits for it; it never goes to a guessed owner.
  const ownerRef = useRef<string | null>(owner);
  const ownerWaitersRef = useRef<((owner: string) => void)[]>([]);
  useEffect(() => {
    ownerRef.current = owner;
    if (!owner) return;
    const waiters = ownerWaitersRef.current;
    ownerWaitersRef.current = [];
    for (const resolve of waiters) resolve(owner);
  }, [owner]);
  const getOwner = useCallback((): Promise<string | null> => {
    if (ownerRef.current) return Promise.resolve(ownerRef.current);
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        ownerWaitersRef.current = ownerWaitersRef.current.filter((w) => w !== done);
        resolve(null);
      }, OWNER_TIMEOUT_MS);
      const done = (value: string) => {
        window.clearTimeout(timer);
        resolve(value);
      };
      ownerWaitersRef.current.push(done);
    });
  }, []);

  const show = useCallback((text: string, tone: NoticeTone) => setNotice({ text, tone }), []);
  const dismiss = useCallback(() => setNotice(null), []);

  const meta = useMemo(() => ({ gameId, name: romName, system }), [gameId, romName, system]);

  const post = useCallback((message: ParentMessage, transfer: Transferable[] = []) => {
    const target = iframeRef.current?.contentWindow;
    if (!target) return false;
    target.postMessage(message, window.location.origin, transfer);
    return true;
  }, []);

  /** Asks the emulator for its current state. Null when it does not answer. */
  const capture = useCallback((): Promise<ArrayBuffer | null> => {
    if (!readyRef.current) return Promise.resolve(null);
    const requestId = nextRequestRef.current++;
    return new Promise((resolve) => {
      const finish = (state: ArrayBuffer | null) => {
        window.clearTimeout(timer);
        capturesRef.current.delete(requestId);
        resolve(state);
      };
      const timer = window.setTimeout(() => finish(null), CAPTURE_TIMEOUT_MS);
      capturesRef.current.set(requestId, finish);
      if (!post({ type: "captureState", requestId })) finish(null);
    });
  }, [post]);

  /**
   * Keeps the current state in the "auto" slot. Returns a message for the
   * kid when that fails, or null.
   */
  const autoSave = useCallback(async (): Promise<string | null> => {
    if (!autoSaveOnExit || !readyRef.current) return null;
    const state = await capture();
    if (!state) return SAVE_MESSAGES.saveFailed;
    const ownerKey = await getOwner();
    if (!ownerKey) return SAVE_MESSAGES.saveFailed;
    try {
      await store.put(ownerKey, meta, "auto", state);
      return null;
    } catch (error) {
      console.warn("Retro Arcade could not keep the auto save", error);
      return SAVE_MESSAGES.didNotFit;
    }
  }, [autoSaveOnExit, capture, getOwner, meta, store]);

  const handleExit = useCallback(async () => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    setExiting(true);
    const problem = await autoSave();
    onExit(problem ?? undefined);
  }, [autoSave, onExit]);

  // A kid who switches apps or locks the iPad keeps their spot.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== "hidden" || exitingRef.current) return;
      void autoSave().then((problem) => {
        if (problem) show(problem, "error");
      });
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [autoSave, show]);

  const loadSlot = useCallback(
    async (slot: SaveSlot, reason: LoadReason) => {
      const ownerKey = await getOwner();
      if (!ownerKey) {
        if (reason === "manual") show(SAVE_MESSAGES.loadFailed, "error");
        return;
      }
      let state: ArrayBuffer | null;
      try {
        state = await store.get(ownerKey, gameId, slot);
      } catch (error) {
        console.warn("Retro Arcade could not read a save", error);
        show(SAVE_MESSAGES.loadFailed, "error");
        return;
      }
      if (!state) {
        if (reason === "manual") show(SAVE_MESSAGES.noSave, "info");
        return;
      }
      if (!post({ type: "loadState", state, reason }, [state])) {
        show(SAVE_MESSAGES.loadFailed, "error");
      }
    },
    [gameId, getOwner, post, show, store]
  );

  const saveManual = useCallback(
    async (state: ArrayBuffer) => {
      const ownerKey = await getOwner();
      if (!ownerKey) {
        show(SAVE_MESSAGES.saveFailed, "error");
        return;
      }
      try {
        await store.put(ownerKey, meta, "manual", state);
        show(SAVE_MESSAGES.saved, "info");
      } catch (error) {
        console.warn("Retro Arcade could not keep a save", error);
        show(SAVE_MESSAGES.didNotFit, "error");
      }
    },
    [getOwner, meta, show, store]
  );

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Only this game's emulator iframe, on this site.
      if (event.origin !== window.location.origin) return;
      const frame = iframeRef.current?.contentWindow;
      if (!frame || event.source !== frame) return;
      const message = parseEmulatorMessage(event.data);
      if (!message) return;

      switch (message.type) {
        case "ready":
          readyRef.current = true;
          setIsReady(true);
          // Start where the kid stopped, unless they asked to start over.
          if (!skipAutoLoad) void loadSlot("auto", "resume");
          break;
        case "saveState":
          void saveManual(message.state);
          break;
        case "saveStateFailed":
          show(SAVE_MESSAGES.saveFailed, "error");
          break;
        case "requestLoadState":
          void loadSlot("manual", "manual");
          break;
        case "capturedState":
          capturesRef.current.get(message.requestId)?.(message.state);
          break;
        case "stateLoaded":
          show(message.reason === "resume" ? SAVE_MESSAGES.resumed : SAVE_MESSAGES.loaded, "info");
          break;
        case "stateLoadFailed":
          show(SAVE_MESSAGES.loadFailed, "error");
          break;
        case "emulator-exit":
          void handleExit();
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleExit, loadSlot, saveManual, show, skipAutoLoad]);

  // Build the emulator URL with params. "core" is the Retro Arcade console
  // (the name of the parameter is historical). The emulator page sets the
  // EmulatorJS core and control layout of the console (SYSTEMS[system].ejsCore
  // and ejsControlScheme; emulator-page.test.ts keeps the two the same).
  // Start the emulator page with the ROM of this start. A catalog ROM is a
  // URL on this site. For an uploaded file, each start (each mount; Start
  // over remounts this view) gets a new object URL, and the URL is revoked
  // when that start ends. EmulatorJS revokes the URL after it reads the ROM,
  // so no start may use the URL of an earlier start (RomSource, lib/store.ts).
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const objectUrl = typeof rom === "string" ? null : URL.createObjectURL(rom);
    const romUrl = objectUrl ?? (rom as string);
    iframe.src = `/emulator/index.html?core=${encodeURIComponent(system)}&rom=${encodeURIComponent(romUrl)}&name=${encodeURIComponent(romName)}`;
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [rom, romName, system]);

  return (
    <div
      data-testid="emulator-view"
      className="fixed inset-0 z-[1100] flex flex-col bg-black"
      style={{
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {/* Top bar: the one way back, always on screen above the game. */}
      <div
        className="flex shrink-0 items-center gap-2 bg-gray-900 px-2 pb-1"
        style={{ paddingTop: "max(0.25rem, env(safe-area-inset-top))" }}
      >
        <button
          type="button"
          onClick={() => void handleExit()}
          disabled={exiting}
          className="min-h-[44px] shrink-0 rounded-lg bg-red-600 px-4 font-bold text-white transition-transform hover:bg-red-500 active:scale-95 disabled:opacity-80"
        >
          {exiting ? (
            "Saving..."
          ) : (
            <span aria-label="Back to Games">
              ← Back<span className="short:hidden">{" "}to Games</span>
            </span>
          )}
        </button>
        <span className="min-w-0 flex-1 truncate font-semibold text-white">{prettyRomName(romName)}</span>
        <span className="hidden shrink-0 text-sm text-white/60 sm:inline">{SYSTEMS[system].name}</span>
        <RestartGameButton
          ref={restartTriggerRef}
          onClick={() => setRestartOpen(true)}
          className="shrink-0 text-white"
        />
      </div>

      {/* Emulator iframe */}
      <div className="relative flex-1">
        {!isReady && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black">
            <div className="text-center">
              <div className="mb-4 text-6xl animate-bounce">{SYSTEMS[system].icon}</div>
              <p className="text-xl text-white">Loading emulator...</p>
            </div>
          </div>
        )}

        {/* The effect above sets src, with the ROM URL of this start. */}
        <iframe
          ref={iframeRef}
          title={`${romName} on the ${SYSTEMS[system].name}`}
          className="h-full w-full border-0"
          allow="autoplay; fullscreen; gamepad"
        />

        <SaveNotice notice={notice} onDismiss={dismiss} className="absolute inset-x-0 top-2 z-20" />
      </div>

      <RestartConfirmationDialog
        isOpen={restartOpen}
        gameName={romName}
        message={`Start ${romName} again from the beginning? Your saves stay safe.`}
        triggerRef={restartTriggerRef}
        onCancel={() => setRestartOpen(false)}
        onConfirm={() => {
          setRestartOpen(false);
          onRestart();
        }}
      />
    </div>
  );
}

/** A game that a player asked to open. */
interface OpenRequest {
  rom: RomSource;
  /** The name for the store, the saves and the bar over the emulator. */
  name: string;
  system: SystemType;
  /** What the content rules read: the catalog entry, or the uploaded file name. */
  title: TitleCandidate;
}

// Main game component
export function RetroArcadeGame() {
  const store = useRetroArcadeStore();
  const [showUploader, setShowUploader] = useState(false);
  const isCoarse = useCoarsePointer();
  // The consoles that need a game file stay folded on a phone.
  const [showFileConsoles, setShowFileConsoles] = useState(false);
  // Every screen starts at its top: the catalog opened 355 px down (569
  // sideways), past its title and search, and the uploaders 233-257 px down.
  useScrollToTopOn(`${store.currentSystem ?? ""}|${showUploader}|${store.isPlaying}`);
  const saveOwner = useSaveOwner();
  // A save problem that happened while the kid left a game. It shows on the
  // next screen, so it is never silent.
  const [exitNotice, setExitNotice] = useState<Notice | null>(null);
  const dismissExitNotice = useCallback(() => setExitNotice(null), []);
  // A mainstream violent classic that waits behind the heads-up card.
  const [pendingOpen, setPendingOpen] = useState<OpenRequest | null>(null);

  // A visit to the arcade never resumes a game that it did not start. The
  // store lives in memory for the whole tab, so without this a game left
  // running by the browser's back button (iOS swipe-back) came back on the
  // next visit with no heads-up card: an older kid plays Mortal Kombat,
  // swipes back, and a younger kid opens Retro Arcade. Each new visit
  // starts at the list, and every game opens through openGame.
  useEffect(() => () => useRetroArcadeStore.getState().stopGame(), []);

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

  // The one place that starts a game. Only openGame and the card's Play
  // button call it (content-notice.test.ts fails on a second caller). A
  // start drops a card that waits for another game, so that card never
  // comes back by itself after this game.
  const launchGame = (request: OpenRequest) => {
    setPendingOpen(null);
    store.startGame(request.rom, request.name, request.system);
  };

  // The one gate in front of launchGame. Every way to open a game comes
  // here: a catalog card (all, a genre, favorites, a search), a new upload,
  // and "Your ROMs". A title that a notice rule matches (Jack, 2026-10-02)
  // waits behind the heads-up card. The card shows each time.
  const openGame = (request: OpenRequest) => {
    if (findOpenNoticeRule(request.title)) {
      setPendingOpen(request);
      return;
    }
    launchGame(request);
  };

  const handleRomLoaded = (rom: Blob, name: string) => {
    if (store.currentSystem) {
      openGame({
        rom,
        name,
        system: store.currentSystem,
        title: { displayName: name, filename: name },
      });
    }
  };

  const handleBack = () => {
    setPendingOpen(null);
    store.setCurrentSystem(null);
    setShowUploader(false);
  };

  const handleGameSelect = (game: CatalogGame, romUrl: string) => {
    // The console now, not the console of the render that made this handler.
    const system = useRetroArcadeStore.getState().currentSystem;
    if (system) {
      openGame({ rom: romUrl, name: game.displayName, system, title: game });
    }
  };

  const noticeCard = pendingOpen ? (
    <ContentNoticeCard
      onPlay={() => {
        setPendingOpen(null);
        launchGame(pendingOpen);
      }}
      onPickAnother={() => setPendingOpen(null)}
    />
  ) : null;

  const handleToggleFavorite = (gameId: string) => {
    if (store.isFavorite(gameId)) {
      store.removeFavorite(gameId);
    } else {
      store.addFavorite(gameId);
    }
  };

  const handleExit = (problem?: string) => {
    store.stopGame();
    setExitNotice(problem ? { text: problem, tone: "error" } : null);
  };

  const exitNoticeView = (
    <SaveNotice
      notice={exitNotice}
      onDismiss={dismissExitNotice}
      className="fixed inset-x-0 top-16 z-[1050]"
    />
  );

  // If playing, show emulator
  if (store.isPlaying && store.currentRom && store.currentSystem) {
    // Generate a consistent gameId for save states
    const gameId = `${store.currentSystem}-${store.currentRomName || "unknown"}`;
    return (
      <EmulatorView
        key={store.restartNonce}
        rom={store.currentRom}
        romName={store.currentRomName || "Game"}
        system={store.currentSystem}
        gameId={gameId}
        owner={saveOwner}
        autoSaveOnExit={store.settings.autoSaveOnExit}
        onExit={handleExit}
        onRestart={store.restartGame}
        skipAutoLoad={store.restartNonce > 0}
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
          data-testid="retro-catalog"
          className={`flex h-full flex-col bg-gradient-to-b ${system.bgGradient} p-3 sm:p-6 short:p-2`}
        >
          {exitNoticeView}
          {noticeCard}
          {/* One row: Back, the console and its count. The games scroll
              under it (the search stays at their top). */}
          <header className="mb-2 flex shrink-0 items-center gap-2 sm:mb-4 short:mb-1">
            <button
              type="button"
              onClick={handleBack}
              className="min-h-11 shrink-0 rounded-lg bg-white/20 px-3 font-bold text-white transition-colors hover:bg-white/30"
            >
              ← Back
            </button>
            <h1 className="min-w-0 flex-1 truncate text-center text-xl font-bold text-white sm:text-3xl">
              {system.icon} {system.fullName}
            </h1>
            <div className="shrink-0 text-sm text-white/80">{catalogInfo.catalog.length} games</div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
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
        data-testid="retro-uploader"
        className={`min-h-full bg-gradient-to-b ${system.bgGradient} p-3 sm:p-6 flex flex-col`}
      >
        {exitNoticeView}
        {noticeCard}
        <header className="mb-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setPendingOpen(null);
              if (hasCatalog && showUploader) {
                setShowUploader(false);
              } else {
                handleBack();
              }
            }}
            className="min-h-11 shrink-0 rounded-lg bg-white/20 px-3 font-bold text-white transition-colors hover:bg-white/30"
          >
            ← {hasCatalog && showUploader ? "Games" : "Consoles"}
          </button>
          <h1 className="min-w-0 flex-1 truncate text-center text-xl font-bold text-white sm:text-3xl">
            {system.icon} {system.fullName}
          </h1>
        </header>

        <div className="flex-1 flex items-start justify-center sm:items-center">
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
  const recentGames = recentGamesToShow(store.recentlyPlayed, CATALOG_NAMES, store.customRoms);
  // A phone cannot drop a file, and a kid rarely has one: the consoles with
  // games show first, and the ones that need a file wait under a fold.
  const withGames = PICKER_ORDER.filter((id) => CATALOG_COUNTS[id]);
  const needFile = PICKER_ORDER.filter((id) => !CATALOG_COUNTS[id]);
  const showNeedFile = !isCoarse || showFileConsoles;
  return (
    <div data-testid="retro-picker" className="min-h-full bg-gradient-to-b from-gray-900 to-gray-800 p-3 sm:p-6 flex flex-col">
      {exitNoticeView}
      {/* iOS install prompt */}
      <IOSInstallPrompt />

      {/* The title, and Read it to me beside it (first screen only, never
          over the emulator): a round button, so a first tap meant for a
          console never starts the voice. */}
      <div className="mx-auto mb-3 flex w-full max-w-4xl items-center gap-2">
        <h1 className="min-w-0 flex-1 text-2xl font-bold text-white short:text-xl">🕹️ Pick a console</h1>
        <ReadAloudButton text={RETRO_ARCADE_INSTRUCTIONS} variant="icon" />
      </div>

      {/* Console grid */}
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <div className="grid w-full max-w-4xl grid-cols-2 gap-3 short:grid-cols-4 md:grid-cols-3">
          {withGames.map((id) => (
            <ConsoleCard key={id} system={SYSTEMS[id]} games={CATALOG_COUNTS[id]} onClick={() => handleConsoleSelect(id)} />
          ))}
          {showNeedFile &&
            needFile.map((id) => <ConsoleCard key={id} system={SYSTEMS[id]} onClick={() => handleConsoleSelect(id)} />)}
        </div>
        {!showNeedFile && (
          <button
            type="button"
            data-testid="show-file-consoles"
            onClick={() => setShowFileConsoles(true)}
            className="min-h-11 rounded-xl border-2 border-dashed border-white/40 px-4 py-2 text-base text-white/90"
          >
            📁 Have your own game file? More consoles
          </button>
        )}
      </div>

      {/* Recently played */}
      {recentGames.length > 0 && (
        <div className="mt-6 max-w-4xl mx-auto w-full">
          <h2 className="text-xl font-bold text-white mb-3">Recently Played</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {recentGames.slice(0, 6).map((game) => (
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

      {/* Save states on this device, with Delete for each game */}
      <SavedGames owner={saveOwner} />

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
