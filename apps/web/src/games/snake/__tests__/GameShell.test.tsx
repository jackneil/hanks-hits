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

import { SnakeGameShell } from "../SnakeGameShell";
import { useSnakeStore } from "../lib/store";

// Snake draws its own DOM "PAUSED" overlay while paused, so we assert the shell
// pause MENU via its unique "Press ESC to resume" hint instead of "PAUSED".
describe("SnakeGameShell pause wiring", () => {
  beforeEach(() => {
    act(() => {
      useSnakeStore.setState({ status: "idle" });
    });
  });

  afterEach(() => {
    act(() => {
      useSnakeStore.setState({ status: "idle" });
    });
  });

  it("hides the shell pause button on the idle screen (canPause is gated)", () => {
    render(<SnakeGameShell />);
    expect(
      screen.queryByRole("button", { name: "Pause game" })
    ).not.toBeInTheDocument();
  });

  it("wires the shell's ESC/pause to the store and keeps the two in sync", () => {
    act(() => {
      useSnakeStore.setState({ status: "playing" });
    });
    render(<SnakeGameShell />);

    // canPause -> the shell shows its pause button while playing, menu closed.
    expect(
      screen.getByRole("button", { name: "Pause game" })
    ).toBeInTheDocument();
    expect(screen.queryByText("Press ESC to resume")).not.toBeInTheDocument();

    // ESC opens the shell's pause menu AND pauses the game (onPause wired).
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useSnakeStore.getState().status).toBe("paused");
    expect(screen.getByText("Press ESC to resume")).toBeInTheDocument();

    // ESC again resumes both in lockstep (onResume wired). The old bug left the
    // game frozen after the menu closed.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useSnakeStore.getState().status).toBe("playing");
    expect(screen.queryByText("Press ESC to resume")).not.toBeInTheDocument();
  });
});
