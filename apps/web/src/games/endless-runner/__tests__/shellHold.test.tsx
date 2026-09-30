import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EndlessRunnerGame } from "../Game";
import { useEndlessRunnerStore } from "../lib/store";
import { installNoop2dContext } from "@/__tests__/noop-2d-context";
import { installRafMock, uninstallRafMock, type RafMock } from "@/__tests__/raf-mock";
import { ShellHoldContext } from "@/shared/hooks/useShellHold";

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

// Regression (phone UX audit 2026-09-29, S7; review of phone/foundation):
// the orientation tip held nothing for the Endless Runner, so on a phone
// held upright the run went on under "Turn your phone sideways" (37 m
// before the kid tapped Keep playing).

let raf: RafMock;
let restoreContext: () => void;

beforeEach(() => {
  raf = installRafMock();
  restoreContext = installNoop2dContext();
  localStorage.clear();
  useEndlessRunnerStore.getState().reset();
});

afterEach(() => {
  restoreContext();
  uninstallRafMock();
  useEndlessRunnerStore.getState().reset();
});

function Game({ held }: { held: boolean }) {
  return (
    <ShellHoldContext.Provider value={held}>
      <EndlessRunnerGame />
    </ShellHoldContext.Provider>
  );
}

const distance = () => useEndlessRunnerStore.getState().distance;

describe("Endless Runner under the shell's hold", () => {
  it("runs no distance while the shell holds it, then starts again from a fresh clock", () => {
    const { rerender } = render(<Game held={false} />);
    act(() => useEndlessRunnerStore.getState().startGame());
    raf.runFor(200, 60, act);
    expect(distance(), "the run moves while it is free").toBeGreaterThan(0);

    rerender(<Game held />);
    const atHold = distance();
    raf.runFor(3000, 60, act);
    expect(distance(), "no distance runs under the hold").toBe(atHold);
    expect(useEndlessRunnerStore.getState().gameState).toBe("playing");

    rerender(<Game held={false} />);
    raf.stall(30_000);
    act(() => {
      raf.nextFrame(60);
    });
    expect(distance(), "the seed frame moves nothing").toBe(atHold);
    act(() => {
      raf.nextFrame(60);
    });
    const firstStep = distance() - atHold;
    const afterFirst = distance();
    // The loop effect re-runs on each store change (render is a dependency),
    // so an update frame is followed by a seed frame: two frames make one
    // more step.
    raf.runFor(2000 / 60, 60, act);
    const nextStep = distance() - afterFirst;
    expect(firstStep).toBeGreaterThan(0);
    // The frame after the wait is one normal frame, like the one after it,
    // not thirty seconds of running at once.
    expect(firstStep).toBeLessThanOrEqual(nextStep * 1.5);
  });
});
