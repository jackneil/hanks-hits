"use client";

import { useRegisterBreakSlot } from "@/shared/lib/gameBreaks";

/**
 * A row in an app's own layout where a trophy celebration shows.
 *
 * Why: an app page with no start card (the joke generator, the virtual
 * pet, the drum machine) had no break surface, so a trophy (First Play on
 * the first joke) showed as the page strip, fixed over the bottom of the
 * screen for 4 s, on the app's own buttons (phone gate, fixed-over-play).
 * Here the card is part of the page: it pushes the app down for its 4 s
 * and covers nothing.
 *
 * It holds celebrations only, and it is inline: the app is not at a break,
 * so the install pill still shows in its place. Put it where a card of
 * about 72 px (44 px on a phone held sideways) can open without pushing
 * the app's main control off the screen, usually at the top of the app.
 * It takes no room while it is empty.
 */
export function AppNotesSlot({ className = "" }: { className?: string }) {
  const { slotRef } = useRegisterBreakSlot(["celebration"], { inline: true });
  return <div ref={slotRef} data-testid="app-notes-slot" className={`empty:hidden ${className}`} />;
}
