"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The result of a run, in DOM text over the game's picture: "Game over!",
 * the score, the best. It pairs with the shared ResultChip, which has the
 * buttons and reads the result aloud.
 *
 * Why the top: the chip is a bar at the bottom of the screen, up to about
 * 260 px tall on a phone held upright (two columns and a clip row). A card
 * centered on the picture sat under it (Dino sideways, Endless upright,
 * the Platformer sideways, Flappy both ways: phone check 2026-09-30). Why
 * DOM text: canvas text drawn for an 800 px board was 7.7 px on a phone.
 *
 * Why the width of the screen: a card inside the picture was as narrow as
 * the picture. On a phone held sideways a portrait field is about 200 px
 * wide, so the card wrapped to three lines (84 px), and a chip grown by a
 * celebration and two clip buttons (172 px of a 311 px screen) reached it
 * (Hextris, G4 phone check 2026-09-30). Across the screen, a short screen
 * puts the card on one line. The card goes to document.body, so a picture
 * that clips its content (overflow hidden) or a moved parent cannot cut
 * or shift it: it sits at the top of the play box, under the header.
 *
 * It takes no taps, so a finger on it reaches nothing under it by mistake.
 * Its level is 60, the top of the game tier (design/ARCHITECTURE.md,
 * "Stacking order"), and it is last in the page, so it draws over the
 * game's own layers.
 */
export interface ResultCardProps {
  /** The first line, for example "Game over!" or "Level complete!". */
  title: string;
  /** The lines under the title: the score, the coins, the best. */
  children?: ReactNode;
  testId?: string;
}

const noSubscribe = () => () => {};
/** True after hydration: document.body exists. */
function useMounted(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false
  );
}

export function ResultCard({ title, children, testId }: ResultCardProps) {
  const mounted = useMounted();
  if (!mounted) return null;
  return createPortal(
    <div
      data-testid={testId}
      data-result-card=""
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center px-2 pt-[calc(var(--shell-header-h,0px)+0.5rem)]"
    >
      <div className="flex max-w-full flex-col items-center gap-0.5 rounded-xl bg-white/95 px-4 py-2 text-center text-gray-900 shadow-md short:flex-row short:flex-wrap short:justify-center short:gap-x-3 short:gap-y-0 short:py-1.5">
        <p className="text-2xl font-bold short:text-xl">{title}</p>
        {children}
      </div>
    </div>,
    document.body
  );
}

/** A line of a ResultCard: the score (`big`) or a detail. */
export function ResultLine({ children, big = false }: { children: ReactNode; big?: boolean }) {
  return (
    <p className={big ? "text-lg font-semibold short:text-base" : "text-base short:text-sm"}>{children}</p>
  );
}
