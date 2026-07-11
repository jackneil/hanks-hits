import { render, screen, act, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Space Invaders builds an AudioContext at module load. jsdom has none, so stub
// it BEFORE the Game module is imported (vi.hoisted runs above imports).
vi.hoisted(() => {
  class MockAudioContext {}
  Object.defineProperty(globalThis, "AudioContext", {
    writable: true,
    configurable: true,
    value: MockAudioContext,
  });
});

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

import { SpaceInvadersGameShell } from "../SpaceInvadersGameShell";
import { useSpaceInvadersStore } from "../lib/store";

describe("SpaceInvadersGameShell pause wiring", () => {
  beforeEach(() => {
    // Keep the game loop from ticking during assertions.
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    act(() => {
      useSpaceInvadersStore.setState({ gameState: "ready" });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    act(() => {
      useSpaceInvadersStore.setState({ gameState: "ready" });
    });
  });

  it("hides the shell pause button on the ready screen (canPause is gated)", () => {
    render(<SpaceInvadersGameShell />);
    expect(
      screen.queryByRole("button", { name: "Pause game" })
    ).not.toBeInTheDocument();
  });

  it("wires the shell's ESC/pause to the store and keeps the two in sync", () => {
    act(() => {
      useSpaceInvadersStore.setState({ gameState: "playing" });
    });
    render(<SpaceInvadersGameShell />);

    // canPause -> the shell shows its pause button while playing.
    expect(
      screen.getByRole("button", { name: "Pause game" })
    ).toBeInTheDocument();
    expect(screen.queryByText("PAUSED")).not.toBeInTheDocument();

    // ESC opens the shell's pause menu AND pauses the game (onPause wired).
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useSpaceInvadersStore.getState().gameState).toBe("paused");
    expect(screen.getByText("PAUSED")).toBeInTheDocument();

    // ESC again resumes both in lockstep (onResume wired). The old bug left the
    // game frozen after the menu closed.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useSpaceInvadersStore.getState().gameState).toBe("playing");
    expect(screen.queryByText("PAUSED")).not.toBeInTheDocument();
  });
});
