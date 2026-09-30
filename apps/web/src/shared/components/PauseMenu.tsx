"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useCoarsePointer } from "../hooks/useCoarsePointer";
import { useScrollCue } from "../hooks/useScrollCue";
import { useShortViewport } from "../hooks/useShortViewport";
import { useRegisterBreakSlot } from "../lib/gameBreaks";
import { spokenLabelsIn } from "../lib/spokenLabels";
import { ReadAloudButton } from "./ReadAloudButton";
import { RestartConfirmationDialog } from "./RestartConfirmationDialog";
import { RestartGameButton } from "./RestartGameButton";

interface PauseMenuProps {
  isOpen: boolean;
  onResume: () => void;
  onHome: () => void;
  gameName: string;
  onRestart?: () => void;
  /**
   * The kid confirmed the restart question. GameShell passes this to run
   * the restart in the shell's order (let the run go, then restart).
   * Without it the menu resumes, then restarts.
   */
  onRestartConfirmed?: () => void;
  restartConfirmation?: "always" | "never";
  restartConfirmationMessage?: string;
  children?: React.ReactNode;
  /**
   * The words to say for the buttons in the children slot. Leave it out and
   * the menu reads the visible label of every button and link in the slot,
   * in screen order, so a new child button is always spoken.
   */
  spokenExtras?: string[];
}

/** A menu button: 48 px, 44 px on a short screen (a phone held sideways). */
const MENU_BUTTON =
  "btn btn-lg text-xl gap-3 shadow-lg hover:scale-105 transition-transform short:h-11 short:min-h-11 short:text-lg";

/**
 * The pause menu. It covers the screen UNDER the header (top-12, and
 * top-10 on a short screen), like the start card, the orientation tip and
 * a game sheet: the header stays in view and in use (Home, Restart, and
 * the pause button, which resumes). Before this it covered the whole
 * screen, and "Paused" sat over the ghost of the header on a phone.
 *
 * Break slots (gameBreaks.ts): a trophy celebration renders into the slot
 * under the buttons on every screen (one row on a short screen). The iOS
 * install tip has its own slot below that, on a tall screen only, and
 * only while the whole menu still fits on the screen with it: when the
 * tip lands and the menu would scroll, the tip's slot goes away for this
 * open and the tip waits for the next break (the same rule as the start
 * card). Before this, the tip made the menu 748 px tall on a 549 px
 * phone, with "Don't show this again" off screen.
 */
export function PauseMenu(props: PauseMenuProps) {
  const { isOpen } = props;

  // Prevent body scroll when paused
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // The open menu is its own component, so its state (the restart
  // question, the room for the tip) starts fresh at each open.
  return <OpenPauseMenu {...props} />;
}

/** True when an element's content is taller than the element. */
function overflows(el: HTMLElement): boolean {
  return el.scrollHeight > el.clientHeight + 1;
}

function OpenPauseMenu({
  onResume,
  onHome,
  gameName,
  onRestart,
  onRestartConfirmed,
  restartConfirmation = "always",
  restartConfirmationMessage,
  children,
  spokenExtras,
}: PauseMenuProps) {
  const [isRestartConfirmationOpen, setIsRestartConfirmationOpen] = useState(false);
  const restartTriggerRef = useRef<HTMLButtonElement>(null);
  const extrasRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // The ESC hint is for a keyboard. A finger on a phone has no ESC key.
  const isCoarse = useCoarsePointer();
  // A phone held sideways: a 2 x 2 grid of buttons, and no install tip
  // (the one column was 580 px tall on a 311 px screen, 684 with the tip;
  // phone UX audit 2026-09-29, S3).
  const isShort = useShortViewport();

  // The celebration slot: a trophy renders into it while the menu is
  // open, under the buttons, on every screen.
  const { slotRef: celebrationSlotRef, readNotes: readCelebrationNotes } = useRegisterBreakSlot(["celebration"]);

  // The tip slot: the iOS install tip renders into it, on a tall screen
  // only, and only while the menu fits on the screen with it.
  const { slotRef: registerTipSlot, readNotes: readTipNotes } = useRegisterBreakSlot(["tip"]);
  const tipSlotElRef = useRef<HTMLElement | null>(null);
  const tipSlotRef = useCallback(
    (el: HTMLDivElement | null) => {
      tipSlotElRef.current = el;
      if (!el) return undefined;
      const unregister = registerTipSlot(el);
      return () => {
        tipSlotElRef.current = null;
        unregister?.();
      };
    },
    [registerTipSlot]
  );
  // One way only, for this open: once the menu would scroll with the tip
  // in it, the tip's slot goes away and the tip waits for the next break.
  const [tipRoom, setTipRoom] = useState(true);
  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const slot = tipSlotElRef.current;
    if (!tipRoom || !overlay || !slot) return;
    const noRoom = () => overflows(overlay);
    // The tip lands in the slot after this commit: measure before paint,
    // so a tip that does not fit never shows.
    const notes =
      typeof MutationObserver !== "undefined"
        ? new MutationObserver(() => {
            if (noRoom()) flushSync(() => setTipRoom(false));
          })
        : null;
    notes?.observe(slot, { childList: true, subtree: true });
    // Later changes: the phone turns, a font loads, a button appears.
    const sizes =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (slot.childElementCount > 0 && noRoom()) setTipRoom(false);
          })
        : null;
    if (contentRef.current) sizes?.observe(contentRef.current);
    sizes?.observe(overlay);
    return () => {
      notes?.disconnect();
      sizes?.disconnect();
    };
  }, [tipRoom]);

  // The overlay's scroll cue: a shadow at an edge only while more of the
  // menu is past that edge (a long menu on a short screen).
  useScrollCue(overlayRef, contentRef, true);

  // Same order as the screen: title, Resume, the children slot, Restart,
  // Go Home, then the notes in the break slots. Built at tap time from
  // what is on screen, so every child button is spoken (the children slot
  // used to be silent).
  const readAloudText = () =>
    [
      "Paused",
      gameName,
      "Resume",
      ...(spokenExtras ?? spokenLabelsIn(extrasRef.current)),
      onRestart ? "Restart" : null,
      "Go Home",
      ...readCelebrationNotes(),
      ...readTipNotes(),
    ]
      .filter(Boolean)
      .join(". ");

  return (
    <div
      ref={overlayRef}
      data-testid="pause-menu"
      className="scroll-cue fixed inset-x-0 bottom-0 top-12 z-[2000] flex overflow-y-auto overscroll-contain bg-black/90 short:top-10"
    >
      {/* m-auto (not justify-center on the parent) centers the column when
          it fits, and lets a taller column (a long menu on a phone held
          sideways) scroll from its top. A centered column that overflows
          clips its top, "Paused" included, where no scroll can reach it. */}
      <div
        ref={contentRef}
        data-testid="pause-menu-content"
        className="m-auto flex flex-col items-center px-4 py-3 short:py-1.5"
      >
        {/* The heading and the game name: one line on a short screen. The
            room under the header is 501 px on a 375x549 phone and 271 px
            sideways; with Sign In and Leaderboard in the menu during play
            (five buttons) the old spacing overflowed both. */}
        <div className="mb-4 flex flex-col items-center short:mb-1 short:flex-row short:items-baseline short:gap-2">
          {/* Sentence case and no pulse: the old all-caps PAUSED blinked
              forever and ignored reduced motion. */}
          <h2 className="text-4xl md:text-6xl font-bold text-white short:text-2xl">Paused</h2>
          <div className="mt-4 text-xl text-gray-400 md:mt-6 short:mt-0 short:text-base">{gameName}</div>
        </div>

        {/* Read the menu out loud for players who cannot read yet */}
        <div className="w-64 mb-3 short:mb-2 short:w-full">
          <ReadAloudButton text={readAloudText} className="short:min-h-[44px]" />
        </div>

        {/* Menu buttons: one column, and a 2 x 2 grid on a short screen so
            Resume, Restart and Go Home are on screen with no scroll */}
        <div
          data-testid="pause-menu-buttons"
          className="flex flex-col gap-3 w-64 short:grid short:w-[28rem] short:max-w-[calc(100vw-2rem)] short:grid-cols-2 short:gap-2"
        >
          <button onClick={onResume} className={`${MENU_BUTTON} btn-primary`}>
            <span className="text-2xl">▶️</span>
            Resume
          </button>

          {/* display: contents keeps the children in the button column */}
          <div ref={extrasRef} className="contents">
            {children}
          </div>

          {onRestart && (
            <RestartGameButton
              ref={restartTriggerRef}
              variant="menu"
              onClick={() => {
                if (restartConfirmation === "never") {
                  onRestart();
                } else {
                  setIsRestartConfirmationOpen(true);
                }
              }}
              className={`${MENU_BUTTON} btn-secondary w-full`}
            />
          )}

          <button onClick={onHome} className={`${MENU_BUTTON} btn-error`}>
            <span className="text-2xl">🏠</span>
            Go Home
          </button>
        </div>

        {/* Celebration slot (empty unless a trophy renders into it): one
            row on a short screen, under the grid. */}
        <div
          ref={celebrationSlotRef}
          data-testid="pause-menu-break-slot"
          className="mt-4 w-72 max-w-[calc(100vw-2rem)] empty:hidden short:mt-2 short:w-[28rem]"
        />

        {/* Tip slot (empty unless the install tip renders into it). Not on
            a short screen, and only while the menu fits with the tip. */}
        {!isShort && tipRoom && (
          <div
            ref={tipSlotRef}
            data-testid="pause-menu-tip-slot"
            className="mt-4 w-72 max-w-[calc(100vw-2rem)] empty:hidden"
          />
        )}

        {/* Keyboard hint, only for a mouse or trackpad */}
        {!isCoarse && (
          <div className="mt-8 text-gray-400 text-sm short:mt-2">Press ESC to resume</div>
        )}
      </div>

      <RestartConfirmationDialog
        isOpen={isRestartConfirmationOpen}
        gameName={gameName}
        message={restartConfirmationMessage}
        triggerRef={restartTriggerRef}
        onCancel={() => setIsRestartConfirmationOpen(false)}
        onConfirm={() => {
          setIsRestartConfirmationOpen(false);
          if (onRestartConfirmed) {
            onRestartConfirmed();
          } else {
            // Let the run go first, then restart: the shell's order.
            onResume();
            onRestart?.();
          }
        }}
      />
    </div>
  );
}
