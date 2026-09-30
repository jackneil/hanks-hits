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
import { fingerDown, fingerMove, fingerTap, fingerUp, liftAllFingers } from "@/__tests__/finger-mock";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";

// Regression (2026 phone audit, snake): the touch controls sat behind
// md:hidden, so a large phone held sideways (844 px wide) had no d-pad and
// no swipe layer and read "Use WASD"; a swipe was read only on touchend, so
// every turn landed one tick late; and a swipe worked only in swipe mode,
// through a fixed layer over the whole page that also swallowed the taps on
// the buttons under it. Now the game itself is the swipe surface, in both
// modes, and the buttons over it keep their taps.

function setPlaying(controlMode: "buttons" | "swipe") {
  const state = useSnakeStore.getState();
  useSnakeStore.setState({
    status: "playing",
    direction: "right",
    nextDirection: "right",
    progress: { ...state.progress, controlMode },
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

/** The store's real setDirection: a test that swaps in a spy puts it back. */
const realSetDirection = useSnakeStore.getState().setDirection;

afterEach(() => {
  liftAllFingers();
  vi.unstubAllGlobals();
  resetPointerMock();
  act(() => {
    useSnakeStore.setState({ status: "idle", setDirection: realSetDirection });
  });
});

describe("Snake touch input", () => {
  it("turns on touchmove, as soon as the swipe is long enough, before the finger lifts", () => {
    mockPointer(true);
    act(() => setPlaying("swipe"));
    render(<SnakeGame />);
    const surface = screen.getByTestId("snake-game");
    fingerDown(surface, { x: 100, y: 100 });
    fingerMove(surface, { x: 100, y: 100 - SWIPE_TURN_PX - 4 });
    expect(useSnakeStore.getState().nextDirection).toBe("up");
    // More travel in the same gesture is not a second turn.
    fingerMove(surface, { x: 160, y: 100 - SWIPE_TURN_PX - 4 });
    expect(useSnakeStore.getState().nextDirection).toBe("up");
    fingerUp(surface);
  });

  it("a swipe on the board turns the snake in arrows mode too", () => {
    mockPointer(true);
    act(() => setPlaying("buttons"));
    render(<SnakeGame />);
    const board = screen.getByTestId("snake-board");
    fingerDown(board, { x: 100, y: 100 });
    fingerMove(board, { x: 100, y: 100 + SWIPE_TURN_PX + 4 });
    expect(useSnakeStore.getState().nextDirection).toBe("down");
    fingerUp(board);
  });

  it("one tap on an arrow is one turn, and the swipe surface never takes the tap", () => {
    mockPointer(true);
    act(() => setPlaying("buttons"));
    render(<SnakeGame />);
    const setDirection = vi.fn();
    act(() => {
      useSnakeStore.setState({ setDirection });
    });
    fingerTap(screen.getByRole("button", { name: "Move up" }), { x: 10, y: 10 });
    expect(setDirection).toHaveBeenCalledTimes(1);
    expect(setDirection).toHaveBeenCalledWith("up");
  });

  it("shows the d-pad on a coarse pointer and the keyboard hint on a fine one, whatever the width", () => {
    mockPointer(true);
    act(() => setPlaying("buttons"));
    const { unmount } = render(<SnakeGame />);
    expect(screen.getByTestId("snake-dpad")).toBeInTheDocument();
    expect(screen.queryByText(/Use WASD or Arrow Keys/)).not.toBeInTheDocument();
    unmount();

    mockPointer(false);
    act(() => setPlaying("buttons"));
    render(<SnakeGame />);
    expect(screen.queryByTestId("snake-dpad")).not.toBeInTheDocument();
    expect(screen.getByText(/Use WASD or Arrow Keys/)).toBeInTheDocument();
  });
});
