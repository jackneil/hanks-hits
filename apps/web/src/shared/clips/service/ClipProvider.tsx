"use client";

/**
 * ClipProvider (plan 4.1). GameShell mounts it (through ClipShellScope) for a
 * module whose metadata literal is clips: true (clipsEnabledFor).
 *
 * - The server and the first client render give no service (the
 *   useSyncExternalStore mounted pattern), so the markup is the children
 *   only, and hydration matches. The providers are always in the tree with a
 *   null value until the service exists, so the game never remounts.
 * - After mount it reads the clips flag (config.ts). When capture is on, it
 *   loads the service with a dynamic import (the capture runtime and the
 *   workers load later, only when the game registers a canvas).
 * - It attaches the game (GameAttachment), provides ClipServiceContext and
 *   AttachedGameContext, and detaches on unmount.
 * - Breaks (plan 11.1): the game is at a break while a start card is on
 *   screen (useStartOverlayPresence), while the shell's pause menu is open
 *   (the paused prop), or while the game itself says it does not play
 *   (useClipSource isPlaying, or setAtBreak on the attached game). The
 *   provider joins these into one setAtBreak, so no source overrides another.
 * - Runs (plan 11.5 zero-code rule): a start card that goes away starts a
 *   run, and a start card that comes back ends it.
 * - The signed-in player reaches the service through the session bus
 *   (ClipSessionWatcher in AuthProvider), on every page.
 *
 * useClipSource(canvasRef, options) is the one line a canvas game adds.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";

import { getGameMetadata } from "@/shared/lib/gameMetadata.generated";
import { useStartOverlayPresence } from "@/shared/lib/startOverlayPresence";
import { loadClipsVerdict } from "../config";
import { ClipUiMount } from "../shell/ClipUiMount";
import type { ClipService } from "./ClipService";
import { AttachedGameContext, ClipServiceContext, useAttachedGame } from "./context";
import type { AttachedGame, GameAttachment } from "./contract";

/** True when the module's metadata literal says clips: true (the generated lookup). */
export function clipsEnabledFor(appId: string | null | undefined): boolean {
  return !!appId && getGameMetadata(appId).clips === true;
}

const noopSubscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

/** False on the server and in the hydration render, true after. */
function useMounted(): boolean {
  return useSyncExternalStore(noopSubscribe, onClient, onServer);
}

export interface ClipProviderProps {
  game: GameAttachment;
  children: ReactNode;
  /** The shell's pause menu is open (GameShell isPaused): a break. */
  paused?: boolean;
  /** Tests: the service to use instead of loading one. */
  loadService?: () => Promise<ClipService | null>;
}

async function defaultLoadService(): Promise<ClipService | null> {
  const verdict = await loadClipsVerdict();
  if (!verdict.capture) return null;
  const { startClipService } = await import("./ClipService");
  return startClipService();
}

/** The break sources that the provider joins (see the file comment). */
interface BreakSources {
  startCard: boolean;
  paused: boolean;
  game: boolean;
}

export function ClipProvider({ game, children, paused = false, loadService = defaultLoadService }: ClipProviderProps) {
  const mounted = useMounted();
  const [service, setService] = useState<ClipService | null>(null);
  const [attached, setAttached] = useState<AttachedGame | null>(null);
  const gameRef = useRef(game);
  const startCard = useStartOverlayPresence((s) => s.count > 0);
  const breaks = useRef<BreakSources>({ startCard, paused, game: false });
  const startCardBefore = useRef(startCard);
  /** A start card went away while this game was attached: a run is on. */
  const runOn = useRef(false);

  useEffect(() => {
    gameRef.current = game;
  });

  useEffect(() => {
    let cancelled = false;
    void loadService()
      .then((loaded) => {
        if (!cancelled && loaded) setService(loaded);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [loadService]);

  const applyBreak = useCallback((handle: AttachedGame | null) => {
    const b = breaks.current;
    handle?.setAtBreak(b.startCard || b.paused || b.game);
  }, []);

  const { appId, canPause } = game;
  useEffect(() => {
    if (!service) return;
    // Only a new app re-attaches. Everything else is read from the newest
    // props when it is needed: many games turn canPause on and off between
    // runs, and a re-attach would cost the ring.
    const latest = gameRef;
    const handle = service.attach({
      appId,
      get gameName() {
        return latest.current.gameName;
      },
      get emoji() {
        return latest.current.emoji;
      },
      get canPause() {
        return latest.current.canPause;
      },
      pause: () => latest.current.pause?.(),
      resume: () => latest.current.resume?.(),
      score: () => latest.current.score?.(),
    });
    // A new attachment plays until a break source says otherwise, with no run yet.
    breaks.current.game = false;
    runOn.current = false;
    applyBreak(handle);
    setAttached(handle);
    return () => {
      handle.detach();
      setAttached(null);
    };
  }, [service, appId, applyBreak]);

  useEffect(() => {
    service?.refreshGame();
  }, [service, canPause]);

  // The shell's pause menu.
  useEffect(() => {
    breaks.current.paused = paused;
    applyBreak(attached);
  }, [attached, paused, applyBreak]);

  // The start card: a break while it shows. It going away starts a run; it
  // coming back after that run ends it (plan 11.5 zero-code rule). A start
  // card that appears with no run before it (the first mount) ends nothing.
  useEffect(() => {
    breaks.current.startCard = startCard;
    applyBreak(attached);
    const before = startCardBefore.current;
    startCardBefore.current = startCard;
    if (!attached || before === startCard) return;
    if (!startCard) {
      runOn.current = true;
      attached.runPhase("start");
    } else if (runOn.current) {
      runOn.current = false;
      attached.runPhase("end");
    }
  }, [attached, startCard, applyBreak]);

  // The game's own break signal goes into the join, never over the others.
  const provided = useMemo<AttachedGame | null>(() => {
    if (!attached) return null;
    return {
      registerCanvas: (canvas, options) => attached.registerCanvas(canvas, options),
      autoDiscover: (root) => attached.autoDiscover(root),
      runPhase: (phase) => attached.runPhase(phase),
      markMoment: (mark) => attached.markMoment(mark),
      setAtBreak: (atBreak) => {
        breaks.current.game = atBreak;
        applyBreak(attached);
      },
      detach: () => attached.detach(),
    };
  }, [attached, applyBreak]);

  return (
    <ClipServiceContext.Provider value={mounted ? service : null}>
      <AttachedGameContext.Provider value={mounted ? provided : null}>{children}</AttachedGameContext.Provider>
    </ClipServiceContext.Provider>
  );
}

export interface ClipShellScopeProps {
  /** GameShell's appId. No appId, or a module without clips: true, renders the children only. */
  appId?: string;
  gameName: string;
  canPause: boolean;
  /** GameShell's pause menu is open. */
  paused: boolean;
  /** GameShell's pause and resume (the game pauses before a clip sheet or a share, plan 12). */
  pause: () => void;
  resume: () => void;
  children: ReactNode;
}

/**
 * The GameShell mount (plan 4.1). For a module whose metadata literal is
 * clips: true it wraps the whole shell (header, game and pause menu) in
 * ClipProvider and the clip UI mount (shell/ClipUiMount.tsx), so the clip
 * button in the header and the pause-menu entries can read the service.
 * Every other module gets its children and nothing else: no hook, no
 * effect, no request.
 */
export function ClipShellScope({ appId, children, ...shell }: ClipShellScopeProps) {
  if (!clipsEnabledFor(appId)) return <>{children}</>;
  return (
    <ClipShellProvider appId={appId as string} {...shell}>
      {children}
    </ClipShellProvider>
  );
}

function ClipShellProvider({ appId, gameName, canPause, paused, pause, resume, children }: Omit<ClipShellScopeProps, "appId"> & { appId: string }) {
  const game = useMemo<GameAttachment>(
    () => ({ appId, gameName, emoji: getGameMetadata(appId).icon, canPause, pause, resume }),
    [appId, gameName, canPause, pause, resume],
  );
  // ClipUiMount holds the clip UI contexts from the first render and loads the
  // clip UI only when the service exists (capture on). See shell/ClipUiMount.tsx.
  return (
    <ClipProvider game={game} paused={paused}>
      <ClipUiMount pauseGame={pause} resumeGame={resume}>
        {children}
      </ClipUiMount>
    </ClipProvider>
  );
}

export interface ClipSourceOptions {
  /** Capture target (plan 6.1). Default 30. */
  targetFps?: 30 | 60;
  /**
   * Register only while true. Default true. A canvas that is not registered
   * is a lost source (after 1.5 s the ring warms up again), so use it only
   * when the canvas really goes away; use isPlaying for a break.
   */
  active?: boolean;
  /**
   * Plan 6.1: false while the game does not play (between runs, its own
   * pause screen). Capture skips a break, and the ring stays warm. Leave it
   * out when the start card and the shell's pause menu are the only breaks.
   */
  isPlaying?: boolean;
}

/**
 * Registers the game's canvas with the attached clip game. It follows the
 * canvas element: a remount (a restart with a new key, a level swap) registers
 * the new canvas and lets the old one go. It does nothing with clips off.
 */
export function useClipSource(canvasRef: RefObject<HTMLCanvasElement | null>, options: ClipSourceOptions = {}): void {
  const game = useAttachedGame();
  const active = options.active ?? true;
  const targetFps = options.targetFps;
  const isPlaying = options.isPlaying;
  const registered = useRef<{ canvas: HTMLCanvasElement; game: AttachedGame; targetFps: 30 | 60 | undefined; dispose: () => void } | null>(null);

  // No dependency list on purpose: the canvas element can change without a
  // prop change, so every commit compares it (a cheap identity check).
  useEffect(() => {
    const canvas = active ? canvasRef.current : null;
    const current = registered.current;
    if (current && current.canvas === canvas && current.game === game && current.targetFps === targetFps) return;
    current?.dispose();
    registered.current = null;
    if (!game || !canvas) return;
    registered.current = { canvas, game, targetFps, dispose: game.registerCanvas(canvas, targetFps ? { targetFps } : undefined) };
  });

  useEffect(
    () => () => {
      registered.current?.dispose();
      registered.current = null;
    },
    [],
  );

  // The game's own break signal (plan 6.1 isPlaying). Gone with the hook: no break.
  useEffect(() => {
    if (!game || isPlaying === undefined) return;
    game.setAtBreak(!isPlaying);
    return () => game.setAtBreak(false);
  }, [game, isPlaying]);
}
