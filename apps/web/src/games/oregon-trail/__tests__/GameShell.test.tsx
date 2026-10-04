import { render, screen, act, fireEvent } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

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
import { localWords } from "@/lib/local-words";
import { ownerBoundProgress } from "@/lib/owner-bound-progress";

beforeAll(async () => {
  localStorage.clear();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("BroadcastChannel", undefined);
  localWords.install();
  await ownerBoundProgress.updateSession("unauthenticated");
  await ownerBoundProgress.whenHydrated("oregon-trail-storage");
  await localWords.prepare("oregon-trail", localWords.captureLease()!);
});
afterAll(() => { ownerBoundProgress.revoke(); vi.unstubAllGlobals(); });

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
    act(() => {
      useOregonTrailStore.setState({ gamePhase: "title" });
      useHuntPauseStore.setState({ paused: false });
    });
  });

  it("restarts the current journey with its existing setup", () => {
    act(() => {
      useOregonTrailStore.getState().startGame("Hank", "carpenter", ["Scout", "Ranger"], "june");
      useOregonTrailStore.setState({
        gamePhase: "travel",
        party: useOregonTrailStore.getState().party.map((member, index) => index === 1 ? { ...member, health: "fair" } : member),
      });
    });
    render(<OregonTrailGameShell />);

    fireEvent.click(screen.getByRole("button", { name: /restart game/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm restart/i }));

    const state = useOregonTrailStore.getState();
    expect(state.gamePhase).toBe("store");
    expect(state.gameStarted).toBe(true);
    expect(state.leaderName).toBe("Hank");
    expect(state.occupation).toBe("carpenter");
    expect(state.departureMonth).toBe("june");
    expect(state.party.map((member) => member.name)).toEqual(["Scout", "Ranger"]);
  });

  it("starts the journey from the shared title-phase overlay, exactly once", () => {
    render(<OregonTrailGameShell />);

    // The title phase now renders the shared start overlay, with the game name
    // as its single heading.
    expect(screen.getByTestId("game-start-overlay")).toBeInTheDocument();
    expect(
      screen.getAllByRole("heading", { name: "The Oregon Trail" })
    ).toHaveLength(1);

    const start = screen.getByRole("button", { name: /start journey/i });
    fireEvent.click(start);
    fireEvent.click(start);

    expect(useOregonTrailStore.getState().gamePhase).toBe("setup_name");
    expect(screen.queryByTestId("game-start-overlay")).not.toBeInTheDocument();
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
    expect(screen.queryByText("Paused")).not.toBeInTheDocument();
    expect(useHuntPauseStore.getState().paused).toBe(false);

    // ESC opens the shell's pause menu AND freezes the hunt (onPause wired).
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useHuntPauseStore.getState().paused).toBe(true);
    expect(screen.getByText("Paused")).toBeInTheDocument();

    // ESC again resumes both in lockstep (onResume wired).
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useHuntPauseStore.getState().paused).toBe(false);
    expect(screen.queryByText("Paused")).not.toBeInTheDocument();
  });
});
