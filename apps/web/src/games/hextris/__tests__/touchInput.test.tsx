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

import HextrisGame from "../Game";
import { useHextrisStore } from "../lib/store";
import { fingerTap, liftAllFingers } from "@/__tests__/finger-mock";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";

// Regression (2026 phone audit, hextris): the canvas carried onClick AND
// onTouchStart with the same handler. A finger tap ran it on touchstart and
// again on the compatibility click, so the hexagon spun 120 degrees for one
// tap, and a tap to resume from pause also spun it 60.

const RECT = { left: 0, top: 0, width: 400, height: 500, right: 400, bottom: 500, x: 0, y: 0 };

function renderPlaying() {
  const { container } = render(<HextrisGame />);
  const canvas = container.querySelector("canvas") as HTMLCanvasElement;
  canvas.getBoundingClientRect = () => ({ ...RECT, toJSON: () => RECT }) as DOMRect;
  return canvas;
}

beforeEach(() => {
  localStorage.clear();
  mockPointer(true);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  act(() => {
    useHextrisStore.setState({ status: "playing", targetRotation: 0, rotation: 0 });
  });
});

afterEach(() => {
  liftAllFingers();
  vi.unstubAllGlobals();
  resetPointerMock();
  act(() => {
    useHextrisStore.setState({ status: "idle" });
  });
});

describe("Hextris touch input", () => {
  it("one finger tap on the left half spins the hexagon ONE step (60 degrees)", () => {
    const canvas = renderPlaying();
    fingerTap(canvas, { x: 50, y: 250 });
    expect(useHextrisStore.getState().targetRotation).toBeCloseTo(-Math.PI / 3, 6);
  });

  it("one finger tap on the right half spins it one step the other way", () => {
    const canvas = renderPlaying();
    fingerTap(canvas, { x: 350, y: 250 });
    expect(useHextrisStore.getState().targetRotation).toBeCloseTo(Math.PI / 3, 6);
  });

  it("a tap to resume from pause resumes and does not spin", () => {
    act(() => {
      useHextrisStore.setState({ status: "paused" });
    });
    const canvas = renderPlaying();
    fingerTap(canvas, { x: 50, y: 250 });
    expect(useHextrisStore.getState().status).toBe("playing");
    expect(useHextrisStore.getState().targetRotation).toBe(0);
  });
});
