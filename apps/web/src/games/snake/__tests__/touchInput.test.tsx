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

import SnakeGame, { SWIPE_TURN_PX } from "../Game";
import { useSnakeStore } from "../lib/store";
import { fingerDown, fingerMove, fingerUp, liftAllFingers } from "@/__tests__/finger-mock";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";

// Regression (2026 phone audit, snake): the touch controls sat behind
// md:hidden, so a large phone held sideways (844 px wide) had no d-pad and
// no swipe layer and read "Use WASD"; a swipe was read only on touchend, so
// every turn landed one tick late.

function setSwipeMode() {
  const state = useSnakeStore.getState();
  useSnakeStore.setState({
    status: "playing",
    direction: "right",
    nextDirection: "right",
    progress: { ...state.progress, controlMode: "swipe" },
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  liftAllFingers();
  vi.unstubAllGlobals();
  resetPointerMock();
  act(() => {
    useSnakeStore.setState({ status: "idle" });
  });
});

describe("Snake touch input", () => {
  it("turns on touchmove, as soon as the swipe is long enough, before the finger lifts", () => {
    mockPointer(true);
    act(setSwipeMode);
    render(<SnakeGame />);
    const layer = screen.getByTestId("snake-swipe-layer");
    fingerDown(layer, { x: 100, y: 100 });
    fingerMove(layer, { x: 100, y: 100 - SWIPE_TURN_PX - 4 });
    expect(useSnakeStore.getState().nextDirection).toBe("up");
    // More travel in the same gesture is not a second turn.
    fingerMove(layer, { x: 160, y: 100 - SWIPE_TURN_PX - 4 });
    expect(useSnakeStore.getState().nextDirection).toBe("up");
    fingerUp(layer);
  });

  it("shows the touch controls on a coarse pointer and the keyboard hint on a fine one", () => {
    mockPointer(true);
    act(setSwipeMode);
    const { unmount } = render(<SnakeGame />);
    expect(screen.getByTestId("snake-swipe-layer")).toBeInTheDocument();
    expect(screen.queryByText(/Use WASD or Arrow Keys/)).not.toBeInTheDocument();
    unmount();

    mockPointer(false);
    act(setSwipeMode);
    render(<SnakeGame />);
    expect(screen.queryByTestId("snake-swipe-layer")).not.toBeInTheDocument();
    expect(screen.getByText(/Use WASD or Arrow Keys/)).toBeInTheDocument();
  });
});
