"use client";

/**
 * React access to the clip service (plan 4.1).
 *
 * ClipProvider (service/ClipProvider.tsx) puts the tab's ClipService and the
 * attached game into these contexts. Every clip surface in ui/ reads them
 * through the hooks below, and its tests put a fake ClipServiceApi into
 * ClipServiceContext. Without a provider, the hooks return the hidden
 * snapshot and a null service, so a surface renders nothing.
 */

import { createContext, useContext, useSyncExternalStore } from "react";

import { HIDDEN_SNAPSHOT, type AttachedGame, type ClipServiceApi, type ClipSnapshot } from "./contract";

export const ClipServiceContext = createContext<ClipServiceApi | null>(null);
export const AttachedGameContext = createContext<AttachedGame | null>(null);

const noopSubscribe = () => () => {};
const hidden = () => HIDDEN_SNAPSHOT;

/** The tab's clip service, or null (no provider, clips off, or SSR). */
export function useClipService(): ClipServiceApi | null {
  return useContext(ClipServiceContext);
}

/** The game that the nearest ClipProvider attached, or null. */
export function useAttachedGame(): AttachedGame | null {
  return useContext(AttachedGameContext);
}

/** The live clip snapshot. SSR and the first client render get HIDDEN_SNAPSHOT. */
export function useClipSnapshot(): ClipSnapshot {
  const service = useClipService();
  return useSyncExternalStore(
    service ? service.subscribe : noopSubscribe,
    service ? service.getSnapshot : hidden,
    service ? service.getServerSnapshot : hidden,
  );
}
