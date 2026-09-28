"use client";

/**
 * The shell of every clip sheet: the Capture menu, the viewer and the
 * settings sheet (plan 11.4).
 *
 * Contracts:
 * - Stacking: z-index 2500. It portals to document.body (every layer above
 *   z-1000 does), so no game container can trap it. It sits above the
 *   pause menu (2000) and below the restart question (3000).
 * - Shape: "menu" is a bottom sheet on phones and a small dialog on wider
 *   screens. "full" fills a phone screen and is a dialog on wider screens.
 *   Both scroll inside, so nothing is cut off on a 320x568 phone.
 * - Taps stay here: React sends portal events up the COMPONENT tree, so a
 *   tap on a sheet button could reach a game handler above the provider.
 *   Every pointer, touch and click event stops at the sheet.
 * - Keys: Escape closes the sheet and nothing else. The sheet listens in
 *   the capture phase and stops the event, so GameShell does not also
 *   toggle the pause menu. Tab stays inside the sheet.
 * - Focus: the main action (the control with data-autofocus), else the
 *   first control, takes focus when the sheet opens. Focus never stays
 *   behind the sheet: while the main action is still disabled (the viewer
 *   reads its file first), the panel itself holds focus, and the main
 *   action gets it as soon as it can take it. The element that had focus
 *   before the sheet opened gets it back when the sheet closes. The clip
 *   controls never take focus from a pointer press, so that element is the
 *   game (or the page) after a tap, and the control after a keyboard press.
 * - Read-aloud: the header has the read-aloud button (every sheet has one).
 * - Motion: it opens in 250 ms with the house easing, and closes at once.
 *   With reduced motion it only fades.
 */

import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import type React from "react";
import { createPortal } from "react-dom";

import { ReadAloudButton } from "@/shared/components/ReadAloudButton";

import { VIEWER_COPY } from "./copy";
import { CloseGlyph } from "./glyphs";
import { subscribeToNothing } from "./platform";

/** The stacking level of every clip sheet (plan 11.4). */
export const CLIP_SHEET_Z_INDEX = 2500;

export interface SheetProps {
  /** The plain-text heading (no emoji, plan 11.6). */
  title: string;
  /** "menu": a bottom sheet on phones. "full": the whole phone screen. */
  variant: "menu" | "full";
  onClose: () => void;
  /** The words the read-aloud button says, built when the kid taps it. */
  readAloudText: () => string;
  children: React.ReactNode;
  testId?: string;
  /** The words of the close button. Default "Close". */
  closeLabel?: string;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])';

/** The main action, when it can take focus. */
const AUTOFOCUS = "[data-autofocus]:not([disabled])";

function stopHere(event: React.SyntheticEvent): void {
  event.stopPropagation();
}

const PANEL_BASE =
  "absolute flex flex-col overflow-y-auto overscroll-contain bg-base-100 text-base-content shadow-xl transition-[opacity,translate] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] starting:opacity-0";

const PANEL_BY_VARIANT: Record<SheetProps["variant"], string> = {
  menu:
    "inset-x-0 bottom-0 max-h-[90dvh] rounded-t-2xl px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] motion-safe:max-sm:starting:translate-y-6 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[26rem] sm:max-h-[85dvh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-4",
  full:
    "inset-0 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[min(40rem,calc(100vw-2rem))] sm:max-h-[90dvh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pt-3",
};

export function Sheet({ title, variant, onClose, readAloudText, children, testId, closeLabel }: SheetProps) {
  const isClient = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropPressed = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Escape closes the sheet and stops there (capture phase, before GameShell).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // Focus the main action, and give focus back on close.
  // While the main action is disabled, the panel holds focus in its place.
  const waitingForMain = useRef(false);
  useEffect(() => {
    if (!isClient) return;
    const panel = panelRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const main = panel?.querySelector<HTMLElement>(AUTOFOCUS) ?? null;
    if (main) {
      main.focus({ preventScroll: true });
    } else if (panel?.querySelector("[data-autofocus]")) {
      // The main action is there but disabled: a disabled button cannot take focus.
      waitingForMain.current = true;
      panel.focus({ preventScroll: true });
    } else {
      (panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel)?.focus({ preventScroll: true });
    }
    return () => {
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [isClient]);

  // The main action can take focus now (its file is ready): move focus to it,
  // unless the kid already moved focus somewhere else.
  useEffect(() => {
    if (!waitingForMain.current) return;
    const panel = panelRef.current;
    if (!panel) return;
    if (document.activeElement !== panel) {
      waitingForMain.current = false;
      return;
    }
    const main = panel.querySelector<HTMLElement>(AUTOFOCUS);
    if (!main) return;
    waitingForMain.current = false;
    main.focus({ preventScroll: true });
  });

  const keepTabInside = (event: React.KeyboardEvent) => {
    if (event.key !== "Tab" || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const onPanel = document.activeElement === panelRef.current;
    if (event.shiftKey && (document.activeElement === first || onPanel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!isClient) return null;

  return createPortal(
    <div
      data-testid={testId}
      data-clip-sheet={variant}
      className="fixed inset-0 z-[2500]"
      onPointerDown={stopHere}
      onPointerUp={stopHere}
      onPointerCancel={stopHere}
      onMouseDown={stopHere}
      onMouseUp={stopHere}
      onTouchStart={stopHere}
      onTouchEnd={stopHere}
      onTouchCancel={stopHere}
      onClick={stopHere}
      onDoubleClick={stopHere}
      onContextMenu={stopHere}
      onKeyDown={stopHere}
    >
      {/* A solid dim, not a blur (no glassmorphism). A tap on it closes the sheet. */}
      <div
        data-testid="clip-sheet-backdrop"
        aria-hidden="true"
        className="absolute inset-0 bg-black/70"
        onPointerDown={() => {
          backdropPressed.current = true;
        }}
        onClick={() => {
          // Only a press that began on the backdrop closes the sheet. A hold
          // opens the menu while the finger is still down, and some browsers
          // send that finger's release click to the new backdrop.
          if (!backdropPressed.current) return;
          backdropPressed.current = false;
          onClose();
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={keepTabInside}
        className={`${PANEL_BASE} ${PANEL_BY_VARIANT[variant]} outline-none`}
      >
        <div className="mb-3 flex items-center gap-2">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-xl font-bold">
            {title}
          </h2>
          <ReadAloudButton text={readAloudText} variant="icon" className="shrink-0" />
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel ?? VIEWER_COPY.close}
            className="btn btn-circle btn-ghost h-11 min-h-11 w-11 min-w-11 shrink-0 touch-manipulation"
          >
            <CloseGlyph size={22} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
