import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MathAttackGame } from "../Game";
import { useMathAttackStore } from "../lib/store";

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
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  localStorage.clear();
  vi.clearAllMocks();
  useMathAttackStore.setState({
    gameState: "ready",
    settings: { ...useMathAttackStore.getState().settings, difficulty: "8yo" },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  mockPointer(false);
});

describe("Math Attack start overlay", () => {
  it("shows the shared overlay with the title exactly once", () => {
    render(<MathAttackGame />);

    expect(screen.getByTestId("game-start-overlay")).toBeInTheDocument();
    expect(
      screen.getAllByRole("heading", { name: "Math Attack" })
    ).toHaveLength(1);
    expect(screen.getAllByText("Math Attack")).toHaveLength(1);
  });

  it("shows touch hints (not keyboard copy) on coarse pointers", () => {
    mockPointer(true);
    render(<MathAttackGame />);

    expect(
      screen.getByText("🔢 Tap the box and type the answer")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("⌨️ Type the answer with the number keys")
    ).not.toBeInTheDocument();
  });

  it("shows keyboard hints (not touch copy) on fine pointers", () => {
    mockPointer(false);
    render(<MathAttackGame />);

    expect(
      screen.getByText("⌨️ Type the answer with the number keys")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("🔢 Tap the box and type the answer")
    ).not.toBeInTheDocument();
  });

  it("starts the game exactly once however hard Play is mashed", () => {
    const startGame = vi.spyOn(useMathAttackStore.getState(), "startGame");
    render(<MathAttackGame />);

    const play = screen.getByRole("button", { name: /start game/i });
    fireEvent.click(play);
    fireEvent.click(play);

    expect(startGame).toHaveBeenCalledTimes(1);
    expect(useMathAttackStore.getState().gameState).toBe("playing");
  });

  it("removes the overlay once the game is playing", () => {
    render(<MathAttackGame />);

    fireEvent.click(screen.getByRole("button", { name: /start game/i }));

    expect(screen.queryByTestId("game-start-overlay")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Math Attack" })
    ).not.toBeInTheDocument();
  });

  it("picks the age from the overlay", () => {
    render(<MathAttackGame />);

    const pick = screen.getByRole("button", { name: "👶 4yo" });
    expect(pick).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(pick);

    expect(useMathAttackStore.getState().settings.difficulty).toBe("4yo");
    expect(
      screen.getByRole("button", { name: "👶 4yo" })
    ).toHaveAttribute("aria-pressed", "true");
  });
});
