import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BreakoutGame } from "../Game";
import { useBreakoutStore } from "../lib/store";

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
  useBreakoutStore.setState({ status: "idle" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  mockPointer(false);
});

describe("BreakoutGame start overlay", () => {
  it("shows the shared overlay with the title exactly once", () => {
    render(<BreakoutGame />);

    expect(screen.getByTestId("game-start-overlay")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Breakout" })).toHaveLength(1);
    expect(screen.getAllByText("Breakout")).toHaveLength(1);
  });

  it("mounts the overlay inside a positioned canvas box", () => {
    const { container } = render(<BreakoutGame />);

    const overlay = screen.getByTestId("game-start-overlay");
    expect(overlay.parentElement?.className).toContain("relative");
    expect(container.querySelector("canvas")).toBeInTheDocument();
  });

  it("shows touch hints (not keyboard copy) on coarse pointers", () => {
    mockPointer(true);
    render(<BreakoutGame />);

    expect(screen.getByText("👆 Tap to launch the ball")).toBeInTheDocument();
    expect(
      screen.queryByText("⌨️ Space to launch the ball")
    ).not.toBeInTheDocument();
  });

  it("shows keyboard hints (not touch copy) on fine pointers", () => {
    mockPointer(false);
    render(<BreakoutGame />);

    expect(screen.getByText("⌨️ Space to launch the ball")).toBeInTheDocument();
    expect(
      screen.queryByText("👆 Tap to launch the ball")
    ).not.toBeInTheDocument();
  });

  it("starts the game exactly once however hard Play is mashed", () => {
    const startGame = vi.spyOn(useBreakoutStore.getState(), "startGame");
    render(<BreakoutGame />);

    const play = screen.getByRole("button", { name: /play/i });
    fireEvent.click(play);
    fireEvent.click(play);

    expect(startGame).toHaveBeenCalledTimes(1);
    expect(useBreakoutStore.getState().status).toBe("playing");
  });

  it("removes the overlay once the game is playing", () => {
    render(<BreakoutGame />);

    fireEvent.click(screen.getByRole("button", { name: /play/i }));

    expect(screen.queryByTestId("game-start-overlay")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Breakout" })
    ).not.toBeInTheDocument();
  });

  it("ignores a space press while the overlay is up", () => {
    const startGame = vi.spyOn(useBreakoutStore.getState(), "startGame");
    render(<BreakoutGame />);

    fireEvent.keyDown(window, { key: " " });

    expect(startGame).not.toHaveBeenCalled();
    expect(useBreakoutStore.getState().status).toBe("idle");
  });
});
