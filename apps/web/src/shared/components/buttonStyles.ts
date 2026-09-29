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

/**
 * The size of a result chip button (ResultChip and the clip buttons in it).
 *
 * 56 px high, and 44 px on a short screen (a phone held sideways). Below
 * 480 px wide the chip is a two-column grid (RESULT_CHIP_GROUP): a button
 * fills its cell, its label may take two lines, and it keeps 44 px or more.
 * Six buttons then take three rows, so the chip does not cover the game's
 * result card on a 320 px phone (in one column they covered all of it).
 */
export const RESULT_CHIP_BUTTON =
  "h-14 min-h-14 short:h-11 short:min-h-11 max-[480px]:h-auto max-[480px]:min-h-11 max-[480px]:w-full max-[480px]:min-w-0 max-[480px]:gap-1.5 max-[480px]:px-1.5 max-[480px]:text-base max-[480px]:leading-tight max-[480px]:whitespace-normal";

/** The layout of the result chip's buttons: two columns below 480 px, one wrapping row above. */
export const RESULT_CHIP_GROUP =
  "grid w-full grid-cols-2 gap-2 min-[480px]:flex min-[480px]:w-auto min-[480px]:max-w-full min-[480px]:flex-wrap min-[480px]:items-center min-[480px]:justify-center";
