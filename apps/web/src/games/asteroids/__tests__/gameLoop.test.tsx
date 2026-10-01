import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installNoop2dContext } from "@/__tests__/noop-2d-context";
import { installRafMock, uninstallRafMock, type RafMock } from "@/__tests__/raf-mock";

import { AsteroidsGame } from "../Game";
import { useAsteroidsStore } from "../lib/store";

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({ isAuthenticated: false, isGuest: true, syncStatus: "idle", lastSynced: null, forceSync: vi.fn() }),
}));
vi.mock("@/shared/components/IOSInstallPrompt", () => ({ IOSInstallPrompt: () => null }));

// The game runs on the shared fixed-step loop (useGameLoop). Before, the
// store's per-frame update ran once per screen frame, so a 120 Hz phone
// played at double speed, and the loop effect restarted on every store
// change. Now: 60 steps of game time each second on any screen, no steps
// between rounds or under the shell's hold (the store's paused state), and
// a fresh clock after a pause, so no burst of steps catches up.

let raf: RafMock;
let restoreContext: () => void;

beforeEach(() => {
  raf = installRafMock();
  restoreContext = installNoop2dContext();
  localStorage.clear();
  act(() => {
    useAsteroidsStore.setState({ status: "ready" });
  });
});

afterEach(() => {
  restoreContext();
  uninstallRafMock();
  act(() => {
    useAsteroidsStore.setState({ status: "ready" });
  });
});

/** The steps the store took: with no rotation, the ship's angle is one measure; shootCooldown another. Count update calls directly. */
function countUpdates() {
  const real = useAsteroidsStore.getState().update;
  const calls = { n: 0 };
  useAsteroidsStore.setState({
    update: () => {
      calls.n += 1;
      real();
    },
  });
  return calls;
}

describe("the Asteroids game loop", () => {
  it.each([60, 120])("takes 60 steps a second on a %d Hz screen while a round plays", (hz) => {
    const calls = countUpdates();
    render(<AsteroidsGame />);
    act(() => useAsteroidsStore.getState().startGame());
    act(() => {
      raf.nextFrame(hz); // the seed frame starts the clock
    });
    raf.runFor(1000, hz, act);
    expect(calls.n).toBe(60);
  });

  it("takes no step on the start card, at game over, or while the store is paused, and starts again from a fresh clock", () => {
    const calls = countUpdates();
    render(<AsteroidsGame />);
    act(() => {
      raf.nextFrame(60);
    });
    raf.runFor(500, 60, act);
    expect(calls.n, "the start card: no game time passes").toBe(0);

    act(() => useAsteroidsStore.getState().startGame());
    raf.runFor(500, 60, act);
    const inPlay = calls.n;
    expect(inPlay).toBeGreaterThan(20);

    // The shell's pause (the pause menu, or a hold under an overlay).
    act(() => useAsteroidsStore.getState().pauseGame());
    raf.stall(30_000);
    raf.runFor(1000, 60, act);
    expect(calls.n, "no step under the pause").toBe(inPlay);

    act(() => useAsteroidsStore.getState().resumeGame());
    raf.stall(30_000);
    act(() => {
      raf.nextFrame(60);
    });
    expect(calls.n, "the resume frame only restarts the clock").toBe(inPlay);
    raf.runFor(1000, 60, act);
    expect(calls.n, "then one second of play is 60 steps, not the 30 s of the stall").toBe(inPlay + 60);

    act(() => useAsteroidsStore.getState().gameOver());
    raf.runFor(500, 60, act);
    expect(calls.n, "game over: no game time passes").toBe(inPlay + 60);
  });

  it("keeps one key listener through a round (it was re-added on every frame)", () => {
    const added = vi.spyOn(window, "addEventListener");
    const keydowns = () => added.mock.calls.filter(([type]) => type === "keydown").length;
    render(<AsteroidsGame />);
    act(() => useAsteroidsStore.getState().startGame());
    act(() => {
      raf.nextFrame(60);
    });
    const atStart = keydowns();
    raf.runFor(500, 60, act);
    expect(keydowns()).toBe(atStart);
    // The listener reads the store when a key goes down, so it still steers.
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowLeft" }));
    });
    expect(useAsteroidsStore.getState().rotatingLeft).toBe(true);
    added.mockRestore();
  });

  it("lets go of a held input when the round stops, so the next round starts still", () => {
    render(<AsteroidsGame />);
    act(() => useAsteroidsStore.getState().startGame());
    act(() => useAsteroidsStore.getState().setInput({ thrusting: true, shooting: true }));
    act(() => useAsteroidsStore.getState().gameOver());
    const { thrusting, shooting } = useAsteroidsStore.getState();
    expect({ thrusting, shooting }).toEqual({ thrusting: false, shooting: false });
  });
});
