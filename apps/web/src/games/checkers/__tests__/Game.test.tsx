import { fireEvent, render, screen } from "@testing-library/react";
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

import { CheckersGame } from "../Game";

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
});

afterEach(() => {
  mockPointer(false);
});

describe("Checkers start overlay", () => {
  it("shows the shared overlay with the title exactly once", () => {
    render(<CheckersGame />);

    expect(screen.getByTestId("game-start-overlay")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Checkers" })).toHaveLength(1);
    expect(screen.getAllByText("Checkers")).toHaveLength(1);
  });

  it("shows touch hints (not mouse copy) on coarse pointers", () => {
    mockPointer(true);
    render(<CheckersGame />);

    expect(
      screen.getByText("👆 Tap a piece, then tap where it goes")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("🖱️ Click a piece, then click where it goes")
    ).not.toBeInTheDocument();
  });

  it("shows mouse hints (not touch copy) on fine pointers", () => {
    mockPointer(false);
    render(<CheckersGame />);

    expect(
      screen.getByText("🖱️ Click a piece, then click where it goes")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("👆 Tap a piece, then tap where it goes")
    ).not.toBeInTheDocument();
  });

  it("starts exactly once even when Play is mashed, and the overlay goes away", () => {
    render(<CheckersGame />);

    const play = screen.getByRole("button", { name: "▶ Play!" });
    fireEvent.click(play);
    fireEvent.click(play);

    expect(screen.queryByTestId("game-start-overlay")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Checkers" })
    ).not.toBeInTheDocument();
  });
});
