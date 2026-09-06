import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SnakeGame } from "../Game";
import { useSnakeStore } from "../lib/store";
import { mockPointer } from "@/__tests__/pointer-mock";
import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";

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

  it("shows the button hint on coarse pointers in the default button mode", () => {
    // Regression: the card always said "Swipe to turn", but swipes are only
    // read in swipe mode and the default control mode is buttons.
    mockPointer(true);
    useSnakeStore.setState((state) => ({
      progress: { ...state.progress, controlMode: "buttons" },
    }));
    render(<SnakeGame />);

    expect(
      screen.getByText("🔼🔽 Tap the arrow buttons to turn")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("👆 Swipe to turn the snake")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("⌨️ Arrow keys or WASD to turn")
    ).not.toBeInTheDocument();
  });

  it("shows the swipe hint on coarse pointers when swipe mode is picked", () => {
    mockPointer(true);
    useSnakeStore.setState((state) => ({
      progress: { ...state.progress, controlMode: "swipe" },
    }));
    render(<SnakeGame />);

    expect(screen.getByText("👆 Swipe to turn the snake")).toBeInTheDocument();
    expect(
      screen.queryByText("🔼🔽 Tap the arrow buttons to turn")
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

describe("snake spoken choices", () => {
  it("says the picker choices out loud, so a kid who cannot read hears them", () => {
    const speech = installSpeechMock();
    render(<SnakeGame  />);

    fireEvent.click(screen.getByTestId("read-aloud-button"));

    const spoken = speech.lastUtterance().text;
    expect(spoken).toContain("Slow");
    expect(spoken).toContain("Medium");
    expect(spoken).toContain("Fast");
    removeSpeechMock();
  });
});

describe("snake speed picker layout", () => {
  it("lays the three speeds out in a grid so none overflow the card", () => {
    // Regression: a flex row of w-full daisyUI buttons (flex-shrink: 0) fitted
    // only "Slow" and pushed Medium and Fast outside the card.
    render(<SnakeGame />);

    const slow = screen.getByRole("button", { name: /^slow$/i });
    const row = slow.parentElement!;
    expect(row.className).toContain("grid-cols-3");
    expect(row.className).not.toContain("flex");
    expect(row.children).toHaveLength(3);
  });
});
