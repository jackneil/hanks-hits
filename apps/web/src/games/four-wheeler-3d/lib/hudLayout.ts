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
 *   TILT (and CALIBRATE)                 SPEEDO
 *                                        JUMP  HORN
 *   LEFT  RIGHT                          BRAKE GAS
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
const SPEEDO = { width: 112, height: 112 };

/** The row the pedals sit on, and the row above it. */
const ROW_1 = EDGE;
const ROW_2 = EDGE + PEDAL.height + GAP;
const ROW_3 = ROW_2 + SMALL.height + GAP;

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
  speedo: { side: "right", offset: EDGE, bottom: ROW_3, ...SPEEDO },
  steerLeft: { side: "left", offset: EDGE, bottom: ROW_1, ...ARROW },
  steerRight: {
    side: "left",
    offset: EDGE + ARROW.width + GAP,
    bottom: ROW_1,
    ...ARROW,
  },
  tilt: {
    side: "left",
    offset: EDGE,
    bottom: EDGE + ARROW.height + GAP,
    ...CHIP,
  },
  calibrate: {
    side: "left",
    offset: EDGE + CHIP.width + GAP,
    bottom: EDGE + ARROW.height + GAP,
    ...CALIBRATE,
  },
} as const satisfies Record<string, ControlBox>;

export type ControlName = keyof typeof TOUCH_LAYOUT;

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
  screenHeight: number
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
  screenHeight: number
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
