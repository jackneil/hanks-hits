import { act, render, screen } from "@testing-library/react";
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

import { ArkanoidGame } from "../Game";
import { useArkanoidStore } from "../lib/store";
import { fingerTap, liftAllFingers } from "@/__tests__/finger-mock";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";

// Regression (2026 phone audit, arkanoid): the canvas carried onClick AND
// onTouchStart, so a finger tap launched on touchstart and again on the
// compatibility click; the launch hint said "Click or press Space" to a
// finger.

beforeEach(() => {
  localStorage.clear();
  mockPointer(true);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  act(() => {
    useArkanoidStore.getState().startGame();
  });
});

afterEach(() => {
  liftAllFingers();
  vi.unstubAllGlobals();
  resetPointerMock();
  act(() => {
    useArkanoidStore.setState({ gameState: "menu" });
  });
});

describe("Arkanoid touch input", () => {
  it("one finger tap launches ONCE", () => {
    const launchBall = vi.fn();
    act(() => {
      useArkanoidStore.setState({ launchBall });
    });
    const { container } = render(<ArkanoidGame />);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    fingerTap(canvas, { x: 100, y: 200 });
    expect(launchBall).toHaveBeenCalledTimes(1);
  });

  it("tells a finger to tap and a mouse to click or press Space", () => {
    mockPointer(true);
    const { unmount } = render(<ArkanoidGame />);
    expect(screen.getByText("👆 Tap to launch!")).toBeInTheDocument();
    unmount();

    mockPointer(false);
    render(<ArkanoidGame />);
    expect(screen.getByText("👆 Click or press Space to launch!")).toBeInTheDocument();
  });
});
