import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DinoRunnerGame } from "../Game";
import { MAX_FRAME_MS, useDinoRunnerStore } from "../lib/store";
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

// Regression (phone UX audit 2026-09-29, S8; review of phone/foundation):
// the shell's hold reached no game that cannot pause, and the store took a
// frame after a 25 s background as one giant step.

let raf: RafMock;
let restoreContext: () => void;

beforeEach(() => {
  raf = installRafMock();
  restoreContext = installNoop2dContext();
  localStorage.clear();
  useDinoRunnerStore.getState().reset();
});

afterEach(() => {
  restoreContext();
  uninstallRafMock();
  useDinoRunnerStore.getState().reset();
});

function Game({ held }: { held: boolean }) {
  return (
    <ShellHoldContext.Provider value={held}>
      <DinoRunnerGame />
    </ShellHoldContext.Provider>
  );
}

const score = () => useDinoRunnerStore.getState().score;

describe("Dino Runner under the shell's hold", () => {
  it("scores nothing while the shell holds it, then starts again from a fresh clock", () => {
    const { rerender } = render(<Game held={false} />);
    act(() => useDinoRunnerStore.getState().startGame());
    raf.runFor(200, 60, act);
    expect(score(), "the run moves while it is free").toBeGreaterThan(0);

    rerender(<Game held />);
    const atHold = score();
    raf.runFor(3000, 60, act);
    expect(score(), "no score under the hold").toBe(atHold);
    expect(useDinoRunnerStore.getState().gameState).toBe("playing");

    rerender(<Game held={false} />);
    raf.stall(30_000);
    act(() => {
      raf.nextFrame(60);
    });
    expect(score(), "the seed frame moves nothing").toBe(atHold);
    act(() => {
      raf.nextFrame(60);
    });
    const firstStep = score() - atHold;
    const afterFirst = score();
    // The loop effect re-runs on each store change (render is a dependency),
    // so an update frame is followed by a seed frame: two frames make one
    // more step.
    raf.runFor(2000 / 60, 60, act);
    const nextStep = score() - afterFirst;
    expect(firstStep).toBeGreaterThan(0);
    expect(firstStep).toBeLessThanOrEqual(nextStep * 1.5);
  });
});

describe("Dino Runner update step", () => {
  it("covers MAX_FRAME_MS at most, so a frame after a stall is not one giant step", () => {
    const store = useDinoRunnerStore.getState();
    store.startGame();
    store.update(5000);
    const afterStall = useDinoRunnerStore.getState().score;

    useDinoRunnerStore.getState().reset();
    useDinoRunnerStore.getState().startGame();
    useDinoRunnerStore.getState().update(MAX_FRAME_MS);
    const afterOneStep = useDinoRunnerStore.getState().score;

    expect(afterStall).toBeGreaterThan(0);
    expect(afterStall).toBe(afterOneStep);
  });
});
