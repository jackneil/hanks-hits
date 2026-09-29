"use client";

/**
 * ClipUiRuntime: the shared state of the clip surfaces (the controller), and
 * the sheets (plan 11.4).
 *
 * There is one way to put the clip UI on a page, and a game writes none of
 * it. GameShell wraps a module whose metadata literal is clips: true in
 * ClipShellScope. Its ClipUiMount (shell/ClipUiMount.tsx) loads the clip UI
 * (shellParts.ts) with a dynamic import when the clips flag turns capture
 * on, renders this runtime NEXT TO the game, and holds the controller in
 * ClipUiContext. GameShell and ResultChip then read the parts through
 * useClipShellUi() and put each one in its place:
 *
 *   header clip slot:     ClipButton
 *   header title region:  InPlayConfirm
 *   under the header:     ToastSlot (it portals, z-1050)
 *   pause menu:           ClipsPauseEntry (the menu reads its label aloud)
 *   ResultChip:           ResultChipClipActions (the chip reads their labels aloud)
 *
 * A game adds only `clips: true`, useClipSource, and at game over a
 * ResultChip (give it `runSeconds` to offer the whole run).
 *
 * The runtime renders the sheets itself (Capture menu, viewer, settings), so
 * each part only asks the controller to open one. Without the runtime, every
 * part renders nothing, the same as without a clip service.
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

interface Latest {
  service: ClipServiceApi | null;
  snapshot: ClipSnapshot;
  host: ClipUiHost;
}

/** The controller and the sheets of one page. */
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

  // Crash recovery (plan 8.4): a Record video saved from last time reaches
  // the kid when the clip UI starts, and whenever the library says a new one
  // came back (the io worker finds them at its start).
  useEffect(() => {
    if (!service) return;
    void controller.checkRecovered();
    return service.library.subscribe(() => void controller.checkRecovered());
  }, [controller, service]);
  // Its reply waits for a break with no sheet open.
  const recoveredClipId = state.recoveredClipId;
  const sheetOpen = state.sheet !== null;
  useEffect(() => {
    if (recoveredClipId) controller.flushRecovered();
  }, [controller, recoveredClipId, sheetOpen, atBreak]);

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
