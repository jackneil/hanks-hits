import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HextrisGame } from "../Game";
import { useHextrisStore } from "../lib/store";
import { mockPointer } from "@/__tests__/pointer-mock";

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
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  localStorage.clear();
  useHextrisStore.setState({ status: "idle" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  mockPointer(false);
});

describe("Hextris start overlay", () => {
  it("shows the shared overlay with the title exactly once", () => {
    render(<HextrisGame />);

    expect(screen.getByTestId("game-start-overlay")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Hextris" })).toHaveLength(1);
    expect(screen.getAllByText("Hextris")).toHaveLength(1);
  });

  it("shows touch hints (not keyboard copy) on coarse pointers", () => {
    mockPointer(true);
    render(<HextrisGame />);

    expect(screen.getByText("👈 Tap the left side to spin left")).toBeInTheDocument();
    expect(
      screen.queryByText("⌨️ Press A or the left arrow to spin left")
    ).not.toBeInTheDocument();
  });

  it("shows keyboard hints (not touch copy) on fine pointers", () => {
    mockPointer(false);
    render(<HextrisGame />);

    expect(
      screen.getByText("⌨️ Press A or the left arrow to spin left")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("👈 Tap the left side to spin left")
    ).not.toBeInTheDocument();
  });

  it("starts the game exactly once however hard Play is mashed", () => {
    const startGame = vi.spyOn(useHextrisStore.getState(), "startGame");
    render(<HextrisGame />);

    const play = screen.getByRole("button", { name: /play/i });
    fireEvent.click(play);
    fireEvent.click(play);

    expect(startGame).toHaveBeenCalledTimes(1);
    expect(useHextrisStore.getState().status).toBe("playing");
  });

  it("removes the overlay once the game is playing", () => {
    render(<HextrisGame />);

    fireEvent.click(screen.getByRole("button", { name: /play/i }));

    expect(screen.queryByTestId("game-start-overlay")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Hextris" })).not.toBeInTheDocument();
  });

  it("does not start from a canvas tap or the space bar while idle", () => {
    const { container } = render(<HextrisGame />);
    const canvas = container.querySelector("canvas");

    fireEvent.click(canvas!);
    fireEvent.keyDown(window, { code: "Space" });

    expect(useHextrisStore.getState().status).toBe("idle");
    expect(screen.getByTestId("game-start-overlay")).toBeInTheDocument();
  });
});
