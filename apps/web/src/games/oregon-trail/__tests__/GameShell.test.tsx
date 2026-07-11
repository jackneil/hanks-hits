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

// OregonTrailGame mounts useAuthSync (next-auth's useSession under the hood),
// which needs a provider we don't mount. Stub it to guest.
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

import { OregonTrailGameShell } from "../OregonTrailGameShell";
import { useOregonTrailStore } from "../lib/store";
import { useHuntPauseStore } from "../lib/huntPause";

const huntingSupplies = {
  food: 100,
  oxen: 4,
  clothing: 10,
  ammunition: 50,
  spareParts: { wheels: 1, axles: 1, tongues: 1 },
  money: 100,
};

describe("OregonTrailGameShell pause wiring (hunting minigame)", () => {
  beforeEach(() => {
    // Keep the hunt's animation loop from ticking during assertions.
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    act(() => {
      useOregonTrailStore.setState({ gamePhase: "title" });
      useHuntPauseStore.setState({ paused: false });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    act(() => {
      useOregonTrailStore.setState({ gamePhase: "title" });
      useHuntPauseStore.setState({ paused: false });
    });
  });

  it("hides the shell pause button outside the hunt (canPause is gated to hunting)", () => {
    render(<OregonTrailGameShell />);
    expect(
      screen.queryByRole("button", { name: "Pause game" })
    ).not.toBeInTheDocument();
  });

  it("wires the shell's ESC/pause to the hunt's freeze flag and keeps them in sync", () => {
    act(() => {
      useOregonTrailStore.setState({
        gamePhase: "hunting",
        supplies: huntingSupplies,
      });
    });
    render(<OregonTrailGameShell />);

    // canPause -> the shell shows its pause button during the hunt.
    expect(
      screen.getByRole("button", { name: "Pause game" })
    ).toBeInTheDocument();
    expect(screen.queryByText("PAUSED")).not.toBeInTheDocument();
    expect(useHuntPauseStore.getState().paused).toBe(false);

    // ESC opens the shell's pause menu AND freezes the hunt (onPause wired).
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useHuntPauseStore.getState().paused).toBe(true);
    expect(screen.getByText("PAUSED")).toBeInTheDocument();

    // ESC again resumes both in lockstep (onResume wired).
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useHuntPauseStore.getState().paused).toBe(false);
    expect(screen.queryByText("PAUSED")).not.toBeInTheDocument();
  });
});
