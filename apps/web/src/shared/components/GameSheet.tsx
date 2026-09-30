"use client";

import { useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useShortViewport } from "../hooks/useShortViewport";
import { useRegisterBreakSlot } from "../lib/gameBreaks";
import { joinSpoken, spokenLabelsIn, spokenWordsOf } from "../lib/spokenLabels";
import { ReadAloudButton } from "./ReadAloudButton";

/**
 * The shared card for a game's own screens between runs: game over, level
 * complete, settings, a garage, a store.
 *
 * Why: game cards were `fixed inset-0 items-center p-8` with no scroll and
 * no top offset. On a phone held sideways (311 px tall) Hill Climb's game
 * over card was 686 px tall, so Try Again showed 9 px of itself, and
 * Monster Truck's Resume showed 0 px (phone UX audit 2026-09-29, S3).
 *
 * Contract:
 * - It covers the screen under the header (top-12, short:top-10), never
 *   the header: Home and Pause stay one tap away.
 * - The card has a header (emoji, title), a body that scrolls when the
 *   screen is short, and an action column that never scrolls out of view.
 *   On a short screen the action column sits beside the body, so every
 *   button is on screen at 667x311 with no scroll (the start card's rule).
 * - Every action is a real button, 44 px or more. Put the main action
 *   (Try Again, Next level) first.
 * - Read-aloud is built in: the voice says the title, the words of the
 *   body, then the label of every action button in screen order, and the
 *   notes in the break slot last.
 * - A break: the iOS install tip renders into the sheet's break slot
 *   (gameBreaks.ts) while the sheet shows, so it never floats over play.
 *   Not on a short screen, where there is no room for it.
 * - Stacking: z-[60], the game tier (a game's own screen). It portals to
 *   document.body, so a game root with its own stacking context (a
 *   `fixed inset-0` root) cannot trap it. The start card (z-90) and the
 *   result chip (z-1200) are above it; use the sheet OR the result chip
 *   for one screen, not both.
 * - Mount it CONDITIONALLY on the game's screen state, like the start
 *   card. It takes no tap for the game: a press that starts on the sheet
 *   stops at the sheet.
 */

export const GAME_SHEET_Z_INDEX = 60;

export interface GameSheetProps {
  /** The heading, in kid words: "You crashed!", "Level 3 done!", "Settings". */
  title: string;
  /** A big picture above the title. */
  emoji?: string;
  /** The words and the controls of the screen (scroll when short). */
  children?: ReactNode;
  /** The action buttons, the main one first. Each one 44 px or more. */
  actions: ReactNode;
  /**
   * The words the voice says. Leave it out and the sheet reads the title,
   * the body and the action labels, in that order.
   */
  spokenText?: string | (() => string);
  testId?: string;
  /** Extra classes for the card (a game's own colors). */
  className?: string;
}

function subscribeToNothing(): () => void {
  return () => {};
}

function stopHere(event: React.SyntheticEvent): void {
  event.stopPropagation();
}

export function GameSheet({
  title,
  emoji,
  children,
  actions,
  spokenText,
  testId = "game-sheet",
  className = "",
}: GameSheetProps) {
  const isClient = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  const isShort = useShortViewport();
  const titleId = useId();
  const wordsRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const { slotRef: breakSlotRef, readNotes: readBreakNotes } = useRegisterBreakSlot();

  // Built at tap time: the title, the words of the body, then the label of
  // every action in screen order, then the notes in the break slot.
  const readAloudText = () => {
    const own =
      typeof spokenText === "function"
        ? spokenText()
        : (spokenText ??
          joinSpoken([title, spokenWordsOf(wordsRef.current), ...spokenLabelsIn(actionsRef.current)]));
    return joinSpoken([own, ...readBreakNotes()]);
  };

  if (!isClient) return null;

  return createPortal(
    <div
      data-testid={testId}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onPointerDown={stopHere}
      onPointerUp={stopHere}
      onTouchStart={stopHere}
      onTouchEnd={stopHere}
      onMouseDown={stopHere}
      onMouseUp={stopHere}
      onClick={stopHere}
      onKeyDown={stopHere}
      className="fixed inset-x-0 bottom-0 top-12 z-[60] flex overflow-y-auto overscroll-contain bg-black/75 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] short:top-10 short:p-3 short:pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <div className="m-auto flex max-h-full min-h-0 w-full max-w-md flex-col gap-3 short:max-w-4xl short:flex-row short:items-center short:justify-center short:gap-2">
        <div
          data-testid={`${testId}-card`}
          className={`flex max-h-full min-h-0 w-full flex-col overflow-hidden rounded-3xl bg-base-100 text-base-content shadow-2xl short:max-w-2xl short:flex-1 short:flex-row ${className}`}
        >
          {/* Body: the heading and the words, scrolls when short */}
          <div
            data-testid={`${testId}-body`}
            className="min-h-0 shrink overflow-y-auto overscroll-contain px-6 pt-6 pb-2 text-center short:min-w-0 short:flex-1 short:px-4 short:py-3 short:text-left"
          >
            {emoji && (
              <div className="mb-2 text-5xl short:mb-0 short:text-3xl" aria-hidden="true">
                {emoji}
              </div>
            )}
            <h2 id={titleId} className="mb-2 break-words text-3xl font-bold short:mb-1 short:text-2xl">
              {title}
            </h2>
            <div ref={wordsRef}>{children}</div>
          </div>

          {/* Actions: pinned, never scroll out of view; beside the body when short */}
          <div
            data-testid={`${testId}-actions`}
            className="flex shrink-0 flex-col items-stretch gap-3 px-6 pb-6 pt-3 short:w-[45%] short:gap-2 short:p-3 short:[align-self:safe_center]"
          >
            <ReadAloudButton text={readAloudText} className="short:min-h-[44px]" />
            {/* display: contents keeps the actions in the column; the voice
                reads only these, not the read-aloud button itself */}
            <div ref={actionsRef} className="contents">
              {actions}
            </div>
          </div>
        </div>

        {/* Break slot (the install tip), outside the card; not on a short screen */}
        {!isShort && (
          <div ref={breakSlotRef} data-testid={`${testId}-break-slot`} className="w-full shrink-0 empty:hidden" />
        )}
      </div>
    </div>,
    document.body
  );
}

/** The one style for a sheet action button: 44 px or more, full width. */
export const GAME_SHEET_ACTION =
  "btn btn-lg min-h-[44px] w-full text-xl gap-2 shadow-md active:scale-[0.97] short:h-11 short:min-h-11 short:text-lg";
