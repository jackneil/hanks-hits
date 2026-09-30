import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  THUMB_GUTTER_WIDTH,
  THUMB_ROW_HEIGHT,
  ThumbPadLayout,
  fitThumbPads,
} from "../ThumbPadLayout";

/** The play box on the real iPhone screens: Safari's inner size less the header (48 px upright, 44 px sideways). */
const BOXES = {
  seUpright: { width: 375, height: 549 - 48 },
  bigUpright: { width: 390, height: 664 - 48 },
  seSideways: { width: 667, height: 311 - 44 },
  bigSideways: { width: 844, height: 340 - 44 },
};
const RUNNER = { width: 800, height: 400 };

describe("fitThumbPads", () => {
  it("puts the buttons in side gutters on a phone held sideways, with the picture as tall as the box allows", () => {
    for (const box of [BOXES.seSideways, BOXES.bigSideways]) {
      const fit = fitThumbPads(box, true, RUNNER);
      expect(fit.layout).toBe("sideways");
      // Picture plus both gutters fit across; the picture fits down.
      expect(fit.viewWidth + 2 * THUMB_GUTTER_WIDTH).toBeLessThanOrEqual(box.width);
      expect(fit.viewHeight).toBeLessThanOrEqual(box.height);
      // It uses nearly all the height (the old layout put the ground below the screen).
      expect(fit.viewHeight).toBeGreaterThan(box.height * 0.8);
      expect(fit.visibleWorld).toBe(RUNNER.width);
    }
  });

  it("puts one row of buttons under the picture on a phone held upright, and never a strip", () => {
    for (const box of [BOXES.seUpright, BOXES.bigUpright]) {
      const whole = fitThumbPads(box, true, RUNNER);
      expect(whole.layout).toBe("upright");
      expect(whole.viewHeight + THUMB_ROW_HEIGHT).toBeLessThanOrEqual(box.height);
      // Cropping the world's width makes the picture taller.
      const cropped = fitThumbPads(box, true, RUNNER, { minVisibleWorldUpright: 600 });
      expect(cropped.viewHeight).toBeGreaterThan(whole.viewHeight);
      expect(cropped.visibleWorld).toBeGreaterThanOrEqual(600);
      expect(cropped.viewWidth).toBeLessThanOrEqual(box.width);
      expect(cropped.viewHeight + THUMB_ROW_HEIGHT).toBeLessThanOrEqual(box.height);
    }
  });

  it("shows the picture alone on a mouse screen, capped at maxScale", () => {
    const fit = fitThumbPads({ width: 1600, height: 900 }, false, RUNNER, { maxScale: 1.5 });
    expect(fit.layout).toBe("desktop");
    expect(fit.scale).toBe(1.5);
    expect(fit.viewWidth).toBe(1200);
  });

  it("takes a wider gutter for the thumb with more buttons", () => {
    const fit = fitThumbPads(BOXES.seSideways, true, { width: 800, height: 450 }, { gutterLeft: 128 });
    expect(fit.gutterLeft).toBe(128);
    expect(fit.gutterRight).toBe(THUMB_GUTTER_WIDTH);
    expect(fit.viewWidth + 128 + THUMB_GUTTER_WIDTH).toBeLessThanOrEqual(BOXES.seSideways.width);
  });

  it("returns an empty window before the play box is measured", () => {
    const fit = fitThumbPads({ width: 0, height: 0 }, true, RUNNER);
    expect(fit.scale).toBe(0);
    expect(fit.viewWidth).toBe(0);
  });
});

describe("ThumbPadLayout", () => {
  it("renders the left and right buttons in gutters sideways and in one row upright", () => {
    const sideways = fitThumbPads(BOXES.seSideways, true, RUNNER);
    const view = render(
      <ThumbPadLayout fit={sideways} left={<button>JUMP</button>} right={<button>DUCK</button>} rowTestId="row">
        <div data-testid="world" />
      </ThumbPadLayout>,
    );
    expect(screen.queryByTestId("row")).toBeNull();
    const order = [...view.container.querySelectorAll("button, [data-testid=world]")].map((e) => e.textContent || "world");
    expect(order).toEqual(["JUMP", "world", "DUCK"]);
    view.unmount();

    const upright = fitThumbPads(BOXES.seUpright, true, RUNNER);
    render(
      <ThumbPadLayout fit={upright} left={<button>JUMP</button>} right={<button>DUCK</button>} rowTestId="row">
        <div data-testid="world" />
      </ThumbPadLayout>,
    );
    const row = screen.getByTestId("row");
    expect(row).toHaveTextContent("JUMPDUCK");
  });

  it("shows no buttons on a mouse screen", () => {
    const desk = fitThumbPads({ width: 1280, height: 752 }, false, RUNNER);
    render(
      <ThumbPadLayout fit={desk} left={<button>JUMP</button>} right={<button>DUCK</button>}>
        <div data-testid="world" />
      </ThumbPadLayout>,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTestId("world")).toBeInTheDocument();
  });
});
