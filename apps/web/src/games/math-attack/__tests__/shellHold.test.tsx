import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MathAttackGame } from "../Game";
import { useMathAttackStore } from "../lib/store";
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
// Math Attack lost two lives in a 25 s background. The shell's hold
// reached no game that cannot pause, and the loop took the frame after
// the background as one giant step, so every problem hit the ground.

let raf: RafMock;
let restoreContext: () => void;

beforeEach(() => {
  raf = installRafMock();
  restoreContext = installNoop2dContext();
  localStorage.clear();
  useMathAttackStore.getState().reset();
  useMathAttackStore.setState({
    settings: { ...useMathAttackStore.getState().settings, difficulty: "8yo" },
  });
});

afterEach(() => {
  restoreContext();
  uninstallRafMock();
  useMathAttackStore.getState().reset();
});

function Game({ held }: { held: boolean }) {
  return (
    <ShellHoldContext.Provider value={held}>
      <MathAttackGame />
    </ShellHoldContext.Provider>
  );
}

const lives = () => useMathAttackStore.getState().lives;

describe("Math Attack under the shell's hold", () => {
  it("runs no frame and loses no life while the shell holds it, and plays on when it is free", () => {
    const { rerender } = render(<Game held={false} />);
    act(() => useMathAttackStore.getState().startGame(3));
    expect(lives()).toBe(3);

    rerender(<Game held />);
    // The shared loop keeps drawing under the hold but runs no game time:
    // a minute under it lands nothing.
    raf.runFor(60_000, 60, act);
    expect(lives(), "no problem lands under the hold").toBe(3);
    expect(useMathAttackStore.getState().gameState).toBe("playing");

    // Free again: the problems fall and, unanswered, land.
    rerender(<Game held={false} />);
    raf.runFor(60_000, 60, act);
    expect(lives()).toBeLessThan(3);
  });

  it("takes a frame after a stall as 50 ms at most (the shared loop's clamp), so nothing lands at once", () => {
    render(<Game held={false} />);
    act(() => useMathAttackStore.getState().startGame(3));
    // The first problem is on screen.
    raf.runFor(1000, 60, act);
    expect(lives()).toBe(3);

    // A stall as long as a background (the tab was throttled, not hidden).
    raf.stall(60_000);
    act(() => {
      raf.nextFrame(60);
    });
    expect(lives(), "one frame after a stall moves a problem by 50 ms of game time, never to the ground").toBe(3);
  });
});
