import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SnakeGame } from "../Game";
import { useSnakeStore } from "../lib/store";

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

/** Swap the global always-false matchMedia stub for a pointer-aware one. */
function mockPointer(coarse: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("pointer: coarse") ? coarse : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => {
  localStorage.clear();
  useSnakeStore.setState({ status: "idle" });
});

afterEach(() => {
  vi.restoreAllMocks();
  mockPointer(false);
});

describe("Snake start overlay", () => {
  it("shows the shared overlay with the title exactly once", () => {
    render(<SnakeGame />);

    expect(screen.getByTestId("game-start-overlay")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Snake" })).toHaveLength(1);
    expect(screen.getAllByText("Snake")).toHaveLength(1);
  });

  it("shows touch hints (not keyboard copy) on coarse pointers", () => {
    mockPointer(true);
    render(<SnakeGame />);

    expect(screen.getByText("👆 Swipe to turn the snake")).toBeInTheDocument();
    expect(
      screen.queryByText("⌨️ Arrow keys or WASD to turn")
    ).not.toBeInTheDocument();
  });

  it("shows keyboard hints (not touch copy) on fine pointers", () => {
    mockPointer(false);
    render(<SnakeGame />);

    expect(screen.getByText("⌨️ Arrow keys or WASD to turn")).toBeInTheDocument();
    expect(screen.queryByText("👆 Swipe to turn the snake")).not.toBeInTheDocument();
  });

  it("starts the game exactly once however hard Play is mashed", () => {
    const startGame = vi.spyOn(useSnakeStore.getState(), "startGame");
    render(<SnakeGame />);

    const play = screen.getByRole("button", { name: /play/i });
    fireEvent.click(play);
    fireEvent.click(play);

    expect(startGame).toHaveBeenCalledTimes(1);
    expect(useSnakeStore.getState().status).toBe("playing");
  });

  it("removes the overlay once the game is playing", () => {
    render(<SnakeGame />);

    fireEvent.click(screen.getByRole("button", { name: /play/i }));

    expect(screen.queryByTestId("game-start-overlay")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Snake" })).not.toBeInTheDocument();
  });

  it("does not start from the space bar while idle", () => {
    render(<SnakeGame />);

    fireEvent.keyDown(window, { key: " " });

    expect(useSnakeStore.getState().status).toBe("idle");
    expect(screen.getByTestId("game-start-overlay")).toBeInTheDocument();
  });

  it("picks the speed from the overlay", () => {
    render(<SnakeGame />);

    const fast = screen.getByRole("button", { name: "fast" });
    expect(fast).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(fast);

    expect(useSnakeStore.getState().progress.speed).toBe("fast");
    expect(
      screen.getByRole("button", { name: "fast" })
    ).toHaveAttribute("aria-pressed", "true");
  });
});
