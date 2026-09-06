import { render, screen, fireEvent, renderHook, act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// PauseMenu uses next/navigation's useRouter (app router isn't mounted in jsdom)
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

import { HillClimbGame } from "../Game";
import { useCombinedControls } from "../hooks/useControls";
import { useHillClimbStore } from "../lib/store";
import { mockPointer } from "@/__tests__/pointer-mock";

/**
 * Start-moment tests for the shared GameStartOverlay migration.
 *
 * Before this, the route always passed `startActive`, so the start screen at
 * the bottom of Game.tsx never rendered and the run began on its own. The
 * overlay is now the real start moment, and the window-level touch/key layer
 * stays dead until the player presses Play.
 */
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    {} as never
  );
  localStorage.clear();
  useHillClimbStore.setState({
    isPlaying: false,
    isPaused: false,
    isGameOver: false,
    pauseScreen: "menu",
  });
});

afterEach(() => {
  cleanup();
  mockPointer(false);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  act(() => {
    useHillClimbStore.setState({ isPlaying: false, isPaused: false });
  });
});

describe("hill-climb start overlay", () => {
  it("renders the shared overlay with the title exactly once", () => {
    render(<HillClimbGame />);

    expect(screen.getByTestId("game-start-overlay")).toBeInTheDocument();
    expect(screen.getAllByText("Hill Climb Racing")).toHaveLength(1);
  });

  it("shows the touch instructions on a coarse-pointer viewport", () => {
    mockPointer(true);
    render(<HillClimbGame />);

    expect(screen.getByText("🦶 Tap the right side to go")).toBeInTheDocument();
    expect(screen.getByText("🛑 Tap the left side to stop")).toBeInTheDocument();
    expect(
      screen.queryByText("🦶 Press D or the right arrow to go")
    ).not.toBeInTheDocument();
  });

  it("starts exactly one run no matter how fast Play is pressed", () => {
    const startRun = vi.spyOn(useHillClimbStore.getState(), "startRun");
    render(<HillClimbGame />);

    const play = screen.getByRole("button", { name: /Play Now/ });
    fireEvent.click(play);
    fireEvent.click(play);

    expect(startRun).toHaveBeenCalledTimes(1);
  });

  it("removes the overlay once the run starts", () => {
    render(<HillClimbGame />);

    fireEvent.click(screen.getByRole("button", { name: /Play Now/ }));

    expect(screen.queryByTestId("game-start-overlay")).toBeNull();
    expect(useHillClimbStore.getState().isPlaying).toBe(true);
  });

  it("opens the Garage from the overlay without starting the run", () => {
    render(<HillClimbGame />);

    fireEvent.click(screen.getByRole("button", { name: /Garage/ }));

    expect(screen.queryByTestId("game-start-overlay")).toBeNull();
    expect(useHillClimbStore.getState().isPlaying).toBe(false);
  });
});

describe("hill-climb window control layer", () => {
  it("ignores keys and taps while the run is not active", () => {
    const { result } = renderHook(() => useCombinedControls(false));

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA" }));
    });

    expect(result.current.gas).toBe(false);
    expect(result.current.brake).toBe(false);
  });

  it("reads keys once the run is active", () => {
    const { result } = renderHook(() => useCombinedControls(true));

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD" }));
    });

    expect(result.current.gas).toBe(true);
  });
});

describe("hill-climb start card after a finished run", () => {
  it("hides the old game-over screen and the HUD behind the start card", () => {
    // Regression: the store is a singleton, so isGameOver stayed true after a
    // run. Re-entering the game painted the z-50 game-over screen on top of
    // the new start card.
    act(() => {
      useHillClimbStore.setState({ isGameOver: true, isPlaying: false });
    });

    render(<HillClimbGame />);

    expect(screen.getByTestId("game-start-overlay")).toBeInTheDocument();
    expect(screen.queryByText("CRASHED!")).not.toBeInTheDocument();
    expect(screen.queryByText("OUT OF FUEL!")).not.toBeInTheDocument();
    expect(useHillClimbStore.getState().isGameOver).toBe(false);
  });

  it("keeps the saved coins and best distance while it clears the run flags", () => {
    act(() => {
      useHillClimbStore.setState({
        isGameOver: true,
        coins: 1234,
        bestDistance: 999,
      });
    });

    render(<HillClimbGame />);

    expect(useHillClimbStore.getState().coins).toBe(1234);
    expect(useHillClimbStore.getState().bestDistance).toBe(999);
  });

  it("starts the run when Play is pressed", () => {
    act(() => {
      useHillClimbStore.setState({ isGameOver: true });
    });
    render(<HillClimbGame />);

    fireEvent.click(screen.getByRole("button", { name: /Play Now/ }));

    expect(screen.queryByTestId("game-start-overlay")).not.toBeInTheDocument();
    expect(useHillClimbStore.getState().isPlaying).toBe(true);
    expect(useHillClimbStore.getState().isGameOver).toBe(false);
  });
});

describe("hill-climb start card clipping", () => {
  it("keeps overflow-hidden off the root, so the sticky start card is not clipped", () => {
    // Regression: overflow-hidden made this root the card's scroll container,
    // which offset the sticky box by the header height and pushed Play off the
    // bottom on a phone held sideways (844x390). The canvas is absolute
    // inset-0, so there is nothing to clip.
    const { container } = render(<HillClimbGame />);

    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("relative");
    expect(root.className).not.toContain("overflow-hidden");
    expect(screen.getByRole("button", { name: /Play Now/ })).toBeInTheDocument();
  });
});
