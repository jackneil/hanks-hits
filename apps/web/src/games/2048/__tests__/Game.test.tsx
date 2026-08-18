import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest"

import { Game2048 } from "../Game";

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

describe("Game2048", () => {
  it("gives the board wrapper a stable responsive width", () => {
    render(<Game2048 />);

    const boardWrapper = screen.getByTestId("game-2048-board-wrapper");
    expect(boardWrapper).toHaveClass("w-full");
    expect(boardWrapper).toHaveClass("max-w-[400px]");
  });

  it("confirms overlay restarts before resetting the board", () => {
    render(<Game2048 />);
    const newGame = screen.getByRole("button", { name: "New Game" });

    fireEvent.click(newGame);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Start a new 2048 game? Your current board will be lost.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm restart" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
