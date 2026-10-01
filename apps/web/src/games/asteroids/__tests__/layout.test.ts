import { describe, expect, it } from "vitest";

import { CANVAS_HEIGHT, CANVAS_WIDTH } from "../lib/constants";
import {
  ACTION_BUTTON_PX,
  asteroidsLayout,
  EDGE_PX,
  GUTTER_PX,
  MAX_SCALE,
  PAD_GAP_PX,
  STATS_ROW_PX,
  TURN_BUTTON_PX,
} from "../lib/layout";

// Regression (phone UX audit 2026-09-29, asteroids, F sideways): the
// canvas took its scale from its own content-sized container, so on a
// phone held sideways it was 554 px tall on a 271 px box, the ship
// spawned under the fold and the pad sat 350 px under the screen. The
// layout now fits the play box on both axes. The four boxes are the real
// iPhone Safari screens under a 48 px (40 px sideways) header.

const HEADER_UPRIGHT = 48;
const HEADER_SIDEWAYS = 40;
const BOXES = {
  "375x549": { width: 375, height: 549 - HEADER_UPRIGHT },
  "390x664": { width: 390, height: 664 - HEADER_UPRIGHT },
  "667x311": { width: 667, height: 311 - HEADER_SIDEWAYS },
  "844x340": { width: 844, height: 340 - HEADER_SIDEWAYS },
};

describe("asteroidsLayout", () => {
  it("upright: the stats line, the canvas and the pad row all fit in the box, and the canvas is as wide as the box", () => {
    for (const name of ["375x549", "390x664"] as const) {
      const box = BOXES[name];
      const layout = asteroidsLayout(box);
      expect(layout.sideways, name).toBe(false);
      const { canvas } = layout;
      // The largest square that leaves room for the stats line and the pad row.
      const room = Math.min(box.width - EDGE_PX * 2, box.height - EDGE_PX * 2 - (STATS_ROW_PX + ACTION_BUTTON_PX + PAD_GAP_PX * 2));
      expect(canvas.width, name).toBe(room);
      expect(canvas.height, name).toBe(canvas.width);
      // Never a strip: the field is at least 90% of the box's width.
      expect(canvas.width, name).toBeGreaterThanOrEqual((box.width - EDGE_PX * 2) * 0.9);
      const stack = EDGE_PX * 2 + STATS_ROW_PX + PAD_GAP_PX + canvas.height + PAD_GAP_PX + ACTION_BUTTON_PX;
      expect(stack, `${name}: the column is ${stack} px in a ${box.height} px box`).toBeLessThanOrEqual(box.height);
    }
  });

  it("sideways: the canvas takes the whole height, and each gutter holds a pad of two buttons", () => {
    for (const name of ["667x311", "844x340"] as const) {
      const box = BOXES[name];
      const layout = asteroidsLayout(box);
      expect(layout.sideways, name).toBe(true);
      const { canvas } = layout;
      expect(canvas.height, name).toBe(box.height - EDGE_PX * 2);
      expect(canvas.width, name).toBe(canvas.height);
      // Room beside the canvas for the widest pad on each side.
      expect(box.width - EDGE_PX * 2 - canvas.width, name).toBeGreaterThanOrEqual(GUTTER_PX * 2);
      expect(GUTTER_PX).toBeGreaterThanOrEqual(ACTION_BUTTON_PX * 2 + PAD_GAP_PX);
      expect(GUTTER_PX).toBeGreaterThanOrEqual(TURN_BUTTON_PX * 2 + PAD_GAP_PX);
    }
  });

  it("never scales past the cap on a big screen, and draws nothing in an unmeasured box", () => {
    const big = asteroidsLayout({ width: 1920, height: 1032 });
    expect(big.canvas.scale).toBe(MAX_SCALE);
    expect(big.canvas.width).toBe(CANVAS_WIDTH * MAX_SCALE);
    expect(big.canvas.height).toBe(CANVAS_HEIGHT * MAX_SCALE);
    const none = asteroidsLayout({ width: 0, height: 0 });
    expect(none.canvas.width).toBe(0);
    expect(none.canvas.height).toBe(0);
  });

  it("every pad button is at least 44 px, and the action buttons are bigger than the turn buttons", () => {
    expect(TURN_BUTTON_PX).toBeGreaterThanOrEqual(44);
    expect(ACTION_BUTTON_PX).toBeGreaterThan(TURN_BUTTON_PX);
  });
});
