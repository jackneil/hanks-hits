/**
 * Where every touch control sits on the screen.
 *
 * One list of rectangles, used by the controls themselves and by the test
 * that proves no two of them ever cover each other. Browsers in a test have
 * no layout engine, so the numbers have to live somewhere both sides can
 * read: this is that place. Positions are in pixels from the bottom and from
 * the near side, which is how the buttons are placed on screen.
 *
 * The layout, from the bottom of a phone up:
 *
 *   left column          middle          right column
 *                                        CONTEXT (Hop off, Use, ...)
 *   SPEEDO
 *   TILT                                 NOS  JUMP  HORN
 *   LEFT  RIGHT  (or CALIBRATE)          BRAKE GAS
 *
 * CALIBRATE only shows while tilt steering is on, and tilt hides the arrows,
 * so it takes their place. On a phone held sideways the context buttons move
 * to the row between the arrows and the pedals, and the speedo moves up to
 * the middle of the top of the screen (adventure.css reads CONTEXT_SLOT).
 */

/** Space kept from the edge of the screen. */
export const EDGE = 12;

/** Space kept between two controls. */
export const GAP = 12;

/** A control's box, measured from the bottom and from one side. */
export type ControlBox = {
  /** Which side `offset` is measured from. */
  side: "left" | "right";
  /** Pixels from that side. */
  offset: number;
  /** Pixels from the bottom of the screen. */
  bottom: number;
  width: number;
  height: number;
};

const PEDAL = { width: 96, height: 72 };
const ARROW = { width: 64, height: 64 };
const SMALL = { width: 56, height: 56 };
const CHIP = { width: 96, height: 44 };
const CALIBRATE = { width: 128, height: 44 };
/** On a phone the speedo is the small "12 MPH" readout, not the dial. */
const SPEEDO = { width: 96, height: 40 };

/** The row the pedals sit on, and the row above it. */
const ROW_1 = EDGE;
const ROW_2 = EDGE + PEDAL.height + GAP;
const ROW_3 = ROW_2 + SMALL.height + GAP;

/** The row above the arrows, where the TILT chip sits. */
const TILT_ROW = EDGE + ARROW.height + GAP;

export const TOUCH_LAYOUT = {
  gas: { side: "right", offset: EDGE, bottom: ROW_1, ...PEDAL },
  brake: {
    side: "right",
    offset: EDGE + PEDAL.width + GAP,
    bottom: ROW_1,
    ...PEDAL,
  },
  horn: { side: "right", offset: EDGE, bottom: ROW_2, ...SMALL },
  jump: {
    side: "right",
    offset: EDGE + SMALL.width + GAP,
    bottom: ROW_2,
    ...SMALL,
  },
  nos: {
    side: "right",
    offset: EDGE + 2 * (SMALL.width + GAP),
    bottom: ROW_2,
    ...SMALL,
  },
  steerLeft: { side: "left", offset: EDGE, bottom: ROW_1, ...ARROW },
  steerRight: {
    side: "left",
    offset: EDGE + ARROW.width + GAP,
    bottom: ROW_1,
    ...ARROW,
  },
  calibrate: { side: "left", offset: EDGE, bottom: ROW_1, ...CALIBRATE },
  tilt: { side: "left", offset: EDGE, bottom: TILT_ROW, ...CHIP },
  speedo: {
    side: "left",
    offset: EDGE,
    bottom: TILT_ROW + CHIP.height + GAP,
    ...SPEEDO,
  },
} as const satisfies Record<string, ControlBox>;

export type ControlName = keyof typeof TOUCH_LAYOUT;

/**
 * The height at or below which a phone counts as held sideways. It is the
 * same test as the site's `short:` variant (max-height: 480px).
 */
export const SHORT_MAX_HEIGHT = 480;

/**
 * Where the context buttons (Hop off, Use, Fishing, Go outside...) sit on a
 * phone, in pixels.
 *
 * Upright they stack up from the row above JUMP and HORN, against the right
 * edge, in a column no wider than `width`. Sideways they fill the row between
 * the arrows and the pedals, from `left` to `right`. adventure.css places the
 * row from these numbers (AdventureHUD hands them over as CSS variables), and
 * a test proves that neither place covers a touch control.
 */
export const CONTEXT_SLOT = {
  upright: { right: EDGE, bottom: ROW_3, width: 214 },
  sideways: {
    left: EDGE + 2 * ARROW.width + 2 * GAP,
    right: EDGE + 2 * PEDAL.width + 2 * GAP,
    bottom: EDGE,
  },
} as const;

/** One row of context buttons: a thumb-sized height and the gap between rows. */
export const CONTEXT_ROW = { height: 44, gap: 6 } as const;

/** The CSS variables that hand CONTEXT_SLOT to adventure.css. */
export function contextSlotVars(): Record<string, string> {
  const { upright, sideways } = CONTEXT_SLOT;
  return {
    "--fw-ctx-up-right": `${upright.right}px`,
    "--fw-ctx-up-bottom": `${upright.bottom}px`,
    "--fw-ctx-up-width": `${upright.width}px`,
    "--fw-ctx-side-left": `${sideways.left}px`,
    "--fw-ctx-side-right": `${sideways.right}px`,
    "--fw-ctx-side-bottom": `${sideways.bottom}px`,
  };
}

/**
 * The rectangle `rows` rows of context buttons fill on a screen of this size,
 * in screen pixels, for the orientation that size means.
 */
export function contextRect(
  rows: number,
  screenWidth: number,
  screenHeight: number,
): { left: number; right: number; top: number; bottom: number } {
  const tall = rows * CONTEXT_ROW.height + (rows - 1) * CONTEXT_ROW.gap;
  if (screenHeight <= SHORT_MAX_HEIGHT) {
    const { left, right, bottom } = CONTEXT_SLOT.sideways;
    return {
      left,
      right: screenWidth - right,
      top: screenHeight - bottom - tall,
      bottom: screenHeight - bottom,
    };
  }
  const { right, bottom, width } = CONTEXT_SLOT.upright;
  return {
    left: screenWidth - right - width,
    right: screenWidth - right,
    top: screenHeight - bottom - tall,
    bottom: screenHeight - bottom,
  };
}

/** The style that puts one control where the layout says it goes. */
export function boxStyle(name: ControlName): React.CSSProperties {
  const box = TOUCH_LAYOUT[name];
  return {
    position: "absolute",
    bottom: `${box.bottom}px`,
    [box.side]: `${box.offset}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    touchAction: "none",
  };
}

/** A control's rectangle on a screen of this width, in screen pixels. */
export function rectOf(
  name: ControlName,
  screenWidth: number,
  screenHeight: number,
): { left: number; right: number; top: number; bottom: number } {
  const box = TOUCH_LAYOUT[name];
  const left =
    box.side === "left" ? box.offset : screenWidth - box.offset - box.width;
  const bottom = screenHeight - box.bottom;
  return {
    left,
    right: left + box.width,
    top: bottom - box.height,
    bottom,
  };
}

/** True when two controls cover any of the same screen. */
export function overlaps(
  a: ControlName,
  b: ControlName,
  screenWidth: number,
  screenHeight: number,
): boolean {
  const one = rectOf(a, screenWidth, screenHeight);
  const two = rectOf(b, screenWidth, screenHeight);
  return (
    one.left < two.right &&
    two.left < one.right &&
    one.top < two.bottom &&
    two.top < one.bottom
  );
}
