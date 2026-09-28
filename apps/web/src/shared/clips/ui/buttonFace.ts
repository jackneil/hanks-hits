/**
 * What the clip button draws in each state (plan 11.3). Pure, so the tests
 * check every state without a browser.
 */

import type { ClipButtonState, ClipSnapshot } from "../service/contract";

export interface FaceLook {
  /** The center glyph. */
  glyph: "clip" | "check" | "stop" | "alert";
  /**
   * The ring: none, a thin static ring (ready), a full ring (made), a
   * progress ring (warming, saving, exporting), or an amber ring (error).
   */
  ring: "none" | "static" | "full" | "progress" | "amber";
  /** 0..1 fill of the progress ring. */
  progress: number;
  /** A slash across the glyph (resting, disabled). */
  slashed: boolean;
  /** The small red dot of the record-only state. */
  dot: boolean;
  /** Opacity of the whole face: 1, 0.6 (resting) or 0.4 (disabled). */
  opacity: number;
}

/** How long a state keeps the previous look before it changes (plan 11.3). */
export const LOOK_HOLD_MS: Partial<Record<ClipButtonState, number>> = {
  "source-lost": 1500,
  recovering: 3000,
};

/**
 * The longest a short-lived look stays (plan 11.3): the check mark 1.2 s,
 * the amber "!" 3 s. The service times these states; this cap keeps the
 * look right even if a state stays longer. After it, the button looks ready.
 */
export const LOOK_MAX_MS: Partial<Record<ClipButtonState, number>> = {
  made: 1200,
  error: 3000,
};

function clamp01(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

const BASE: FaceLook = { glyph: "clip", ring: "none", progress: 0, slashed: false, dot: false, opacity: 1 };

/** The look of a state after any hold time. */
export function faceFor(state: ClipButtonState, snapshot: Pick<ClipSnapshot, "warmProgress" | "savingProgress">): FaceLook {
  switch (state) {
    case "warming":
      return { ...BASE, ring: "progress", progress: clamp01(snapshot.warmProgress) };
    case "ready":
      return { ...BASE, ring: "static" };
    case "saving":
    case "exporting":
      return { ...BASE, ring: "progress", progress: clamp01(snapshot.savingProgress) };
    case "made":
      return { ...BASE, glyph: "check", ring: "full" };
    case "recording":
      return { ...BASE, glyph: "stop" };
    case "resting":
      return { ...BASE, slashed: true, opacity: 0.6 };
    case "suspended":
      return { ...BASE };
    case "source-lost":
      // After its hold the ring empties.
      return { ...BASE, ring: "progress", progress: 0 };
    case "recovering":
      // After its hold it looks like warming.
      return { ...BASE, ring: "progress", progress: clamp01(snapshot.warmProgress) };
    case "record-only":
      return { ...BASE, ring: "static", dot: true };
    case "disabled":
      return { ...BASE, slashed: true, opacity: 0.4 };
    case "error":
      return { ...BASE, glyph: "alert", ring: "amber" };
    case "hidden":
      return { ...BASE };
  }
}

export function sameLook(a: FaceLook, b: FaceLook): boolean {
  return (
    a.glyph === b.glyph &&
    a.ring === b.ring &&
    a.progress === b.progress &&
    a.slashed === b.slashed &&
    a.dot === b.dot &&
    a.opacity === b.opacity
  );
}
