import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FlappyBirdGame } from "../Game";
import { useFlappyStore } from "../lib/store";
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
// the orientation tip held nothing for Flappy Bird, so on a phone held
// sideways the run started under "Turn your phone upright" and the bird
// hit the floor before the kid could tap Keep playing.

let raf: RafMock;
let restoreContext: () => void;

beforeEach(() => {
  raf = installRafMock();
  restoreContext = installNoop2dContext();
  localStorage.clear();
  useFlappyStore.getState().reset();
});

afterEach(() => {
  restoreContext();
  uninstallRafMock();
  useFlappyStore.getState().reset();
});

function Game({ held }: { held: boolean }) {
  return (
    <ShellHoldContext.Provider value={held}>
      <FlappyBirdGame />
    </ShellHoldContext.Provider>
  );
}

const birdY = () => useFlappyStore.getState().bird.y;

describe("Flappy Bird under the shell's hold", () => {
  it("lets no game time pass while the shell holds it, then starts again from a fresh clock", () => {
    const { rerender } = render(<Game held={false} />);
    act(() => useFlappyStore.getState().startGame());
    const start = birdY();
    raf.runFor(200, 60, act);
    expect(birdY(), "the run moves while it is free").not.toBe(start);

    rerender(<Game held />);
    const atHold = birdY();
    raf.runFor(3000, 60, act);
    expect(birdY(), "the bird hangs where it was under the hold").toBe(atHold);
    expect(useFlappyStore.getState().gameState).toBe("playing");

    // The hold ends after a long time: the first frame is a seed frame, and
    // the next one is one normal step, never the whole wait at once.
    rerender(<Game held={false} />);
    raf.stall(30_000);
    act(() => {
      raf.nextFrame(60);
    });
    expect(birdY(), "the seed frame moves nothing").toBe(atHold);
    act(() => {
      raf.nextFrame(60);
    });
    const firstStep = Math.abs(birdY() - atHold);
    const afterFirst = birdY();
    // The loop effect re-runs on each store change (render is a dependency),
    // so an update frame is followed by a seed frame: two frames make one
    // more step.
    raf.runFor(2000 / 60, 60, act);
    const nextStep = Math.abs(birdY() - afterFirst);
    expect(firstStep).toBeGreaterThan(0);
    // The frame after the wait is one normal frame of fall, like the one
    // after it (gravity makes the next one larger), not thirty seconds.
    expect(firstStep).toBeLessThanOrEqual(nextStep * 1.5);
  });
});
