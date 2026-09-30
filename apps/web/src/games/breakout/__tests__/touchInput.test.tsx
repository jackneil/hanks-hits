import { act, fireEvent, render, screen } from "@testing-library/react";
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

import { BreakoutGame, getLaunchHint, TAP_SLOP_PX } from "../Game";
import { DEFAULT_RESTART_GRACE_MS } from "@/shared/lib/input";
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

  it("a game-over tap never restarts; Play again starts a run with the ball STUCK", () => {
    let clock = 1_000_000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    act(() => {
      useBreakoutStore.getState().gameOver();
    });
    const canvas = renderPlaying();
    fingerTap(canvas, { x: 100, y: 500 });
    expect(useBreakoutStore.getState().status).toBe("game-over");
    clock += DEFAULT_RESTART_GRACE_MS + 50;
    fireEvent.click(screen.getByRole("button", { name: /play again/i }));
    expect(useBreakoutStore.getState().status).toBe("playing");
    expect(stuckBalls()).toBeGreaterThan(0);
  });

  it("shows the launch hint as DOM text keyed on the pointer, never on a width breakpoint", () => {
    mockPointer(true);
    const { unmount } = render(<BreakoutGame />);
    expect(screen.getByTestId("breakout-launch-hint")).toHaveTextContent("Tap to launch!");
    expect(screen.queryByText(/Space/)).not.toBeInTheDocument();
    unmount();

    mockPointer(false);
    render(<BreakoutGame />);
    expect(screen.getByTestId("breakout-launch-hint")).toHaveTextContent("press Space to launch");
  });

  it("gives a finger no keyboard words in the launch hint", () => {
    expect(getLaunchHint(true)).toBe("👆 Tap to launch!");
    expect(getLaunchHint(true)).not.toMatch(/Space|Click/);
    expect(getLaunchHint(false)).toBe("👆 Click or press Space to launch!");
  });
});
