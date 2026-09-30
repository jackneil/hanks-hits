import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { Game2048 } from "../Game";
import { use2048Store } from "../lib/store";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";

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

/** Press the start overlay's Play button. */
function startPlaying() {
  fireEvent.click(screen.getByRole("button", { name: /play/i }));
}

describe("Game2048", () => {
  it("sizes the board as a square from the play box (it was w-full max-w-[400px], cut off sideways)", () => {
    render(<Game2048 />);
    const board = screen.getByTestId("game-2048-board");
    expect(board.style.width).not.toBe("");
    expect(board.style.width).toBe(board.style.height);
  });

  it("has no New Game button of its own mid-game: the header's restart asks first, the result chip starts at once", () => {
    render(<Game2048 />);
    startPlaying();
    expect(screen.queryByRole("button", { name: "New Game" })).toBeNull();
  });
});

describe("Game2048 start overlay", () => {
  beforeEach(() => {
    localStorage.clear();
    use2048Store.getState().newGame();
  });

  afterEach(() => {
    resetPointerMock();
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

  it("keeps Undo available in play", () => {
    render(<Game2048 />);
    startPlaying();
    expect(screen.getByRole("button", { name: /Undo/ })).toBeInTheDocument();
  });
});
