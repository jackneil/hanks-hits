/**
 * The game loop: one loop for the life of the page, a world update on every
 * frame, at the pace of STEP_MS whatever the screen's refresh rate.
 * Regression (review 2026-10-02): the loop effect depended on the drawing,
 * which changed on every step, so the loop started again after each update.
 * Every other frame then only drew (the run moved in 30 Hz jerks), and a
 * store write on every frame froze the run (8 m in 40 s).
 */
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EndlessRunnerGame } from "../Game";
import { SCORING, SPEED, STEP_MS } from "../lib/constants";
import { useEndlessRunnerStore } from "../lib/store";
import { installNoop2dContext } from "@/__tests__/noop-2d-context";
import { installRafMock, uninstallRafMock, type RafMock } from "@/__tests__/raf-mock";

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({ isAuthenticated: false, isGuest: true, syncStatus: "idle", lastSynced: null, forceSync: vi.fn() }),
}));
vi.mock("@/shared/components/IOSInstallPrompt", () => ({ IOSInstallPrompt: () => null }));

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

const distance = () => useEndlessRunnerStore.getState().distance;

/** Mount the game, start a run, and run the seed frame (it starts the clock and moves nothing). */
function startRun(hz: number) {
  render(<EndlessRunnerGame />);
  act(() => useEndlessRunnerStore.getState().startGame());
  act(() => {
    raf.nextFrame(hz);
  });
  expect(distance(), "the seed frame moves nothing").toBe(0);
}

/** The distance one second of play covers at the starting speed: 1000 / STEP_MS steps. */
const ONE_SECOND = (1000 / STEP_MS) * SPEED.INITIAL * SCORING.DISTANCE_MULTIPLIER;

describe("Endless Runner game loop", () => {
  it("moves the world on every frame and never starts the loop again", () => {
    startRun(60);
    const cancelsBefore = raf.cancelCount();
    const requestsBefore = raf.requestCount();
    let before = distance();
    for (let i = 0; i < 60; i++) {
      act(() => {
        raf.nextFrame(60);
      });
      expect(distance(), `frame ${i + 1} moves the world`).toBeGreaterThan(before);
      before = distance();
    }
    expect(raf.cancelCount() - cancelsBefore, "the loop is never cancelled and started again").toBe(0);
    expect(raf.requestCount() - requestsBefore, "one frame request per frame").toBe(60);
    expect(useEndlessRunnerStore.getState().gameState).toBe("playing");
  });

  for (const hz of [60, 120, 144]) {
    it(`keeps the pace of one step per STEP_MS on a ${hz} Hz screen`, () => {
      startRun(hz);
      raf.runFor(1000, hz, act);
      // The speed rises a little during the second: 0.03 at most.
      expect(distance()).toBeGreaterThanOrEqual(ONE_SECOND);
      expect(distance()).toBeLessThan(ONE_SECOND * 1.01);
    });
  }

  it("keeps running when the store changes on every frame", () => {
    startRun(60);
    raf.runFor(1000, 60, (runFrame) =>
      act(() => {
        // Something the page shows changes every frame (like a held key's repeats).
        useEndlessRunnerStore.setState((s) => ({ coinsThisRun: s.coinsThisRun + 1 }));
        runFrame();
      }),
    );
    expect(distance()).toBeGreaterThanOrEqual(ONE_SECOND);
  });
});
