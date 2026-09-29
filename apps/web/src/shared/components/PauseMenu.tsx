"use client";

import { useEffect, useRef, useState } from "react";
import { useCoarsePointer } from "../hooks/useCoarsePointer";
import { useRegisterBreakSlot } from "../lib/gameBreaks";
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

const INTERACTIVE = 'button, a[href], [role="button"], [role="link"]';
// Emoji are pictures for kids who cannot read. The voice says the word.
const PICTOGRAPHS = /[\p{Extended_Pictographic}️‍⃣]/gu;

/** The words a voice says for one control: its visible label, else its aria-label. */
function spokenLabel(el: Element): string | null {
  const visible = (el.textContent ?? "").replace(PICTOGRAPHS, " ").replace(/\s+/g, " ").trim();
  if (visible) return visible;
  return el.getAttribute("aria-label")?.trim() || null;
}

/** The spoken labels of the visible controls inside a container, in DOM order. */
function spokenLabelsIn(container: HTMLElement | null): string[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll(INTERACTIVE))
    .filter((el) => !el.closest('[aria-hidden="true"], [hidden]'))
    .map(spokenLabel)
    .filter((label): label is string => !!label);
}

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
  // The ESC hint is for a keyboard. A finger on a phone has no ESC key.
  const isCoarse = useCoarsePointer();

  // The break slot: nudges such as the iOS install tip render into it
  // while the menu is open, so they never float over play (gameBreaks.ts).
  const { slotRef: breakSlotRef, readNotes: readBreakNotes } = useRegisterBreakSlot();

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
      data-testid="pause-menu"
      className="fixed inset-0 z-[2000] flex overflow-y-auto bg-black/90"
    >
      {/* m-auto (not justify-center on the parent) centers the column when
          it fits, and lets a taller column (an install tip on a short
          iPhone, or a phone held sideways) scroll from its top. A centered
          column that overflows clips its top, "Paused" included, where no
          scroll can reach it. */}
      <div data-testid="pause-menu-content" className="m-auto flex flex-col items-center py-4">
        {/* Sentence case and no pulse: the old all-caps PAUSED blinked
            forever and ignored reduced motion. */}
        <h2 className="text-4xl md:text-6xl font-bold text-white mb-8 short:mb-2 short:text-3xl">
          Paused
        </h2>

        {/* Game name */}
        <div className="text-xl text-gray-400 mb-8 short:mb-2">{gameName}</div>

        {/* Read the menu out loud for players who cannot read yet */}
        <div className="w-64 mb-4 short:mb-2">
          <ReadAloudButton text={readAloudText} className="short:min-h-[44px]" />
        </div>

        {/* Menu buttons */}
        <div className="flex flex-col gap-4 w-64 short:gap-2">
          <button
            onClick={onResume}
            className="btn btn-primary btn-lg text-xl gap-3 shadow-lg hover:scale-105 transition-transform"
          >
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
              className="btn btn-secondary btn-lg w-full text-xl gap-3 shadow-lg hover:scale-105 transition-transform"
            />
          )}

          <button
            onClick={onHome}
            className="btn btn-error btn-lg text-xl gap-3 shadow-lg hover:scale-105 transition-transform"
          >
            <span className="text-2xl">🏠</span>
            Go Home
          </button>
        </div>

        {/* Break slot (empty unless a nudge renders into it) */}
        <div
          ref={breakSlotRef}
          data-testid="pause-menu-break-slot"
          className="mt-4 w-72 max-w-[calc(100vw-2rem)] empty:hidden short:mt-2"
        />

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
