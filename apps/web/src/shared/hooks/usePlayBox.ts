"use client";

import { createContext, useContext, useLayoutEffect, useState, type RefObject } from "react";

/**
 * The play box: the part of the screen under the GameShell header where a
 * game draws.
 *
 * Why: iOS Safari says 100vh is the height with the toolbars hidden. With
 * the toolbars shown (the first minutes of every visit), a page that is
 * 100vh tall is taller than the screen (375 px of page on a 311 px
 * screen), so every page scrolls, a drag on the game pans the page, and a
 * centered layout sits low. The phone UX audit (2026-09-29) found this on
 * all 33 routes.
 *
 * GameShell owns one play box (`[data-play-box]`), sized in dvh: exactly
 * the screen under the header, with the toolbars in or out. A game reads
 * the size of that box with `usePlayBox()` and fits its canvas or board
 * with `fitCanvas()`. It never reads window.innerHeight or 100vh.
 *
 * Two modes of the box:
 * - Default: the box scrolls (a list page, a board with a long control
 *   column). The page itself never scrolls.
 * - Fitted (`usePlayBox({ fit: true })` in a game that fills the box): the
 *   box does not scroll, and the browser takes no touch gesture from it
 *   (touch-action: none), so a drag on the canvas is the game's.
 */

/** The attribute on the play box element (GameShell). */
export const PLAY_BOX_ATTR = "data-play-box";
/** Set on the play box while at least one game component asks for the fitted mode. */
export const PLAY_BOX_FITTED_ATTR = "data-fitted";

export interface PlayBoxSize {
  /** The width of the play box in CSS px. 0 before the first measure. */
  width: number;
  /** The height of the play box in CSS px. 0 before the first measure. */
  height: number;
  /**
   * The height the kid can see right now: the box height, less the part
   * under the on-screen keyboard (visualViewport). It is the same as
   * `height` when no keyboard is up.
   */
  visibleHeight: number;
}

export interface PlayBoxOptions {
  /**
   * True while the game fits its drawing to the box. The box then does
   * not scroll, and a touch on it goes to the game, not to the browser.
   */
  fit?: boolean;
}

/** GameShell gives the play box element to the games under it. */
export const PlayBoxContext = createContext<RefObject<HTMLElement | null> | null>(null);

/** The play box on the page, or null (no GameShell, or the server). */
export function findPlayBox(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>(`[${PLAY_BOX_ATTR}]`);
}

/**
 * The play box for a hook: the shell's element from the context, else
 * the one on the page. A child's layout effect runs before React attaches
 * the parent's ref, so on the first pass the context ref can still be
 * null; the box is in the DOM by then, so the page lookup finds it.
 */
export function resolvePlayBox(ref: RefObject<HTMLElement | null> | null): HTMLElement | null {
  return ref?.current ?? findPlayBox();
}

const ZERO: PlayBoxSize = { width: 0, height: 0, visibleHeight: 0 };

/** The size of the box, or of the window when there is no box. */
export function measurePlayBox(box: HTMLElement | null): PlayBoxSize {
  if (typeof window === "undefined") return ZERO;
  const viewport = window.visualViewport;
  if (!box) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const visibleHeight = viewport ? Math.max(0, Math.min(height, Math.round(viewport.height))) : height;
    return { width, height, visibleHeight };
  }
  const width = box.clientWidth;
  const height = box.clientHeight;
  let visibleHeight = height;
  if (viewport) {
    // The visual viewport ends at offsetTop + height in page coordinates.
    // The box top comes from the same coordinates (the layout viewport).
    const top = box.getBoundingClientRect().top;
    visibleHeight = Math.max(0, Math.min(height, Math.round(viewport.offsetTop + viewport.height - top)));
  }
  return { width, height, visibleHeight };
}

function sameSize(a: PlayBoxSize, b: PlayBoxSize): boolean {
  return a.width === b.width && a.height === b.height && a.visibleHeight === b.visibleHeight;
}

/** How many components hold each box in the fitted mode. */
const fitHolds = new WeakMap<HTMLElement, number>();

/**
 * The size of the play box, live. It measures before the first paint and
 * again when the box, the window or the visual viewport changes size.
 * With no GameShell on the page (a test, a page of its own) it reports the
 * window.
 */
export function usePlayBox(options: PlayBoxOptions = {}): PlayBoxSize {
  const { fit = false } = options;
  const boxRef = useContext(PlayBoxContext);
  const [size, setSize] = useState<PlayBoxSize>(ZERO);

  useLayoutEffect(() => {
    const box = resolvePlayBox(boxRef);
    const update = () => {
      const next = measurePlayBox(box);
      setSize((prev) => (sameSize(prev, next) ? prev : next));
    };
    update();

    const sizes = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (box) sizes?.observe(box);
    window.addEventListener("resize", update);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    return () => {
      sizes?.disconnect();
      window.removeEventListener("resize", update);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
    };
  }, [boxRef]);

  useLayoutEffect(() => {
    if (!fit) return;
    const box = resolvePlayBox(boxRef);
    if (!box) return;
    fitHolds.set(box, (fitHolds.get(box) ?? 0) + 1);
    box.setAttribute(PLAY_BOX_FITTED_ATTR, "");
    // A fitted box has nothing to scroll to.
    box.scrollTop = 0;
    return () => {
      const left = (fitHolds.get(box) ?? 1) - 1;
      if (left > 0) {
        fitHolds.set(box, left);
        return;
      }
      fitHolds.delete(box);
      box.removeAttribute(PLAY_BOX_FITTED_ATTR);
    };
  }, [boxRef, fit]);

  return size;
}

export interface CanvasFit {
  /** The size of one canvas unit on screen (the same on both axes). 0 when nothing fits. */
  scale: number;
  /** The width on screen in whole CSS px. */
  width: number;
  /** The height on screen in whole CSS px. */
  height: number;
}

/**
 * The largest size of a canvas (or a board) of `canvasWidth` x
 * `canvasHeight` units that fits in the box, with the same scale on both
 * axes. `reserved` is the room to keep for controls: a number keeps that
 * many px of height (a control row under the canvas); an object keeps
 * width and height (gutters beside the canvas on a phone held sideways).
 *
 * Why one helper: nine canvas games scaled by width only, so a phone held
 * sideways put the paddle or the player below the screen, and a phone
 * held upright drew a strip 19 to 32 percent tall. Fit on both axes, and
 * put the controls in the reserved room.
 */
export function fitCanvas(
  box: { width: number; height: number },
  canvasWidth: number,
  canvasHeight: number,
  reserved: number | { width?: number; height?: number } = 0
): CanvasFit {
  const keep =
    typeof reserved === "number"
      ? { width: 0, height: reserved }
      : { width: reserved.width ?? 0, height: reserved.height ?? 0 };
  const availableWidth = box.width - keep.width;
  const availableHeight = box.height - keep.height;
  if (!(canvasWidth > 0) || !(canvasHeight > 0) || availableWidth <= 0 || availableHeight <= 0) {
    return { scale: 0, width: 0, height: 0 };
  }
  const scale = Math.min(availableWidth / canvasWidth, availableHeight / canvasHeight);
  // Whole pixels: a canvas at a fraction of a pixel draws blurred. The
  // rounded size never passes the box, because the limiting axis is
  // exactly the (whole) available size and the other is below it.
  return {
    scale,
    width: Math.max(1, Math.round(canvasWidth * scale)),
    height: Math.max(1, Math.round(canvasHeight * scale)),
  };
}
