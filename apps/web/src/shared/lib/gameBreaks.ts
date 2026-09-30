"use client";

import { useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import { create } from "zustand";

import { useStartOverlayPresence } from "./startOverlayPresence";

/**
 * Two signals that keep sheets and nudges out of active play.
 *
 * 1. Shells: how many game shells are on screen. Every game page mounts a
 *    GameShell, so a count above 0 means the kid can be playing. A shell on
 *    an app page (under /apps/) does not count: an app has no play to
 *    cover (see shellHasPlay).
 * 2. Break slots: DOM elements that a break surface (the start card, the
 *    pause menu, the result chip) puts on screen while play is stopped. A
 *    nudge such as the iOS install tip or a trophy celebration renders
 *    INTO the newest slot that holds its kind, as part of that surface,
 *    instead of floating over the game controls.
 *
 * A slot says what it holds. The start card and the pause menu hold every
 * note. The result chip holds celebrations only: the install tip is about
 * 150 px tall, and with the chip's buttons it would cover most of a phone
 * held sideways at the moment the kid wants Play again.
 *
 * Why: the iOS "Add to Home Screen" sheet used to float over the bottom
 * game controls during play (issue #32), and the trophy toast covered the
 * top of the play area for 4 s the moment a first run started (phone UX
 * audit, S9). The start card also has its own signal in
 * startOverlayPresence.ts.
 */

/** What a break surface can hold: the install tip, or a trophy celebration. */
export type NoteKind = "tip" | "celebration";

export const ALL_NOTES: readonly NoteKind[] = ["tip", "celebration"];

export type BreakSlot = { el: HTMLElement; holds: readonly NoteKind[] };

type GameBreaks = {
  shells: number;
  slots: BreakSlot[];
  enterShell: () => void;
  leaveShell: () => void;
  addSlot: (el: HTMLElement, holds?: readonly NoteKind[]) => void;
  removeSlot: (el: HTMLElement) => void;
};

export const useGameBreaks = create<GameBreaks>((set) => ({
  shells: 0,
  slots: [],
  enterShell: () => set((s) => ({ shells: s.shells + 1 })),
  leaveShell: () => set((s) => ({ shells: Math.max(0, s.shells - 1) })),
  addSlot: (el, holds = ALL_NOTES) =>
    set((s) =>
      s.slots.some((slot) => slot.el === el) ? s : { slots: [...s.slots, { el, holds }] }
    ),
  removeSlot: (el) =>
    set((s) =>
      s.slots.some((slot) => slot.el === el)
        ? { slots: s.slots.filter((slot) => slot.el !== el) }
        : s
    ),
}));

/**
 * True when a GameShell on this route can hold active play. App pages
 * ("/apps/weather") have no play to cover, so a nudge may show there as it
 * does on a page with no shell (issue #32: "Show it only on non-game pages
 * or at a natural break").
 */
export function shellHasPlay(pathname: string): boolean {
  return !/^\/apps(\/|$)/.test(pathname);
}

/** True while at least one game shell is mounted. */
export function useGameShellMounted(): boolean {
  return useGameBreaks((s) => s.shells > 0);
}

/** The newest break slot on screen that holds `kind`, or null during play. */
export function useBreakSlot(kind: NoteKind): HTMLElement | null {
  return useGameBreaks((s) => {
    for (let i = s.slots.length - 1; i >= 0; i--) {
      if (s.slots[i].holds.includes(kind)) return s.slots[i].el;
    }
    return null;
  });
}

/** True while any break slot is on screen (a break surface is up). */
export function useAtBreak(): boolean {
  return useGameBreaks((s) => s.slots.length > 0);
}

/** The data-read-aloud words of the notes inside a container, in DOM order. */
export function readAloudNotesIn(container: HTMLElement | null): string[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll("[data-read-aloud]"))
    .map((el) => el.getAttribute("data-read-aloud")?.trim() ?? "")
    .filter(Boolean);
}

/**
 * Make an element a break slot while it is mounted. A break surface puts
 * `slotRef` on an empty element, and reads the notes that nudges rendered
 * into it with `readNotes()` (for its read-aloud text). `holds` says which
 * notes the slot takes; the default is every note.
 */
export function useRegisterBreakSlot(holds: readonly NoteKind[] = ALL_NOTES): {
  slotRef: (el: HTMLElement | null) => (() => void) | undefined;
  readNotes: () => string[];
} {
  const addSlot = useGameBreaks((s) => s.addSlot);
  const removeSlot = useGameBreaks((s) => s.removeSlot);
  const slotEl = useRef<HTMLElement | null>(null);
  // The list is read at mount time: a surface does not change what it holds.
  const holdsRef = useRef(holds);

  const slotRef = useCallback(
    (el: HTMLElement | null) => {
      slotEl.current = el;
      if (!el) return undefined;
      addSlot(el, holdsRef.current);
      return () => {
        slotEl.current = null;
        removeSlot(el);
      };
    },
    [addSlot, removeSlot]
  );

  const readNotes = useCallback(() => readAloudNotesIn(slotEl.current), []);

  return { slotRef, readNotes };
}

/**
 * Where a nudge (the install tip, a trophy celebration) goes right now.
 *
 * - "slot": a break surface that holds this kind of note is up. Render into
 *   `slot`, as part of that surface.
 * - "wait": the kid is playing, or is about to. Render nothing and keep the
 *   nudge for the next break. This covers a game shell on a game page, a
 *   start card with no room for a note (a page form would cover Play), and
 *   an app page whose start card has left (a Trivia quiz with a timer).
 * - "page": no play here (the home page, an app with no start card, such as
 *   the drawing app). Render the page form: a thin strip or a 44 px pill.
 */
export type NudgePlacement =
  | { kind: "slot"; slot: HTMLElement }
  | { kind: "wait" }
  | { kind: "page" };

const WAIT: NudgePlacement = { kind: "wait" };
const PAGE: NudgePlacement = { kind: "page" };

/**
 * The route of the page: from the router, or from the URL where there is no
 * router (tests). The router value follows a client-side navigation, so a
 * component that stays mounted across pages (the root layout) sees the new
 * route.
 */
function useRoute(): string {
  const fromRouter = usePathname();
  if (fromRouter) return fromRouter;
  return typeof window === "undefined" ? "/" : window.location.pathname;
}

export function useNudgePlacement(kind: NoteKind): NudgePlacement {
  const route = useRoute();
  const slot = useBreakSlot(kind);
  const atBreak = useAtBreak();
  const shellMounted = useGameShellMounted();
  const startCardShowing = useStartOverlayPresence((s) => s.count > 0);
  const leftOn = useStartOverlayPresence((s) => s.leftOn);

  if (slot) return { kind: "slot", slot };
  // A break surface is up, but it does not hold this note (the result chip
  // and the install tip): the note waits for the next break.
  if (atBreak) return WAIT;
  // A start card with no room for a note: a page form would cover Play.
  if (startCardShowing) return WAIT;
  if (shellMounted) return WAIT;
  // An app whose start card has left: the kid is in the app.
  if (!shellHasPlay(route) && leftOn === route) return WAIT;
  return PAGE;
}
