import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { Game2048 } from "../Game";
import { use2048Store } from "../lib/store";

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({
    isAuthenticated: false,
    syncStatus: "idle",
    forceSync: vi.fn(),
  }),
}));

vi.mock("@/shared/components/FullscreenButton", () => ({
  FullscreenButton: () => <button>Enter fullscreen</button>,
}));

vi.mock("@/shared/components/IOSInstallPrompt", () => ({
  IOSInstallPrompt: () => null,
}));

/**
 * The global setup installs a matchMedia stub that always returns
 * matches: false. This swaps in one where "(pointer: coarse)" resolves to the
 * requested value so we can simulate touch vs keyboard viewports.
 */
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

/** Press the start overlay's Play button. */
function startPlaying() {
  fireEvent.click(screen.getByRole("button", { name: /play/i }));
}

describe("Game2048", () => {
  it("gives the board wrapper a stable responsive width", () => {
    render(<Game2048 />);

    const boardWrapper = screen.getByTestId("game-2048-board-wrapper");
    expect(boardWrapper).toHaveClass("w-full");
    expect(boardWrapper).toHaveClass("max-w-[400px]");
  });

  it("confirms overlay restarts before resetting the board", () => {
    render(<Game2048 />);
    startPlaying();
    const newGame = screen.getByRole("button", { name: "New Game" });

    fireEvent.click(newGame);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Start a new 2048 game? Your current board will be lost.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm restart" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("Game2048 start overlay", () => {
  beforeEach(() => {
    localStorage.clear();
    use2048Store.getState().newGame();
  });

  afterEach(() => {
    mockPointer(false);
  });

  it("shows the shared overlay with the title exactly once", () => {
    render(<Game2048 />);

    expect(screen.getByTestId("game-start-overlay")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "2048" })).toHaveLength(1);
    expect(screen.getAllByText("2048")).toHaveLength(1);
  });

  it("shows swipe hints (not keyboard copy) on coarse pointers", () => {
    mockPointer(true);
    render(<Game2048 />);

    expect(screen.getByText("👈👉 Swipe to slide the tiles")).toBeInTheDocument();
    expect(
      screen.queryByText("⬅️➡️ Arrow keys slide the tiles")
    ).not.toBeInTheDocument();
  });

  it("shows keyboard hints (not swipe copy) on fine pointers", () => {
    mockPointer(false);
    render(<Game2048 />);

    expect(
      screen.getByText("⬅️➡️ Arrow keys slide the tiles")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("👈👉 Swipe to slide the tiles")
    ).not.toBeInTheDocument();
  });

  it("keeps the board frozen until Play, then starts exactly once", () => {
    render(<Game2048 />);

    const before = JSON.stringify(use2048Store.getState().grid);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(JSON.stringify(use2048Store.getState().grid)).toBe(before);

    const play = screen.getByRole("button", { name: /play/i });
    fireEvent.click(play);
    fireEvent.click(play);

    expect(screen.queryByTestId("game-start-overlay")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "2048" })).not.toBeInTheDocument();
  });

  it("keeps Undo and New Game available", () => {
    render(<Game2048 />);
    startPlaying();

    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Game" })).toBeInTheDocument();
  });
});
