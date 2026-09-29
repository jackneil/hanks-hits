"use client";

/**
 * The shell mount of the clip UI (plan 4.1, 11.4).
 *
 * ClipShellScope (service/ClipProvider.tsx) puts this component around the
 * whole GameShell of a module whose metadata literal is clips: true. It is
 * small on purpose: every page of a clip-enabled game loads it, also when the
 * clips flag is off.
 *
 * What it does:
 * - When the clip service exists (the flag turned capture on), it loads the
 *   clip UI (ui/shellParts.ts) with a dynamic import. With no service it
 *   loads nothing, so a page with clips off gets no clip UI code.
 * - It holds ClipUiContext and ClipShellUiContext from the first render, so
 *   the game under it never remounts when the clip UI arrives.
 * - The loaded ClipUiRuntime renders next to the game. It makes the page's
 *   controller and the sheets (z-2500, portaled to document.body).
 * - GameShell and ResultChip read useClipShellUi(): the parts to put in the
 *   header, the pause menu, the toast slot and the result chip, or null.
 * - A load that fails (a network blip, or a stale chunk after a deploy) is
 *   tried again after UI_RETRY_DELAYS_MS (2 s, 10 s, 60 s), then each time
 *   the page becomes visible again.
 * - No capture without a clip button: until the clip UI runs, the game under
 *   this mount gets no attached clip game (AttachedGameContext is null), so
 *   useClipSource registers no canvas and the capture engine does not run.
 *   The service stays attached, and the canvas registers when the UI runs.
 */

import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import { AttachedGameContext, useAttachedGame, useClipService } from "../service/context";
import type { ClipServiceApi } from "../service/contract";
import { ClipUiContext } from "../ui/uiContext";
import type { ClipUiController } from "../ui/uiStore";

/** The parts that ui/shellParts.ts gives. */
export type ClipShellParts = typeof import("../ui/shellParts");

/** The loaded clip UI parts, or null (no clip-enabled game, clips off, or not loaded yet). */
export const ClipShellUiContext = createContext<ClipShellParts | null>(null);

/** The clip UI parts for GameShell and ResultChip, or null when there is no clip UI on this page. */
export function useClipShellUi(): ClipShellParts | null {
  return useContext(ClipShellUiContext);
}

const noService = () => () => {};
const shownNever = () => false;

/**
 * True when the header must hold the clip button: the clip UI is here and the
 * service shows a button (not "hidden": the game is attached and the device
 * can capture). It changes when the clip UI arrives and when a device turns
 * out to have no capture tier, never at a run boundary.
 */
export function useClipHeaderSlot(): boolean {
  const parts = useClipShellUi();
  const service = useClipService();
  const live: ClipServiceApi | null = parts ? service : null;
  return useSyncExternalStore(
    live ? live.subscribe : noService,
    live ? () => live.getSnapshot().button !== "hidden" : shownNever,
    shownNever,
  );
}

/** Loads the clip UI parts. Tests give their own. */
export type ClipShellPartsLoader = () => Promise<ClipShellParts>;

const loadShellParts: ClipShellPartsLoader = () => import("../ui/shellParts");

export interface ClipUiMountProps {
  /** GameShell's pause: the game pauses before a clip sheet or a share opens (plan 12). */
  pauseGame?: () => void;
  /** GameShell's resume. */
  resumeGame?: () => void;
  children: ReactNode;
  /** Tests: the loader to use instead of the dynamic import. */
  loadParts?: ClipShellPartsLoader;
}

/**
 * The waits before each new try of a clip UI load that failed. After the
 * last one, the next time the page becomes visible tries again (and again
 * after each later failure).
 */
export const UI_RETRY_DELAYS_MS: readonly number[] = Object.freeze([2000, 10_000, 60_000]);

/** A values-free warning (plan 12): the page keeps working with no clip UI. */
function warnLoadFailed(error: unknown, attempt: number): void {
  const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
  try {
    console.warn(`[clips] ui: load failed (${typeof name === "string" && /^[A-Za-z]{1,64}$/.test(name) ? name : "Error"}, try ${attempt + 1})`);
  } catch {
    // A console that throws must not break the page.
  }
}

export function ClipUiMount({ pauseGame, resumeGame, children, loadParts = loadShellParts }: ClipUiMountProps) {
  const service = useClipService();
  const attachedGame = useAttachedGame();
  const [parts, setParts] = useState<ClipShellParts | null>(null);
  const [controller, setController] = useState<ClipUiController | null>(null);
  /** The number of loads that failed so far. A new value starts the next try. */
  const [attempt, setAttempt] = useState(0);

  const hasService = service !== null;
  const loaded = parts !== null;
  useEffect(() => {
    if (!hasService || loaded) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let onVisible: (() => void) | null = null;
    const tryAgain = () => {
      if (!cancelled) setAttempt((n) => n + 1);
    };
    loadParts().then(
      (module) => {
        if (!cancelled) setParts(module);
      },
      (error: unknown) => {
        warnLoadFailed(error, attempt);
        if (cancelled) return;
        const delay = UI_RETRY_DELAYS_MS[attempt];
        if (delay !== undefined) {
          timer = setTimeout(tryAgain, delay);
          return;
        }
        if (typeof document === "undefined") return;
        const doc = document;
        onVisible = () => {
          if (doc.visibilityState === "visible") tryAgain();
        };
        doc.addEventListener("visibilitychange", onVisible);
      },
    );
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      if (onVisible) document.removeEventListener("visibilitychange", onVisible);
    };
  }, [hasService, loaded, loadParts, attempt]);

  const onController = useCallback((next: ClipUiController | null) => setController(next), []);
  const ready = hasService && controller !== null ? parts : null;
  const Runtime = parts?.ClipUiRuntime;

  return (
    <ClipUiContext.Provider value={ready ? controller : null}>
      <ClipShellUiContext.Provider value={ready}>
        {/* No capture without a clip button: the game gets its clip game when the UI runs. */}
        <AttachedGameContext.Provider value={ready ? attachedGame : null}>{children}</AttachedGameContext.Provider>
      </ClipShellUiContext.Provider>
      {Runtime && <Runtime pauseGame={pauseGame} resumeGame={resumeGame} onController={onController} />}
    </ClipUiContext.Provider>
  );
}
