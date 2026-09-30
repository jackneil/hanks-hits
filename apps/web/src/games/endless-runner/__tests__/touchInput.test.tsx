import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({
    isAuthenticated: false,
    isGuest: true,
    syncStatus: "idle",
    lastSynced: null,
    forceSync: vi.fn(),
  }),
}));

vi.mock("@/shared/components/IOSInstallPrompt", () => ({
  IOSInstallPrompt: () => null,
}));

import { EndlessRunnerGame } from "../Game";
import { useEndlessRunnerStore } from "../lib/store";
import { fingerDown, fingerUp, liftAllFingers } from "@/__tests__/finger-mock";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";

// Regression (2026 phone audit, endless-runner): the touch zones read
// e.touches[0] and any touchend called stopDuck, so a thumb holding the
// duck zone stood the runner up the moment the other thumb tapped to jump.
// Each finger now has its own zone, and only the duck finger lifting stops
// the duck.

// The canvas is 800x400 at scale 1 (jsdom has no layout, so the rect is set
// by hand). The duck zone is the bottom 30 %: y > 280.
const RECT = { left: 0, top: 0, width: 800, height: 400, right: 800, bottom: 400, x: 0, y: 0 };

beforeEach(() => {
  localStorage.clear();
  mockPointer(true);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  // The zone math divides by `scale`, derived from the container's client
  // size (zero in jsdom): pin it so scale is 1.
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 400 });
  act(() => {
    useEndlessRunnerStore.setState({ gameState: "playing" });
  });
});

afterEach(() => {
  liftAllFingers();
  vi.unstubAllGlobals();
  resetPointerMock();
  delete (HTMLElement.prototype as { clientWidth?: unknown }).clientWidth;
  delete (HTMLElement.prototype as { clientHeight?: unknown }).clientHeight;
  act(() => {
    useEndlessRunnerStore.setState({ gameState: "ready" });
  });
});

describe("Endless Runner touch zones", () => {
  it("keeps ducking while the duck finger is down, whatever the jump finger does", () => {
    const startDuck = vi.fn();
    const stopDuck = vi.fn();
    act(() => {
      useEndlessRunnerStore.setState({ startDuck, stopDuck });
    });
    const { container } = render(<EndlessRunnerGame />);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    canvas.getBoundingClientRect = () => ({ ...RECT, toJSON: () => RECT }) as DOMRect;

    // Left thumb holds the duck zone.
    fingerDown(canvas, { id: 1, x: 200, y: 350 });
    expect(startDuck).toHaveBeenCalledTimes(1);

    // Right thumb taps the jump zone and lifts.
    fingerDown(canvas, { id: 2, x: 600, y: 50 });
    fingerUp(canvas, { id: 2 });
    expect(stopDuck).not.toHaveBeenCalled();

    // The duck thumb lifts: now the runner stands up.
    fingerUp(canvas, { id: 1 });
    expect(stopDuck).toHaveBeenCalledTimes(1);
  });
});
