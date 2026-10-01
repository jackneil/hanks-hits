import { describe, expect, it } from "vitest";

import { CANVAS_HEIGHT, CANVAS_WIDTH } from "../lib/constants";
import {
  EDGE_PX,
  FIRE_BUTTON_PX,
  GUTTER_PX,
  HUD_ROW_PX,
  MAX_SCALE,
  MOVE_BUTTON_PX,
  PAD_GAP_PX,
  spaceInvadersLayout,
} from "../lib/layout";

// Regression (phone UX audit 2026-09-29, space-invaders, D upright and F
// sideways): the canvas was a 172x229 px stamp upright (19% of the screen)
// and 65x87 px sideways, with the pad under the fold. The layout now fits
// the play box on both axes. The four boxes are the real iPhone Safari
// screens under a 48 px (40 px sideways) header.

const BOXES = {
  "375x549": { width: 375, height: 549 - 48 },
  "390x664": { width: 390, height: 664 - 48 },
  "667x311": { width: 667, height: 311 - 40 },
  "844x340": { width: 844, height: 340 - 40 },
};

describe("spaceInvadersLayout", () => {
  it("upright: the HUD line, the canvas and the pad row fit in the box, and the field is most of the screen", () => {
    for (const name of ["375x549", "390x664"] as const) {
      const box = BOXES[name];
      const layout = spaceInvadersLayout(box);
      expect(layout.sideways, name).toBe(false);
      const { canvas } = layout;
      const stack = EDGE_PX * 2 + HUD_ROW_PX + PAD_GAP_PX + canvas.height + PAD_GAP_PX + FIRE_BUTTON_PX;
      expect(stack, `${name}: the column is ${stack} px in a ${box.height} px box`).toBeLessThanOrEqual(box.height);
      expect(canvas.width, name).toBeLessThanOrEqual(box.width - EDGE_PX * 2);
      // The audit measured 19% of the screen (a 172x229 stamp at 375x549).
      // Now the field is 259x345 at 375x549 (48% of the box, height-bound
      // by the HUD line and the pad row) and 357x476 at 390x664 (71%).
      const share = (canvas.width * canvas.height) / (box.width * box.height);
      expect(share, `${name}: the field is ${(share * 100).toFixed(0)}% of the box`).toBeGreaterThan(0.45);
      expect(Math.abs(canvas.width / canvas.height - CANVAS_WIDTH / CANVAS_HEIGHT), name).toBeLessThan(0.01);
    }
  });

  it("sideways: the canvas takes the whole height, with a gutter for a pad on each side", () => {
    for (const name of ["667x311", "844x340"] as const) {
      const box = BOXES[name];
      const layout = spaceInvadersLayout(box);
      expect(layout.sideways, name).toBe(true);
      const { canvas } = layout;
      expect(canvas.height, name).toBe(box.height - EDGE_PX * 2);
      expect(box.width - EDGE_PX * 2 - canvas.width, name).toBeGreaterThanOrEqual(GUTTER_PX * 2);
      expect(GUTTER_PX).toBeGreaterThanOrEqual(MOVE_BUTTON_PX * 2 + PAD_GAP_PX);
      expect(GUTTER_PX).toBeGreaterThanOrEqual(FIRE_BUTTON_PX);
    }
  });

  it("never scales past the cap, and draws nothing in an unmeasured box", () => {
    expect(spaceInvadersLayout({ width: 1920, height: 1500 }).canvas.scale).toBe(MAX_SCALE);
    expect(spaceInvadersLayout({ width: 0, height: 0 }).canvas.width).toBe(0);
  });

  it("every pad button is at least 44 px, and FIRE is bigger than a move button", () => {
    expect(MOVE_BUTTON_PX).toBeGreaterThanOrEqual(44);
    expect(FIRE_BUTTON_PX).toBeGreaterThan(MOVE_BUTTON_PX);
  });
});
