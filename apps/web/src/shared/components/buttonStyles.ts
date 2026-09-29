/**
 * The look of a secondary button: a white button next to a main (blue)
 * one, on a white surface (a clip sheet, the result chip, the start card).
 *
 * Why: a white button with the theme's pale border (base-300 on base-100)
 * has a 1.1:1 edge, so a kid sees floating words, not a button. A control
 * boundary needs 3:1 or more against the surface (WCAG 1.4.11). This edge
 * is slate-500: 4.8:1 on the light theme's white, 3.6:1 on the dark
 * theme's base. It goes all around the button (a full border, never a
 * colored stripe on one side).
 *
 * Put the class on the button with DaisyUI's `btn`. Keep the hex in
 * SECONDARY_EDGE_HEX and in the class the same: the test measures the
 * contrast from them.
 */

/** The edge color (slate-500). */
export const SECONDARY_EDGE_HEX = "#64748b";

/** The classes of a secondary button: a white fill and a 2 px slate edge. */
export const SECONDARY_ACTION = "border-2 border-[#64748b] bg-base-100 text-base-content";
