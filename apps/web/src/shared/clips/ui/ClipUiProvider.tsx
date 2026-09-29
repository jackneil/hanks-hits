"use client";

/**
 * ClipUiProvider: the shared state of the clip surfaces, and the sheets.
 *
 * Mount it ONCE per game page, inside the service's ClipProvider (so
 * useClipService and useClipSnapshot see the service), around the parts
 * that GameShell renders. The integration step mounts:
 *
 *   <ClipUiProvider pauseGame={pause} resumeGame={resume}>
 *     header clipSlot:        <ClipButton />
 *     header title region:    <InPlayConfirm />
 *     anywhere:               <ToastSlot />
 *     pauseMenuChildren:      <ClipsPauseEntry />
 *     ResultChip children:    <ResultChipClipActions />
 *   </ClipUiProvider>
 *
 * The provider renders the sheets itself (Capture menu, viewer, settings),
 * so each part only asks the controller to open one.
 *
 * Without a provider every part renders nothing, the same as without a
 * clip service.
 */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type React from "react";

import { useClipService, useClipSnapshot } from "../service/context";
import type { ClipServiceApi, ClipSnapshot } from "../service/contract";
import { CaptureMenu } from "./CaptureMenu";
import { ClipSettingsSheet } from "./ClipSettingsSheet";
import { ClipViewer } from "./ClipViewer";
import { detectSavePlatform, subscribeToNothing } from "./platform";
import { ClipUiContext, serverUiState } from "./uiContext";
import {
  createClipUiController,
  createClipUiStore,
  RESULT_MARK_TICK_MS,
  type ClipUiController,
  type ClipUiHost,
} from "./uiStore";

// The context lives in uiContext.ts (a module with type imports only), so the
// shell mount can hold it on every page without this module. Every part
// imports it from here or from there: it is the same object.
export { ClipUiContext, useClipUi, useClipUiState } from "./uiContext";

export interface ClipUiProviderProps extends ClipUiHost {
  children?: React.ReactNode;
}

interface Latest {
  service: ClipServiceApi | null;
  snapshot: ClipSnapshot;
  host: ClipUiHost;
}

/**
 * The controller and the sheets of one page. ClipUiProvider and ClipUiRuntime
 * share it, so the page behaves the same whichever of the two mounts it.
 */
function useClipUiRuntime({ pauseGame, resumeGame }: ClipUiHost): { controller: ClipUiController; sheets: React.ReactNode } {
  const service = useClipService();
  const snapshot = useClipSnapshot();

  // The controller lives as long as the page. It reads the newest service,
  // snapshot and host through this ref, which a layout effect keeps current.
  const latest = useRef<Latest>({ service, snapshot, host: { pauseGame, resumeGame } });
  useLayoutEffect(() => {
    latest.current = { service, snapshot, host: { pauseGame, resumeGame } };
  });

  const [controller] = useState(() => {
    const store = createClipUiStore();
    let platform: ReturnType<typeof detectSavePlatform> | null = null;
    return createClipUiController({
      store,
      service: () => latest.current.service,
      snapshot: () => latest.current.snapshot,
      host: () => latest.current.host,
      platform: () => (platform ??= detectSavePlatform()),
    });
  });
  useEffect(() => () => controller.store.dispose(), [controller]);

  const state = useSyncExternalStore(controller.store.subscribe, controller.store.getState, serverUiState);
  const isClient = useSyncExternalStore(subscribeToNothing, () => true, () => false);

  // A clip or a Capture menu that waited for the end of a run opens at the next break.
  const pendingOpenId = state.pendingOpenId;
  const pendingMenu = state.pendingMenu;
  const atBreak = snapshot.atBreak;
  useEffect(() => {
    if ((pendingOpenId || pendingMenu) && atBreak) controller.flushPendingOpen();
  }, [controller, pendingOpenId, pendingMenu, atBreak]);

  // The result chip's frozen run end counts how long capture ran since.
  const engine = snapshot.engine;
  useEffect(() => {
    controller.noteEngine(engine);
  }, [controller, engine]);
  const markCounting = state.resultMark !== null && state.resultMark.runningSince !== null;
  useEffect(() => {
    if (!markCounting) return;
    const timer = setInterval(() => controller.tickResultMark(), RESULT_MARK_TICK_MS);
    return () => clearInterval(timer);
  }, [controller, markCounting]);

  // The service went away (the page left clips on): close any sheet.
  const hasService = service !== null;
  useEffect(() => {
    if (!hasService) controller.closeSheet({ resume: false });
  }, [controller, hasService]);

  const sheet = isClient && service ? state.sheet : null;

  const sheets = (
    <>
      {sheet?.kind === "menu" && <CaptureMenu token={sheet.token} />}
      {sheet?.kind === "viewer" && (
        <ClipViewer
          key={sheet.target.kind === "clip" ? `clip:${sheet.target.id}` : `game:${sheet.target.gameId}`}
          target={sheet.target}
          onClose={() => controller.closeSheet()}
        />
      )}
      {sheet?.kind === "settings" && <ClipSettingsSheet onClose={() => controller.closeSheet()} />}
    </>
  );
  return { controller, sheets };
}

export function ClipUiProvider({ children, pauseGame, resumeGame }: ClipUiProviderProps) {
  const { controller, sheets } = useClipUiRuntime({ pauseGame, resumeGame });
  return (
    <ClipUiContext.Provider value={controller}>
      {children}
      {sheets}
    </ClipUiContext.Provider>
  );
}

export interface ClipUiRuntimeProps extends ClipUiHost {
  /** Gets the page's controller after mount, and null when the runtime goes away. */
  onController: (controller: ClipUiController | null) => void;
}

/**
 * The half of the shell mount that loads with the clip UI (shell/ClipUiMount.tsx).
 *
 * The shell mount wraps the game from the first render, so the game never
 * remounts when the clip UI arrives. This part renders NEXT TO the game, not
 * around it: it makes the controller, gives it to the mount (which puts it in
 * ClipUiContext for the header parts and the game), and renders the sheets.
 */
export function ClipUiRuntime({ pauseGame, resumeGame, onController }: ClipUiRuntimeProps) {
  const { controller, sheets } = useClipUiRuntime({ pauseGame, resumeGame });
  useLayoutEffect(() => {
    onController(controller);
    return () => onController(null);
  }, [controller, onController]);
  return <ClipUiContext.Provider value={controller}>{sheets}</ClipUiContext.Provider>;
}
