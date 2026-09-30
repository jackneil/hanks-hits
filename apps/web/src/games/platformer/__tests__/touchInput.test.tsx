import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

import PlatformerGame from "../Game";
import { usePlatformerStore } from "../lib/store";
import { fingerCancel, fingerDown, fingerUp, liftAllFingers } from "@/__tests__/finger-mock";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";

// Regression (2026 phone audit, platformer): the canvas handler read
// e.touches[0], the OLDEST finger, so a tap on the level while ▶ was held
// used the ▶ thumb's coordinates (it started moving LEFT sideways) and any
// touchend released both directions even though ▶ was still down. The pad
// buttons had no touchcancel path.

// The zone math divides by `scale`, which the resize handler derives from
// the container's clientWidth/clientHeight (zero in jsdom). Pin the client
// sizes and the rect to the canvas's natural 800x450 so scale is 1 and
// clientX maps 1:1 onto canvas coordinates: left third moves left, right
// third moves right, the middle jumps.
const RECT = { left: 0, top: 0, width: 800, height: 450, right: 800, bottom: 450, x: 0, y: 0 };

beforeEach(() => {
  localStorage.clear();
  mockPointer(true);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 450 });
  act(() => {
    usePlatformerStore.setState({ gameState: "playing", movingLeft: false, movingRight: false });
  });
});

afterEach(() => {
  liftAllFingers();
  vi.unstubAllGlobals();
  resetPointerMock();
  delete (HTMLElement.prototype as { clientWidth?: unknown }).clientWidth;
  delete (HTMLElement.prototype as { clientHeight?: unknown }).clientHeight;
  act(() => {
    usePlatformerStore.setState({ gameState: "ready", movingLeft: false, movingRight: false });
  });
});

describe("Platformer touch input", () => {
  it("a level tap while ▶ is held jumps with the TAP's finger and keeps ▶ held", () => {
    const jump = vi.fn();
    act(() => {
      usePlatformerStore.setState({ jump });
    });
    const { container } = render(<PlatformerGame />);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    canvas.getBoundingClientRect = () => ({ ...RECT, toJSON: () => RECT }) as DOMRect;
    const right = screen.getByRole("button", { name: "▶" });

    // Right thumb holds ▶ (off to the right of the level, x 700).
    fingerDown(right, { id: 1, x: 700, y: 380 });
    expect(usePlatformerStore.getState().movingRight).toBe(true);

    // Left thumb taps the middle of the level.
    fingerDown(canvas, { id: 2, x: 400, y: 200 });
    expect(jump).toHaveBeenCalledTimes(1);
    expect(usePlatformerStore.getState().movingLeft).toBe(false);
    expect(usePlatformerStore.getState().movingRight).toBe(true);

    // The tapping finger lifts: ▶ is still held.
    fingerUp(canvas, { id: 2 });
    expect(usePlatformerStore.getState().movingRight).toBe(true);

    fingerUp(right, { id: 1 });
    expect(usePlatformerStore.getState().movingRight).toBe(false);
  });

  it("a level touch in the left third moves left only until THAT finger lifts", () => {
    const { container } = render(<PlatformerGame />);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    canvas.getBoundingClientRect = () => ({ ...RECT, toJSON: () => RECT }) as DOMRect;

    fingerDown(canvas, { id: 1, x: 100, y: 200 });
    expect(usePlatformerStore.getState().movingLeft).toBe(true);
    fingerDown(canvas, { id: 2, x: 700, y: 200 });
    expect(usePlatformerStore.getState().movingRight).toBe(true);
    fingerUp(canvas, { id: 2 });
    expect(usePlatformerStore.getState().movingRight).toBe(false);
    expect(usePlatformerStore.getState().movingLeft).toBe(true);
    fingerUp(canvas, { id: 1 });
    expect(usePlatformerStore.getState().movingLeft).toBe(false);
  });

  it("a cancelled touch on ◀ releases the direction", () => {
    render(<PlatformerGame />);
    const left = screen.getByRole("button", { name: "◀" });
    fingerDown(left, { id: 1 });
    expect(usePlatformerStore.getState().movingLeft).toBe(true);
    fingerCancel(left, { id: 1 });
    expect(usePlatformerStore.getState().movingLeft).toBe(false);
  });
});
