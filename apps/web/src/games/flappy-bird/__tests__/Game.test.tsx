import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FlappyBirdGame } from "../Game";
import { useFlappyStore } from "../lib/store";

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

/**
 * The global setup installs a matchMedia stub that always returns
 * matches: false. This swaps in one where "(pointer: coarse)" resolves to the
 * requested value so we can simulate touch vs keyboard/mouse viewports.
 */
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
  // The canvas render loop is irrelevant to the start screen.
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  localStorage.clear();
  // A zustand set() swaps the state object, so a spy installed on the old one
  // survives restoreAllMocks and its call count would leak across tests.
  vi.clearAllMocks();
  useFlappyStore.setState({ gameState: "ready" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  mockPointer(false);
});

describe("FlappyBirdGame start overlay", () => {
  it("shows the shared overlay with the title exactly once", () => {
    render(<FlappyBirdGame />);

    expect(screen.getByTestId("game-start-overlay")).toBeInTheDocument();
    expect(
      screen.getAllByRole("heading", { name: "Flappy Bird" })
    ).toHaveLength(1);
    expect(screen.getAllByText("Flappy Bird")).toHaveLength(1);
  });

  it("shows touch hints (not keyboard copy) on coarse pointers", () => {
    mockPointer(true);
    render(<FlappyBirdGame />);

    expect(screen.getByText("👆 Tap to flap")).toBeInTheDocument();
    expect(screen.queryByText("⌨️ Space to flap")).not.toBeInTheDocument();
  });

  it("shows keyboard hints (not touch copy) on fine pointers", () => {
    mockPointer(false);
    render(<FlappyBirdGame />);

    expect(screen.getByText("⌨️ Space to flap")).toBeInTheDocument();
    expect(screen.queryByText("👆 Tap to flap")).not.toBeInTheDocument();
  });

  it("starts the game exactly once however hard Play is mashed", () => {
    const startGame = vi.spyOn(useFlappyStore.getState(), "startGame");
    render(<FlappyBirdGame />);

    const play = screen.getByRole("button", { name: /play/i });
    fireEvent.click(play);
    fireEvent.click(play);

    expect(startGame).toHaveBeenCalledTimes(1);
    expect(useFlappyStore.getState().gameState).toBe("playing");
  });

  it("removes the overlay once the game is playing", () => {
    render(<FlappyBirdGame />);

    fireEvent.click(screen.getByRole("button", { name: /play/i }));

    expect(screen.queryByTestId("game-start-overlay")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Flappy Bird" })
    ).not.toBeInTheDocument();
  });
});
