"use client";

import { useId, useRef, useState, useSyncExternalStore } from "react";
import type React from "react";
import { createPortal } from "react-dom";

import { hasLeaderboardSupport } from "@/lib/leaderboard-extractors";
import { getGameMetadata } from "../lib/gameMetadata.generated";
import { COMPAT_CLICK_WINDOW_MS } from "../lib/input/usePointerTap";
import {
  DEFAULT_RESTART_GRACE_MS,
  useRestartGrace,
} from "../lib/input/useRestartGrace";
import { LeaderboardModal } from "./LeaderboardModal";
import { ReadAloudButton } from "./ReadAloudButton";

/**
 * One shared bar of big buttons that sits over a game's result or
 * game-over card: read it to me, play again, the leaderboard, and (later)
 * the clip buttons in the children slot.
 *
 * Why: the result card is where a kid wants to do the next thing, but
 * most games draw that card into the canvas, where a tap only restarts.
 * The read-aloud button was missing on almost every result screen, and
 * on small phones the header has no room for Leaderboard and Restart.
 * This bar gives every game the same real buttons at game over.
 *
 * Contracts:
 * - Stacking: z-index 1200 (plan 11.4). It sits above the header row
 *   (1000), the in-play toast slot (1050) and the toast lane (1100), and
 *   below the leaderboard (1500), the pause menu (2000), the clip sheets
 *   (2500) and the restart question (3000). Like every layer above 1000,
 *   it portals to document.body, so no game container can trap it.
 * - Taps stay here: pointer, mouse, touch and click events stop at the
 *   bar. React sends portal events up the COMPONENT tree, so without this
 *   a tap on "Play again" would also reach the game's canvas handler and
 *   restart twice (or flap the bird of the new run).
 * - Restart grace: for the first 600 ms after the bar appears, every
 *   button in it ignores taps, and a held key never repeats a button. A
 *   kid who is still tapping when the run ends sees the result first.
 * - Mount it CONDITIONALLY on the result state
 *   (`{state === "gameOver" && <ResultChip ... />}`). The grace starts at
 *   mount, and Play again fires only once for each mount.
 * - Read-aloud: the voice says the result, then the name of every button
 *   in screen order. Name the buttons in the children slot with
 *   `spokenExtras`, in screen order.
 */

/** The stacking level of the result chip (plan 11.4). */
export const RESULT_CHIP_Z_INDEX = 1200;

/** Button labels. The voice uses the same words as the screen. */
export const RESULT_CHIP_LABELS = {
  playAgain: "Play again",
  leaderboard: "Leaderboard",
} as const;

export interface ResultChipProps {
  /**
   * The result in kid words, read aloud first. For example:
   * "Game over! You got 12 points. That is a new best!"
   */
  resultText: string;
  /** The game id. Shows the Leaderboard button when this game has one. */
  appId?: string;
  /** Starts a new run. Shows the Play again button. */
  onRestart?: () => void;
  /** More actions, for example the clip buttons. Use 44 px targets. */
  children?: React.ReactNode;
  /** Labels of the buttons in the children slot, in screen order. */
  spokenExtras?: string[];
  /** The lockout after the bar appears, in ms. Default 600. */
  graceMs?: number;
}

/** Nothing on the page can change "are we in the browser", so no subscription. */
function subscribeToNothing(): () => void {
  return () => {};
}

/** Keeps a tap on the bar from reaching the game under it. */
function stopAtChip(event: React.SyntheticEvent): void {
  event.stopPropagation();
}

const ACTION_BUTTON =
  "btn h-11 min-h-11 gap-2 px-4 text-lg active:scale-[0.97] touch-manipulation";

export function ResultChip({
  resultText,
  appId,
  onRestart,
  children,
  spokenExtras = [],
  graceMs = DEFAULT_RESTART_GRACE_MS,
}: ResultChipProps) {
  // The server has no document.body to portal into. The server snapshot is
  // false, so the server and the first client render agree.
  const isClient = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  const grace = useRestartGrace(graceMs);
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false);
  const resultId = useId();

  const leaderboardAppId = appId && hasLeaderboardSupport(appId) ? appId : null;

  // Same order as the buttons on screen: Play again, Leaderboard, extras.
  const spokenText = [
    resultText,
    onRestart ? RESULT_CHIP_LABELS.playAgain : null,
    leaderboardAppId ? RESULT_CHIP_LABELS.leaderboard : null,
    ...spokenExtras,
  ]
    .filter(Boolean)
    .join(". ");

  // During the grace, a tap or click on ANY button in the bar (the children
  // slot included) does nothing. Stopping it in the capture phase keeps it
  // from reaching the button at all.
  const blockedPressAtRef = useRef(Number.NEGATIVE_INFINITY);
  const block = (event: React.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const holdPressDuringGrace = (event: React.PointerEvent) => {
    if (grace.accept()) return;
    blockedPressAtRef.current = performance.now();
    block(event);
  };
  const holdClickDuringGrace = (event: React.MouseEvent) => {
    // A press that started inside the grace stays ignored, even when the
    // finger lifts after the grace ends.
    const pressWasBlocked =
      performance.now() - blockedPressAtRef.current < COMPAT_CLICK_WINDOW_MS;
    if (pressWasBlocked) blockedPressAtRef.current = Number.NEGATIVE_INFINITY;
    if (grace.accept() && !pressWasBlocked) return;
    block(event);
  };

  // A held Enter repeats the click on a focused button. Only a new press
  // may act.
  const blockKeyRepeat = (event: React.KeyboardEvent) => {
    if (event.repeat) event.preventDefault();
  };

  // Play again fires once per chip, no matter how fast it is mashed (the
  // GameStartOverlay rule). The game unmounts the chip when the run starts.
  const restartedRef = useRef(false);
  const handleRestart = () => {
    if (restartedRef.current || !onRestart) return;
    restartedRef.current = true;
    onRestart();
  };

  if (!isClient) return null;

  const leaderboardInfo = leaderboardAppId ? getGameMetadata(leaderboardAppId) : null;

  return createPortal(
    <div
      data-testid="result-chip"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[1200] flex justify-center px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <div
        role="group"
        aria-labelledby={resultId}
        onClickCapture={holdClickDuringGrace}
        onPointerDownCapture={holdPressDuringGrace}
        onKeyDownCapture={blockKeyRepeat}
        onPointerDown={stopAtChip}
        onPointerUp={stopAtChip}
        onMouseDown={stopAtChip}
        onMouseUp={stopAtChip}
        onTouchStart={stopAtChip}
        onTouchEnd={stopAtChip}
        onClick={stopAtChip}
        onDoubleClick={stopAtChip}
        onContextMenu={stopAtChip}
        className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-2xl border border-base-300 bg-base-100 p-2 text-base-content shadow-lg transition-[opacity,translate] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] starting:opacity-0 motion-safe:starting:translate-y-2"
      >
        <p id={resultId} className="sr-only">
          {resultText}
        </p>

        <ReadAloudButton variant="icon" text={spokenText} />

        {onRestart && (
          <button
            type="button"
            onClick={handleRestart}
            className={`${ACTION_BUTTON} btn-primary`}
          >
            <span aria-hidden="true">↻</span>
            {RESULT_CHIP_LABELS.playAgain}
          </button>
        )}

        {leaderboardAppId && (
          <button
            type="button"
            onClick={() => setIsLeaderboardOpen(true)}
            className={ACTION_BUTTON}
          >
            <span aria-hidden="true">🏆</span>
            {RESULT_CHIP_LABELS.leaderboard}
          </button>
        )}

        {children}

        {leaderboardAppId && leaderboardInfo && (
          <LeaderboardModal
            isOpen={isLeaderboardOpen}
            onClose={() => setIsLeaderboardOpen(false)}
            appId={leaderboardAppId}
            gameName={leaderboardInfo.name}
            icon={leaderboardInfo.icon}
          />
        )}
      </div>
    </div>,
    document.body
  );
}
