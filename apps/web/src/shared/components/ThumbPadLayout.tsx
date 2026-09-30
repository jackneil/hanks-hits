"use client";

import type { ReactNode } from "react";

import { fitCanvas } from "@/shared/hooks/usePlayBox";

/**
 * A canvas game with on-screen buttons for the thumbs, on every screen.
 *
 * - A phone held sideways: the picture fills the height of the play box and
 *   the buttons sit in a gutter on each side, under the left and the right
 *   thumb.
 * - A phone held upright: the picture on top, as tall as the box allows,
 *   and one row of buttons under it, where the thumbs rest.
 * - A mouse: the picture alone; keys and the mouse play.
 *
 * Why one layout: Dino Runner, Endless Runner and the Platformer each drew
 * a strip 19 to 32 percent of an upright phone with a dead thumb zone under
 * it, and held sideways they put the ground and the buttons below the
 * screen (phone UX audit 2026-09-29).
 *
 * `fitThumbPads` is pure, so a test can check every screen. The game sizes
 * its window onto the world with `viewWidth` x `viewHeight`, draws the
 * canvas at `scale`, and, on a phone, may show only `visibleWorld` of the
 * world's width so the picture is taller (cropped on the right, or around
 * the middle for a game whose camera centers the player). A mouse screen
 * always shows the whole world.
 */

/** The width of each side gutter on a phone held sideways, in CSS px. */
export const THUMB_GUTTER_WIDTH = 88;
/** The height of the button row on a phone held upright, in CSS px. */
export const THUMB_ROW_HEIGHT = 96;
/** Room around the picture on every layout. */
const MARGIN = 16;

export type ThumbLayout = "sideways" | "upright" | "desktop";

export interface ThumbFit {
  layout: ThumbLayout;
  /** One world px on screen, in CSS px. 0 before the play box is measured. */
  scale: number;
  /** The size of the window onto the world, in CSS px. */
  viewWidth: number;
  viewHeight: number;
  /** How many world px of width the window shows (the world width when nothing is cropped). */
  visibleWorld: number;
  /** The width of the left and the right gutter on a phone held sideways, in CSS px. */
  gutterLeft: number;
  gutterRight: number;
}

export interface ThumbFitOptions {
  /**
   * On a phone (either way up), the narrowest part of the world's width the
   * window may show. Less width means a taller picture. Default: the whole
   * width.
   */
  minVisibleWorld?: number;
  /** The largest scale (pixel art looks chunky past it on a big monitor). */
  maxScale?: number;
  /**
   * Gutter widths on a phone held sideways, when one thumb has more buttons
   * (a platformer's ◀ ▶ side by side). Default THUMB_GUTTER_WIDTH each.
   */
  gutterLeft?: number;
  gutterRight?: number;
}

/** The layout, the scale and the window onto the world for a play box. */
export function fitThumbPads(
  box: { width: number; height: number },
  coarse: boolean,
  world: { width: number; height: number },
  {
    minVisibleWorld = world.width,
    maxScale = Number.POSITIVE_INFINITY,
    gutterLeft = THUMB_GUTTER_WIDTH,
    gutterRight = THUMB_GUTTER_WIDTH,
  }: ThumbFitOptions = {},
): ThumbFit {
  const sideways = box.width > box.height;
  const layout: ThumbLayout = coarse ? (sideways ? "sideways" : "upright") : "desktop";
  const reserved =
    layout === "sideways"
      ? { width: gutterLeft + gutterRight + MARGIN, height: MARGIN }
      : layout === "upright"
        ? { width: MARGIN, height: THUMB_ROW_HEIGHT + MARGIN }
        : { width: MARGIN, height: MARGIN };
  const narrowest = layout === "desktop" ? world.width : Math.min(world.width, minVisibleWorld);
  const fit = fitCanvas(box, narrowest, world.height, reserved);
  if (fit.scale === 0) {
    return { layout, scale: 0, viewWidth: 0, viewHeight: 0, visibleWorld: world.width, gutterLeft, gutterRight };
  }
  const scale = Math.min(fit.scale, maxScale);
  const roomWidth = Math.max(0, box.width - reserved.width);
  const viewWidth = Math.min(roomWidth, Math.round(world.width * scale));
  return {
    layout,
    scale,
    viewWidth,
    viewHeight: Math.max(1, Math.round(world.height * scale)),
    visibleWorld: Math.min(world.width, viewWidth / scale),
    gutterLeft,
    gutterRight,
  };
}

export interface ThumbPadLayoutProps {
  fit: ThumbFit;
  /** The buttons under the left thumb (sideways) or the left of the row (upright). */
  left?: ReactNode;
  /** The buttons under the right thumb (sideways) or the right of the row (upright). */
  right?: ReactNode;
  /** The window onto the world, sized by the game from `fit`. */
  children: ReactNode;
  /** A test id for the row of buttons on an upright phone. */
  rowTestId?: string;
}

/**
 * Places the window onto the world and the thumb buttons for the layout in
 * `fit`. On a mouse screen only the window shows.
 *
 * One element tree for every layout, with the window always the second
 * child: turning the phone must never remount the game's canvas (its loop
 * and its touch listeners would stay on the old, detached one).
 */
export function ThumbPadLayout({ fit, left, right, children, rowTestId }: ThumbPadLayoutProps) {
  const sideways = fit.layout === "sideways";
  const upright = fit.layout === "upright";
  return (
    <div
      data-thumb-layout={fit.layout}
      className={`flex h-full w-full items-center ${sideways ? "flex-row justify-center gap-2" : "flex-col"}`}
    >
      {/* Sideways: the left gutter. Otherwise a spacer above the window, so
          the window sits in the middle of the room above the row. */}
      {sideways ? (
        <div className="flex shrink-0 items-center justify-center gap-2" style={{ width: fit.gutterLeft }}>
          {left}
        </div>
      ) : (
        <div aria-hidden="true" className="min-h-0 w-full flex-1" />
      )}
      {children}
      {sideways ? (
        <div className="flex shrink-0 items-center justify-center gap-2" style={{ width: fit.gutterRight }}>
          {right}
        </div>
      ) : (
        <div aria-hidden="true" className="min-h-0 w-full flex-1" />
      )}
      {/* Upright: the row at the bottom of the play box, where the thumbs
          rest (the audit found that zone dead). It keeps its place between
          runs, so the window never jumps when a run starts or ends. */}
      {upright && (
        <div
          data-testid={rowTestId}
          className="flex w-full shrink-0 items-center justify-between gap-3 px-3 pb-2"
          style={{ height: THUMB_ROW_HEIGHT, maxWidth: Math.max(fit.viewWidth + 24, 280) }}
        >
          <div className="flex flex-1 items-center gap-3">{left}</div>
          <div className="flex flex-1 items-center justify-end gap-3">{right}</div>
        </div>
      )}
    </div>
  );
}
