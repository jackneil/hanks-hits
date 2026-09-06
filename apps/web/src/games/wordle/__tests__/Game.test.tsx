import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WordleGame } from "../Game";
import { useWordleStore } from "../lib/store";

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
  useWordleStore.setState({
    gameState: "ready",
    showTutorial: false,
    settings: { ...useWordleStore.getState().settings, difficulty: "8yo" },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  mockPointer(false);
});

describe("Wordle start overlay", () => {
  it("shows the shared overlay with the title exactly once", () => {
    render(<WordleGame />);

    expect(screen.getByTestId("game-start-overlay")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Wordle" })).toHaveLength(1);
    expect(screen.getAllByText("Wordle")).toHaveLength(1);
  });

  it("shows touch hints (not keyboard copy) on coarse pointers", () => {
    mockPointer(true);
    render(<WordleGame />);

    expect(
      screen.getByText("🔤 Tap the letters to spell a word")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("🔤 Type letters to spell a word")
    ).not.toBeInTheDocument();
  });

  it("shows keyboard hints (not touch copy) on fine pointers", () => {
    mockPointer(false);
    render(<WordleGame />);

    expect(
      screen.getByText("🔤 Type letters to spell a word")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("🔤 Tap the letters to spell a word")
    ).not.toBeInTheDocument();
  });

  it("starts the game exactly once however hard Play is mashed", () => {
    const startGame = vi.spyOn(useWordleStore.getState(), "startGame");
    render(<WordleGame />);

    const play = screen.getByRole("button", { name: /start game/i });
    fireEvent.click(play);
    fireEvent.click(play);

    expect(startGame).toHaveBeenCalledTimes(1);
    expect(useWordleStore.getState().gameState).toBe("playing");
  });

  it("removes the overlay once the game is playing", () => {
    render(<WordleGame />);

    fireEvent.click(screen.getByRole("button", { name: /start game/i }));

    expect(screen.queryByTestId("game-start-overlay")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Wordle" })
    ).not.toBeInTheDocument();
  });

  it("picks the age from the overlay", () => {
    render(<WordleGame />);

    const pick = screen.getByRole("button", { name: "👶 4yo" });
    expect(pick).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(pick);

    expect(useWordleStore.getState().settings.difficulty).toBe("4yo");
    expect(screen.getByRole("button", { name: "👶 4yo" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("opens the tutorial from the overlay's How to Play button", () => {
    render(<WordleGame />);

    fireEvent.click(screen.getByRole("button", { name: /how to play/i }));

    expect(useWordleStore.getState().showTutorial).toBe(true);
  });
});
