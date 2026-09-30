"use client";

import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal, flushSync } from "react-dom";
import { useCoarsePointer } from "../hooks/useCoarsePointer";
import { useScrollCue } from "../hooks/useScrollCue";
import { useShortViewport } from "../hooks/useShortViewport";
import { unlockGameAudio } from "../lib/audio";
import { useStartOverlayPresence } from "../lib/startOverlayPresence";
import { ReadAloudButton } from "./ReadAloudButton";
import { useRegisterBreakSlot } from "../lib/gameBreaks";

/**
 * Shared start screen for every game: a DOM overlay (never in-canvas),
 * so start controls are real buttons that work on touch, scale with the
 * viewport, and stay readable. Renders the game title exactly once —
 * games using it must not paint their own menu/title into the canvas.
 *
 * Position contract: the overlay portals to document.body and covers the
 * viewport (fixed), with the card in the box below the GameShell header.
 * So it does not matter where a game mounts it: a short canvas box, a
 * page taller than the screen, or a host that scrolls cannot clip the
 * card. (Before 2026-09-29 the card was clipped to the game's own box, and
 * on a phone Play fell below the visible part of the card with no hint.)
 * Stacking: z-[90] — above every game layer (game modals use z-50/z-60),
 * below OrientationWarning (z-100) and the GameShell header and pause
 * layers (z-1000 and up).
 *
 * The card has two parts:
 *   - a body (emoji, title, subtitle, hints, and the picker slot when the
 *     built-in start button shows) that scrolls when the screen is short.
 *     On a touch screen (a phone upright too) and on a short screen the
 *     picker comes BEFORE the hints, so a choice is never under the fold
 *     while a hint is on screen, and the emoji is smaller on a touch
 *     screen; a desktop with a mouse reads how to play, then the choices;
 *   - an action row pinned at the bottom of the card: "Read it to me",
 *     then Play, or the picker slot when the picker starts the game. A
 *     picker slot with ONE child (Hill Climb's Garage button) is pinned
 *     into the action row too, above Play, so a centre tap never lands on
 *     Read it to me instead (phone UX audit 2026-09-29, S12).
 *     On a short screen (a phone held sideways) the action row sits to the
 *     right of the body instead, so the words keep their room.
 * So Play (or every choice) is always on screen, with no scroll.
 *
 * Break slot: a nudge such as the iOS install tip renders into a slot
 * OUTSIDE the card (below it, or beside it on a short screen), so it can
 * never push Play down or sit in the card's scroll box. The slot shows
 * only while the whole card body still fits with the note next to it.
 * When it does not fit, the slot goes away for this mount, and the note
 * waits for the next break (the pause menu).
 *
 * Mount contract: render it CONDITIONALLY on the menu/ready state
 * (`{state === "ready" && <GameStartOverlay .../>}`), never permanently
 * with CSS toggling — the fire-once guard is a per-mount ref, so an
 * always-mounted overlay would have a dead start button on replay. A
 * ReadAloudButton sits in the action row so a player who cannot read yet
 * can always find it and hear the title, the subtitle and the
 * instructions. Note
 * the guard covers only the built-in start button; picker buttons in the
 * children slot call the game's own start action directly (fine as long
 * as that action is an idempotent state reset, which every current game's
 * startGame is).
 *
 * Sound: Play (and every GameStartOverlayButton, so a picker that starts
 * the game counts too) calls unlockGameAudio() synchronously inside the
 * tap, before the game's handler. iOS only lets audio start inside a user
 * gesture, and many games start their first sound later, in an effect.
 */

interface GameStartOverlayButtonProps {
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
  /** Visual emphasis: "primary" for the main start action, "choice" for picker options */
  variant?: "primary" | "choice";
  /** Toggle-state semantics for picker buttons (screen readers hear the selection) */
  "aria-pressed"?: boolean;
}

/**
 * The one start-button style. Also used by difficulty/level pickers so
 * every start-screen target shares the same look and >=44px hit area.
 */
export function GameStartOverlayButton({
  onClick,
  children,
  className = "",
  variant = "choice",
  "aria-pressed": ariaPressed,
  ref,
}: GameStartOverlayButtonProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const handleClick = () => {
    // A start-screen tap means a game is about to play: start the shared
    // game sound now, inside the gesture (see the file comment).
    unlockGameAudio();
    onClick();
  };
  return (
    <button
      ref={ref}
      onClick={handleClick}
      aria-pressed={ariaPressed}
      className={`btn ${
        // "choice" stays on the default (base-200/base-content) button: white
        // text on btn-secondary green is ~3.1:1 and fails the 4.5:1 contract
        variant === "primary" ? "btn-primary btn-lg text-xl" : ""
      } min-h-[44px] min-w-[44px] w-full shadow-lg hover:scale-105 active:scale-95 transition-transform ${className}`}
    >
      {children}
    </button>
  );
}

export interface GameStartOverlayProps {
  /** Game name — rendered exactly once, as the overlay heading */
  title: string;
  /** Big friendly icon above the title */
  emoji?: string;
  /** One-line flavor text under the title */
  subtitle?: string;
  /** Instruction lines for touch (coarse-pointer) viewports */
  touchHints?: string[];
  /** Instruction lines for keyboard/mouse viewports */
  keyboardHints?: string[];
  /** Label for the built-in start button */
  startLabel?: string;
  /** Called exactly once, no matter how fast the button is mashed */
  onStart: () => void;
  /** Hide the built-in start button when the picker slot starts the game */
  showStartButton?: boolean;
  /** Picker slot (difficulty / level / age) rendered between hints and start */
  children?: React.ReactNode;
  /**
   * What the voice says about the picker slot, e.g. "Pick how old you are:
   * 4, 8, or 12." Required when the slot decides how the game starts; a kid
   * who cannot read has no other way to learn the choices.
   */
  spokenChoices?: string;
}

const subscribeNothing = () => () => {};

/**
 * True once the component renders in a browser. The server (and the
 * hydration pass) has no document.body to portal into.
 */
function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false
  );
}

/** Does the scroll box hold more than it shows? (1 px for rounding.) */
function overflows(box: HTMLElement): boolean {
  return box.scrollHeight > box.clientHeight + 1;
}

export function GameStartOverlay({
  title,
  emoji,
  subtitle,
  touchHints = [],
  keyboardHints = [],
  startLabel = "▶ Play!",
  onStart,
  showStartButton = true,
  children,
  spokenChoices,
}: GameStartOverlayProps) {
  const isClient = useIsClient();
  const isCoarse = useCoarsePointer();
  // A phone held sideways: the card gets the whole width, and the break
  // slot (the install tip) waits for a taller break. Beside the card the
  // tip took 288 px of a 667 px screen, so one hint wrapped to two lines.
  const isShort = useShortViewport();
  const startedRef = useRef(false);
  const titleId = useId();
  const startRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodyContentRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const breakSlotElRef = useRef<HTMLDivElement | null>(null);

  // Keyboard and screen-reader users land on Play, not on whatever game
  // control sits under the card. (A finger is not affected: focusing a
  // button opens no keyboard and moves no scroll on a phone.)
  useEffect(() => {
    startRef.current?.focus({ preventScroll: true });
  }, [isClient]);

  // Tell bottom sheets (the iOS install banner) that a start card is up,
  // so they stay hidden until the kid has pressed Play. A layout effect
  // runs before paint: a sheet rendered in the same commit leaves in the
  // sync render before paint, so it never flashes over the card for one
  // frame (it did on /apps/trivia with a passive effect). GameShell counts
  // itself the same way.
  const enter = useStartOverlayPresence((s) => s.enter);
  const leave = useStartOverlayPresence((s) => s.leave);
  useLayoutEffect(() => {
    enter();
    return leave;
  }, [enter, leave]);

  const handleStart = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    // Synchronously, before onStart: resume() only works inside the tap.
    unlockGameAudio();
    onStart();
  }, [onStart]);

  // The start screen is a break: a nudge such as the iOS install tip
  // renders into this slot, next to the card (gameBreaks.ts). On a short
  // screen the slot beside the card is gone (the tip took 288 px of a 667
  // px screen); a trophy celebration, one row there, gets a slot at the
  // top of the action column instead. Both slots share breakSlotElRef, so
  // the room check below watches whichever one is on screen.
  const { slotRef: registerBreakSlot, readNotes: readBreakNotes } = useRegisterBreakSlot();
  const { slotRef: registerShortSlot, readNotes: readShortNotes } = useRegisterBreakSlot(["celebration"]);
  const watchSlot = useCallback(
    (register: (el: HTMLElement | null) => (() => void) | undefined) =>
      (el: HTMLDivElement | null) => {
        breakSlotElRef.current = el;
        if (!el) return undefined;
        const unregister = register(el);
        return () => {
          breakSlotElRef.current = null;
          unregister?.();
        };
      },
    []
  );
  const breakSlotRef = useMemo(() => watchSlot(registerBreakSlot), [watchSlot, registerBreakSlot]);
  const shortSlotRef = useMemo(() => watchSlot(registerShortSlot), [watchSlot, registerShortSlot]);
  const readNotes = () => [...readBreakNotes(), ...readShortNotes()];

  // The slot stays only while the card fits with the note next to it.
  // When the body (or the whole card) must scroll, the
  // note is removed for this mount and waits for the next break (the
  // pause menu). One way only: if the note came back when the card fits
  // again, the two would swap forever.
  const [breakRoom, setBreakRoom] = useState(true);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const card = cardRef.current;
    if (!breakRoom || !body) return;
    // The card itself scrolls only when even the action row does not fit.
    const noRoom = () => overflows(body) || (!!card && overflows(card));

    // A note arrives in the slot after this commit. Measure it before the
    // browser paints, so a note that does not fit never shows. (This also
    // catches a card that is too tall even with no note.)
    const slot = breakSlotElRef.current;
    const notes =
      slot && typeof MutationObserver !== "undefined"
        ? new MutationObserver(() => {
            if (noRoom()) flushSync(() => setBreakRoom(false));
          })
        : null;
    if (slot) notes?.observe(slot, { childList: true, subtree: true });

    // The first size, and later changes: the phone turns, a font loads,
    // a line appears. (A ResizeObserver reports once when it starts.)
    const sizes =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (noRoom()) setBreakRoom(false);
          })
        : null;
    sizes?.observe(body);
    if (bodyContentRef.current) sizes?.observe(bodyContentRef.current);
    if (card) sizes?.observe(card);

    return () => {
      notes?.disconnect();
      sizes?.disconnect();
    };
  }, [breakRoom, isClient]);

  // The body's shadow at an edge shows only while there is more past that
  // edge (measured, so a body that fits draws no line).
  useScrollCue(bodyRef, bodyContentRef, isClient);

  const hints = isCoarse ? touchHints : keyboardHints;
  // Also tell the kid HOW to start: some games hide the Play button and
  // start from a picker choice instead, and a non-reader cannot tell.
  const startInstruction = showStartButton
    ? `Then tap ${startLabel} to start.`
    : "Then tap one of the choices to start.";
  // Built at tap time, so a note in a break slot is spoken last.
  const readAloudText = () =>
    [title, subtitle, ...hints, spokenChoices, startInstruction]
      .filter(Boolean)
      .join(". ") + readNotes().map((note) => ` ${note}`).join("");

  const pickerNodes = Children.toArray(children).filter(isValidElement);
  const pickers =
    pickerNodes.length > 0 ? (
      <div data-testid="start-card-pickers" className="flex flex-col items-stretch gap-3 short:gap-2">
        {children}
      </div>
    ) : null;
  // One picker child next to Play (a Garage button): pin it with Play. A
  // picker with more parts (a heading and a row of choices) stays in the
  // body, where it can scroll.
  const pinSinglePicker = showStartButton && pickerNodes.length === 1;
  // The picker in the body comes BEFORE the hints on a touch screen (a
  // phone upright too) and on a short screen: a choice is never under the
  // fold while a hint is on screen. Wordle showed "How old are you?" with
  // the choices under the fold at 375x549; Math Attack showed the heading
  // and no choice. A desktop with a mouse keeps the reading order: how to
  // play, then the choices.
  const pickerFirst = isCoarse || isShort;
  // pb: room for the picker buttons' shadow, which the scroll box would
  // cut off at its bottom edge.
  const bodyPickers =
    showStartButton && pickers && !pinSinglePicker ? (
      <div className="mt-3 pb-4 short:mt-1 short:mb-2 short:pb-1">{pickers}</div>
    ) : null;

  if (!isClient) return null;

  return createPortal(
    <div
      data-testid="game-start-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[90] bg-black/75"
    >
      {/* The box under the GameShell header (h-12, short:h-10). The short:
          variant (viewport under 480px tall, a phone held sideways)
          tightens the spacing and puts a note beside the card. */}
      <div className="absolute inset-x-0 bottom-0 top-12 flex p-4 pb-[max(1rem,env(safe-area-inset-bottom))] short:top-10 short:p-2 short:pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="m-auto flex max-h-full min-h-0 w-full max-w-md flex-col gap-3 short:h-full short:max-w-4xl short:flex-row short:items-center short:justify-center short:gap-2">
          <div
            ref={cardRef}
            data-testid="start-card"
            className="flex max-h-full min-h-0 w-full flex-col overflow-y-auto rounded-3xl bg-base-100 text-center text-base-content shadow-2xl short:min-w-0 short:max-w-2xl short:flex-1 short:flex-row"
          >
            {/* Body: scrolls when the screen is short. The scroll-cue
                shadow shows at an edge only while more is past that edge
                (useScrollCue). On a short screen (a phone held sideways)
                the body and the action row sit side by side, so the words
                keep their room. */}
            <div
              ref={bodyRef}
              data-testid="start-card-body"
              className="scroll-cue min-h-[4.5rem] shrink overflow-y-auto overscroll-contain px-6 pt-6 short:min-h-0 short:min-w-0 short:flex-1 short:px-3 short:py-3"
            >
              {/* The picker comes before the hints on a touch screen or a
                  short screen (pickerFirst), in DOM order, so the screen
                  and the tab order agree. */}
              <div ref={bodyContentRef} className="flex flex-col">
                {/* A smaller emoji on a touch screen: the 48 px one cost a
                    row of choices on a phone upright. */}
                {emoji && (
                  <div
                    className={`mb-2 short:mb-0 short:text-3xl ${isCoarse ? "text-4xl" : "text-5xl"}`}
                    aria-hidden="true"
                  >
                    {emoji}
                  </div>
                )}

                <h1
                  id={titleId}
                  className="mb-1 break-words text-3xl font-bold md:text-4xl short:mb-0 short:text-2xl"
                >
                  {title}
                </h1>

                {subtitle && (
                  <p className="mb-3 break-words text-base opacity-80 short:mb-1 short:text-sm">
                    {subtitle}
                  </p>
                )}

                {pickerFirst && bodyPickers}

                {/* Two columns on a short screen only with two or more
                    hints: one hint in a half-width column wrapped to four
                    lines. */}
                {hints.length > 0 && (
                  <ul
                    data-testid="start-card-hints"
                    className={`mb-1 space-y-1 text-base font-medium opacity-90 short:text-sm ${
                      hints.length >= 2 ? "short:grid short:grid-cols-2 short:gap-x-4 short:space-y-0" : ""
                    }`}
                  >
                    {hints.map((hint, index) => (
                      <li key={`${index}-${hint}`}>{hint}</li>
                    ))}
                  </ul>
                )}

                {!pickerFirst && bodyPickers}
              </div>
            </div>

            {/* Action row: pinned, never scrolls out of view */}
            <div
              data-testid="start-card-actions"
              className="flex shrink-0 flex-col items-stretch gap-3 px-6 pb-6 pt-3 short:w-[45%] short:gap-2 short:p-3 short:[align-self:safe_center]"
            >
              {/* Short screen: the celebration slot (one row) at the top
                  of the column; it goes away when the card would not fit. */}
              {breakRoom && isShort && (
                <div ref={shortSlotRef} data-testid="start-overlay-short-slot" className="w-full shrink-0 empty:hidden" />
              )}
              <ReadAloudButton text={readAloudText} className="short:min-h-[44px]" />

              {showStartButton ? (
                <>
                  {pinSinglePicker && pickers}
                  <GameStartOverlayButton ref={startRef} variant="primary" onClick={handleStart}>
                    {startLabel}
                  </GameStartOverlayButton>
                </>
              ) : (
                pickers
              )}
            </div>
          </div>

          {/* Break slot, outside the card (empty unless a nudge renders into
              it). Not on a short screen. */}
          {breakRoom && !isShort && (
            <div
              ref={breakSlotRef}
              data-testid="start-overlay-break-slot"
              className="w-full shrink-0 empty:hidden"
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
