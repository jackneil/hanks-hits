"use client";

import { useLayoutEffect, type RefObject } from "react";

/**
 * Space at the end of the page for a sheet that is fixed to the bottom of
 * the screen.
 *
 * A fixed sheet covers the last part of the page. On an iPhone the install
 * tip covered the Atari 2600 card at the bottom of the Retro Arcade console
 * grid, and a tap on the card hit the tip. While a sheet shows, this hook
 * sets the sheet's measured height on the document root as
 * --bottom-sheet-space. globals.css adds that much padding at the end of
 * the body (the scroll box of every page), so every element can scroll up
 * clear of the sheet. When the sheet closes, the space goes away.
 *
 * - The height is the sheet's border box, so its safe-area padding counts.
 *   A ResizeObserver keeps the value current when the phone turns or the
 *   words wrap to a new line.
 * - When two sheets show at once, the taller one sets the space. When one
 *   closes, the space of the other stays.
 */
export const BOTTOM_SHEET_SPACE_VAR = "--bottom-sheet-space";

/** The measured height of each sheet on screen. */
const sheetHeights = new Map<object, number>();

function applySpace(): void {
  const root = document.documentElement;
  if (sheetHeights.size === 0) {
    root.style.removeProperty(BOTTOM_SHEET_SPACE_VAR);
    return;
  }
  const tallest = Math.max(...sheetHeights.values());
  // Whole pixels, rounded up: a space that is short by a fraction of a
  // pixel leaves the edge of the last element under the sheet.
  root.style.setProperty(BOTTOM_SHEET_SPACE_VAR, `${Math.ceil(tallest)}px`);
}

/**
 * Reserve space at the end of the page for the sheet in `ref` while the
 * calling component is mounted. A layout effect sets the space before the
 * browser paints, so the page never shows one frame without it.
 */
export function useBottomSheetSpace(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const sheet = ref.current;
    if (!sheet) return undefined;

    const key = {};
    const measure = () => {
      sheetHeights.set(key, sheet.getBoundingClientRect().height);
      applySpace();
    };
    measure();

    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(sheet, { box: "border-box" });

    return () => {
      observer?.disconnect();
      sheetHeights.delete(key);
      applySpace();
    };
  }, [ref]);
}
