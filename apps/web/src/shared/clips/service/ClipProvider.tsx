"use client";

/**
 * ClipProvider (plan 4.1). GameShell mounts it for a module whose metadata
 * literal is clips: true (clipsEnabledFor).
 *
 * - The server and the first client render give no service (the
 *   useSyncExternalStore mounted pattern), so the markup is the children
 *   only, and hydration matches. The providers are always in the tree with a
 *   null value until the service exists, so the game never remounts.
 * - After mount it reads the clips flag once per tab session. When capture is
 *   on, it loads the service with a dynamic import (the capture runtime and
 *   the workers load later, only when the game registers a canvas).
 * - It attaches the game (GameAttachment), provides ClipServiceContext and
 *   AttachedGameContext, and detaches on unmount.
 * - It tells the service who is signed in (next-auth session), for the owner
 *   rules of plan 7.1.
 *
 * useClipSource(canvasRef, options) is the one line a canvas game adds.
 */

import { useSession } from "next-auth/react";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";

import { getGameMetadata } from "@/shared/lib/gameMetadata.generated";
import { loadClipsVerdict } from "../config";
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
  /** Tests: the service to use instead of loading one. */
  loadService?: () => Promise<ClipService | null>;
}

async function defaultLoadService(): Promise<ClipService | null> {
  const verdict = await loadClipsVerdict();
  if (!verdict.capture) return null;
  const { startClipService } = await import("./ClipService");
  return startClipService();
}

export function ClipProvider({ game, children, loadService = defaultLoadService }: ClipProviderProps) {
  const mounted = useMounted();
  const [service, setService] = useState<ClipService | null>(null);
  const [attached, setAttached] = useState<AttachedGame | null>(null);
  const gameRef = useRef(game);
  const { data: session, status } = useSession();

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
    setAttached(handle);
    return () => {
      handle.detach();
      setAttached(null);
    };
  }, [service, appId]);

  useEffect(() => {
    service?.refreshGame();
  }, [service, canPause]);

  const userId = session?.user?.id ?? null;
  useEffect(() => {
    if (!service || status === "loading") return;
    void service.setSessionUser(userId);
  }, [service, status, userId]);

  return (
    <ClipServiceContext.Provider value={mounted ? service : null}>
      <AttachedGameContext.Provider value={mounted ? attached : null}>{children}</AttachedGameContext.Provider>
    </ClipServiceContext.Provider>
  );
}

export interface ClipSourceOptions {
  /** Capture target (plan 6.1). Default 30. */
  targetFps?: 30 | 60;
  /** Register only while true (for example only while a run is on screen). Default true. */
  active?: boolean;
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
}
