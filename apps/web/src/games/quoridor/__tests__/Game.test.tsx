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

import { QuoridorGame } from "../Game";

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

describe("Quoridor start overlay", () => {
  it("shows the shared overlay with the title exactly once", () => {
    render(<QuoridorGame />);

    expect(screen.getByTestId("game-start-overlay")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Quoridor" })).toHaveLength(1);
    expect(screen.getAllByText("Quoridor")).toHaveLength(1);
  });

  it("shows touch hints (not mouse copy) on coarse pointers", () => {
    mockPointer(true);
    render(<QuoridorGame />);

    expect(
      screen.getByText("👆 Tap your pawn, then tap a green dot")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("🖱️ Click your pawn, then click a green dot")
    ).not.toBeInTheDocument();
  });

  it("shows mouse hints (not touch copy) on fine pointers", () => {
    mockPointer(false);
    render(<QuoridorGame />);

    expect(
      screen.getByText("🖱️ Click your pawn, then click a green dot")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("👆 Tap your pawn, then tap a green dot")
    ).not.toBeInTheDocument();
  });

  it("starts exactly once even when Play is mashed, and the overlay goes away", () => {
    render(<QuoridorGame />);

    const play = screen.getByRole("button", { name: "▶ Play!" });
    fireEvent.click(play);
    fireEvent.click(play);

    expect(screen.queryByTestId("game-start-overlay")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Quoridor" })
    ).not.toBeInTheDocument();
  });
});
