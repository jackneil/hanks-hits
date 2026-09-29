"use client";

import { useId, useRef, useState, useSyncExternalStore } from "react";
import type React from "react";
import { createPortal } from "react-dom";

import { hasLeaderboardSupport } from "@/lib/leaderboard-extractors";
import { useClipShellUi } from "@/shared/clips";
import { getGameMetadata } from "../lib/gameMetadata.generated";
import { RESULT_CHIP_BUTTON, RESULT_CHIP_GROUP, SECONDARY_ACTION } from "./buttonStyles";
import { createPressOwnership } from "../lib/input/pressOwnership";
import {
  DEFAULT_RESTART_GRACE_MS,
  useRestartGrace,
} from "../lib/input/useRestartGrace";
import { LeaderboardModal } from "./LeaderboardModal";
import { ReadAloudButton } from "./ReadAloudButton";

/**
 * One shared bar of big buttons that sits over a game's result or
 * game-over card: read it to me, play again, the leaderboard, and, in a
 * clip-enabled game with clips on, the clip buttons.
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
 * - Taps stay here: the events of a press that starts on the bar stop at
 *   the bar. React sends portal events up the COMPONENT tree, so without
 *   this a tap on "Play again" would also reach the game's canvas handler
 *   and restart twice (or flap the bird of the new run). A press that
 *   started on the game and ends over the bar still reaches the game
 *   (shared/lib/input/pressOwnership.ts), so its held input lets go.
 * - Restart grace: for the first 600 ms after the bar appears, every
 *   button in it ignores taps, and a held key never repeats a button. A
 *   press that starts inside the grace stays ignored until the finger
 *   lifts, however long it is held. A kid who is still tapping when the
 *   run ends sees the result first.
 * - A pointer click acts only when its press started on the bar. A finger
 *   that went down on the game before the bar appeared (holding thrust at
 *   the last death) and lifts over a button sends a click there; it is not
 *   a tap on the bar, so it does nothing, however late it lifts. Keyboard
 *   and screen-reader clicks (no pointer press, detail 0) act as usual.
 * - Mount it CONDITIONALLY on the result state
 *   (`{state === "gameOver" && <ResultChip ... />}`). The grace starts at
 *   mount, and Play again fires only once for each mount.
 * - Read-aloud: the big labelled "Read it to me" button, the same one as
 *   on the start card and the pause menu. The voice says the result, then
 *   the name of every button in screen order. Name the buttons in the
 *   children slot with `spokenExtras`, in screen order.
 * - Size: every button is 56 px high, and 44 px on a short screen (a phone
 *   held sideways), like the read-aloud button on the start card. Below
 *   480 px wide the buttons sit in two columns, 44 px or more, so the chip
 *   leaves the game's result card in view (buttonStyles.ts).
 * - Clips (plan 11.4, decision D1): in a clip-enabled game with clips on,
 *   the bar also shows the clip buttons after the children. A run of 30
 *   seconds or less gets "Watch the whole run (m:ss)"; a longer run gets
 *   "Watch the end" and "Make the whole run a video (m:ss)". Each clip
 *   holds this run only: its bounds come from the game's runPhase("start")
 *   and runPhase("end") on the clip timeline. The game adds no other code
 *   for them. The voice reads them too, in screen order, with each length
 *   in words.
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
  /**
   * More actions, for example the clip buttons. Use the same size as the
   * chip's own buttons: `min-h-14 short:min-h-11` (56 px, 44 px on a
   * short screen).
   */
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

const INTERACTIVE = 'button, a[href], [role="button"], [role="link"]';
// Emoji are pictures for kids who cannot read. The voice says the word.
const PICTOGRAPHS = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu;

/**
 * The spoken labels of the visible controls inside a container, in DOM
 * order. A control's data-spoken words win over its visible label (a clip
 * length is "16 seconds" for the voice, "0:16" on the screen).
 */
function spokenLabelsIn(container: HTMLElement | null): string[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll(INTERACTIVE))
    .filter((el) => !el.closest('[aria-hidden="true"], [hidden]'))
    .map((el) => {
      const spoken = el.getAttribute("data-spoken")?.trim();
      if (spoken) return spoken;
      const visible = (el.textContent ?? "").replace(PICTOGRAPHS, " ").replace(/\s+/g, " ").trim();
      return visible || el.getAttribute("aria-label")?.trim() || "";
    })
    .filter((label) => label.length > 0);
}

/** 56 px buttons, 44 px on a short screen, like the start card's read-aloud button. */
const BUTTON_SIZE = RESULT_CHIP_BUTTON;

const ACTION_BUTTON = `btn gap-2 px-4 text-lg ${BUTTON_SIZE} active:scale-[0.97] touch-manipulation`;

export function ResultChip({
  resultText,
  appId,
  onRestart,
  children,
  spokenExtras = [],
  graceMs = DEFAULT_RESTART_GRACE_MS,
}: ResultChipProps) {
  // The clip UI parts of a clip-enabled game with clips on, or null.
  const clip = useClipShellUi();
  const clipActionsRef = useRef<HTMLDivElement>(null);
  // The server has no document.body to portal into. The server snapshot is
  // false, so the server and the first client render agree.
  const isClient = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  const grace = useRestartGrace(graceMs);
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false);
  const resultId = useId();
  // The presses that started on the bar: only their events stop here.
  const [owned] = useState(createPressOwnership);
  const ownPointerDown = (event: React.PointerEvent) => {
    event.stopPropagation();
    owned.down(event.pointerId);
  };
  const ownPointerEnd = (event: React.PointerEvent) => {
    if (owned.end(event.pointerId)) event.stopPropagation();
  };
  const ownMouseDown = (event: React.MouseEvent) => {
    event.stopPropagation();
    owned.mouseDown();
  };
  const ownMouseUp = (event: React.MouseEvent) => {
    if (owned.mouseUp()) event.stopPropagation();
  };

  const leaderboardAppId = appId && hasLeaderboardSupport(appId) ? appId : null;

  // Same order as the buttons on screen: Play again, Leaderboard, extras,
  // then the clip buttons. Built at tap time, so the clip buttons that show
  // right now are the ones the voice says.
  const spokenText = () =>
    [
      resultText,
      onRestart ? RESULT_CHIP_LABELS.playAgain : null,
      leaderboardAppId ? RESULT_CHIP_LABELS.leaderboard : null,
      ...spokenExtras,
      ...spokenLabelsIn(clipActionsRef.current),
    ]
      .filter(Boolean)
      .join(". ");

  // During the grace, a tap or click on ANY button in the bar (the children
  // slot included) does nothing. Stopping it in the capture phase keeps it
  // from reaching the button at all.
  //
  // The block follows the gesture, not the clock. A press that starts
  // inside the grace stays ignored until its click, however long the
  // finger stays down. Each new press or key starts clean, so a blocked
  // press that never clicks (the browser cancelled it, or the finger slid
  // off) cannot eat the next deliberate tap.
  const pressBlockedRef = useRef(false);
  const block = (event: React.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  // True from a pointer press on the bar until its click: a pointer click
  // with no press here came from a press that started on the game.
  const pressStartedHereRef = useRef(false);
  const holdPressDuringGrace = (event: React.PointerEvent) => {
    pressStartedHereRef.current = true;
    pressBlockedRef.current = !grace.accept();
    if (pressBlockedRef.current) {
      // Blocking the press also stops the bubble-phase ownPointerDown, but
      // the press is still the bar's own: its release (pointerup, and the
      // mouseup of a mouse) must stop at the bar too, or a game that acts
      // on a release gets a stray one.
      owned.down(event.pointerId);
      if (event.pointerType === "mouse") owned.mouseDown();
      block(event);
    }
  };
  const endCancelledPress = () => {
    // A cancelled press sends no click, so its gesture ends here.
    pressBlockedRef.current = false;
    pressStartedHereRef.current = false;
  };
  const holdClickDuringGrace = (event: React.MouseEvent) => {
    const startedHere = pressStartedHereRef.current;
    pressStartedHereRef.current = false;
    if (pressBlockedRef.current) {
      // The click that ends a press that started inside the grace.
      pressBlockedRef.current = false;
      block(event);
      return;
    }
    // A pointer click (detail > 0) whose press began outside the bar.
    if (event.detail > 0 && !startedHere) {
      block(event);
      return;
    }
    if (!grace.accept()) block(event);
  };

  // A key press is a new gesture. A held Enter repeats the click on a
  // focused button, so only a new press may act.
  const startKeyGesture = (event: React.KeyboardEvent) => {
    pressBlockedRef.current = false;
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
        onPointerCancelCapture={endCancelledPress}
        onKeyDownCapture={startKeyGesture}
        onPointerDown={ownPointerDown}
        onPointerUp={ownPointerEnd}
        onPointerCancel={ownPointerEnd}
        onLostPointerCapture={(event) => owned.end(event.pointerId)}
        onPointerLeave={(event) => owned.leave(event.pointerId, event.pointerType)}
        onMouseDown={ownMouseDown}
        onMouseUp={ownMouseUp}
        onTouchStart={stopAtChip}
        onTouchEnd={stopAtChip}
        onTouchCancel={stopAtChip}
        onClick={stopAtChip}
        onDoubleClick={stopAtChip}
        onContextMenu={stopAtChip}
        className={`pointer-events-auto ${RESULT_CHIP_GROUP} rounded-2xl border border-base-300 bg-base-100 p-2 text-base-content shadow-lg transition-[opacity,translate] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] starting:opacity-0 motion-safe:starting:translate-y-2`}
      >
        <p id={resultId} className="sr-only">
          {resultText}
        </p>

        {/* The full button is w-full for a column; in this row it takes
            only the width of its label. */}
        <ReadAloudButton
          text={spokenText}
          className={`w-auto! shrink-0 px-4 max-[480px]:w-full! max-[480px]:px-1.5! ${BUTTON_SIZE}`}
        />

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
            className={`${ACTION_BUTTON} ${SECONDARY_ACTION}`}
          >
            <span aria-hidden="true">🏆</span>
            {RESULT_CHIP_LABELS.leaderboard}
          </button>
        )}

        {children}

        {/* display: contents keeps the clip buttons in the button row */}
        {clip && (
          <div ref={clipActionsRef} data-testid="result-chip-clip-actions" className="contents">
            <clip.ResultChipClipActions />
          </div>
        )}

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
