import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EndlessRunnerGame } from "../Game";
import { useEndlessRunnerStore } from "../lib/store";
import { getInstructionLines } from "../lib/instructions";
import { mockPointer } from "@/__tests__/pointer-mock";

// useAuthSync pulls in next-auth's useSession, which needs a provider we don't
// mount in unit tests. Stub it with the shape the game destructures.
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

vi.mock("@/shared/components/OrientationWarning", () => ({
  OrientationWarning: () => null,
}));

beforeEach(() => {
  // The canvas render loop is irrelevant to the start screen.
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  localStorage.clear();
  // A zustand set() swaps the state object, so a spy installed on the old one
  // survives restoreAllMocks and its call count would leak across tests.
  vi.clearAllMocks();
  useEndlessRunnerStore.setState({ gameState: "ready" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  mockPointer(false);
});

describe("EndlessRunnerGame start overlay", () => {
  it("shows the shared overlay with the title exactly once", () => {
    render(<EndlessRunnerGame />);

    expect(screen.getByTestId("game-start-overlay")).toBeInTheDocument();
    expect(
      screen.getAllByRole("heading", { name: "Endless Runner" })
    ).toHaveLength(1);
    expect(screen.getAllByText("Endless Runner")).toHaveLength(1);
  });

  it("shows the touch instruction lines on coarse pointers", () => {
    mockPointer(true);
    render(<EndlessRunnerGame />);

    for (const line of getInstructionLines(true)) {
      expect(screen.getByText(line)).toBeInTheDocument();
    }
    for (const line of getInstructionLines(false)) {
      expect(screen.queryByText(line)).not.toBeInTheDocument();
    }
  });

  it("shows the keyboard instruction lines on fine pointers", () => {
    mockPointer(false);
    render(<EndlessRunnerGame />);

    for (const line of getInstructionLines(false)) {
      expect(screen.getByText(line)).toBeInTheDocument();
    }
    for (const line of getInstructionLines(true)) {
      expect(screen.queryByText(line)).not.toBeInTheDocument();
    }
  });

  it("starts the run exactly once however hard Play is mashed", () => {
    const startGame = vi.spyOn(useEndlessRunnerStore.getState(), "startGame");
    render(<EndlessRunnerGame />);

    const play = screen.getByRole("button", { name: /play/i });
    fireEvent.click(play);
    fireEvent.click(play);

    expect(startGame).toHaveBeenCalledTimes(1);
    expect(useEndlessRunnerStore.getState().gameState).toBe("playing");
  });

  it("removes the overlay once the run is playing", () => {
    render(<EndlessRunnerGame />);

    fireEvent.click(screen.getByRole("button", { name: /play/i }));

    expect(screen.queryByTestId("game-start-overlay")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Endless Runner" })
    ).not.toBeInTheDocument();
  });

  it("ignores a space press while the overlay is up", () => {
    const startGame = vi.spyOn(useEndlessRunnerStore.getState(), "startGame");
    render(<EndlessRunnerGame />);

    fireEvent.keyDown(window, { code: "Space" });

    expect(startGame).not.toHaveBeenCalled();
    expect(useEndlessRunnerStore.getState().gameState).toBe("ready");
  });
});
