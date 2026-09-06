import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryMatchGame } from "../Game";
import { useMemoryMatchStore } from "../lib/store";

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
  vi.clearAllMocks();
  useMemoryMatchStore.setState({ difficulty: "medium" });
});

afterEach(() => {
  vi.restoreAllMocks();
  mockPointer(false);
});

describe("Memory Match start overlay", () => {
  it("shows the shared overlay with the title exactly once", () => {
    render(<MemoryMatchGame />);

    expect(screen.getByTestId("game-start-overlay")).toBeInTheDocument();
    expect(
      screen.getAllByRole("heading", { name: "Memory Match" })
    ).toHaveLength(1);
    expect(screen.getAllByText("Memory Match")).toHaveLength(1);
  });

  it("shows touch hints (not mouse copy) on coarse pointers", () => {
    mockPointer(true);
    render(<MemoryMatchGame />);

    expect(screen.getByText("👆 Tap a card to flip it")).toBeInTheDocument();
    expect(
      screen.queryByText("🖱️ Click a card to flip it")
    ).not.toBeInTheDocument();
  });

  it("shows mouse hints (not touch copy) on fine pointers", () => {
    mockPointer(false);
    render(<MemoryMatchGame />);

    expect(screen.getByText("🖱️ Click a card to flip it")).toBeInTheDocument();
    expect(screen.queryByText("👆 Tap a card to flip it")).not.toBeInTheDocument();
  });

  it("holds the cards still until Play is pressed", () => {
    render(<MemoryMatchGame />);

    const card = screen.getAllByRole("button", { name: "Hidden card" })[0];
    expect(card).toBeDisabled();

    fireEvent.click(card);
    expect(useMemoryMatchStore.getState().cards.some((c) => c.isFlipped)).toBe(
      false
    );
  });

  it("starts the game exactly once however hard Play is mashed, then flips", () => {
    render(<MemoryMatchGame />);

    const play = screen.getByRole("button", { name: /play/i });
    fireEvent.click(play);
    fireEvent.click(play);

    expect(screen.queryByTestId("game-start-overlay")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Memory Match" })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Hidden card" })[0]);
    expect(useMemoryMatchStore.getState().cards.some((c) => c.isFlipped)).toBe(
      true
    );
  });

  it("picks the difficulty from the overlay", () => {
    render(<MemoryMatchGame />);

    const overlay = screen.getByTestId("game-start-overlay");
    const easy = within(overlay).getByRole("button", { name: "Easy" });
    expect(easy).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(easy);

    expect(useMemoryMatchStore.getState().difficulty).toBe("easy");
    expect(
      within(screen.getByTestId("game-start-overlay")).getByRole("button", {
        name: "Easy",
      })
    ).toHaveAttribute("aria-pressed", "true");
  });
});
