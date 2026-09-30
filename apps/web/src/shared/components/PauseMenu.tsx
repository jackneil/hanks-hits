"use client";

import { useEffect, useRef, useState } from "react";
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

export function PauseMenu({
  isOpen,
  onResume,
  onHome,
  gameName,
  onRestart,
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

  // The break slot: nudges such as the iOS install tip render into it
  // while the menu is open, so they never float over play (gameBreaks.ts).
  const { slotRef: breakSlotRef, readNotes: readBreakNotes } = useRegisterBreakSlot();

  // The overlay's scroll cue: a shadow at an edge only while more of the
  // menu is past that edge (a long menu on a short screen).
  useScrollCue(overlayRef, contentRef, isOpen);

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

  // Same order as the screen: title, Resume, the children slot, Restart,
  // Go Home, then the notes in the break slot. Built at tap time from what
  // is on screen, so every child button is spoken (the children slot used
  // to be silent).
  const readAloudText = () =>
    [
      "Paused",
      gameName,
      "Resume",
      ...(spokenExtras ?? spokenLabelsIn(extrasRef.current)),
      onRestart ? "Restart" : null,
      "Go Home",
      ...readBreakNotes(),
    ]
      .filter(Boolean)
      .join(". ");

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      data-testid="pause-menu"
      className="scroll-cue fixed inset-0 z-[2000] flex overflow-y-auto overscroll-contain bg-black/90"
    >
      {/* m-auto (not justify-center on the parent) centers the column when
          it fits, and lets a taller column (an install tip on a short
          iPhone, or a phone held sideways) scroll from its top. A centered
          column that overflows clips its top, "Paused" included, where no
          scroll can reach it. */}
      <div
        ref={contentRef}
        data-testid="pause-menu-content"
        className="m-auto flex flex-col items-center px-4 py-4 short:py-3"
      >
        {/* Sentence case and no pulse: the old all-caps PAUSED blinked
            forever and ignored reduced motion. */}
        <h2 className="text-4xl md:text-6xl font-bold text-white mb-8 short:mb-1 short:text-2xl">
          Paused
        </h2>

        {/* Game name */}
        <div className="text-xl text-gray-400 mb-8 short:mb-1 short:text-base">{gameName}</div>

        {/* Read the menu out loud for players who cannot read yet */}
        <div className="w-64 mb-4 short:mb-2 short:w-full">
          <ReadAloudButton text={readAloudText} className="short:min-h-[44px]" />
        </div>

        {/* Menu buttons: one column, and a 2 x 2 grid on a short screen so
            Resume, Restart and Go Home are on screen with no scroll */}
        <div
          data-testid="pause-menu-buttons"
          className="flex flex-col gap-4 w-64 short:grid short:w-[28rem] short:max-w-[calc(100vw-2rem)] short:grid-cols-2 short:gap-2"
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

        {/* Break slot (empty unless a nudge renders into it). Not on a short
            screen: the tip waits for a taller break. */}
        {!isShort && (
          <div
            ref={breakSlotRef}
            data-testid="pause-menu-break-slot"
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
          onRestart?.();
          onResume();
        }}
      />
    </div>
  );
}
