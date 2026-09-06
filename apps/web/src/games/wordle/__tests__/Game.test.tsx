import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WordleGame } from "../Game";
import { useWordleStore } from "../lib/store";
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

describe("wordle spoken choices", () => {
  it("says the picker choices out loud, so a kid who cannot read hears them", () => {
    const speech = installSpeechMock();
    render(<WordleGame  />);

    fireEvent.click(screen.getByTestId("read-aloud-button"));

    const spoken = speech.lastUtterance().text;
    expect(spoken).toContain("4 years old");
    expect(spoken).toContain("8 years old");
    expect(spoken).toContain("12 years old");
    expect(spoken).toContain("24 years old");
    expect(spoken).toContain("99 years old");
    expect(spoken).toContain("How to Play");
    removeSpeechMock();
  });
});

describe("wordle age picker layout", () => {
  it("gives the odd last age the full width, so no half cell dangles", () => {
    render(<WordleGame  />);

    const buttons = screen
      .getAllByRole("button")
      .filter((b) => /years old|^\S+ \d+yo$|\d+yo/.test(b.textContent ?? ""));
    const grid = screen.getByText("How old are you?").nextElementSibling!;
    expect(grid.className).toContain("grid-cols-2");

    const cells = Array.from(grid.children);
    expect(cells.length % 2).toBe(1);
    expect(cells[cells.length - 1].className).toContain("col-span-2");
    cells.slice(0, -1).forEach((cell) => {
      expect(cell.className).not.toContain("col-span-2");
    });
    expect(buttons.length).toBeGreaterThan(0);
  });
});
