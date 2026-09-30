import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({ isAuthenticated: false, isGuest: true, syncStatus: "idle", lastSynced: null, forceSync: vi.fn() }),
}));
vi.mock("@/shared/components/IOSInstallPrompt", () => ({ IOSInstallPrompt: () => null }));

import { CONTROL_ROW_HEIGHT, DinoRunnerGame, fitDino, GUTTER_WIDTH, MAX_SCALE, PORTRAIT_VISIBLE_WORLD } from "../Game";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "../lib/constants";
import { useDinoRunnerStore } from "../lib/store";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";

// Regression (phone UX audit 2026-09-29, dino-runner findings 3 to 5): the
// canvas scaled by width only, so a phone held upright showed a strip 19
// to 21 percent of the screen tall with a 20 px dino, and a phone held
// sideways put DUCK below the bottom edge (or nowhere, on a large phone).
// The picture now fits the play box on both axes; sideways the buttons sit
// in gutters beside it, upright in a row under it, and upright the world
// is cropped on the right so the picture can be tall.

/** The four iPhone play boxes: the screen under the 48 px (40 px sideways) header. */
const BOXES = {
  "375x549": { width: 375, height: 501 },
  "667x311": { width: 667, height: 271 },
  "390x664": { width: 390, height: 616 },
  "844x340": { width: 844, height: 300 },
};

describe("fitDino", () => {
  it("sideways on a phone: gutters for JUMP and DUCK beside a picture that shows the whole world", () => {
    for (const name of ["667x311", "844x340"] as const) {
      const fit = fitDino(BOXES[name], true);
      expect(fit.layout, name).toBe("sideways");
      expect(fit.visibleWorld, name).toBe(CANVAS_WIDTH);
      expect(fit.viewWidth + 2 * GUTTER_WIDTH, name).toBeLessThanOrEqual(BOXES[name].width);
      expect(fit.viewHeight, name).toBeLessThanOrEqual(BOXES[name].height);
      expect(fit.viewHeight, `${name}: the picture uses the height`).toBeGreaterThanOrEqual(BOXES[name].height * 0.6);
    }
  });

  it("upright on a phone: a control row under a picture that crops the world on the right", () => {
    for (const name of ["375x549", "390x664"] as const) {
      const box = BOXES[name];
      const fit = fitDino(box, true);
      expect(fit.layout, name).toBe("upright");
      expect(fit.visibleWorld, name).toBeCloseTo(PORTRAIT_VISIBLE_WORLD, 3);
      expect(fit.viewWidth, name).toBeLessThanOrEqual(box.width);
      expect(fit.viewHeight + CONTROL_ROW_HEIGHT, name).toBeLessThanOrEqual(box.height);
      // Taller than the old width-only strip (129 px at 375, 134 px at 390).
      expect(fit.viewHeight, name).toBeGreaterThan(170);
      // The dino (47 world px) is 28 px or taller.
      expect(47 * fit.scale, name).toBeGreaterThanOrEqual(28);
    }
  });

  it("a desktop with a mouse: no controls, the whole world, pixel art no bigger than 1.5x", () => {
    const fit = fitDino({ width: 1424, height: 852 }, false);
    expect(fit.layout).toBe("desktop");
    expect(fit.scale).toBe(MAX_SCALE);
    expect(fit.viewWidth).toBe(CANVAS_WIDTH * MAX_SCALE);
    expect(fit.viewHeight).toBe(CANVAS_HEIGHT * MAX_SCALE);
    expect(fit.visibleWorld).toBe(CANVAS_WIDTH);
  });

  it("gives an empty picture before the box is measured", () => {
    expect(fitDino({ width: 0, height: 0 }, true)).toMatchObject({ scale: 0, viewWidth: 0, viewHeight: 0 });
  });
});

/** A fake GameShell play box of a given size, for the game to measure. */
function playBox(width: number, height: number): HTMLElement {
  const box = document.createElement("div");
  box.setAttribute("data-play-box", "");
  Object.defineProperty(box, "clientWidth", { configurable: true, get: () => width });
  Object.defineProperty(box, "clientHeight", { configurable: true, get: () => height });
  document.body.appendChild(box);
  return box;
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  localStorage.clear();
  useDinoRunnerStore.setState({ gameState: "playing" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetPointerMock();
  useDinoRunnerStore.setState({ gameState: "idle" });
  document.querySelectorAll("[data-play-box]").forEach((el) => el.remove());
});

describe("DinoRunnerGame in the play box", () => {
  it("sizes the picture from the play box, sideways, with the buttons in the gutters", () => {
    mockPointer(true);
    const box = playBox(667, 271);
    render(<DinoRunnerGame />, { container: box });
    const fit = fitDino(BOXES["667x311"], true);
    const surface = screen.getByTestId("dino-surface");
    expect(surface.dataset.layout).toBe("sideways");
    const viewport = screen.getByTestId("dino-viewport");
    expect(viewport.style.width).toBe(`${fit.viewWidth}px`);
    expect(viewport.style.height).toBe(`${fit.viewHeight}px`);
    // The buttons are outside the picture: siblings of it, not children.
    const jump = screen.getByRole("button", { name: "JUMP" });
    const duck = screen.getByRole("button", { name: "DUCK" });
    expect(viewport.contains(jump)).toBe(false);
    expect(viewport.contains(duck)).toBe(false);
    expect(screen.queryByTestId("dino-control-row")).toBeNull();
  });

  it("sizes the picture from the play box, upright, with the buttons in a row under it", () => {
    mockPointer(true);
    const box = playBox(375, 501);
    render(<DinoRunnerGame />, { container: box });
    const fit = fitDino(BOXES["375x549"], true);
    expect(screen.getByTestId("dino-surface").dataset.layout).toBe("upright");
    const viewport = screen.getByTestId("dino-viewport");
    expect(viewport.style.width).toBe(`${fit.viewWidth}px`);
    expect(viewport.style.height).toBe(`${fit.viewHeight}px`);
    // The canvas is wider than its window: the world is cropped on the right.
    const canvas = viewport.querySelector("canvas") as HTMLCanvasElement;
    expect(parseFloat(canvas.style.width)).toBeGreaterThan(fit.viewWidth);
    const row = screen.getByTestId("dino-control-row");
    expect(row.style.height).toBe(`${CONTROL_ROW_HEIGHT}px`);
    expect(row.contains(screen.getByRole("button", { name: "JUMP" }))).toBe(true);
    expect(row.contains(screen.getByRole("button", { name: "DUCK" }))).toBe(true);
  });

  it("keeps the buttons in place between runs, hidden and inert, so the picture never jumps", () => {
    mockPointer(true);
    playBox(667, 271);
    useDinoRunnerStore.setState({ gameState: "idle" });
    render(<DinoRunnerGame />, { container: document.querySelector("[data-play-box]") as HTMLElement });
    const duck = screen.getByTestId("dino-duck");
    expect(duck.className.split(/\s+/)).toContain("invisible");
    expect(duck.hasAttribute("inert")).toBe(true);
    expect(duck.getAttribute("aria-hidden")).toBe("true");
  });
});
