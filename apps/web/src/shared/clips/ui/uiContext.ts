"use client";

/**
 * The clip UI context: the one piece of the clip UI that every game page may
 * load (plan 4.1).
 *
 * The shell mount (shell/ClipUiMount.tsx) holds this context on every page
 * of a clip-enabled game, also before the clip UI loads and when clips are
 * off. The clip UI itself (ClipUiRuntime.tsx and the parts) loads with a
 * dynamic import, only when capture is on. Both sides must use the SAME
 * context object, so it lives here, in a module that imports only types.
 */

import { createContext, useContext, useSyncExternalStore } from "react";

import type { ClipUiController, ClipUiState } from "./uiStore";

export const ClipUiContext = createContext<ClipUiController | null>(null);

/** The clip UI controller, or null without a ClipUiRuntime (before the clip UI loads, or with clips off). */
export function useClipUi(): ClipUiController | null {
  return useContext(ClipUiContext);
}

/** The UI state of the server render and of a page with no controller. */
export const SERVER_UI_STATE: ClipUiState = Object.freeze({
  sheet: null,
  reply: null,
  pendingOpenId: null,
  pendingMenu: false,
  resultMark: null,
  holdTip: "none",
  pulse: 0,
}) as ClipUiState;

const noStore = () => () => {};
export const serverUiState = (): ClipUiState => SERVER_UI_STATE;

/** The clip UI state. The server and the first client render get the empty state. */
export function useClipUiState(): ClipUiState {
  const ui = useClipUi();
  return useSyncExternalStore(ui ? ui.store.subscribe : noStore, ui ? ui.store.getState : serverUiState, serverUiState);
}
