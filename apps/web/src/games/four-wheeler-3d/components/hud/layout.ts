/**
 * Where the heads up display starts.
 *
 * The game shell puts a fixed header across the top of the screen: h-12 on a
 * phone and h-14 from the medium breakpoint up, at a very high stacking
 * order. Anything placed at the top of the canvas must start below it or the
 * header covers it. Every HUD piece uses this one offset, so they all line up
 * and a change to the header only has to be made here.
 */
export const HUD_TOP = "top-14 md:top-16";

/** The side margins the HUD keeps, so nothing touches the screen edge. */
export const HUD_LEFT = "left-3";
export const HUD_RIGHT = "right-3";
