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

vi.mock("@/shared/components/IOSInstallPrompt", () => ({
  IOSInstallPrompt: () => null,
}));

import { BreakoutGame, getCanvasCopy, TAP_SLOP_PX } from "../Game";
import { useBreakoutStore } from "../lib/store";
import { fingerDown, fingerMove, fingerTap, fingerUp, liftAllFingers } from "@/__tests__/finger-mock";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";

// Regression (2026 phone audit, breakout): the canvas carried onClick AND
// onTouchStart with the same handler, so the first touch launched the ball
// at once (before the kid could place the paddle) and again on the
// compatibility click: a game-over tap restarted AND launched the new ball.
// Now a drag steers and only a tap that did not drag launches.

function renderPlaying() {
  const { container } = render(<BreakoutGame />);
  return container.querySelector("canvas") as HTMLCanvasElement;
}

function stuckBalls() {
  return useBreakoutStore.getState().balls.filter((b) => b.stuck).length;
}

beforeEach(() => {
  localStorage.clear();
  mockPointer(true);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  act(() => {
    useBreakoutStore.getState().startGame();
  });
});

afterEach(() => {
  liftAllFingers();
  vi.unstubAllGlobals();
  resetPointerMock();
  act(() => {
    useBreakoutStore.setState({ status: "idle" });
  });
});

describe("Breakout touch input", () => {
  it("a run starts with the ball stuck to the paddle", () => {
    expect(useBreakoutStore.getState().status).toBe("playing");
    expect(stuckBalls()).toBeGreaterThan(0);
  });

  it("a finger that drags the paddle does NOT launch the ball", () => {
    const canvas = renderPlaying();
    fingerDown(canvas, { x: 100, y: 500 });
    fingerMove(canvas, { x: 100 + TAP_SLOP_PX * 4, y: 500 });
    fingerUp(canvas);
    expect(stuckBalls()).toBeGreaterThan(0);
  });

  it("a finger tap (no drag) launches the ball once", () => {
    const canvas = renderPlaying();
    fingerTap(canvas, { x: 100, y: 500 });
    expect(stuckBalls()).toBe(0);
  });

  it("a game-over tap restarts with the ball STUCK, not already flying", () => {
    act(() => {
      useBreakoutStore.getState().gameOver();
    });
    const canvas = renderPlaying();
    fingerTap(canvas, { x: 100, y: 500 });
    expect(useBreakoutStore.getState().status).toBe("playing");
    expect(stuckBalls()).toBeGreaterThan(0);
  });

  it("keys the in-play hint on the pointer, not on a width breakpoint", () => {
    mockPointer(true);
    const { unmount } = render(<BreakoutGame />);
    expect(screen.getByText("Drag to move paddle | Tap to launch")).toBeInTheDocument();
    expect(screen.queryByText(/Space to launch/)).not.toBeInTheDocument();
    unmount();

    mockPointer(false);
    render(<BreakoutGame />);
    expect(screen.getByText(/Space to launch/)).toBeInTheDocument();
    expect(screen.queryByText("Drag to move paddle | Tap to launch")).not.toBeInTheDocument();
  });

  it("draws touch copy on the canvas for a finger and keyboard copy for a mouse", () => {
    expect(getCanvasCopy(true).launch).toBe("Tap to Launch!");
    expect(getCanvasCopy(true).playAgain).not.toMatch(/Space/);
    expect(getCanvasCopy(false).launch).toBe("Tap or Press Space to Launch!");
  });
});
