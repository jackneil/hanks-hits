"use client";

import type { ReactNode } from "react";

/**
 * The result of a run, in DOM text over the game's picture: "Game over!",
 * the score, the best. It pairs with the shared ResultChip, which has the
 * buttons and reads the result aloud.
 *
 * Why the top: the chip is a bar at the bottom of the screen, up to about
 * 260 px tall on a phone held upright (two columns and a clip row). A card
 * centered on the picture sat under it (Dino sideways, Endless upright,
 * the Platformer sideways, Flappy both ways: phone check 2026-09-30). The
 * top of the picture is always above the chip. Why DOM text: canvas text
 * drawn for an 800 px board was 7.7 px on a phone.
 *
 * Place it inside the picture's window (a `relative` element). It takes no
 * taps, so a finger on it reaches nothing under it by mistake.
 */
export interface ResultCardProps {
  /** The first line, for example "Game over!" or "Level complete!". */
  title: string;
  /** The lines under the title: the score, the coins, the best. */
  children?: ReactNode;
  testId?: string;
}

export function ResultCard({ title, children, testId }: ResultCardProps) {
  return (
    <div
      data-testid={testId}
      className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-2"
    >
      <div className="flex max-w-full flex-col items-center gap-0.5 rounded-xl bg-white/95 px-4 py-2 text-center text-gray-900 shadow-md short:flex-row short:flex-wrap short:justify-center short:gap-x-3 short:gap-y-0 short:py-1.5">
        <p className="text-2xl font-bold short:text-xl">{title}</p>
        {children}
      </div>
    </div>
  );
}

/** A line of a ResultCard: the score (`big`) or a detail. */
export function ResultLine({ children, big = false }: { children: ReactNode; big?: boolean }) {
  return (
    <p className={big ? "text-lg font-semibold short:text-base" : "text-base short:text-sm"}>{children}</p>
  );
}
