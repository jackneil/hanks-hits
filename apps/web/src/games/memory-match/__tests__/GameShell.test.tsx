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

import { MemoryMatchGameShell } from "../MemoryMatchGameShell";
import { useMemoryMatchStore } from "../lib/store";

describe("MemoryMatchGameShell pause wiring", () => {
  beforeEach(() => {
    act(() => {
      useMemoryMatchStore.setState({
        isPlaying: false,
        isWon: false,
        timeStarted: null,
        pausedAt: null,
      });
    });
  });

  afterEach(() => {
    act(() => {
      useMemoryMatchStore.setState({
        isPlaying: false,
        isWon: false,
        timeStarted: null,
        pausedAt: null,
      });
    });
  });

  it("hides the shell pause button before the round starts (canPause gated)", () => {
    render(<MemoryMatchGameShell />);
    // The mount effect calls newGame(), so isPlaying is false here.
    expect(
      screen.queryByRole("button", { name: "Pause game" })
    ).not.toBeInTheDocument();
  });

  it("wires the shell's ESC/pause to the round timer and keeps them in sync", () => {
    render(<MemoryMatchGameShell />);

    // Simulate a round in progress (mount's newGame() reset isPlaying to false).
    act(() => {
      useMemoryMatchStore.setState({
        isPlaying: true,
        isWon: false,
        timeStarted: Date.now() - 5000,
        pausedAt: null,
      });
    });

    // canPause -> the shell shows its pause button mid-round, timer running.
    expect(
      screen.getByRole("button", { name: "Pause game" })
    ).toBeInTheDocument();
    expect(screen.queryByText("PAUSED")).not.toBeInTheDocument();
    expect(useMemoryMatchStore.getState().pausedAt).toBeNull();

    // ESC opens the shell's pause menu AND pauses the timer (onPause wired).
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useMemoryMatchStore.getState().pausedAt).not.toBeNull();
    expect(screen.getByText("PAUSED")).toBeInTheDocument();

    // ESC again resumes both in lockstep (onResume wired): the timer un-pauses
    // and the game keeps playing.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useMemoryMatchStore.getState().pausedAt).toBeNull();
    expect(useMemoryMatchStore.getState().isPlaying).toBe(true);
    expect(screen.queryByText("PAUSED")).not.toBeInTheDocument();
  });

  it("excludes the paused span from the recorded time (timeStarted shifts on resume)", () => {
    // The timer is wall-clock anchored (elapsed = now - timeStarted), so
    // resumeTimer MUST slide timeStarted forward by the paused span — a
    // resume that only clears pausedAt would silently inflate bestTime.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      useMemoryMatchStore.setState({
        isPlaying: true,
        isWon: false,
        timeStarted: Date.now(),
        pausedAt: null,
      });

      // Play 10s, then pause for 30s, then resume.
      vi.advanceTimersByTime(10_000);
      const startedBeforePause = useMemoryMatchStore.getState().timeStarted!;
      useMemoryMatchStore.getState().pauseTimer();
      vi.advanceTimersByTime(30_000);
      useMemoryMatchStore.getState().resumeTimer();

      const state = useMemoryMatchStore.getState();
      expect(state.pausedAt).toBeNull();
      // timeStarted slid forward by exactly the 30s paused span...
      expect(state.timeStarted).toBe(startedBeforePause + 30_000);
      // ...so the elapsed time still reads 10s of actual play.
      expect(state.currentTime).toBe(10_000);
    } finally {
      vi.useRealTimers();
    }
  });
});
