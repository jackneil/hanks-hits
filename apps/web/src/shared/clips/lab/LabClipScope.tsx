"use client";

/**
 * The lab's clip scope: it loads the clip service, attaches the lab game and
 * gives both to the lab through the same contexts that ClipProvider fills
 * (service/context.ts). So the lab reads the service exactly as a clip
 * surface does, with useClipService, useAttachedGame and useClipSnapshot.
 *
 * - The server render and the first client render have no service (the
 *   contexts hold null), so the markup is the same on both sides.
 * - After the mount it calls loadService once and attaches the game to the
 *   service that it gives. A loader that gives null (clips are off) or that
 *   fails, and an attach that throws, leave both contexts null, and
 *   LabServiceStateContext says why.
 * - It detaches the game on unmount.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { AttachedGameContext, ClipServiceContext } from "../service/context";
import type { AttachedGame, ClipServiceApi, GameAttachment } from "../service/contract";
import type { LabServiceLoader } from "./labService";

/** loading: the loader runs. ready: attached. missing: clips are off. error: the loader or attach threw. */
export type LabServiceState = "loading" | "ready" | "missing" | "error";

export const LabServiceStateContext = createContext<LabServiceState>("loading");

/** The state of the lab's clip service. */
export function useLabServiceState(): LabServiceState {
  return useContext(LabServiceStateContext);
}

export interface LabClipScopeProps {
  /** Keep it the same object between renders: a new object attaches again. */
  game: GameAttachment;
  loadService: LabServiceLoader;
  children: ReactNode;
}

interface Scope {
  state: LabServiceState;
  service: ClipServiceApi | null;
  attached: AttachedGame | null;
}

const LOADING: Scope = { state: "loading", service: null, attached: null };

export function LabClipScope({ game, loadService, children }: LabClipScopeProps) {
  const [scope, setScope] = useState<Scope>(LOADING);

  useEffect(() => {
    let cancelled = false;
    let handle: AttachedGame | null = null;
    loadService().then(
      (service) => {
        if (cancelled) return;
        if (!service) {
          setScope({ state: "missing", service: null, attached: null });
          return;
        }
        try {
          handle = service.attach(game);
        } catch {
          setScope({ state: "error", service: null, attached: null });
          return;
        }
        setScope({ state: "ready", service, attached: handle });
      },
      () => {
        if (!cancelled) setScope({ state: "error", service: null, attached: null });
      },
    );
    return () => {
      cancelled = true;
      handle?.detach();
      handle = null;
    };
  }, [loadService, game]);

  return (
    <LabServiceStateContext.Provider value={scope.state}>
      <ClipServiceContext.Provider value={scope.service}>
        <AttachedGameContext.Provider value={scope.attached}>{children}</AttachedGameContext.Provider>
      </ClipServiceContext.Provider>
    </LabServiceStateContext.Provider>
  );
}
