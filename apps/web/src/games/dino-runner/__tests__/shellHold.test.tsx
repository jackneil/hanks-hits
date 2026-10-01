import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DinoRunnerGame } from "../Game";
import { MAX_FRAME_MS, useDinoRunnerStore } from "../lib/store";
import { installNoop2dContext } from "@/__tests__/noop-2d-context";
import { installRafMock, uninstallRafMock, type RafMock } from "@/__tests__/raf-mock";
import { ShellHoldContext } from "@/shared/hooks/useShellHold";
import { DEFAULT_FIXED_STEP_MS } from "@/shared/hooks/useGameLoop";

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
// frame after a 25 s background as one giant step. The game now runs on the
// shared fixed-step loop (useGameLoop): the hold pauses the steps, the
// resume frame only restarts the clock, and a long frame is clamped.

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
    expect(score(), "the resume frame only restarts the clock").toBe(atHold);
    act(() => {
      raf.nextFrame(60);
    });
    const firstStep = score() - atHold;
    const afterFirst = score();
    act(() => {
      raf.nextFrame(60);
    });
    const nextStep = score() - afterFirst;
    expect(firstStep).toBeGreaterThan(0);
    // One frame after the wait is one fixed step, like the frame after it:
    // never thirty seconds of running at once.
    expect(firstStep).toBeCloseTo(nextStep, 3);
  });

  it("runs one fixed step per 60 Hz frame, and the same game time per second on a 120 Hz screen", () => {
    const realUpdate = useDinoRunnerStore.getState().update;
    const update = vi.fn();
    try {
      render(<Game held={false} />);
      act(() => useDinoRunnerStore.getState().startGame());
      act(() => useDinoRunnerStore.setState({ update }));
      // The first frame of the run only starts the clock.
      act(() => {
        raf.nextFrame(60);
      });
      raf.runFor(1000, 60, act);
      const at60 = update.mock.calls.length;
      update.mockClear();
      raf.runFor(1000, 120, act);
      const at120 = update.mock.calls.length;
      expect(at60).toBe(60);
      expect(at120).toBe(60);
      expect(new Set(update.mock.calls.map((c) => c[0]))).toEqual(new Set([DEFAULT_FIXED_STEP_MS]));
    } finally {
      useDinoRunnerStore.setState({ update: realUpdate });
    }
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
