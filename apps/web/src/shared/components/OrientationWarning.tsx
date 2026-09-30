"use client";

import { useEffect, useId, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { useCoarsePointer } from "../hooks/useCoarsePointer";
import { isPhoneScreen } from "../lib/headerBudget";
import { useShellOverlay } from "../lib/shellOverlays";
import { useStartOverlayShowing } from "../lib/startOverlayPresence";
import { ReadAloudButton } from "./ReadAloudButton";

/**
 * The orientation tip: "Turn your phone sideways" or "Turn your phone
 * upright", for a game whose metadata declares a preferredOrientation.
 *
 * GameShell renders it once, above the game (the game's own tree may be
 * keyed and remount on each restart; this one does not). Rules (main-loop
 * decision 2, phone UX audit 2026-09-29, S7):
 * - A suggestion, not a gate. It shows at most once per session for each
 *   game (sessionStorage), never over the start card (it waits until the
 *   kid has pressed Play), and it never blocks the header.
 * - The game is held while it shows (shellOverlays.ts: GameShell calls the
 *   game's onPause, or onShellOverlayOpen for a game with its own loop),
 *   so a finger under the tip drives nothing.
 * - It shows only on a phone with a touch screen. "Phone" is the short
 *   side of the screen at 480 px or less, in both orientations (the same
 *   rule as the short: variant), so a tablet held upright never sees it.
 * - It goes away when the kid turns the phone, or taps Keep playing.
 * - A game that plays well both ways declares no preferredOrientation and
 *   never shows it.
 *
 * Stacking: z-[100], above every game layer and the start card (z-90),
 * below the header (z-1000). It portals to document.body, so a game root
 * with its own stacking context cannot put it under anything.
 */

export type PreferredOrientation = "portrait" | "landscape";

/** The words of the tip, in kid English. The voice says the same words. */
export const ORIENTATION_TIP_COPY: Record<
  PreferredOrientation,
  { title: string; body: string }
> = {
  landscape: {
    title: "Turn your phone sideways",
    body: "This game is bigger when your phone is sideways.",
  },
  portrait: {
    title: "Turn your phone upright",
    body: "This game is bigger when your phone is upright.",
  },
};

/** The one button of the tip. */
export const ORIENTATION_TIP_KEEP_PLAYING = "Keep playing";

/** The sessionStorage key that remembers the tip for one game. */
export function orientationTipKey(gameId: string): string {
  return `hh-orientation-tip:${gameId}`;
}

/** When storage is blocked (a private tab), this set keeps the promise for this page. */
const shownThisPage = new Set<string>();

function wasShown(gameId: string): boolean {
  try {
    return sessionStorage.getItem(orientationTipKey(gameId)) !== null;
  } catch {
    return shownThisPage.has(gameId);
  }
}

function markShown(gameId: string): void {
  try {
    sessionStorage.setItem(orientationTipKey(gameId), "1");
  } catch {
    shownThisPage.add(gameId);
  }
}

/**
 * The orientation of the screen from its size. A square screen counts as
 * upright.
 */
export function orientationOf(width: number, height: number): PreferredOrientation {
  return height >= width ? "portrait" : "landscape";
}

function subscribeToResize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  window.addEventListener("orientationchange", onChange);
  return () => {
    window.removeEventListener("resize", onChange);
    window.removeEventListener("orientationchange", onChange);
  };
}

/** "wxh" of the viewport, or null on the server. One string, so the store snapshot is stable. */
function useViewportKey(): string | null {
  return useSyncExternalStore(
    subscribeToResize,
    () => `${window.innerWidth}x${window.innerHeight}`,
    () => null
  );
}

/**
 * The preferred orientation of a route from the metadata lookup, by appId
 * then by the route's own id. Null when the game plays well both ways.
 */
export function preferredOrientationFor(
  lookup: Record<string, { preferredOrientation?: string }>,
  options: { appId?: string; routeId?: string | null }
): PreferredOrientation | null {
  for (const id of [options.appId, options.routeId]) {
    if (!id || !Object.hasOwn(lookup, id)) continue;
    const value = lookup[id].preferredOrientation;
    if (value === "portrait" || value === "landscape") return value;
  }
  return null;
}

interface OrientationWarningProps {
  /** The orientation the game plays best in. */
  preferred: PreferredOrientation;
  /** The game id, for the once-per-session memory. */
  gameId: string;
}

export function OrientationWarning({ preferred, gameId }: OrientationWarningProps) {
  const isCoarse = useCoarsePointer();
  const startCardShowing = useStartOverlayShowing();
  const viewportKey = useViewportKey();
  const titleId = useId();
  const [state, setState] = useState<"waiting" | "shown" | "done">("waiting");

  // Decide only after the first layout pass: a start card that mounts in
  // the same commit counts itself in a layout effect, and this render
  // cannot see it yet (the same rule as IOSInstallPrompt).
  const [laidOut, setLaidOut] = useState(false);
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLaidOut(true);
  }, []);

  let mismatch = false;
  if (viewportKey) {
    const [width, height] = viewportKey.split("x").map(Number);
    mismatch = isPhoneScreen(width, height) && orientationOf(width, height) !== preferred;
  }
  const due = laidOut && isCoarse && !startCardShowing && mismatch;

  // The two moves of the tip are decided while rendering (React's "adjust
  // state while rendering" pattern, not an effect): the first moment the
  // tip is due, it shows unless this session saw it; and when the kid
  // turns the phone, it is done. React renders again at once, before
  // paint, so no frame shows the old state.
  if (state === "waiting" && due) {
    setState(wasShown(gameId) ? "done" : "shown");
  }
  if (state === "shown" && !mismatch) {
    setState("done");
  }

  const visible = state === "shown";
  useShellOverlay(visible);

  // Remember it for the session, once it is on screen.
  useEffect(() => {
    if (visible) markShown(gameId);
  }, [visible, gameId]);

  if (!visible) return null;

  const copy = ORIENTATION_TIP_COPY[preferred];
  const spoken = `${copy.title}. ${copy.body} ${ORIENTATION_TIP_KEEP_PLAYING}.`;

  return createPortal(
    <div
      data-testid="orientation-tip"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-x-0 bottom-0 top-[var(--shell-header-h)] z-[100] flex bg-black/70 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] short:p-2"
    >
      <div className="m-auto w-full max-w-sm rounded-3xl bg-base-100 p-5 text-center text-base-content shadow-2xl short:flex short:max-w-xl short:flex-row short:items-center short:gap-4 short:p-3 short:text-left">
        <div className="short:min-w-0 short:flex-1">
          <div className="orientation-tip-phone mb-2 text-5xl short:mb-0 short:text-4xl" aria-hidden="true">
            📱
          </div>
          <h2 id={titleId} className="text-2xl font-bold short:text-xl">
            {copy.title}
          </h2>
          <p className="mt-1 text-base opacity-80 short:text-sm">{copy.body}</p>
        </div>

        <div className="mt-4 flex flex-col gap-2 short:mt-0 short:w-[45%] short:shrink-0">
          <ReadAloudButton text={spoken} className="short:min-h-[44px]" />
          <button
            type="button"
            onClick={() => setState("done")}
            className="btn btn-primary btn-lg min-h-[44px] w-full text-xl"
          >
            <span aria-hidden="true">▶</span> {ORIENTATION_TIP_KEEP_PLAYING}
          </button>
        </div>
      </div>

      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          @keyframes orientation-tip-turn {
            0%, 100% { transform: rotate(0deg); }
            25% { transform: rotate(-15deg); }
            75% { transform: rotate(${preferred === "landscape" ? 90 : -90}deg); }
          }
          .orientation-tip-phone {
            display: inline-block;
            animation: orientation-tip-turn 2s ease-in-out infinite;
          }
        }
      `}</style>
    </div>,
    document.body
  );
}
