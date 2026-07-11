import { render, screen, act, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The GameShell reads useRouter (via useGameShell.goHome); jsdom has no Next
// app-router context, so stub it.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
}));

// useAuthSync -> useSession needs a SessionProvider we don't mount in tests.
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

import { BombermanGameShell } from "../BombermanGameShell";
import { useBombermanStore } from "../lib/store";

describe("BombermanGameShell pause wiring", () => {
  beforeEach(() => {
    // Keep the game loop from ticking during assertions.
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    act(() => {
      useBombermanStore.getState().resetGame();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    act(() => {
      useBombermanStore.getState().resetGame();
    });
  });

  it("hides the shell pause button on the menu screen (canPause is gated)", () => {
    render(<BombermanGameShell />);
    expect(
      screen.queryByRole("button", { name: "Pause game" })
    ).not.toBeInTheDocument();
  });

  it("wires the shell's ESC/pause to the store and keeps the two in sync", () => {
    act(() => {
      useBombermanStore.setState({ gameState: "playing" });
    });
    render(<BombermanGameShell />);

    expect(
      screen.getByRole("button", { name: "Pause game" })
    ).toBeInTheDocument();

    // ESC opens the shell's pause menu AND pauses the game (onPause wired). The
    // shell's PauseMenu renders the exact text "PAUSED" (the game's own overlay
    // reads "⏸️ PAUSED"), so this matches the shell menu specifically.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useBombermanStore.getState().gameState).toBe("paused");
    expect(screen.getByText("PAUSED")).toBeInTheDocument();

    // ESC again resumes both in lockstep (onResume wired).
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useBombermanStore.getState().gameState).toBe("playing");
    expect(screen.queryByText("PAUSED")).not.toBeInTheDocument();
  });
});
