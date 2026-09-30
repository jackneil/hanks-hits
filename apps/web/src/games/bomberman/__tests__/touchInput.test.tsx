import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

import BombermanGame from "../Game";
import { useBombermanStore } from "../lib/store";
import { fingerCancel, fingerDown, fingerTap, fingerUp, liftAllFingers } from "@/__tests__/finger-mock";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";
import { installRafMock, uninstallRafMock, type RafMock } from "@/__tests__/raf-mock";

// Regression (2026 phone audit, bomberman): the bomb button carried
// onTouchStart AND onClick, so one tap placed two bombs (the second one
// swallowed by the maxBombs guard, a latent double); each d-pad button moved
// exactly one tile per touchstart, so crossing the arena took twenty taps.

let raf: RafMock;

beforeEach(() => {
  localStorage.clear();
  mockPointer(true);
  raf = installRafMock();
  act(() => {
    useBombermanStore.getState().resetGame();
    useBombermanStore.getState().startGame();
  });
});

afterEach(() => {
  liftAllFingers();
  uninstallRafMock();
  resetPointerMock();
  act(() => {
    useBombermanStore.getState().resetGame();
  });
});

describe("Bomberman touch input", () => {
  it("one tap on the bomb button places ONE bomb", () => {
    const placeBomb = vi.fn();
    act(() => {
      useBombermanStore.setState({ placeBomb });
    });
    render(<BombermanGame />);
    fingerTap(screen.getByRole("button", { name: "💣" }));
    expect(placeBomb).toHaveBeenCalledTimes(1);
  });

  it("holding a d-pad button keeps moving at the key repeat rate", () => {
    const movePlayer = vi.fn();
    act(() => {
      useBombermanStore.setState({ movePlayer });
    });
    render(<BombermanGame />);
    const right = screen.getByRole("button", { name: "▶" });
    fingerDown(right);
    raf.runFor(1000, 60, act);
    // MOVE_RATE is 120 ms: a 1 s hold is about eight moves.
    expect(movePlayer.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(movePlayer.mock.calls.every(([dir]) => dir === "RIGHT")).toBe(true);

    fingerUp(right);
    const afterRelease = movePlayer.mock.calls.length;
    raf.runFor(500, 60, act);
    expect(movePlayer.mock.calls.length).toBe(afterRelease);
  });

  it("moves at the key repeat rate even when the real clock is far ahead of the frame clock", () => {
    // Under machine load, performance.now() can run far ahead of the frame
    // timestamps. The loop used to seed its clock from performance.now(), so
    // the first delta was hugely negative and a held button barely moved.
    const now = vi.spyOn(performance, "now").mockReturnValue(1_000_000);
    const movePlayer = vi.fn();
    act(() => {
      useBombermanStore.setState({ movePlayer });
    });
    render(<BombermanGame />);
    fingerDown(screen.getByRole("button", { name: "▶" }));
    raf.runFor(1000, 60, act);
    expect(movePlayer.mock.calls.length).toBeGreaterThanOrEqual(5);
    now.mockRestore();
  });

  it("a cancelled touch on the d-pad stops the movement", () => {
    const movePlayer = vi.fn();
    act(() => {
      useBombermanStore.setState({ movePlayer });
    });
    render(<BombermanGame />);
    const up = screen.getByRole("button", { name: "▲" });
    fingerDown(up);
    raf.runFor(300, 60, act);
    expect(movePlayer).toHaveBeenCalled();
    fingerCancel(up);
    const afterCancel = movePlayer.mock.calls.length;
    raf.runFor(500, 60, act);
    expect(movePlayer.mock.calls.length).toBe(afterCancel);
  });
});
