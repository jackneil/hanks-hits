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

import { AsteroidsGameShell } from "../AsteroidsGameShell";
import { useAsteroidsStore } from "../lib/store";

describe("AsteroidsGameShell pause wiring", () => {
  beforeEach(() => {
    // Keep the game loop from ticking during assertions.
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    act(() => {
      useAsteroidsStore.setState({ status: "ready" });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    act(() => {
      useAsteroidsStore.setState({ status: "ready" });
    });
  });

  it("hides the shell pause button on the ready screen (canPause is gated)", () => {
    render(<AsteroidsGameShell />);
    expect(
      screen.queryByRole("button", { name: "Pause game" })
    ).not.toBeInTheDocument();
  });

  it("wires the shell's ESC/pause to the store and keeps the two in sync", () => {
    act(() => {
      useAsteroidsStore.setState({ status: "playing" });
    });
    render(<AsteroidsGameShell />);

    expect(
      screen.getByRole("button", { name: "Pause game" })
    ).toBeInTheDocument();
    expect(screen.queryByText("PAUSED")).not.toBeInTheDocument();

    // ESC opens the shell's pause menu AND pauses the game (onPause wired).
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useAsteroidsStore.getState().status).toBe("paused");
    expect(screen.getByText("PAUSED")).toBeInTheDocument();

    // ESC again resumes both in lockstep (onResume wired).
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useAsteroidsStore.getState().status).toBe("playing");
    expect(screen.queryByText("PAUSED")).not.toBeInTheDocument();
  });
});
