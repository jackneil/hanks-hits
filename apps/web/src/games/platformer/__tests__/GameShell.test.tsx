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

import { PlatformerGameShell } from "../PlatformerGameShell";
import { usePlatformerStore } from "../lib/store";

describe("PlatformerGameShell pause wiring", () => {
  beforeEach(() => {
    // Keep the game loop from ticking during assertions.
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    act(() => {
      usePlatformerStore.setState({ gameState: "ready" });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    act(() => {
      usePlatformerStore.setState({ gameState: "ready" });
    });
  });

  it("hides the shell pause button on the ready screen (canPause is gated)", () => {
    render(<PlatformerGameShell />);
    expect(
      screen.queryByRole("button", { name: "Pause game" })
    ).not.toBeInTheDocument();
  });

  it("adds a paused state and keeps the shell menu and game loop in lockstep", () => {
    act(() => {
      usePlatformerStore.setState({ gameState: "playing" });
    });
    render(<PlatformerGameShell />);

    // canPause -> the shell shows its pause button while playing.
    expect(
      screen.getByRole("button", { name: "Pause game" })
    ).toBeInTheDocument();
    expect(screen.queryByText("PAUSED")).not.toBeInTheDocument();

    // ESC freezes the game (new "paused" state) AND opens the shell menu. Before
    // this, the player kept running/dying behind the menu because there was no
    // paused state at all.
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(usePlatformerStore.getState().gameState).toBe("paused");
    expect(screen.getByText("PAUSED")).toBeInTheDocument();

    // ESC again resumes both in lockstep (onResume wired).
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(usePlatformerStore.getState().gameState).toBe("playing");
    expect(screen.queryByText("PAUSED")).not.toBeInTheDocument();
  });
});
